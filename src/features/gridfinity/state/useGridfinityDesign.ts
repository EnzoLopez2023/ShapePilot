import { useCallback, useMemo } from 'react'
import { useDesignHistory } from '../../../state/useDesignHistory.ts'
import type {
  GridfinityBaseplateParams, GridfinityBinParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { emptyDesign, type GridfinityDesign, type GridfinityKind } from '../model/types.ts'

export function useGridfinityDesign() {
  const h = useDesignHistory<GridfinityDesign>(() => emptyDesign())
  const { replace } = h
  const setKind = useCallback(
    (kind: GridfinityKind) => replace(d => {
      if (d.kind === kind) return d
      // A name nobody chose follows the kind; one they typed stays.
      const name = d.name === emptyDesign(d.kind).name ? emptyDesign(kind).name : d.name
      return { ...d, kind, name }
    }), [replace])
  const setName = useCallback((name: string) => replace(d => ({ ...d, name })), [replace])
  const setBin = useCallback(
    (patch: Partial<GridfinityBinParams>) => replace(d => ({ ...d, bin: { ...d.bin, ...patch } })),
    [replace])
  const setBaseplate = useCallback(
    (patch: Partial<GridfinityBaseplateParams>) =>
      replace(d => ({ ...d, baseplate: { ...d.baseplate, ...patch } })),
    [replace])
  return useMemo(
    () => ({ ...h, setKind, setName, setBin, setBaseplate }),
    [h, setKind, setName, setBin, setBaseplate])
}
