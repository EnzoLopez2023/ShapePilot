// What is left of the set, while the tray is being laid out.
//
// The count spans the whole project, not this tray: a set is cut across several
// trays and "what still needs a home" is a question about the set. Everything
// on other trays comes from the server; this tray's pockets are read live, so
// the numbers move as pockets are dragged in, before anything is saved.
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { allocateSet } from '../../keycap-projects/model/allocation.ts'
import type { PocketShape } from '../../keycap-projects/model/allocation.ts'
import type { CoverageRow, SetItem } from '../../keycap-projects/model/types.ts'
import type { PocketSizing } from '../geometry/shapes.ts'
import type { Pocket } from '../model/types.ts'

export interface SetCoveragePanelProps {
  projectId: string
  projectName: string
  items: SetItem[]
  /** Every other tray in the project, already grouped by size. */
  otherTrays: CoverageRow[]
  /** This tray, live -- including edits that have not been saved. */
  pockets: readonly Pocket[]
  sizing: PocketSizing
}

/** Coverage rows are counts; allocation wants one entry per pocket. */
const expand = (coverage: readonly CoverageRow[]): PocketShape[] =>
  coverage.flatMap(row => Array.from({ length: row.pockets }, () => ({
    units: row.units,
    heightUnits: row.heightUnits,
    shape: row.shape,
  })))

export default function SetCoveragePanel(props: SetCoveragePanelProps) {
  const { projectId, projectName, items, otherTrays, pockets, sizing } = props

  const live: PocketShape[] = pockets.map(p => ({
    units: p.units,
    heightUnits: p.heightUnits ?? 1,
    shape: p.shape ?? null,
  }))
  const result = allocateSet(items, [...expand(otherTrays), ...live], sizing)

  if (!result.owned) {
    return (
      <Typography variant="body2" color="text.secondary">
        <Box component={RouterLink} to={`/projects/${projectId}`} sx={{ color: 'inherit' }}>
          {projectName}
        </Box>
        {' has no caps listed yet.'}
      </Typography>
    )
  }

  const percent = Math.round((result.placed / result.owned) * 100)
  const unplaced = result.rows.filter(row => row.left > 0)

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {result.placed} of {result.owned} placed
          {result.left > 0 && ` · ${result.left} to go`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-label={`${percent}% of the set has a pocket`}
          sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover' }}
        />
      </Box>

      <Tooltip title="A long pocket holds as many 1u caps as fit across it, so merging a row into one trough still counts every cap in it.">
        <Typography variant="body2">
          {result.oneUnit.left > 0
            ? `${result.oneUnit.left} more 1u ${result.oneUnit.left === 1 ? 'cap needs' : 'caps need'} room`
            : `every 1u cap has room${result.oneUnit.spare > 0 ? ` · ${result.oneUnit.spare} spare` : ''}`}
        </Typography>
      </Tooltip>

      {unplaced.length > 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Still needs its own pocket
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {unplaced.map(row => (
              <Box
                key={row.key}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 0.75, py: 0.25 }}
              >
                <Typography variant="body2">
                  {row.label} × {row.left}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {!unplaced.length && result.left === 0 && (
        <Typography variant="body2">The whole set has a home.</Typography>
      )}
    </Stack>
  )
}
