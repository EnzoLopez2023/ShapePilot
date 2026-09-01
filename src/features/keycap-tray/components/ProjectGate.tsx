// What the designer shows when no tray is open: a keycap tray only exists
// inside a project, so the choice is always "open a set" or "start one" -- never
// a blank scratch tray.
import { Box, Button, Divider, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import AddIcon from '@mui/icons-material/Add'
import { EmptyState } from '../../../components/LoadingState.tsx'
import type { ProjectSummary } from '../../keycap-projects/model/types.ts'

export interface ProjectGateProps {
  projects: ProjectSummary[]
  busy: boolean
  /** Opens the name dialog owned by the page. */
  onNewProject: () => void
  /** Opens that project's most recently edited tray. */
  onOpenProject: (id: string) => void
}

const RECENT_LIMIT = 8

export default function ProjectGate({
  projects, busy, onNewProject, onOpenProject,
}: ProjectGateProps) {
  const recent = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT)

  return (
    <Box sx={{ minHeight: 0, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
      <Paper sx={{ m: { xs: 0, md: 2 }, p: 1, width: '100%', maxWidth: 460, alignSelf: 'start' }}>
        <EmptyState
          title="Start with a project"
          description="Every tray belongs to a keycap set. Open one to keep working, or start a new set."
          action={(
            <Stack spacing={1} sx={{ width: '100%', mt: 1 }}>
              <Button
                variant="contained" startIcon={<AddIcon />} disabled={busy}
                onClick={onNewProject} sx={{ alignSelf: 'flex-start' }}
              >
                New project
              </Button>

              {recent.length > 0 && (
                <>
                  <Divider sx={{ mt: 1 }}>Open a project</Divider>
                  {recent.map(p => (
                    <Button
                      key={p.id} disabled={busy} onClick={() => onOpenProject(p.id)}
                      sx={{ justifyContent: 'flex-start', textTransform: 'none', px: 1.5 }}
                    >
                      <Box
                        component="span"
                        sx={{
                          flex: 1, minWidth: 0, textAlign: 'left',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {p.name}
                      </Box>
                      <Typography
                        variant="body2" color="text.secondary" component="span" sx={{ ml: 1 }}
                      >
                        {p.trayCount} {p.trayCount === 1 ? 'tray' : 'trays'}
                      </Typography>
                    </Button>
                  ))}
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
      </Paper>
    </Box>
  )
}
