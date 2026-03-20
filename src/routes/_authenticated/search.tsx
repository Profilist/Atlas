import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
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
  const generateUploadUrl = useMutation(api.boards.generateSnapshotUploadUrl)
  const createFromSearch = useMutation(api.boards.createFromSearch)
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
  const [boardName, setBoardName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreatingBoard, setIsCreatingBoard] = useState(false)
  const [pendingSnapshot, setPendingSnapshot] = useState<BoardSnapshot | null>(null)
  const boardNameInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    setBoardName(search.q.trim())
    setSaveError(null)
    setIsCreateModalOpen(false)
    setIsCreatingBoard(false)
    setPendingSnapshot(null)
  }, [search.boardId, search.q])

  useEffect(() => {
    if (!isCreateModalOpen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      boardNameInputRef.current?.focus()
      boardNameInputRef.current?.select()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isCreateModalOpen])

  useEffect(() => {
    if (!isCreateModalOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isCreatingBoard) {
        closeCreateBoardModal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isCreateModalOpen, isCreatingBoard])

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
  const canCreateBoard = (results?.cards.length ?? 0) > 0

  function closeCreateBoardModal() {
    if (isCreatingBoard) {
      return
    }

    setIsCreateModalOpen(false)
    setPendingSnapshot(null)
    setSaveError(null)
  }

  async function handleOpenCreateBoardModal(nextSnapshot: BoardSnapshot) {
    if (nextSnapshot.cards.length === 0) {
      return
    }

    setPendingSnapshot(nextSnapshot)
    setBoardName((currentName) => currentName.trim() || search.q.trim())
    setSaveError(null)
    setIsCreateModalOpen(true)
  }

  async function handleCreateBoard() {
    const trimmedBoardName = boardName.trim()
    if (!trimmedBoardName) {
      setSaveError('Enter a board name before creating it.')
      return
    }

    if (!pendingSnapshot || pendingSnapshot.cards.length === 0) {
      setSaveError('Search needs at least one result before it can become a board.')
      return
    }

    setIsCreatingBoard(true)
    setSaveError(null)

    try {
      const uploadUrl = await generateUploadUrl({})
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pendingSnapshot),
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload the saved board layout')
      }

      const payload = (await uploadResponse.json()) as {
        storageId: Id<'_storage'>
      }
      const createdBoard = await createFromSearch({
        name: trimmedBoardName,
        itemIds: pendingSnapshot.cards.map((card) => card.itemId),
        snapshotStorageId: payload.storageId,
      })

      setIsCreateModalOpen(false)
      setPendingSnapshot(null)

      void navigate({
        to: '/boards/$boardId',
        params: {
          boardId: createdBoard.boardId,
        },
      })
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to create the board',
      )
    } finally {
      setIsCreatingBoard(false)
    }
  }

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

        <div className="page-header__actions stack-sm">
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
        </div>
      </header>

      <BoardCanvas
        cards={results?.cards.map((card) => card.card) ?? []}
        emptyTitle="Search"
        onSave={search.q ? handleOpenCreateBoardModal : undefined}
        saveDisabled={!canCreateBoard || isCreateModalOpen || isCreatingBoard}
        saveLabel="Create Board"
        showEmptyState={false}
        snapshot={snapshot}
      />

      {isCreateModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCreateBoardModal()
            }
          }}
        >
          <div
            aria-labelledby="create-board-title"
            aria-modal="true"
            className="modal panel"
            role="dialog"
          >
            <form
              className="stack-md"
              onSubmit={(event) => {
                event.preventDefault()
                void handleCreateBoard()
              }}
            >
              <div className="modal__header stack-sm">
                <p className="eyebrow">Create Board</p>
                <h2 className="section-title" id="create-board-title">
                  Save this search as a board.
                </h2>
              </div>

              <input
                className="input"
                disabled={isCreatingBoard}
                onChange={(event) => {
                  setBoardName(event.target.value)
                  if (saveError) {
                    setSaveError(null)
                  }
                }}
                placeholder="Board name"
                ref={boardNameInputRef}
                value={boardName}
              />

              {saveError ? <p className="form-note form-note--error">{saveError}</p> : null}

              <div className="modal__actions row gap-sm">
                <button
                  className="button button-secondary"
                  disabled={isCreatingBoard}
                  onClick={closeCreateBoardModal}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={isCreatingBoard} type="submit">
                  {isCreatingBoard ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
