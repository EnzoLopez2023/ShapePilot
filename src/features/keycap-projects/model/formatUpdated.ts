// SQLite writes `datetime('now')`, which is UTC without a zone marker: the
// string '2026-08-30 12:00:00'. Handing that to `new Date` reads it as local
// time in some engines and fails outright in others, so the marker is added
// before parsing. A value that still will not parse is shown as it came.
export function formatUpdated(raw: string): string {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString()
}
