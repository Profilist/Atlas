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
  const boardData = useQuery(api.boards.get, {
    boardId: boardId as Id<'boards'>,
  })
  const readSnapshot = useAction(api.boards.readSnapshot)
  const ingestLinks = useMutation(api.manualLinks.ingest)
  const generateUploadUrl = useMutation(api.boards.generateSnapshotUploadUrl)
  const commitSnapshot = useMutation(api.boards.commitSnapshot)
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [linkInput, setLinkInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  async function handleIngest() {
    const urls = linkInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)

    if (urls.length === 0) {
      return
    }

    setIsSubmitting(true)
    try {
      await ingestLinks({ urls })
      setLinkInput('')
    } finally {
      setIsSubmitting(false)
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
          <textarea
            className="input input-textarea"
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Paste links here, one per line or comma-separated"
            rows={3}
            value={linkInput}
          />
          <button className="button button-primary" disabled={isSubmitting} onClick={handleIngest}>
            {isSubmitting ? 'Saving...' : 'Save Links'}
          </button>
        </div>
      </header>

      <BoardCanvas
        cards={boardData.cards}
        emptyTitle="Board"
        onSave={handleSave}
        snapshot={snapshot}
      />
    </div>
  )
}
