import { installSignalHandlers, start } from './bootstrap.ts'

try {
  const running = await start()
  installSignalHandlers(running)
} catch (error) {
  console.error(
    'ShapePilot failed to start:',
    error instanceof Error ? error.message : String(error),
  )
  process.exit(1)
}
