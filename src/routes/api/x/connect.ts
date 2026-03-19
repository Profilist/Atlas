import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../../convex/_generated/api'
import { fetchAuthQuery } from '@/lib/auth-server'

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function createPkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = toBase64Url(verifierBytes)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )

  return {
    verifier,
    challenge: toBase64Url(new Uint8Array(digest)),
  }
}

function buildCookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds = 600,
) {
  const url = new URL(request.url)
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

function redirectWithCookies(target: string | URL, cookies: string[]) {
  const headers = new Headers({
    Location: typeof target === 'string' ? target : target.toString(),
  })

  for (const nextCookie of cookies) {
    headers.append('Set-Cookie', nextCookie)
  }

  return new Response(null, {
    status: 302,
    headers,
  })
}

export const Route = createFileRoute('/api/x/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const viewer = await fetchAuthQuery(api.auth.currentUser, {})
        if (!viewer) {
          return Response.redirect(new URL('/login', request.url), 302)
        }

        const clientId = process.env.X_CLIENT_ID
        const callbackUrl = process.env.X_CALLBACK_URL
        if (!clientId || !callbackUrl) {
          return new Response('Missing X OAuth configuration', { status: 500 })
        }

        const { verifier, challenge } = await createPkcePair()
        const state = crypto.randomUUID()
        const authorizationUrl = new URL('https://x.com/i/oauth2/authorize')
        authorizationUrl.searchParams.set('response_type', 'code')
        authorizationUrl.searchParams.set('client_id', clientId)
        authorizationUrl.searchParams.set('redirect_uri', callbackUrl)
        authorizationUrl.searchParams.set('scope', 'bookmark.read tweet.read users.read offline.access')
        authorizationUrl.searchParams.set('state', state)
        authorizationUrl.searchParams.set('code_challenge', challenge)
        authorizationUrl.searchParams.set('code_challenge_method', 'S256')

        return redirectWithCookies(authorizationUrl, [
          buildCookie(request, 'x_oauth_state', state),
          buildCookie(request, 'x_oauth_verifier', verifier),
        ])
      },
    },
  },
})
