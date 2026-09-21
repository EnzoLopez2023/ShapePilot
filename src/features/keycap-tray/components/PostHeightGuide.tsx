// What the corner posts should be for the caps going in this tray.
//
// The arithmetic is in model/capProfiles.ts; this is its reading: pick the
// cap profile, see the post height that clears the tallest row, whether the
// shortest row stays in its pocket at that height, and how many trays that
// stacks into an S76.
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { CAP_PROFILES, HEADROOM_MM, S76_STACK_MM, advisePosts, capProfileOf } from '../model/capProfiles.ts'
import type { TrayDesign } from '../model/types.ts'

export interface PostHeightGuideProps {
  design: TrayDesign
  /** The profile chosen here, or the one the project names; undefined = none yet. */
  profileId: string | undefined
  /** True when `profileId` came from the project rather than a choice here. */
  fromProject: boolean
  onProfile: (id: string) => void
  onDesign: (mutate: (d: TrayDesign) => TrayDesign) => void
}

const mm = (v: number) => `${+v.toFixed(1)} mm`

export default function PostHeightGuide(
  { design, profileId, fromProject, onProfile, onDesign }: PostHeightGuideProps,
) {
  const profile = capProfileOf(profileId)
  const advice = profile
    ? advisePosts(profile, design.floorThicknessMm, design.pocketDepthMm)
    : null
  const current = design.cornerSpacers?.heightMm
  const applied = advice && (advice.postMm > 0
    ? current !== undefined && Math.abs(current - advice.postMm) < 0.05
    : current === undefined)
  const nameplateTooTall = advice && design.nameplate && design.nameplate.heightMm >= advice.postMm
  const inCase = design.profile.kind === 'preset'

  return (
    <Stack spacing={1}>
      <TextField
        select size="small" label="Keycap profile" value={profile?.id ?? ''}
        helperText={fromProject && profile ? 'From the project' : undefined}
        onChange={e => onProfile(e.target.value)}
      >
        {CAP_PROFILES.map(p => (
          <MenuItem key={p.id} value={p.id}>
            {p.label}
            <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 1 }}>
              {p.minHeightMm === p.maxHeightMm
                ? mm(p.maxHeightMm)
                : `${p.minHeightMm}–${mm(p.maxHeightMm)}`}
            </Typography>
          </MenuItem>
        ))}
      </TextField>

      {advice && profile && (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2">
              Suggested post <strong>{mm(advice.postMm)}</strong>
            </Typography>
            <Button
              size="small" variant="outlined" disabled={!!applied}
              onClick={() => onDesign(d => ({
                ...d,
                cornerSpacers: advice.postMm > 0
                  ? { sizeMm: 10, ...d.cornerSpacers, heightMm: advice.postMm }
                  : undefined,
              }))}
            >
              {advice.postMm > 0 ? (applied ? 'Applied' : 'Apply') : (applied ? 'Not needed' : 'Remove posts')}
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {advice.tallestProudMm > 0
              ? `The tallest row stands ${mm(advice.tallestProudMm)} above the rim; the post clears it by ~${HEADROOM_MM} mm.`
              : 'Every row sits below the rim, so the tray above can rest on it.'}
            {' '}Stacks {mm(advice.pitchMm)} a tray
            {inCase && ` · ${advice.traysInS76} fit the S76's ${S76_STACK_MM} mm base`}.
          </Typography>
          {!advice.retained && advice.depthNeededMm !== undefined && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {profile.label} rows differ by {mm(profile.maxHeightMm - profile.minHeightMm)}, so at
              this depth the shortest caps can rise {mm(advice.looseMm)} and leave their pockets.
              Deepen the pocket to {advice.depthNeededMm} mm, or keep the short rows on their own tray.
              {' '}
              <Button
                size="small" color="inherit" sx={{ p: 0, minWidth: 0, verticalAlign: 'baseline' }}
                onClick={() => onDesign(d => ({ ...d, pocketDepthMm: advice.depthNeededMm! }))}
              >
                Set depth {advice.depthNeededMm} mm
              </Button>
            </Alert>
          )}
          {nameplateTooTall && (
            <Typography variant="body2" color="warning.main">
              The nameplate stands {mm(design.nameplate!.heightMm)} proud — as tall as the posts, so the
              tray above would rest on it.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Typical {profile.label} heights. Calipers on your tallest and shortest cap beat them:
            post = tallest − pocket depth + {HEADROOM_MM} mm.
          </Typography>
        </>
      )}
    </Stack>
  )
}
