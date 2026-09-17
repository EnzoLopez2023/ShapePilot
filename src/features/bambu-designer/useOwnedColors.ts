// The filament colours on the shelf, for a part to be coloured with.
import { useEffect, useMemo, useState } from 'react'
import { filamentByKey, filamentLineById } from '../../../lib/contracts/bambuFilaments.ts'
import { getFilaments } from '../filaments/service.ts'

export interface OwnedColor {
  key: string
  label: string
  hexes: readonly string[]
}

/** The colours on the shelf, each once, however many spools and refills of it. */
export function useOwnedColors(): OwnedColor[] {
  const [keys, setKeys] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void getFilaments()
      .then(owned => { if (!cancelled) setKeys([...new Set(owned.map(tick => tick.key))]) })
      .catch(() => { /* the field simply offers nothing */ })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => keys.flatMap(key => {
    const color = filamentByKey(key)
    if (!color) return []
    const line = filamentLineById(color.line)
    return [{
      key,
      label: `${line?.label ?? ''} ${color.name}`.trim(),
      hexes: color.hexes,
    }]
  }).sort((a, b) => a.label.localeCompare(b.label)), [keys])
}

