import { createHash, randomUUID } from 'node:crypto'
import type {
  ElementAccount, ElementConnection, ElementConnectionState, ElementEventInput,
  ElementProblem, ElementSnapshot, ElementStatus,
} from '../../lib/contracts/elementStatistics.ts'
import type { ElementStatisticsRepository } from '../../lib/db/repositories/elementStatisticsContract.ts'
import type { ElementConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'
import { BambuProviderError, createBambuProvider } from './provider.ts'
import type { BambuProvider, BambuSubscription } from './provider.ts'
import { synchronizeHistory, SYNC_INTERVAL_MS } from './synchronization.ts'

export const SNAPSHOT_FRESH_MS = 3 * 60_000
export const TELEMETRY_SAMPLE_MS = 60_000
export const TELEMETRY_RETENTION_DAYS = 30
const ACTION_INTERVAL_MS = 30_000
const MAX_EVENT_BUFFER = 100

interface MonitorOptions {
  repository: ElementStatisticsRepository
  config: ElementConfig
  providerFactory?: () => BambuProvider
  now?: () => number
  /** Tests drive sync explicitly; production always uses the scheduler. */
  schedule?: boolean
  logger?: (message: string, detail: unknown) => void
}

export interface ElementSelection {
  enabled: boolean
  accountId?: string
  printerId?: string
}

export function elementProblem(error: unknown): ElementProblem {
  if (error instanceof BambuProviderError) return { code: error.code, message: error.message }
  if (error instanceof ApiError) return { code: error.code, message: error.message }
  return {
    code: 'recording_error',
    message: 'Statistics could not be recorded. Check the ShapePilot server logs and retry.',
  }
}

function expiredProblem(problem: ElementProblem): boolean {
  return /expired|unauthorized|credential|authentication|forbidden/.test(problem.code)
}

export class ElementMonitor {
  private readonly repository: ElementStatisticsRepository
  private readonly config: ElementConfig
  private readonly providerFactory: () => BambuProvider
  private readonly now: () => number
  private readonly automatic: boolean
  private readonly log: (message: string, detail: unknown) => void
  private provider: BambuProvider | null = null
  private subscription: BambuSubscription | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private sampleTimer: ReturnType<typeof setTimeout> | null = null
  private aborter = new AbortController()
  private work: Promise<void> | null = null
  private sampleWork: Promise<void> | null = null
  private state: ElementConnectionState = 'disabled'
  private problem: ElementProblem | null = null
  private liveProblem: ElementProblem | null = null
  private recordingProblem: ElementProblem | null = null
  private snapshot: ElementSnapshot | null = null
  private snapshotConnectionId: string | null = null
  private pendingSnapshot: { connectionId: string; snapshot: ElementSnapshot } | null = null
  private pendingEvents: ElementEventInput[] = []
  private pendingEventGap: ElementEventInput | null = null
  private lastQueuedEventKey: string | null = null
  private lastSampleAt = 0
  private lastDiscoveryAt: number | null = null
  private lastSelectionAt: number | null = null
  private verifiedAccount: { account: ElementAccount; at: number } | null = null
  private actionInFlight = false
  private syncAdmission = false
  private generation = 0
  private started = false
  private closed = false
  private lastPrinterState: string | null = null
  private lastPrinterError: string | null = null
  private lastBrokerState: string | null = null

  constructor(options: MonitorOptions) {
    this.repository = options.repository
    this.config = options.config
    this.providerFactory = options.providerFactory ?? (() => createBambuProvider({
      accessToken: options.config.accessToken!, region: options.config.region,
    }))
    this.now = options.now ?? Date.now
    this.automatic = options.schedule !== false
    this.log = options.logger ?? ((message, detail) => console.error(message, detail))
  }

  private isoNow(): string { return new Date(this.now()).toISOString() }

  private getProvider(): BambuProvider {
    if (!this.config.accessToken) {
      throw new ApiError(409, 'credential_missing', this.missingCredential().message)
    }
    this.provider ??= this.providerFactory()
    return this.provider
  }

  private missingCredential(): ElementProblem {
    return {
      code: this.config.unresolvedSecret ? 'credential_unresolved' : 'credential_missing',
      message: this.config.unresolvedSecret
        ? 'The server could not resolve SHAPEPILOT_BAMBU_ACCESS_TOKEN from its secret store. Fix the reference, then restart ShapePilot.'
        : 'Configure SHAPEPILOT_BAMBU_ACCESS_TOKEN in the server secret store, then restart ShapePilot and verify the connection.',
    }
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return
    this.started = true
    const settings = await this.repository.getSettings()
    if (settings.activeConnectionId) {
      this.snapshot = await this.repository.getSnapshot(settings.activeConnectionId)
      this.snapshotConnectionId = settings.activeConnectionId
      if (settings.enabled && this.snapshot
        && this.now() - Date.parse(this.snapshot.receivedAt) > SNAPSHOT_FRESH_MS) {
        await this.repository.recordEvent({
          connectionId: settings.activeConnectionId, occurredAt: this.isoNow(),
          kind: 'recording_gap', code: 'monitor_restarted', jobId: null,
          message: `Live recording resumed after the last saved report at ${this.snapshot.receivedAt}. The intervening telemetry is unavailable.`,
        })
      }
    }
    if (settings.enabled && this.config.accessToken) {
      const sync = settings.activeConnectionId
        ? await this.repository.getSyncState(settings.activeConnectionId) : null
      this.state = 'connecting'
      this.schedule(Math.max(0, Date.parse(sync?.nextSyncAt ?? '') - this.now()) || 0)
    }
  }

  private schedule(delay: number): void {
    if (!this.automatic || this.closed || !this.started) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.launch()
    }, Math.min(Math.max(0, delay), 3_600_000))
    this.timer.unref()
  }

  private launch(): void {
    if (this.work || this.closed) return
    const generation = this.generation
    this.work = this.runCycle(generation)
      .catch(error => {
        this.problem = elementProblem(error)
        this.state = 'error'
        this.log('EL-ement Statistics recording failed.', { code: this.problem.code })
        if (generation === this.generation) this.schedule(SYNC_INTERVAL_MS)
      })
      .finally(() => { this.work = null })
  }

  /** Used by shutdown and deterministic tests, not by an HTTP request. */
  async idle(): Promise<void> { await this.work }

  private async withAction<T>(kind: 'discover' | 'configure', action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ApiError(503, 'monitor_stopped', 'Monitoring is stopping. Retry after ShapePilot restarts.')
    const lastActionAt = kind === 'discover' ? this.lastDiscoveryAt : this.lastSelectionAt
    if (this.actionInFlight || this.syncAdmission
      || (lastActionAt !== null && this.now() - lastActionAt < ACTION_INTERVAL_MS)) {
      throw new ApiError(429, 'connection_rate_limited', 'Wait 30 seconds before repeating this Bambu connection action.')
    }
    this.actionInFlight = true
    if (kind === 'discover') this.lastDiscoveryAt = this.now()
    else this.lastSelectionAt = this.now()
    try {
      return await action()
    } catch (error) {
      const problem = elementProblem(error)
      this.problem = problem
      if (expiredProblem(problem)) this.state = 'expired'
      if (error instanceof ApiError) throw error
      if (error instanceof BambuProviderError) {
        throw new ApiError(expiredProblem(problem) ? 424 : 502, problem.code, problem.message)
      }
      this.log('EL-ement Statistics configuration failed.', { code: problem.code })
      throw new ApiError(500, problem.code, problem.message)
    } finally {
      this.actionInFlight = false
    }
  }

  async discover(): Promise<ElementAccount> {
    return this.withAction('discover', async () => {
      const account = await this.getProvider().discover(
        AbortSignal.any([this.aborter.signal, AbortSignal.timeout(40_000)]),
      )
      this.verifiedAccount = { account, at: this.now() }
      this.problem = null
      return account
    })
  }

  async configure(selection: ElementSelection): Promise<void> {
    if (!selection.enabled) {
      if (this.closed) throw new ApiError(503, 'monitor_stopped', 'Monitoring is stopping.')
      if (this.actionInFlight || this.syncAdmission) {
        throw ApiError.conflict('Wait for the current connection action to finish before disabling monitoring.')
      }
      this.actionInFlight = true
      try {
        const settings = await this.repository.getSettings()
        await this.repository.saveSettings({ ...settings, enabled: false, updatedAt: this.isoNow() })
        await this.stopWork()
        this.state = 'disabled'
        this.problem = null
        this.liveProblem = null
      } finally {
        this.actionInFlight = false
      }
      return
    }
    await this.withAction('configure', async () => {
      const account = this.verifiedAccount && this.now() - this.verifiedAccount.at < ACTION_INTERVAL_MS
        ? this.verifiedAccount.account
        : await this.getProvider().discover(
          AbortSignal.any([this.aborter.signal, AbortSignal.timeout(40_000)]),
        )
      if (account.accountId !== selection.accountId || account.region !== this.config.region) {
        throw new ApiError(409, 'account_mismatch', 'The configured Bambu account changed. Verify the connection and select its printer again; existing history is retained.')
      }
      const printer = account.printers.find(item => item.id === selection.printerId)
      if (!printer) {
        throw new ApiError(409, 'printer_mismatch', 'That printer is not bound to the verified Bambu account. Verify the connection and choose a listed printer.')
      }
      const now = this.isoNow()
      const connection: ElementConnection = {
        id: createHash('sha256')
          .update(`${account.region}\0${account.accountId}\0${printer.id}`).digest('hex'),
        accountId: account.accountId, accountName: account.name, region: account.region,
        printerId: printer.id, printerName: printer.name, printerModel: printer.model,
        createdAt: now, updatedAt: now,
      }
      await this.repository.saveConnection(connection)
      await this.repository.saveSettings({
        enabled: true, activeConnectionId: connection.id, updatedAt: now,
      })
      await this.stopWork()
      this.verifiedAccount = null
      this.snapshotConnectionId = connection.id
      this.snapshot = await this.repository.getSnapshot(connection.id)
      this.problem = null
      this.liveProblem = null
      this.state = 'connecting'
      this.started = true
      this.schedule(0)
    })
  }

  async requestSync(rescan = false): Promise<boolean> {
    if (this.closed) throw new ApiError(503, 'monitor_stopped', 'Monitoring is stopping.')
    if (this.actionInFlight) throw ApiError.conflict('Wait for connection setup to finish before syncing.')
    if (this.work || this.syncAdmission) return false
    this.syncAdmission = true
    try {
      const settings = await this.repository.getSettings()
      if (!settings.enabled || !settings.activeConnectionId || !this.config.accessToken) {
        throw new ApiError(409, 'monitor_disabled', 'Configure and enable the household printer connection before syncing.')
      }
      const sync = await this.repository.getSyncState(settings.activeConnectionId)
      if ((sync.lastAttemptAt && this.now() - Date.parse(sync.lastAttemptAt) < ACTION_INTERVAL_MS)
        || (sync.consecutiveFailures > 0 && sync.nextSyncAt && this.now() < Date.parse(sync.nextSyncAt))) {
        throw new ApiError(429, 'sync_backoff', 'Bambu sync is cooling down. Wait until the next scheduled attempt before retrying.')
      }
      if (rescan) {
        await this.repository.saveSyncState({
          ...sync, backfillCursor: null, backfillComplete: false,
          backfillStartedAt: this.isoNow(), backfillSeenCursors: [], backfillPages: 0,
          refreshCursor: null, refreshBoundary: null, refreshSeenCursors: [],
        })
      }
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.started = true
      this.launch()
      return true
    } finally {
      this.syncAdmission = false
    }
  }

  private async runCycle(generation: number): Promise<void> {
    const settings = await this.repository.getSettings()
    if (!settings.enabled || !settings.activeConnectionId || !this.config.accessToken) return
    const connection = (await this.repository.listConnections())
      .find(item => item.id === settings.activeConnectionId)
    if (!connection) {
      this.state = 'selection_required'
      this.problem = { code: 'selection_required', message: 'Verify the Bambu connection and select the household printer.' }
      return
    }
    const signal = this.aborter.signal
    let sync = await this.repository.getSyncState(connection.id)
    const previousProblem = sync.problem
    sync.lastAttemptAt = this.isoNow()
    sync.nextSyncAt = null
    await this.repository.saveSyncState(sync)
    try {
      const provider = this.getProvider()
      const account = await provider.discover(signal)
      signal.throwIfAborted()
      if (account.accountId !== connection.accountId || account.region !== connection.region) {
        this.state = 'selection_required'
        throw new ApiError(409, 'account_mismatch', 'The server credential belongs to a different Bambu account or region. Verify and select its printer; previous history is retained.')
      }
      const printer = account.printers.find(item => item.id === connection.printerId)
      if (!printer) {
        this.state = 'selection_required'
        throw new ApiError(409, 'printer_mismatch', 'The selected printer is no longer bound to this Bambu account. Verify the connection and select a listed printer.')
      }
      if (!this.subscription) {
        this.state = 'connecting'
        try {
          this.subscription = await provider.subscribe(account.accountId, printer.id, {
            onSnapshot: snapshot => {
              if (generation !== this.generation || this.closed) return
              this.state = 'connected'
              this.liveProblem = null
              this.problem = null
              this.receiveSnapshot(connection.id, snapshot)
            },
            onState: (state, problem) => {
              if (generation !== this.generation || this.closed) return
              this.state = state === 'connected' && printer.online === false ? 'offline' : state
              this.liveProblem = problem
              this.problem = problem
              if (state !== this.lastBrokerState) {
                this.lastBrokerState = state
                this.queueEvent({
                  connectionId: connection.id, occurredAt: this.isoNow(), kind: 'connection',
                  code: state, jobId: null,
                  message: problem?.message ?? `Bambu status subscription: ${state}.`,
                })
              }
            },
          })
        } catch (error) {
          this.problem = elementProblem(error)
          this.liveProblem = this.problem
          if (expiredProblem(this.problem)) throw error
          this.state = 'offline'
          this.queueEvent({
            connectionId: connection.id, occurredAt: this.isoNow(), kind: 'connection',
            code: this.problem.code, message: this.problem.message, jobId: null,
          })
        }
      }
      sync = await synchronizeHistory({
        repository: this.repository, provider, connectionId: connection.id,
        printerId: connection.printerId, signal, now: this.now,
      })
      this.problem = this.liveProblem
      if (previousProblem) {
        await this.repository.recordEvent({
          connectionId: connection.id, occurredAt: this.isoNow(), kind: 'sync_recovered',
          code: 'history_sync_recovered', message: 'Cloud history sync recovered. Imported jobs were retained.', jobId: null,
        })
      }
      await this.repository.pruneTelemetry(
        new Date(this.now() - TELEMETRY_RETENTION_DAYS * 86_400_000).toISOString(),
      )
      if (generation === this.generation) this.schedule(SYNC_INTERVAL_MS)
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return
      const problem = elementProblem(error)
      this.problem = problem
      const needsSelection = problem.code === 'account_mismatch' || problem.code === 'printer_mismatch'
      const expired = expiredProblem(problem)
      if (expired) this.state = 'expired'
      else if (needsSelection) this.state = 'selection_required'
      else if (this.state !== 'connected') this.state = 'error'
      sync = await this.repository.getSyncState(connection.id)
      const failures = Math.min(sync.consecutiveFailures + 1, 20)
      const backoff = Math.min(3_600_000, Math.max(
        60_000 * 2 ** Math.min(failures - 1, 6),
        error instanceof BambuProviderError ? error.retryAfterMs ?? 0 : 0,
      ))
      await this.repository.saveSyncState({
        ...sync, consecutiveFailures: failures, problem,
        nextSyncAt: expired || needsSelection ? null : new Date(this.now() + backoff).toISOString(),
      })
      if (previousProblem?.code !== problem.code) {
        await this.repository.recordEvent({
          connectionId: connection.id, occurredAt: this.isoNow(), kind: 'sync_error',
          code: problem.code, message: problem.message, jobId: null,
        })
      }
      this.log('EL-ement Statistics sync failed.', { code: problem.code })
      if (!expired && !needsSelection) this.schedule(backoff)
    }
  }

  private receiveSnapshot(connectionId: string, snapshot: ElementSnapshot): void {
    this.snapshot = snapshot
    this.snapshotConnectionId = connectionId
    this.pendingSnapshot = { connectionId, snapshot }
    const stateKey = JSON.stringify([snapshot.jobId, snapshot.state])
    if (stateKey !== this.lastPrinterState) {
      this.lastPrinterState = stateKey
      this.queueEvent({
        connectionId, occurredAt: snapshot.receivedAt, kind: 'printer_state',
        code: snapshot.state ?? 'unreported', jobId: snapshot.jobId,
        message: `Printer state: ${snapshot.state ?? 'unreported'}.`,
      })
    }
    const errorKey = JSON.stringify([snapshot.printError, snapshot.hms])
    if (errorKey !== this.lastPrinterError && (snapshot.printError !== null || snapshot.hms !== null)) {
      this.lastPrinterError = errorKey
      const message = `Print error: ${snapshot.printError ?? 'unreported'}; HMS: ${
        snapshot.hms === null ? 'unreported' : snapshot.hms.length === 0
          ? 'no issues reported' : snapshot.hms.map(issue =>
            issue.attribute === null ? issue.code : `${issue.code} (${issue.attribute})`).join(', ')
      }.`
      this.queueEvent({
        connectionId, occurredAt: snapshot.receivedAt, kind: 'printer_error',
        code: snapshot.printError ?? 'hms_report', jobId: snapshot.jobId,
        message: message.length <= 1_000 ? message : `${message.slice(0, 970)}... [HMS details truncated]`,
      }, errorKey)
    }
    this.scheduleSample()
  }

  private queueEvent(event: ElementEventInput, observationKey: string | null = null): void {
    const key = JSON.stringify([
      event.connectionId, event.kind, event.code, event.jobId, event.message,
      event.occurredAt.slice(0, 16), observationKey,
    ])
    if (key === this.lastQueuedEventKey && (this.pendingEvents.length > 0 || this.pendingEventGap)) return
    this.lastQueuedEventKey = key
    if (this.pendingEvents.length < MAX_EVENT_BUFFER) {
      this.pendingEvents.push({ ...event, occurrenceId: randomUUID() })
    } else if (!this.pendingEventGap) {
      this.pendingEventGap = {
        occurrenceId: randomUUID(),
        connectionId: event.connectionId, occurredAt: event.occurredAt, kind: 'recording_gap',
        code: 'events_coalesced', jobId: null,
        message: 'More than 100 state changes arrived within a sampling interval. Additional transitions were coalesced; the latest snapshot was retained.',
      }
    }
    this.scheduleSample()
  }

  private scheduleSample(): void {
    if (this.sampleTimer || this.closed || !this.automatic) return
    this.sampleTimer = setTimeout(() => {
      this.sampleTimer = null
      this.sampleWork = this.flushObservations()
        .catch(error => {
          this.recordingProblem = elementProblem(error)
          this.log('EL-ement Statistics telemetry could not be recorded.', { code: this.recordingProblem.code })
        })
        .finally(() => {
          this.sampleWork = null
          if (this.pendingSnapshot || this.pendingEvents.length > 0 || this.pendingEventGap) this.scheduleSample()
        })
    }, Math.max(0, this.lastSampleAt + TELEMETRY_SAMPLE_MS - this.now()))
    this.sampleTimer.unref()
  }

  private async flushObservations(): Promise<void> {
    this.lastSampleAt = this.now()
    const snapshot = this.pendingSnapshot
    if (snapshot) {
      await this.repository.recordSnapshot(snapshot.connectionId, snapshot.snapshot)
      if (this.pendingSnapshot === snapshot) this.pendingSnapshot = null
    }
    const batch = this.pendingEvents.slice()
    const gap = this.pendingEventGap
    for (const event of batch) {
      await this.repository.recordEvent(event)
      if (this.pendingEvents[0] === event) this.pendingEvents.shift()
    }
    if (gap) {
      await this.repository.recordEvent(gap)
      if (this.pendingEventGap === gap) this.pendingEventGap = null
    }
    if (this.pendingEvents.length === 0 && !this.pendingEventGap) this.lastQueuedEventKey = null
    this.recordingProblem = null
  }

  private async stopWork(): Promise<void> {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    if (this.sampleTimer) clearTimeout(this.sampleTimer)
    this.timer = null
    this.sampleTimer = null
    this.aborter.abort()
    if (this.provider) await this.provider.close()
    await this.work
    await this.sampleWork
    await this.flushObservations()
    if (this.sampleTimer) clearTimeout(this.sampleTimer)
    this.sampleTimer = null
    this.provider = null
    this.subscription = null
    this.aborter = new AbortController()
    this.lastPrinterState = null
    this.lastPrinterError = null
    this.lastBrokerState = null
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.stopWork()
  }

  async status(): Promise<ElementStatus> {
    const [settings, connections, coverage, events] = await Promise.all([
      this.repository.getSettings(), this.repository.listConnections(),
      this.repository.coverage(), this.repository.listEvents(null, 50),
    ])
    let snapshot = this.snapshotConnectionId === settings.activeConnectionId ? this.snapshot : null
    if (!snapshot && settings.activeConnectionId) {
      snapshot = await this.repository.getSnapshot(settings.activeConnectionId)
    }
    let state = this.state
    let problem = this.recordingProblem ?? this.problem
      ?? coverage.find(item => item.connectionId === settings.activeConnectionId)?.sync.problem ?? null
    if (!this.config.accessToken) {
      state = 'unconfigured'
      problem = this.missingCredential()
    } else if (!settings.enabled) {
      state = 'disabled'
      if (!expiredProblem(problem ?? { code: '', message: '' })) problem = null
    } else if (!settings.activeConnectionId) {
      state = 'selection_required'
    }
    const expiresAt = this.config.accessToken ? this.getProvider().expiresAt : null
    if (settings.enabled && expiresAt && Date.parse(expiresAt) <= this.now()) {
      state = 'expired'
      problem = { code: 'credential_expired', message: 'The Bambu access token has expired. Replace SHAPEPILOT_BAMBU_ACCESS_TOKEN in the server secret store, restart ShapePilot, and verify the connection again.' }
    }
    return {
      settings, credential: {
        configured: this.config.accessToken !== null, region: this.config.region, expiresAt,
      },
      connectionState: state, problem, connections, snapshot,
      snapshotConnectionId: snapshot ? settings.activeConnectionId : null,
      freshness: !snapshot ? 'unavailable'
        : state === 'connected' && this.now() - Date.parse(snapshot.receivedAt) <= SNAPSHOT_FRESH_MS
          ? 'fresh' : 'stale',
      syncing: this.work !== null, coverage, events, checkedAt: this.isoNow(),
    }
  }
}
