export const HELPER_VERSION: string
export const CONTRACT_VERSION: string
export const DEFAULT_RECORD_PATH: string

export interface ProcessClassification {
  ok: boolean
  error?: string
}

export interface ProcessOutcome {
  spawnError: string | null
  timedOut: boolean
  signal: string | null
  exitCode: number | null
}

export interface ParsedReport {
  ok: boolean
  severity: {
    critical: number
    high: number
    medium: number
    low: number
    unknown: number
  }
  count: number
  summary: string
  error?: string
}

export function classifyProcess(outcome: ProcessOutcome): ProcessClassification
export function parseReport(format: string, raw: string): ParsedReport
export function redact(
  text: string,
  secretValues?: string[],
): { text: string; replacements: number }
