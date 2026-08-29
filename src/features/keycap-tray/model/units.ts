// mm <-> imperial-fraction conversion for the designer's display layer. Every
// value is still stored and computed in millimetres -- this only touches how
// numbers are typed and read.
const MM_PER_INCH = 25.4

export const mmToInches = (mm: number): number => mm / MM_PER_INCH
export const inchesToMm = (inches: number): number => inches * MM_PER_INCH

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** Nearest 1/32" fraction, e.g. 9.525 mm -> `3/8"`, 31.75 mm -> `1-1/4"`. */
export function formatImperial(mm: number, denom = 32): string {
  const inches = mmToInches(mm)
  const sign = inches < 0 ? '-' : ''
  const abs = Math.abs(inches)
  let whole = Math.trunc(abs)
  let frac = Math.round((abs - whole) * denom)
  if (frac === denom) { frac = 0; whole += 1 }
  if (frac === 0) return `${sign}${whole}"`
  const g = gcd(frac, denom)
  const n = frac / g, d = denom / g
  return whole === 0 ? `${sign}${n}/${d}"` : `${sign}${whole}-${n}/${d}"`
}

export const formatMm = (mm: number): string => `${+mm.toFixed(3)}`

export const formatLength = (mm: number, imperial: boolean): string =>
  imperial ? formatImperial(mm) : formatMm(mm)

/**
 * Accepts `1-3/8"`, `3/8`, `1.25`, or a bare decimal (read as inches when
 * `imperial`, millimetres otherwise). Returns null for unparseable input so
 * the caller can fall back to the last-known value instead of zeroing it.
 */
export function parseLength(raw: string, imperial: boolean): number | null {
  const s = raw.trim().replace(/["\s]+$/, '')
  if (!s) return null
  if (!imperial) {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }
  const fraction = s.match(/^(-)?(\d+)\/(\d+)$/)
  if (fraction) {
    const [, neg, num, den] = fraction
    const f = parseFloat(num) / parseFloat(den)
    if (!Number.isFinite(f)) return null
    return inchesToMm((neg ? -1 : 1) * f)
  }
  const mixed = s.match(/^(-)?(\d+(?:\.\d+)?)(?:[\s-](\d+)\/(\d+))?$/)
  if (mixed) {
    const [, neg, whole, num, den] = mixed
    const w = whole ? parseFloat(whole) : 0
    const f = num && den ? parseFloat(num) / parseFloat(den) : 0
    if (!Number.isFinite(w + f)) return null
    return inchesToMm((neg ? -1 : 1) * (w + f))
  }
  // Bare decimal read as inches, e.g. "1.25".
  const n = parseFloat(s)
  return Number.isFinite(n) ? inchesToMm(n) : null
}
