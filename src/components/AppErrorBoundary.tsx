import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Last-resort boundary. A render failure must not leave the operator staring at
 * a blank page with no way back to their work.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <Typography variant="h1" component="h1">ShapePilot stopped unexpectedly</Typography>
          <Typography color="text.secondary">
            The current view failed to render. Reloading usually recovers it. Unsaved
            changes to the tray on screen will be lost.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {this.state.error.message}
          </Typography>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => window.location.reload()}
          >
            Reload ShapePilot
          </Button>
        </Stack>
      </Box>
    )
  }
}
