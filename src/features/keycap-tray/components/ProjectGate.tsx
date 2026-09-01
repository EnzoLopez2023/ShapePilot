// What the designer shows when no tray is open: a keycap tray only exists
// inside a project, so the choice is always "open a set" or "start one" -- never
// a blank scratch tray.
//
// This screen orients rather than being worked in, so it is built in the same
// hand as the home page: the invitation on the left, a real Systainer drawing on
// the right, and one authored entrance from `home.css` -- not the still, dense
// treatment a working surface gets.
import { Box, Button, Divider, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import AddIcon from '@mui/icons-material/Add'
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded'
import { EmptyState } from '../../../components/LoadingState.tsx'
import { KeycapArtwork } from '../../home/components/PathArtwork.tsx'
import type { ProjectSummary } from '../../keycap-projects/model/types.ts'
import '../../home/home.css'

export interface ProjectGateProps {
  projects: ProjectSummary[]
  busy: boolean
  /** Opens the name dialog owned by the page. */
  onNewProject: () => void
  /** Opens that project's most recently edited tray. */
  onOpenProject: (id: string) => void
}

const RECENT_LIMIT = 6

/** A short line under the name: whatever the set is actually known by. */
const describe = (p: ProjectSummary): string => {
  const parts = [p.setName, p.capProfile, p.colorway].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return `${p.capCount} ${p.capCount === 1 ? 'cap' : 'caps'} catalogued`
}

export default function ProjectGate({
  projects, busy, onNewProject, onOpenProject,
}: ProjectGateProps) {
  const recent = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT)

  return (
    <Box
      sx={{
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: { xs: 'start', md: 'center' },
        py: { xs: 0, md: 2 },
      }}
    >
      <Paper
        sx={{
          m: { xs: 0, md: 2 },
          p: { xs: 2, md: 3.5 },
          width: '100%',
          maxWidth: 1040,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 2, md: 4 },
            alignItems: 'center',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.15fr)' },
          }}
        >
          <Box className="sp-rise" sx={{ minWidth: 0 }}>
            <EmptyState
              title="Start with a project"
              description={
                'Every tray belongs to a keycap set. Open one to keep working, '
                + 'or start a new set.'
              }
              action={(
                <Stack spacing={1.25} sx={{ width: '100%', mt: 1.5 }}>
                  <Button
                    variant="contained" startIcon={<AddIcon />} disabled={busy}
                    onClick={onNewProject} sx={{ alignSelf: 'flex-start' }}
                  >
                    New project
                  </Button>

                  {recent.length > 0 && (
                    <>
                      <Divider sx={{ mt: 1 }}>Open a project</Divider>
                      <Stack spacing={0.75}>
                        {recent.map(p => (
                          <Button
                            key={p.id}
                            disabled={busy}
                            onClick={() => onOpenProject(p.id)}
                            endIcon={<ArrowIcon sx={{ opacity: 0.5 }} />}
                            sx={{
                              justifyContent: 'space-between',
                              textTransform: 'none',
                              textAlign: 'left',
                              px: 1.5,
                              py: 1,
                              border: 1,
                              borderColor: 'divider',
                              borderRadius: 2,
                              color: 'text.primary',
                              fontWeight: 400,
                              transition:
                                'border-color 160ms ease-in-out, background-color 160ms ease-in-out',
                              '&:hover': {
                                bgcolor: 'action.hover',
                                borderColor: 'text.disabled',
                              },
                            }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                {p.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {describe(p)}
                              </Typography>
                            </Box>
                            <Typography
                              variant="body2" color="text.secondary" component="span"
                              sx={{ ml: 1.5, flexShrink: 0 }}
                            >
                              {p.trayCount} {p.trayCount === 1 ? 'tray' : 'trays'}
                            </Typography>
                          </Button>
                        ))}
                      </Stack>
                      {projects.length > recent.length && (
                        <Button
                          size="small" component={RouterLink} to="/projects"
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          All {projects.length} projects
                        </Button>
                      )}
                    </>
                  )}
                </Stack>
              )}
            />
          </Box>

          <Box
            className="sp-card sp-rise"
            aria-hidden
            sx={{
              animationDelay: '80ms',
              aspectRatio: { xs: '1.9 / 1', md: '1.5 / 1' },
              color: 'text.primary',
              bgcolor: 'background.default',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: { xs: 1.5, md: 2 },
            }}
          >
            <KeycapArtwork />
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
