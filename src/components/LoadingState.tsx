import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export interface LoadingStateProps {
  label: string
  /** Fill the parent instead of sitting inline. */
  fill?: boolean
}

export function LoadingState({ label, fill = true }: LoadingStateProps) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        minHeight: fill ? 200 : undefined,
        p: 3,
        color: 'text.secondary',
      }}
    >
      <CircularProgress size={18} aria-hidden />
      <Typography variant="body2">{label}</Typography>
    </Box>
  )
}

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Stack spacing={1} sx={{ p: 3, alignItems: 'flex-start' }}>
      <Typography variant="h3" component="p">{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary">{description}</Typography>}
      {action}
    </Stack>
  )
}

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <Alert
      severity="error"
      sx={{ m: 2 }}
      action={onRetry
        ? <Button color="inherit" size="small" onClick={onRetry}>Try again</Button>
        : undefined}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Typography variant="body2">{message}</Typography>
    </Alert>
  )
}
