export interface VerificationOptions {
  baseUrl: URL
  livePath: string
  readyPath: string
  expectedSha: string
  expectedBuildId: string
  attempts: number
  confirmations: number
  intervalMs: number
  requestTimeoutMs: number
  runToken: string
  previousInstanceId: string | null
}

export interface VerificationResult {
  instanceId: string
  confirmations: number
}

export function parseArguments(argv: string[]): VerificationOptions
export function verifyDeployment(options: VerificationOptions): Promise<VerificationResult>
