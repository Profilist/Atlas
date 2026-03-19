/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { createServerFn } from '@tanstack/react-start'
import appCss from '@/styles/app.css?url'
import { DefaultCatchBoundary } from '@/components/DefaultCatchBoundary'
import { NotFound } from '@/components/NotFound'
import { authClient } from '@/lib/auth-client'
import { getToken } from '@/lib/auth-server'
import { seo } from '@/utils/seo'

const getAuth = createServerFn({ method: 'GET' }).handler(async () => {
  return await getToken()
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...seo({
        title: 'Atlas',
        description: 'AI-organized X bookmarks and saved links on minimal whiteboards.',
      }),
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth()

    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }

    return {
      isAuthenticated: Boolean(token),
      token,
    }
  },
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: NotFound,
  component: RootComponent,
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })

  return (
    <ConvexBetterAuthProvider
      authClient={authClient}
      client={context.convexQueryClient.convexClient}
      initialToken={context.token}
    >
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          <Outlet />
          <Scripts />
        </body>
      </html>
    </ConvexBetterAuthProvider>
  )
}
