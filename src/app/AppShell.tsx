import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import {
  Avatar, Box, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { SvgIconComponent } from '@mui/icons-material'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import ArchitectureRoundedIcon from '@mui/icons-material/ArchitectureRounded'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import { EASE_IOS, GLASS, SHADOW } from '../theme/theme.ts'
import { getSettings } from '../features/settings/preferences.ts'
import type { AccountProfile } from '../features/settings/preferences.ts'
import { AUTH_ENABLED } from '../auth/msal.ts'
import { formatBuildStamp, useBuildStamp } from './buildStamp.ts'

interface NavItem {
  to: string
  label: string
  icon: SvgIconComponent
  /** `/` matches every route without it, so Home would always read as active. */
  end?: boolean
  adminOnly?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeRoundedIcon, end: true },
  { to: '/projects', label: 'Projects', icon: FolderRoundedIcon },
  { to: '/keycap-tray', label: 'Keycap tray', icon: GridViewRoundedIcon },
  { to: '/shaper-designer', label: 'Shaper designer', icon: ArchitectureRoundedIcon },
  { to: '/bambu-designer', label: 'Bambu designer', icon: ViewInArRoundedIcon },
  { to: '/playground', label: 'AI playground', icon: AutoAwesomeRoundedIcon },
  { to: '/settings', label: 'Settings', icon: TuneRoundedIcon },
  { to: '/admin', label: 'Admin', icon: AdminPanelSettingsRoundedIcon, adminOnly: true },
]

const SIDEBAR_WIDTH = 260
const SIDEBAR_WIDTH_COLLAPSED = 76
const COLLAPSE_KEY = 'shapepilot:nav-collapsed'

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A floating, rounded left sidebar in the native-iOS idiom: frosted glass over
 * the page wash, squircle rows, a lifting shadow, an Apple-timed hover fade.
 * On `md` and up it collapses to an icon rail (choice persisted); below `md`
 * the same nav slides in as a temporary drawer from a glass top bar. The nav
 * is real routes throughout — the back button and a copied URL both work.
 */
export function AppShell() {
  const theme = useTheme()
  const { instance } = useMsal()
  const glass = GLASS[theme.palette.mode]
  const shadow = SHADOW[theme.palette.mode]
  // `defaultMatches: true` keeps the permanent sidebar (and its single
  // "Sections" landmark) present when `matchMedia` is unavailable, e.g. jsdom.
  const permanent = useMediaQuery(theme.breakpoints.up('md'), {
    defaultMatches: true,
    noSsr: true,
  })
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const role = profile?.role ?? null
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    let cancelled = false
    void getSettings()
      .then(result => { if (!cancelled) setProfile(result.profile) })
      // A shell that cannot read the profile still has to render the app; the
      // account block is simply absent and admin rows stay hidden.
      .catch(() => { if (!cancelled) setProfile(null) })
    return () => { cancelled = true }
  }, [])

  // A permanent sidebar and a temporary drawer are never mounted at once, so
  // there is exactly one `navigation` landmark named "Sections" on the page.
  useEffect(() => {
    if (permanent) setDrawerOpen(false)
  }, [permanent])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }, [])

  const items = NAV.filter(item => !item.adminOnly || role === 'admin')
  const signOut = () => {
    // Redirect, matching how signing in works: ending the session only in this
    // browser would leave the next sign-in silently reusing the same account.
    void instance.logoutRedirect({ account: instance.getActiveAccount() })
  }

  const glassSurface = {
    background: glass.fill,
    backdropFilter: glass.backdrop,
    WebkitBackdropFilter: glass.backdrop,
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
      background: theme.palette.background.paper,
    },
  } as const

  return (
    <Box sx={{ height: '100dvh', display: 'flex', overflow: 'hidden' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          left: -9999,
          top: 0,
          zIndex: theme.zIndex.drawer + 2,
          p: 1,
          borderRadius: '14px',
          bgcolor: 'background.paper',
          '&:focus': { left: 8, top: 8 },
        }}
      >
        Skip to content
      </Box>

      {permanent ? (
        <Box
          component="aside"
          sx={{
            ...glassSurface,
            m: 1.5,
            width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRadius: '14px',
            border: `1px solid ${glass.border}`,
            boxShadow: shadow,
            overflow: 'hidden',
            transition: `width 0.25s ${EASE_IOS}`,
          }}
        >
          <SidebarBody
            profile={profile}
            onSignOut={signOut}
            items={items}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
          />
        </Box>
      ) : (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={{
            sx: {
              ...glassSurface,
              width: SIDEBAR_WIDTH,
              border: 'none',
              borderRight: `1px solid ${glass.border}`,
              borderRadius: '0 14px 14px 0',
              backgroundImage: 'none',
              boxShadow: shadow,
            },
          }}
        >
          <SidebarBody
            items={items}
            profile={profile}
            onSignOut={signOut}
            onNavigate={() => setDrawerOpen(false)}
          />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!permanent && (
          <Box
            component="header"
            sx={{
              ...glassSurface,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1.5,
              py: 1,
              borderBottom: `1px solid ${glass.border}`,
            }}
          >
            <IconButton
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
              sx={{ borderRadius: '14px' }}
            >
              <MenuRoundedIcon />
            </IconButton>
            <Typography
              component="span"
              sx={{ fontWeight: 650, letterSpacing: '-0.01em', fontSize: '0.9375rem' }}
            >
              ShapePilot
            </Typography>
          </Box>
        )}

        <Box
          component="main"
          id="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            px: { xs: 1.5, md: 2 },
            py: { xs: 1.5, md: 2 },
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}

function SidebarBody({
  items,
  profile,
  onSignOut,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  items: NavItem[]
  profile: AccountProfile | null
  onSignOut: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onNavigate?: () => void
}) {
  const theme = useTheme()
  const glass = GLASS[theme.palette.mode]
  const stamp = useBuildStamp()

  return (
    <Stack sx={{ height: '100%', px: collapsed ? 1 : 1.5, py: 2, gap: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          minHeight: 36,
        }}
      >
        {!collapsed && (
          <Typography
            component="span"
            sx={{
              pl: 1,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              fontSize: '1.0625rem',
            }}
          >
            ShapePilot
          </Typography>
        )}
        {onToggleCollapsed && (
          <Tooltip title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            <IconButton
              size="small"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!collapsed}
              sx={{ borderRadius: '14px' }}
            >
              {collapsed
                ? <MenuRoundedIcon fontSize="small" />
                : <MenuOpenRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Stack component="nav" aria-label="Sections" sx={{ gap: 0.5 }}>
        {items.map(item => {
          const Icon = item.icon
          const row = (
            <Box
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? 0 : 1.25,
                px: collapsed ? 0 : 1.5,
                py: 1.25,
                borderRadius: '14px',
                fontSize: '0.9375rem',
                lineHeight: 1.2,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                color: 'text.secondary',
                transition: 'background 0.2s ease-in-out, color 0.2s ease-in-out',
                '& .MuiSvgIcon-root': { fontSize: '1.25rem', flexShrink: 0 },
                '&:hover': { background: glass.fillHover, color: 'text.primary' },
                '&.active': {
                  background: glass.fillActive,
                  color: 'text.primary',
                  fontWeight: 600,
                },
              }}
            >
              <Icon />
              <Box
                component="span"
                sx={{
                  opacity: collapsed ? 0 : 1,
                  width: collapsed ? 0 : 'auto',
                  transition: `opacity 0.15s ${EASE_IOS}`,
                }}
              >
                {item.label}
              </Box>
            </Box>
          )

          return collapsed ? (
            <Tooltip key={item.to} title={item.label} placement="right">
              {row}
            </Tooltip>
          ) : row
        })}
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0 }} />

      {/* Who is signed in, and the way out. Above the build stamp because it
          is about the person rather than the deployment, and one hairline
          apart so the two do not read as one block. */}
      {profile && (
        <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.25, mb: 0.5 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <Tooltip
              title={collapsed ? (profile.displayName ?? profile.email ?? 'Signed in') : ''}
              placement="right"
              disableHoverListener={!collapsed}
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  bgcolor: 'action.selected',
                  color: 'text.primary',
                }}
              >
                {initialsOf(profile)}
              </Avatar>
            </Tooltip>
            {!collapsed && (
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {profile.displayName ?? 'Signed in'}
                </Typography>
                {profile.email && (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {profile.email}
                  </Typography>
                )}
              </Box>
            )}
            {!collapsed && (
              <Tooltip title={AUTH_ENABLED
                ? 'End this session'
                : 'No session to end: this build runs with the development bypass'}
              >
                <span>
                  <IconButton
                    size="small"
                    aria-label="Sign out"
                    disabled={!AUTH_ENABLED}
                    onClick={onSignOut}
                    sx={{ borderRadius: '14px' }}
                  >
                    <LogoutRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
          {collapsed && (
            <Tooltip title="Sign out" placement="right">
              <span>
                <IconButton
                  size="small"
                  aria-label="Sign out"
                  disabled={!AUTH_ENABLED}
                  onClick={onSignOut}
                  sx={{ borderRadius: '14px', display: 'flex', mx: 'auto', mt: 0.5 }}
                >
                  <LogoutRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      )}

      {/* Which build is live, answerable at a glance without opening a console
          or asking the API. Absent until it loads, and absent for good if it
          never does: a stamp is a convenience and must never look like a
          failure. */}
      {stamp && (
        <Tooltip
          title={`ShapePilot ${formatBuildStamp(stamp)}`}
          placement={collapsed ? 'right' : 'top'}
        >
          <Typography
            variant="body2"
            component="p"
            sx={{
              px: collapsed ? 0 : 1.5,
              color: 'text.secondary',
              fontSize: '0.6875rem',
              textAlign: collapsed ? 'center' : 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {collapsed ? (stamp.buildNumber || stamp.build) : formatBuildStamp(stamp)}
          </Typography>
        </Tooltip>
      )}
    </Stack>
  )
}

/** Two letters from the name, or one from the sign-in address. */
function initialsOf(profile: AccountProfile): string {
  const name = profile.displayName?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    return (parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0].slice(0, 2)).toUpperCase()
  }
  return (profile.email?.trim()[0] ?? '?').toUpperCase()
}
