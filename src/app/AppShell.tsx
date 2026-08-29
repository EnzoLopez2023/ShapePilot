import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Box, Stack, Typography } from '@mui/material'
import { getSettings } from '../features/settings/preferences.ts'

interface NavItem { to: string; label: string; adminOnly?: boolean }

const NAV: NavItem[] = [
  { to: '/keycap-tray', label: 'Keycap tray' },
  { to: '/settings', label: 'Settings' },
  { to: '/admin', label: 'Admin', adminOnly: true },
]

/**
 * One header, real links, no global view switch. The nav is a list of routes;
 * the browser's back button and a copied URL both work.
 */
export function AppShell() {
  const [role, setRole] = useState<'user' | 'admin' | null>(null)

  useEffect(() => {
    let cancelled = false
    void getSettings()
      .then(result => { if (!cancelled) setRole(result.profile.role) })
      .catch(() => { if (!cancelled) setRole('user') })
    return () => { cancelled = true }
  }, [])

  const items = NAV.filter(item => !item.adminOnly || role === 'admin')

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          left: -9999,
          top: 0,
          zIndex: 10,
          p: 1,
          bgcolor: 'background.paper',
          '&:focus': { left: 8, top: 8 },
        }}
      >
        Skip to content
      </Box>

      <Box
        component="header"
        sx={{
          px: { xs: 2, md: 3 },
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Stack
          direction="row"
          spacing={3}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography
            component="span"
            sx={{ fontWeight: 650, letterSpacing: '-0.01em', fontSize: '0.9375rem' }}
          >
            ShapePilot
          </Typography>
          <Stack component="nav" aria-label="Sections" direction="row" spacing={0.5}>
            {items.map(item => (
              <Box
                key={item.to}
                component={NavLink}
                to={item.to}
                sx={{
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 1,
                  fontSize: '0.875rem',
                  textDecoration: 'none',
                  color: 'text.secondary',
                  border: 1,
                  borderColor: 'transparent',
                  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                  '&.active': {
                    color: 'text.primary',
                    borderColor: 'divider',
                    fontWeight: 600,
                  },
                }}
              >
                {item.label}
              </Box>
            ))}
          </Stack>
        </Stack>
      </Box>

      <Box
        component="main"
        id="main"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: { xs: 1.5, md: 2.5 },
          py: { xs: 1.5, md: 2 },
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  )
}
