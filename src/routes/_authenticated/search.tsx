import { createFileRoute } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { BoardCanvas } from '@/components/BoardCanvas'
import type { BoardCard, BoardSnapshot } from '@/lib/board-types'

export const Route = createFileRoute('/_authenticated/search')({
  ssr: 'data-only',
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
    boardId: typeof search.boardId === 'string' ? search.boardId : '',
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    boardId: search.boardId,
  }),
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const boards = useQuery(api.boards.list, {})
  const generateBoard = useAction(api.search.generateBoard)
  const [results, setResults] = useState<{
    boardTitle: string
    query: string
    cards: Array<{
      itemId: Id<'items'>
      x: number
      y: number
      w: number
      h: number
      cluster: string
      card: BoardCard
    }>
  } | null>(null)

  useEffect(() => {
    if (!search.q) {
      setResults(null)
      return
    }

    let isActive = true
    void generateBoard({
      query: search.q,
      boardId: search.boardId ? (search.boardId as Id<'boards'>) : undefined,
    }).then((nextResults) => {
      if (isActive) {
        setResults(nextResults)
      }
    })

    return () => {
      isActive = false
    }
  }, [generateBoard, search.boardId, search.q])

  const snapshot: BoardSnapshot | null = results
    ? {
        version: 1,
        cards: results.cards.map((card) => ({
          itemId: card.itemId,
          x: card.x,
          y: card.y,
          w: card.w,
          h: card.h,
        })),
      }
    : null

  return (
    <div className="page stack-lg">
      <header className="page-header">
        <div className="stack-sm">
          <p className="eyebrow">Search</p>
          <h1 className="display display-sm">{results?.boardTitle || 'Spin up a temporary board.'}</h1>
          <p className="muted">
            Search inside one category or across every saved board and get a fresh whiteboard instantly.
          </p>
        </div>

        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault()
            const formData = new FormData(event.currentTarget)
            void navigate({
              to: '/search',
              search: {
                q: String(formData.get('q') || ''),
                boardId: String(formData.get('boardId') || ''),
              },
            })
          }}
        >
          <input className="input" defaultValue={search.q} name="q" placeholder="Search design, ML, agents..." />
          <select className="input" defaultValue={search.boardId} name="boardId">
            <option value="">All boards</option>
            {(boards?.boards ?? []).map((board: { _id: Id<'boards'>; name: string }) => (
              <option key={board._id} value={board._id}>
                {board.name}
              </option>
            ))}
          </select>
          <button className="button button-primary" type="submit">
            Search
          </button>
        </form>
      </header>

      <BoardCanvas
        cards={results?.cards.map((card) => card.card) ?? []}
        emptyTitle="Search"
        snapshot={snapshot}
      />
    </div>
  )
}
