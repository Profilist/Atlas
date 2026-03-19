import { useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapePartial,
} from 'tldraw'
import 'tldraw/tldraw.css'
import type { BoardCard, BoardSnapshot } from '@/lib/board-types'
import { BookmarkCardShapeUtil } from '@/components/BookmarkCardShapeUtil'

type PositionedCard = {
  itemId: BoardCard['itemId']
  x: number
  y: number
  w: number
  h: number
}

function syncBoardShapes(
  editor: Editor,
  cards: BoardCard[],
  snapshot: BoardSnapshot | null,
) {
  const layouts = new Map<string, PositionedCard>()
  for (const card of snapshot?.cards ?? []) {
    layouts.set(card.itemId, card)
  }

  const existingShapes = new Map(
    editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === 'bookmark-card')
      .map((shape) => [shape.id, shape]),
  )

  const creates: TLShapePartial[] = []
  const updates: TLShapePartial[] = []
  const liveIds = new Set<string>()

  cards.forEach((card, index) => {
    const shapeId = createShapeId(`card-${card.itemId}`)
    liveIds.add(shapeId)
    const currentShape = existingShapes.get(shapeId)
    const persisted = layouts.get(card.itemId)

    const x = persisted?.x ?? currentShape?.x ?? (index % 3) * 360
    const y = persisted?.y ?? currentShape?.y ?? Math.floor(index / 3) * 420
    const w = persisted?.w ?? currentShape?.props.w ?? 320
    const h = persisted?.h ?? currentShape?.props.h ?? 360

    const shape: TLShapePartial = {
      id: shapeId,
      type: 'bookmark-card',
      x,
      y,
      props: {
        w,
        h,
        url: card.url,
        title: card.title,
        summary: card.summary,
        sourceType: card.sourceType,
        authorLabel: card.authorHandle ? `@${card.authorHandle}` : card.authorName || '',
        tagsJson: JSON.stringify(card.tags),
        mediaJson: JSON.stringify(
          [...card.media]
            .sort((left, right) => left.position - right.position)
            .slice(0, 4)
            .map((media) => ({
              kind: media.kind,
              url: media.url,
              previewUrl: media.previewUrl,
              altText: media.altText,
            })),
        ),
      },
    }

    if (currentShape) {
      updates.push(shape)
    } else {
      creates.push(shape)
    }
  })

  const staleIds = [...existingShapes.keys()].filter((shapeId) => !liveIds.has(shapeId))

  if (creates.length > 0) {
    editor.createShapes(creates)
  }

  if (updates.length > 0) {
    editor.updateShapes(updates)
  }

  if (staleIds.length > 0) {
    editor.deleteShapes(staleIds)
  }
}

export function BoardCanvas(props: {
  cards: BoardCard[]
  snapshot: BoardSnapshot | null
  emptyTitle: string
  onSave?: (snapshot: BoardSnapshot) => Promise<void>
}) {
  const editorRef = useRef<Editor | null>(null)
  const hasFramedInitialContentRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    syncBoardShapes(editor, props.cards, props.snapshot)
    if (!hasFramedInitialContentRef.current && props.cards.length > 0) {
      editor.zoomToFit({
        animation: {
          duration: 0,
        },
      })
      hasFramedInitialContentRef.current = true
    }
  }, [props.cards, props.snapshot])

  async function handleSave() {
    if (!props.onSave || !editorRef.current) {
      return
    }

    setIsSaving(true)
    try {
      const cards = editorRef.current
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'bookmark-card')
        .map((shape) => ({
          itemId: shape.id.replace('shape:card-', '') as BoardCard['itemId'],
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
        }))

      await props.onSave({
        version: 1,
        cards,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="canvas-shell">
      {props.onSave ? (
        <div className="canvas-toolbar">
          <button className="button button-primary" disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      ) : null}

      {props.cards.length === 0 ? (
        <div className="panel empty-panel">
          <p className="eyebrow">{props.emptyTitle}</p>
          <h2 className="section-title">Nothing here yet.</h2>
        </div>
      ) : null}

      <div className="canvas-frame">
        <Tldraw
          hideUi
          onMount={(editor) => {
            editorRef.current = editor
            syncBoardShapes(editor, props.cards, props.snapshot)
            if (!hasFramedInitialContentRef.current && props.cards.length > 0) {
              editor.zoomToFit({
                animation: {
                  duration: 0,
                },
              })
              hasFramedInitialContentRef.current = true
            }
          }}
          shapeUtils={[BookmarkCardShapeUtil]}
        />
      </div>
    </div>
  )
}
