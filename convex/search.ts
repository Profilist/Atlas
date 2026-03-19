"use node"

import { GoogleGenAI } from '@google/genai'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action } from './_generated/server'
import { requireViewerAction } from './auth'
import { boardCardRenderModelValidator } from './validators'

const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null

async function createEmbedding(searchText: string) {
  if (!ai) {
    return undefined
  }

  const response = await ai.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: [searchText],
    config: {
      outputDimensionality: 768,
    },
  })

  const values = response.embeddings?.[0]?.values
  return values && values.length > 0 ? values : undefined
}

type SearchBoardCard = {
  itemId: Id<'items'>
  x: number
  y: number
  w: number
  h: number
  cluster: string
  card: {
    itemId: Id<'items'>
    boardId?: Id<'boards'>
    sourceType: 'x' | 'link'
    sourceId?: string
    url: string
    canonicalUrl: string
    title: string
    summary: string
    contentText: string
    authorName?: string
    authorHandle?: string
    previewImageUrl?: string
    tags: string[]
    sourceCreatedAt?: number
    media: Doc<'itemAssets'>[]
  }
}

type SearchBoardResult = {
  boardTitle: string
  query: string
  cards: SearchBoardCard[]
}

export const generateBoard = action({
  args: {
    query: v.string(),
    boardId: v.optional(v.id('boards')),
  },
  returns: v.object({
    boardTitle: v.string(),
    query: v.string(),
    cards: v.array(
      v.object({
        itemId: v.id('items'),
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
        cluster: v.string(),
        card: boardCardRenderModelValidator,
      }),
    ),
  }),
  handler: async (ctx, args): Promise<SearchBoardResult> => {
    const viewer = await requireViewerAction(ctx)
    const scopeBoard: Doc<'boards'> | null = args.boardId
      ? await ctx.runQuery(internal.boardReaders.getOwnedBoard, {
          userId: viewer._id,
          boardId: args.boardId,
        })
      : null

    const textHits = await ctx.runQuery(internal.searchIndex.searchTextHits, {
      userId: viewer._id,
      query: args.query,
      boardId: args.boardId,
      limit: 24,
    })

    const embedding = await createEmbedding(args.query).catch(() => undefined)
    const vectorHits = embedding
      ? await ctx.vectorSearch('items', 'by_embedding', {
          vector: embedding,
          limit: 24,
          filter: (q) => q.eq('userId', viewer._id),
        })
      : []

    const scoreMap = new Map<Id<'items'>, number>()

    textHits.forEach((item: (typeof textHits)[number], index: number) => {
      scoreMap.set(item._id, (scoreMap.get(item._id) ?? 0) + (24 - index) * 4)
    })

    vectorHits.forEach((item: (typeof vectorHits)[number]) => {
      if (args.boardId) {
        const matchingTextHit = textHits.find(
          (textHit: (typeof textHits)[number]) => textHit._id === item._id,
        )
        if (matchingTextHit && matchingTextHit.boardId !== args.boardId) {
          return
        }
      }

      scoreMap.set(item._id, (scoreMap.get(item._id) ?? 0) + item._score * 100)
    })

    const topIds = [...scoreMap.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 18)
      .map(([itemId]) => itemId)

    const cards = await ctx.runQuery(internal.items.getCardsByItemIds, {
      userId: viewer._id,
      itemIds: topIds,
    })

    const grouped = new Map<string, typeof cards>()
    for (const card of cards) {
      const cluster =
        card.tags[0] ||
        (scopeBoard ? scopeBoard.name : card.authorHandle || card.title.split(' ')[0] || 'Relevant')
      const bucket = grouped.get(cluster) ?? []
      bucket.push(card)
      grouped.set(cluster, bucket)
    }

    const positionedCards: Array<{
      itemId: (typeof cards)[number]['itemId']
      x: number
      y: number
      w: number
      h: number
      cluster: string
      card: (typeof cards)[number]
    }> = []
    let clusterIndex = 0
    for (const [cluster, bucket] of grouped.entries()) {
      bucket.forEach((card: (typeof cards)[number], itemIndex: number) => {
        const column = itemIndex % 2
        const row = Math.floor(itemIndex / 2)
        positionedCards.push({
          itemId: card.itemId,
          x: clusterIndex * 760 + column * 340,
          y: row * 420,
          w: 320,
          h: 360,
          cluster,
          card,
        })
      })

      clusterIndex += 1
    }

    return {
      boardTitle: scopeBoard
        ? `${scopeBoard.name}: ${args.query}`
        : `Search: ${args.query}`,
      query: args.query,
      cards: positionedCards,
    }
  },
})
