import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import type { ElementJob, ElementQuery, ElementReport } from '../../lib/contracts/elementStatistics.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { ApiError } from '../errors/ApiError.ts'
import type { ElementMonitor, ElementSelection } from '../element/monitor.ts'
import {
  createElementReport, elementUtcBounds, filteredElementJobs, parseElementQuery,
} from '../element/reporting.ts'
import { elementCsv, elementPrintableHtml } from '../element/exports.ts'
import { REPORT_JOB_LIMIT } from '../element/synchronization.ts'

interface ElementRouterOptions {
  repos: Repositories
  monitor: ElementMonitor
}

function objectBody(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('A JSON object is required.')
  }
  const object = body as Record<string, unknown>
  if (Object.keys(object).some(key => !keys.includes(key))) {
    throw ApiError.badRequest('The request contains an unsupported field.')
  }
  return object
}

function selectionBody(body: unknown): ElementSelection {
  const value = objectBody(body, ['enabled', 'accountId', 'printerId'])
  if (typeof value.enabled !== 'boolean') throw ApiError.badRequest('enabled must be a boolean.')
  if (!value.enabled) return { enabled: false }
  if (typeof value.accountId !== 'string' || !/^\d{1,32}$/.test(value.accountId)
    || typeof value.printerId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.printerId)) {
    throw ApiError.badRequest('Select an account and printer returned by connection verification.')
  }
  return { enabled: true, accountId: value.accountId, printerId: value.printerId }
}

/** Mounted behind both authenticated and database-rechecked admin middleware. */
export function createElementStatisticsRouter({ repos, monitor }: ElementRouterOptions): Router {
  const router = Router()
  let activeReports = 0
  const repository = repos.elementStatistics
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    next()
  })

  const reportData = async (query: ElementQuery): Promise<{
    report: ElementReport; filteredJobs: ElementJob[]
  }> => {
    if (activeReports >= 2) {
      throw new ApiError(429, 'report_busy', 'Two statistics reports are already being prepared. Retry shortly.')
    }
    activeReports += 1
    try {
      const [jobs, connections, coverage] = await Promise.all([
        repository.listJobs(query.filters.connectionId, REPORT_JOB_LIMIT + 1, elementUtcBounds(query.filters)),
        repository.listConnections(), repository.coverage(),
      ])
      if (query.filters.connectionId && !connections.some(item => item.id === query.filters.connectionId)) {
        throw ApiError.notFound('That recorded printer connection does not exist.')
      }
      if (jobs.length > REPORT_JOB_LIMIT) {
        throw new ApiError(413, 'report_limit', 'This date/printer scope exceeds 50,000 recorded jobs. Narrow the date range or select a single printer connection; the durable ledger has not been truncated.')
      }
      return {
        report: createElementReport(jobs, connections, coverage, query),
        filteredJobs: filteredElementJobs(jobs, query.filters),
      }
    } finally {
      activeReports -= 1
    }
  }

  router.get('/status', (_req, res, next) => {
    void monitor.status().then(status => res.json(status)).catch(next)
  })

  router.post('/discover', (req, res, next) => {
    void (async () => {
      objectBody(req.body, [])
      res.json(await monitor.discover())
    })().catch(next)
  })

  router.put('/connection', (req, res, next) => {
    void (async () => {
      const selection = selectionBody(req.body)
      await monitor.configure(selection)
      await repos.audit.record({
        owner: ownerOf(req), category: 'element_statistics',
        action: selection.enabled ? 'monitoring_enabled' : 'monitoring_disabled',
        outcome: 'success', requestId: req.requestId,
        detail: { enabled: selection.enabled },
      })
      res.json(await monitor.status())
    })().catch(next)
  })

  router.post('/sync', (req, res, next) => {
    void (async () => {
      const body = objectBody(req.body, ['rescan'])
      if (body.rescan !== undefined && typeof body.rescan !== 'boolean') {
        throw ApiError.badRequest('rescan must be a boolean.')
      }
      const started = await monitor.requestSync(body.rescan === true)
      res.status(202).json({ started })
    })().catch(next)
  })

  router.get('/report', (req, res, next) => {
    void (async () => {
      const { report } = await reportData(parseElementQuery(req.query))
      res.json(report)
    })().catch(next)
  })

  router.get('/jobs/:connectionId/:jobId', (req, res, next) => {
    void (async () => {
      const { connectionId, jobId } = req.params
      if (!/^[a-f0-9]{64}$/.test(connectionId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) {
        throw ApiError.badRequest('The recorded job address is invalid.')
      }
      const [job, connections] = await Promise.all([
        repository.getJob(connectionId, jobId), repository.listConnections(),
      ])
      const connection = connections.find(item => item.id === connectionId)
      if (!job || !connection) throw ApiError.notFound('That recorded job does not exist.')
      res.json({
        job, connection,
        events: await repository.listEvents(connectionId, 100, jobId),
      })
    })().catch(next)
  })

  router.get(['/export/jobs.csv', '/export/materials.csv', '/export/summary.csv'], (req, res, next) => {
    void (async () => {
      const kind = req.path === '/export/materials.csv' ? 'materials'
        : req.path === '/export/summary.csv' ? 'summary' : 'jobs'
      const { report, filteredJobs } = await reportData(parseElementQuery(req.query))
      res.setHeader('content-disposition', `attachment; filename="el-ement-statistics-${kind}.csv"`)
      res.type('text/csv').send(elementCsv(report, filteredJobs, kind))
    })().catch(next)
  })

  router.get('/report.html', (req, res, next) => {
    void (async () => {
      const { report, filteredJobs } = await reportData(parseElementQuery(req.query))
      res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      res.setHeader('content-disposition', 'inline; filename="el-ement-statistics-report.html"')
      res.type('html').send(elementPrintableHtml(report, filteredJobs))
    })().catch(next)
  })

  return router
}
