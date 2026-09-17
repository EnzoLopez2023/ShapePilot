// Where the usage numbers come from, and the place to settle what the matcher
// could not.
//
// Unmatched filament is listed largest first, because a few hundred grams of an
// unlinked colour is a reorder warning that will never fire, and a crumb of
// purge is not worth anyone's attention. Each row is one decision -- which
// colour is this, or don't track it -- and it saves the moment it is made, like
// every other control on this page.
//
// Links stay listed beneath, with a way back. A link is a claim about what was
// in the AMS, and the person who made it is the one who may later know better.
import { useMemo } from 'react'
import {
  Autocomplete, Box, Button, Link, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { FILAMENT_CATALOG } from '../../../../lib/contracts/bambuFilaments.ts'
import { sourceId } from '../../../../lib/contracts/filamentUsage.ts'
import type {
  FilamentSource, FilamentUsage, FilamentUsageMapping, UnmatchedUsage,
} from '../../../../lib/contracts/filamentUsage.ts'
import { colorLabel, formatGrams, sourceLabel } from '../model/usage.ts'
import { costOf, formatMoney } from '../model/cost.ts'
import type { FilamentPrice } from '../service.ts'
import { Swatch } from './Swatch.tsx'
import ReminderControl from './ReminderControl.tsx'

export interface UsagePanelProps {
  usage: FilamentUsage
  busy: boolean
  /** What the account pays per kilogram, per line. Unpriced lines cost nothing. */
  prices: readonly FilamentPrice[]
  /** Replace every link. The page saves and reloads usage. */
  onMappings: (mappings: FilamentUsageMapping[]) => void
}

interface Choice {
  /** A catalogue key, or null for "don't track". */
  key: string | null
  label: string
  group: string
}

const DONT_TRACK: Choice = { key: null, label: 'Don’t track this filament', group: 'Not a catalogue colour' }

const CURRENT_COLORS = FILAMENT_CATALOG.filter(color => !color.discontinued)

function choicesFor(entry: UnmatchedUsage): Choice[] {
  const suggested = new Set(entry.candidates)
  return [
    DONT_TRACK,
    ...entry.candidates.map(key => ({ key, label: colorLabel(key), group: 'Closest colours' })),
    ...CURRENT_COLORS
      .filter(color => !suggested.has(color.key))
      .map(color => ({ key: color.key, label: colorLabel(color.key), group: 'Every colour' })),
  ]
}

const hexesOf = (source: FilamentSource): string[] => (source.color ? [source.color] : ['#9E9E9E'])

const formatSince = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(iso))

export default function UsagePanel({ usage, busy, prices, onMappings }: UsagePanelProps) {
  // Only the colours the matcher is sure of can be priced: an unlinked filament
  // has no line, so its grams are counted as unpriced rather than guessed at.
  const cost = useMemo(() => costOf(usage.colors, prices), [usage.colors, prices])
  const untrackedGrams = useMemo(
    () => new Map(usage.untracked.map(entry => [sourceId(entry), entry.grams])), [usage.untracked])

  const link = ({ material, filamentId, color }: FilamentSource, key: string | null) => {
    // Only the three identifying fields: an unmatched row also carries its
    // totals and suggestions, and the server refuses a source with extras.
    const source = { material, filamentId, color }
    const others = usage.mappings.filter(mapping => sourceId(mapping.source) !== sourceId(source))
    onMappings([...others, { source, key }])
  }

  const unlink = (source: FilamentSource) => {
    onMappings(usage.mappings.filter(mapping => sourceId(mapping.source) !== sourceId(source)))
  }

  const unmatchedGrams = usage.unmatched.reduce((total, entry) => total + entry.grams, 0)
  const failedGrams = [...usage.colors, ...usage.unmatched, ...usage.untracked]
    .reduce((total, entry) => total + entry.failedGrams, 0)

  return (
    <Paper component="section" aria-labelledby="usage-heading" sx={{ p: 2 }}>
      <Typography variant="h2" component="h2" id="usage-heading">Print usage</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {usage.coverage.prints === 0
          ? 'No recorded prints yet. '
          : <>
            {formatGrams(usage.coverage.grams)} across {usage.coverage.prints} prints
            {usage.coverage.since && <> since {formatSince(usage.coverage.since)}</>}
            {'. '}
          </>}
        Slicer estimates from{' '}
        <Link component={RouterLink} to="/admin/el-ement-statistics">EL-ement Statistics</Link>
        {failedGrams > 0 && (
          <>; failed and aborted prints count in full ({formatGrams(failedGrams)})</>
        )}
        .
      </Typography>

      {(cost.amount !== null || cost.mixedCurrencies) && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {cost.mixedCurrencies
            ? 'Your lines are priced in more than one currency, so there is no single total.'
            : <>
              <Box component="span" sx={{ fontWeight: 650 }}>
                {formatMoney(cost.amount!, cost.currency!)}
              </Box>
              {' '}of filament, from the {formatGrams(cost.pricedGrams)} on priced lines
              {cost.unpricedGrams > 0 && <> ({formatGrams(cost.unpricedGrams)} unpriced)</>}.
            </>}
        </Typography>
      )}

      {usage.unmatched.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h3" component="h3" sx={{ fontSize: '1rem', fontWeight: 650 }}>
            Not linked to a colour · {formatGrams(unmatchedGrams)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 1 }}>
            These prints reported a filament the catalogue could not be sure of. Say what
            each one is once, and every print like it follows.
          </Typography>
          <Stack sx={{ gap: 1 }}>
            {usage.unmatched.map(entry => (
              <Stack
                key={sourceId(entry)}
                direction={{ xs: 'column', sm: 'row' }}
                sx={{
                  gap: 1,
                  alignItems: { xs: 'stretch', sm: 'center' },
                  py: 1,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <Swatch hexes={hexesOf(entry)} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{sourceLabel(entry)}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatGrams(entry.grams)} · {entry.prints} {entry.prints === 1 ? 'print' : 'prints'}
                    </Typography>
                  </Box>
                </Stack>
                <Autocomplete<Choice>
                  size="small"
                  disabled={busy}
                  options={choicesFor(entry)}
                  groupBy={choice => choice.group}
                  getOptionLabel={choice => choice.label}
                  isOptionEqualToValue={(a, b) => a.key === b.key}
                  value={null}
                  onChange={(_event, choice) => { if (choice) link(entry, choice.key) }}
                  sx={{ width: { xs: '100%', sm: 280 } }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="This is…"
                      inputProps={{
                        ...params.inputProps,
                        'aria-label': `What ${sourceLabel(entry)} is`,
                      }}
                    />
                  )}
                />
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {usage.mappings.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h3" component="h3" sx={{ fontSize: '1rem', fontWeight: 650, mb: 0.5 }}>
            Your links
          </Typography>
          <Stack>
            {usage.mappings.map(mapping => {
              const grams = mapping.key === null ? untrackedGrams.get(sourceId(mapping.source)) : undefined
              return (
                <Stack
                  key={sourceId(mapping.source)}
                  direction="row"
                  sx={{
                    gap: 1, alignItems: 'center', py: 0.75,
                    borderTop: '1px solid', borderColor: 'divider',
                  }}
                >
                  <Swatch hexes={hexesOf(mapping.source)} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {sourceLabel(mapping.source)} →{' '}
                    {mapping.key === null
                      ? <Box component="span" sx={{ color: 'text.secondary' }}>
                        not tracked{grams !== undefined && <> ({formatGrams(grams)})</>}
                      </Box>
                      : colorLabel(mapping.key)}
                  </Typography>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => unlink(mapping.source)}
                    aria-label={`Remove the link for ${sourceLabel(mapping.source)}`}
                  >
                    Remove
                  </Button>
                </Stack>
              )
            })}
          </Stack>
        </Box>
      )}

      <ReminderControl />
    </Paper>
  )
}
