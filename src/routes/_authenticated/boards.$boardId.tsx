import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { BoardCanvas } from '@/components/BoardCanvas'
import type { BoardSnapshot } from '@/lib/board-types'

export const Route = createFileRoute('/_authenticated/boards/$boardId')({
  ssr: 'data-only',
  component: BoardRouteComponent,
})

function BoardRouteComponent() {
  const { boardId } = Route.useParams()
  const navigate = Route.useNavigate()
  const boardData = useQuery(api.boards.get, {
    boardId: boardId as Id<'boards'>,
  })
  const readSnapshot = useAction(api.boards.readSnapshot)
  const deleteBoard = useAction(api.boards.deleteBoard)
  const generateUploadUrl = useMutation(api.boards.generateSnapshotUploadUrl)
  const commitSnapshot = useMutation(api.boards.commitSnapshot)
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true

    void readSnapshot({ boardId: boardId as Id<'boards'> }).then((result) => {
      if (isActive) {
        setSnapshot(result)
      }
    })

    return () => {
      isActive = false
    }
  }, [boardId, readSnapshot])

  useEffect(() => {
    setIsConfirmingDelete(false)
    setDeleteError(null)
    setIsDeleting(false)
  }, [boardId])

  async function handleSave(nextSnapshot: BoardSnapshot) {
    const uploadUrl = await generateUploadUrl({})
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(nextSnapshot),
    })

    const payload = (await uploadResponse.json()) as { storageId: Id<'_storage'> }
    await commitSnapshot({
      boardId: boardId as Id<'boards'>,
      storageId: payload.storageId,
    })
    setSnapshot(nextSnapshot)
  }

  async function handleDeleteBoard() {
    setIsDeleting(true)
    setDeleteError(null)

    try {
      const result = await deleteBoard({ boardId: boardId as Id<'boards'> })

      if (result.redirectBoardId) {
        void navigate({
          to: '/boards/$boardId',
          params: {
            boardId: result.redirectBoardId,
          },
        })
        return
      }

      void navigate({
        to: '/settings/connections',
      })
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete the board',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  if (boardData === undefined) {
    return (
      <div className="stack-lg">
        <p className="eyebrow">Loading</p>
        <h1 className="section-title">Fetching board...</h1>
      </div>
    )
  }

  if (!boardData) {
    return (
      <div className="panel stack-md">
        <p className="eyebrow">Missing Board</p>
        <h1 className="section-title">This board no longer exists.</h1>
      </div>
    )
  }

  return (
    <div className="page stack-lg">
      <header className="page-header">
        <div className="stack-sm">
          <p className="eyebrow">Board</p>
          <h1 className="display display-sm">{boardData.board.name}</h1>
          {boardData.board.description ? <p className="muted">{boardData.board.description}</p> : null}
        </div>

        <div className="stack-sm page-header__actions">
          {isConfirmingDelete ? (
            <div className="board-delete-card stack-sm">
              <p className="muted">
                Delete this board?{' '}
                {boardData.deleteImpact.ownedItemCount > 0
                  ? `${boardData.deleteImpact.ownedItemCount} primary item${boardData.deleteImpact.ownedItemCount === 1 ? '' : 's'} will be reassigned automatically.`
                  : 'It has no primary-owned items.'}{' '}
                {boardData.deleteImpact.membershipOnlyItemCount > 0
                  ? `${boardData.deleteImpact.membershipOnlyItemCount} saved-search item${boardData.deleteImpact.membershipOnlyItemCount === 1 ? '' : 's'} will simply lose this board membership.`
                  : 'No membership-only items will be affected.'}
              </p>

              <div className="row gap-sm">
                <button
                  className="button button-danger"
                  disabled={isDeleting}
                  onClick={() => {
                    void handleDeleteBoard()
                  }}
                >
                  {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
                <button
                  className="button button-secondary"
                  disabled={isDeleting}
                  onClick={() => {
                    setIsConfirmingDelete(false)
                    setDeleteError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button button-danger"
              disabled={isDeleting}
              onClick={() => {
                setIsConfirmingDelete(true)
                setDeleteError(null)
              }}
            >
              Delete Board
            </button>
          )}

          {deleteError ? <p className="form-note form-note--error">{deleteError}</p> : null}
        </div>
      </header>

      <BoardCanvas
        cards={boardData.cards}
        emptyTitle="Board"
        onSave={handleSave}
        saveDisabled={isDeleting}
        snapshot={snapshot}
      />
    </div>
  )
}
