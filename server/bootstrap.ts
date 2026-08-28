// Validated startup and graceful lifecycle.
//
// Startup does exactly: load config, open the database, apply the connection
// invariants, run pending migrations, build the app, listen. There is no
// integrity scan, no backup, no repair and no unbounded work anywhere on this
// path — those are explicit operator commands (see scripts/recovery.ts).
import type { Server } from 'node:http'
import { openDatabase } from '../lib/db/connection.ts'
import type { AppDatabase } from '../lib/db/connection.ts'
import { createRepositories } from '../lib/db/repositories/index.ts'
import type { Lifecycle } from '../lib/health/readiness.ts'
import { buildIdentity } from '../lib/lineage/buildIdentity.ts'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import type { AppConfig } from './config.ts'

export interface RunningServer {
  server: Server
  config: AppConfig
  database: AppDatabase
  port: number
  close(): Promise<void>
}

export async function start(env: NodeJS.ProcessEnv = process.env): Promise<RunningServer> {
  const config = loadConfig(env)
  const identity = buildIdentity(env)

  let lifecycle: Lifecycle = 'starting'
  const database = openDatabase(config.database)
  const repos = createRepositories(database)

  const app = createApp({
    config,
    identity,
    repos,
    database: () => database,
    lifecycle: () => lifecycle,
  })

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, () => resolve(listening))
    listening.once('error', reject)
  })

  lifecycle = 'ready'
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  console.log(
    `ShapePilot ${identity.version} (build ${identity.build}) listening on :${port} `
    + `— database ${database.path}`,
  )
  if (config.auth.devBypass.enabled) {
    console.warn(
      'ShapePilot development auth bypass is ENABLED. '
      + 'This is refused when NODE_ENV=production.',
    )
  }

  const close = async (): Promise<void> => {
    lifecycle = 'draining'
    await new Promise<void>((resolve) => server.close(() => resolve()))
    database.close()
    lifecycle = 'stopped'
  }

  return { server, config, database, port, close }
}

export function installSignalHandlers(running: RunningServer): void {
  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`Received ${signal}; draining.`)
    running.close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('Shutdown failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
