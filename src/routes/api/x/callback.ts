import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../../convex/_generated/api'
import { fetchAuthMutation } from '@/lib/auth-server'

function readCookie(request: Request, key: string) {
  const cookieHeader = request.headers.get('cookie') || ''
  const cookieValue = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${key}=`))

  if (!cookieValue) {
    return null
  }

  return decodeURIComponent(cookieValue.slice(key.length + 1))
}

function clearCookie(request: Request, name: string) {
  const url = new URL(request.url)
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
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

export const Route = createFileRoute('/api/x/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const expectedState = readCookie(request, 'x_oauth_state')
        const verifier = readCookie(request, 'x_oauth_verifier')

        const redirectUrl = new URL('/settings/connections', request.url)

        if (!code || !state || !expectedState || !verifier || state !== expectedState) {
          return Response.redirect(redirectUrl, 302)
        }

        const clientId = process.env.X_CLIENT_ID
        const clientSecret = process.env.X_CLIENT_SECRET
        const callbackUrl = process.env.X_CALLBACK_URL
        if (!clientId || !callbackUrl) {
          return new Response('Missing X OAuth configuration', { status: 500 })
        }

        const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(clientSecret
              ? {
                  Authorization: `Basic ${Buffer.from(
                    `${clientId}:${clientSecret}`,
                  ).toString('base64')}`,
                }
              : {}),
          },
          body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            client_id: clientId,
            redirect_uri: callbackUrl,
            code_verifier: verifier,
          }),
        })

        if (!tokenResponse.ok) {
          return Response.redirect(redirectUrl, 302)
        }

        const tokenPayload = (await tokenResponse.json()) as {
          access_token: string
          refresh_token?: string
          scope?: string
          expires_in?: number
        }

        const userResponse = await fetch(
          'https://api.x.com/2/users/me?user.fields=name,username',
          {
            headers: {
              Authorization: `Bearer ${tokenPayload.access_token}`,
            },
          },
        )

        if (!userResponse.ok) {
          return Response.redirect(redirectUrl, 302)
        }

        const userPayload = (await userResponse.json()) as {
          data?: {
            id: string
            name?: string
            username?: string
          }
        }

        if (!userPayload.data?.id || !userPayload.data.username) {
          return Response.redirect(redirectUrl, 302)
        }

        await fetchAuthMutation(api.connections.completeXConnect, {
          xUserId: userPayload.data.id,
          username: userPayload.data.username,
          displayName: userPayload.data.name,
          accessToken: tokenPayload.access_token,
          refreshToken: tokenPayload.refresh_token,
          scope: (tokenPayload.scope || '').split(' ').filter(Boolean),
          expiresAt: tokenPayload.expires_in
            ? Date.now() + tokenPayload.expires_in * 1000
            : undefined,
        })

        return redirectWithCookies(redirectUrl, [
          clearCookie(request, 'x_oauth_state'),
          clearCookie(request, 'x_oauth_verifier'),
        ])
      },
    },
  },
})
