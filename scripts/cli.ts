// Minimal argv parsing shared by the four operator commands.
// No dependency: these are internal tools with an explicit, checked contract.

export interface ParsedArgs {
  command: string | null
  flags: Map<string, string>
  booleans: Set<string>
  positionals: string[]
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>()
  const booleans = new Set<string>()
  const positionals: string[] = []
  let command: string | null = null

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=', 2)
      if (inline !== undefined) {
        flags.set(name, inline)
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags.set(name, argv[i + 1])
        i += 1
      } else {
        booleans.add(name)
      }
    } else if (command === null) {
      command = token
    } else {
      positionals.push(token)
    }
  }

  return { command, flags, booleans, positionals }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export const requireFlag = (args: ParsedArgs, name: string): string => {
  const value = args.flags.get(name)
  if (!value) throw new UsageError(`--${name} is required`)
  return value
}

export function fail(error: unknown): never {
  const code = (error as { code?: string }).code
  const message = error instanceof Error ? error.message : String(error)
  console.error(code ? `${code}: ${message}` : message)
  process.exit(1)
}
