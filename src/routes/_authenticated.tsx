import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { AppShell } from '@/components/AppShell'
import { sanitizeRedirect } from '@/lib/redirect'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      const redirectTarget = sanitizeRedirect(
        `${location.pathname}${location.search}${location.hash}`,
      )

      throw redirect({
        to: '/login',
        search: {
          redirect: redirectTarget,
        },
      })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const boards = useQuery(api.boards.list, {})

  return <AppShell boards={boards?.boards ?? []} />
}
