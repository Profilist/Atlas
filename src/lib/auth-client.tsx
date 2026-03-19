import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

function getAuthBaseUrl() {
  if (typeof window !== 'undefined') {
    return new URL('/api/auth', window.location.origin).toString()
  }

  const appUrl = import.meta.env.VITE_APP_URL
  if (!appUrl) {
    throw new Error('VITE_APP_URL is required for SSR auth')
  }

  return new URL('/api/auth', appUrl).toString()
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [convexClient()],
})
