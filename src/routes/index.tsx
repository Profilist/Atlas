import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: '/' } })
    }
  },
  component: HomeRedirect,
})

function HomeRedirect() {
  const navigate = useNavigate()
  const boards = useQuery(api.boards.list, {})

  useEffect(() => {
    if (!boards) {
      return
    }

    if (boards.boards.length > 0) {
      void navigate({
        to: '/boards/$boardId',
        params: { boardId: boards.boards[0]._id },
        replace: true,
      })
      return
    }

    void navigate({ to: '/settings/connections', replace: true })
  }, [boards, navigate])

  return (
    <div className="app-center">
      <div className="panel stack-md">
        <p className="eyebrow">Loading</p>
        <h1 className="section-title">Opening your workspace...</h1>
      </div>
    </div>
  )
}
