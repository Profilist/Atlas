import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useCallback, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AddLinksModal } from './AddLinksModal'

export function AppShell(props: {
  boards: Array<{
    _id: Id<'boards'>
    name: string
    itemCount: number
  }>
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const ingestLinks = useAction(api.manualLinks.ingest)
  const [isAddLinksOpen, setIsAddLinksOpen] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{
    tone: 'neutral' | 'error'
    text: string
  } | null>(null)

  const resetModal = useCallback(() => {
    setIsAddLinksOpen(false)
    setLinkInput('')
    setMessage(null)
  }, [])

  const closeModal = useCallback(() => {
    if (isSubmitting) {
      return
    }

    resetModal()
  }, [isSubmitting, resetModal])

  async function handleSubmitLinks() {
    const urls = linkInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)

    if (urls.length === 0) {
      setMessage({
        tone: 'error',
        text: 'Paste at least one link to save.',
      })
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    try {
      const result = await ingestLinks({ urls })

      if (result.redirectBoardId) {
        resetModal()
        void navigate({
          to: '/boards/$boardId',
          params: {
            boardId: result.redirectBoardId,
          },
        })
        return
      }

      if (result.created === 0) {
        setMessage({
          tone: 'neutral',
          text: 'All pasted links were already saved.',
        })
        return
      }

      setMessage({
        tone: 'error',
        text: 'Links were saved, but routing did not finish. Try again in a moment.',
      })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Failed to save links.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <h1 className="display display-sm">Atlas</h1>
        </div>

        <nav className="sidebar__nav">
          <button
            className="button button-primary sidebar__cta"
            onClick={() => {
              setIsAddLinksOpen(true)
              setMessage(null)
            }}
            type="button"
          >
            Add Links
          </button>
          <Link
            className="nav-link"
            search={{ boardId: '', q: '' }}
            to="/search"
          >
            Search
          </Link>
          <Link className="nav-link" to="/settings/connections">
            Connections
          </Link>
        </nav>

        <div aria-hidden="true" className="sidebar__divider" />

        <div className="sidebar__boards-shell">
          <div className="sidebar__boards">
            {props.boards.map((board) => {
              const isActive = location.pathname === `/boards/${board._id}`
              return (
                <Link
                  className={isActive ? 'board-link board-link--active' : 'board-link'}
                  key={board._id}
                  params={{ boardId: board._id }}
                  to="/boards/$boardId"
                >
                  <span>{board.name}</span>
                  <span className="board-link__count">{board.itemCount}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      <AddLinksModal
        isOpen={isAddLinksOpen}
        isSubmitting={isSubmitting}
        message={message}
        onChange={setLinkInput}
        onClose={closeModal}
        onSubmit={() => {
          void handleSubmitLinks()
        }}
        value={linkInput}
      />
    </div>
  )
}
