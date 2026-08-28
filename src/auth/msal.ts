// MSAL configuration.
//
// ShapePilot requests an access token for its own API audience, not a Graph
// token and not an ID token. The client id, tenant and scope are build-time
// configuration; none of them are secrets.
import { LogLevel, PublicClientApplication } from '@azure/msal-browser'
import type { Configuration, PopupRequest, SilentRequest } from '@azure/msal-browser'

const env = import.meta.env

export const AUTH_ENABLED = env.VITE_AUTH_MODE !== 'development'

const clientId = env.VITE_ENTRA_CLIENT_ID ?? ''
const tenantId = env.VITE_ENTRA_TENANT_ID ?? ''
const apiScope = env.VITE_API_SCOPE ?? ''

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: typeof window === 'undefined' ? '/' : window.location.origin,
    postLogoutRedirectUri: typeof window === 'undefined' ? '/' : window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    // Session storage keeps a signed-in tab isolated and avoids leaving tokens
    // behind on a shared machine after the browser closes.
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback(level, message, containsPii) {
        if (containsPii || level > LogLevel.Warning) return
        console.debug(`[MSAL] ${message}`)
      },
      logLevel: LogLevel.Warning,
    },
  },
}

/** Sign-in only needs openid/profile; the API scope is acquired separately. */
export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', apiScope].filter(Boolean),
}

export const apiTokenRequest: Omit<SilentRequest, 'account'> = {
  scopes: [apiScope].filter(Boolean),
}

let instance: PublicClientApplication | null = null

/** Created lazily so a development build without an Entra tenant still boots. */
export function msalInstance(): PublicClientApplication {
  if (!instance) instance = new PublicClientApplication(msalConfig)
  return instance
}

export const authConfigured = Boolean(clientId && tenantId && apiScope)
