import { ConvexError, v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery } from './_generated/server'
import { requireViewer } from './auth'
import {
  boardCardRenderModelValidator,
  itemMediaAssetValidator,
  itemValidator,
} from './validators'

const processedAssetInputValidator = v.object({
  kind: v.union(
    v.literal('image'),
    v.literal('video'),
    v.literal('gif'),
    v.literal('link-preview'),
  ),
  url: v.string(),
  previewUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  altText: v.optional(v.string()),
  position: v.number(),
})

export const getPipelineItem = internalQuery({
  args: {
    itemId: v.id('items'),
  },
  returns: v.union(
    v.object({
      item: itemValidator,
      assets: v.array(itemMediaAssetValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId)
    if (!item) {
      return null
    }

    const assets = await ctx.db
      .query('itemAssets')
      .withIndex('by_item_and_position', (q) => q.eq('itemId', args.itemId))
      .collect()

    return { item, assets }
  },
})

export const markProcessing = internalMutation({
  args: {
    itemId: v.id('items'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      analysisStatus: 'processing',
      analysisError: undefined,
      updatedAt: Date.now(),
    })

    return null
  },
})

export const markFailed = internalMutation({
  args: {
    itemId: v.id('items'),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      analysisStatus: 'error',
      analysisError: args.message,
      updatedAt: Date.now(),
    })

    return null
  },
})

export const applyProcessedItem = internalMutation({
  args: {
    itemId: v.id('items'),
    boardId: v.id('boards'),
    title: v.string(),
    summary: v.string(),
    contentText: v.string(),
    searchText: v.string(),
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    previewImageUrl: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceCreatedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    assets: v.array(processedAssetInputValidator),
  },
  returns: v.object({
    oldBoardId: v.optional(v.id('boards')),
    boardId: v.id('boards'),
  }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId)
    if (!item) {
      throw new ConvexError('Item not found')
    }

    const previousBoardId = item.boardId

    const existingAssets = await ctx.db
      .query('itemAssets')
      .withIndex('by_item', (q) => q.eq('itemId', args.itemId))
      .collect()

    for (const asset of existingAssets) {
      await ctx.db.delete(asset._id)
    }

    for (const asset of args.assets) {
      await ctx.db.insert('itemAssets', {
        userId: item.userId,
        itemId: args.itemId,
        kind: asset.kind,
        url: asset.url,
        previewUrl: asset.previewUrl,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        mimeType: asset.mimeType,
        altText: asset.altText,
        position: asset.position,
      })
    }

    await ctx.db.patch(args.itemId, {
      boardId: args.boardId,
      title: args.title,
      summary: args.summary,
      contentText: args.contentText,
      searchText: args.searchText,
      authorName: args.authorName,
      authorHandle: args.authorHandle,
      previewImageUrl: args.previewImageUrl,
      tags: args.tags,
      sourceCreatedAt: args.sourceCreatedAt,
      embedding: args.embedding,
      analysisStatus: 'ready',
      analysisError: undefined,
      updatedAt: Date.now(),
    })

    const existingMembership = await ctx.db
      .query('boardMemberships')
      .withIndex('by_board_and_item', (q) =>
        q.eq('boardId', args.boardId).eq('itemId', args.itemId),
      )
      .unique()

    if (!existingMembership) {
      await ctx.db.insert('boardMemberships', {
        userId: item.userId,
        boardId: args.boardId,
        itemId: args.itemId,
        createdAt: Date.now(),
      })
    }

    if (previousBoardId && previousBoardId !== args.boardId) {
      const priorMembership = await ctx.db
        .query('boardMemberships')
        .withIndex('by_board_and_item', (q) =>
          q.eq('boardId', previousBoardId).eq('itemId', args.itemId),
        )
        .unique()

      if (priorMembership) {
        await ctx.db.delete(priorMembership._id)
      }

      const previousBoard = await ctx.db.get(previousBoardId)
      if (previousBoard) {
        await ctx.db.patch(previousBoardId, {
          itemCount: Math.max(0, previousBoard.itemCount - 1),
          updatedAt: Date.now(),
        })
      }
    }

    if (previousBoardId !== args.boardId) {
      const nextBoard = await ctx.db.get(args.boardId)
      if (nextBoard) {
        await ctx.db.patch(args.boardId, {
          itemCount: nextBoard.itemCount + 1,
          updatedAt: Date.now(),
        })
      }
    }

    return {
      oldBoardId: previousBoardId,
      boardId: args.boardId,
    }
  },
})

export const listCardsForBoard = internalQuery({
  args: {
    boardId: v.id('boards'),
  },
  returns: v.array(boardCardRenderModelValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const items = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', viewer._id).eq('boardId', args.boardId),
      )
      .collect()

    const cards: Array<{
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
      media: any[]
    }> = []
    for (const item of items) {
      const media = await ctx.db
        .query('itemAssets')
        .withIndex('by_item_and_position', (q) => q.eq('itemId', item._id))
        .collect()

      cards.push({
        itemId: item._id,
        boardId: item.boardId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        title: item.title,
        summary: item.summary,
        contentText: item.contentText,
        authorName: item.authorName,
        authorHandle: item.authorHandle,
        previewImageUrl: item.previewImageUrl,
        tags: item.tags,
        sourceCreatedAt: item.sourceCreatedAt,
        media,
      })
    }

    return cards
  },
})

export const getCardsByItemIds = internalQuery({
  args: {
    userId: v.id('users'),
    itemIds: v.array(v.id('items')),
  },
  returns: v.array(boardCardRenderModelValidator),
  handler: async (ctx, args) => {
    const cards: Array<{
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
      media: any[]
    }> = []

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId)
      if (!item || item.userId !== args.userId) {
        continue
      }

      const media = await ctx.db
        .query('itemAssets')
        .withIndex('by_item_and_position', (q) => q.eq('itemId', item._id))
        .collect()

      cards.push({
        itemId: item._id,
        boardId: item.boardId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        title: item.title,
        summary: item.summary,
        contentText: item.contentText,
        authorName: item.authorName,
        authorHandle: item.authorHandle,
        previewImageUrl: item.previewImageUrl,
        tags: item.tags,
        sourceCreatedAt: item.sourceCreatedAt,
        media,
      })
    }

    return cards
  },
})
