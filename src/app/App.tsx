import { AppProviders } from './providers.tsx'
import { AppRoutes } from './routes.tsx'

export default function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  )
}
