/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'development' | 'entra'
  readonly VITE_ENTRA_CLIENT_ID?: string
  readonly VITE_ENTRA_TENANT_ID?: string
  readonly VITE_API_SCOPE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
