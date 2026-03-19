import { ConvexError, v } from 'convex/values'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import { requireViewer, requireViewerAction } from './auth'
import type { Id } from './_generated/dataModel'
import {
  boardCardRenderModelValidator,
  boardSnapshotValidator,
  boardSummaryValidator,
  syncRunSummaryValidator,
} from './validators'
import { boardNameFromTopic, safeJsonParse, slugify } from './utils'

type BoardSnapshotValue = {
  version: number
  cards: Array<{
    itemId: Id<'items'>
    x: number
    y: number
    w: number
    h: number
  }>
}

type SnapshotMeta = {
  storageId: Id<'_storage'>
  version: number
  updatedAt: number
}

async function ensureBoardTargetForUser(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    boardId?: Id<'boards'>
    boardName?: string
    description?: string
    autoCreated: boolean
  },
) {
  if (args.boardId) {
    const existingBoard = await ctx.db.get(args.boardId)
    if (!existingBoard || existingBoard.userId !== args.userId) {
      throw new ConvexError('Board not found')
    }

    return existingBoard
  }

  const rawName = boardNameFromTopic(args.boardName ?? 'Collected')
  const slug = slugify(rawName) || 'collected'

  const matchingBoard = await ctx.db
    .query('boards')
    .withIndex('by_user_and_slug', (q) =>
      q.eq('userId', args.userId).eq('slug', slug),
    )
    .unique()

  if (matchingBoard) {
    return matchingBoard
  }

  const now = Date.now()
  const boardId = await ctx.db.insert('boards', {
    userId: args.userId,
    name: rawName,
    slug,
    description: args.description,
    autoCreated: args.autoCreated,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  const board = await ctx.db.get(boardId)
  if (!board) {
    throw new ConvexError('Failed to create board')
  }

  return board
}

export const list = query({
  args: {},
  returns: v.object({
    boards: v.array(boardSummaryValidator),
    latestSyncRun: v.union(syncRunSummaryValidator, v.null()),
  }),
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx)
    const boards = await ctx.db
      .query('boards')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .collect()

    boards.sort((left, right) => right.updatedAt - left.updatedAt)

    const latestSyncRun = (
      await ctx.db
        .query('syncRuns')
        .withIndex('by_user_and_started', (q) => q.eq('userId', viewer._id))
        .order('desc')
        .take(1)
    )[0] ?? null

    return {
      boards,
      latestSyncRun,
    }
  },
})

export const get = query({
  args: {
    boardId: v.id('boards'),
  },
  returns: v.union(
    v.object({
      board: boardSummaryValidator,
      cards: v.array(boardCardRenderModelValidator),
      snapshotVersion: v.optional(v.number()),
      snapshotUpdatedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const board = await ctx.db.get(args.boardId)
    if (!board || board.userId !== viewer._id) {
      return null
    }

    const items = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', viewer._id).eq('boardId', board._id),
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

    const latestSnapshot = (
      await ctx.db
        .query('boardSnapshots')
        .withIndex('by_board', (q) => q.eq('boardId', board._id))
        .order('desc')
        .take(1)
    )[0]

    return {
      board,
      cards,
      snapshotVersion: latestSnapshot?.version,
      snapshotUpdatedAt: latestSnapshot?.updatedAt,
    }
  },
})

export const generateSnapshotUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireViewer(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const commitSnapshot = mutation({
  args: {
    boardId: v.id('boards'),
    storageId: v.id('_storage'),
  },
  returns: v.object({
    boardId: v.id('boards'),
    version: v.number(),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const board = await ctx.db.get(args.boardId)
    if (!board || board.userId !== viewer._id) {
      throw new ConvexError('Board not found')
    }

    const latestSnapshot = (
      await ctx.db
        .query('boardSnapshots')
        .withIndex('by_board', (q) => q.eq('boardId', board._id))
        .order('desc')
        .take(1)
    )[0]

    const version = (latestSnapshot?.version ?? 0) + 1
    await ctx.db.insert('boardSnapshots', {
      userId: viewer._id,
      boardId: board._id,
      storageId: args.storageId,
      version,
      updatedAt: Date.now(),
    })

    await ctx.db.patch(board._id, {
      updatedAt: Date.now(),
    })

    return {
      boardId: board._id,
      version,
    }
  },
})

export const readSnapshot = action({
  args: {
    boardId: v.id('boards'),
  },
  returns: v.union(boardSnapshotValidator, v.null()),
  handler: async (ctx, args): Promise<BoardSnapshotValue | null> => {
    const viewer = await requireViewerAction(ctx)
    const board = await ctx.runQuery(internal.boardReaders.getOwnedBoard, {
      boardId: args.boardId,
      userId: viewer._id,
    })

    if (!board) {
      throw new ConvexError('Board not found')
    }

    const latestSnapshot: SnapshotMeta | null = await ctx.runQuery(
      internal.boardReaders.getLatestSnapshotMeta,
      {
        boardId: args.boardId,
      },
    )

    if (!latestSnapshot) {
      return null
    }

    const blob: Blob | null = await ctx.storage.get(latestSnapshot.storageId)
    if (!blob) {
      return null
    }

    return safeJsonParse(await blob.text(), null)
  },
})

export const ensureBoardTarget = internalMutation({
  args: {
    userId: v.id('users'),
    boardId: v.optional(v.id('boards')),
    boardName: v.optional(v.string()),
    description: v.optional(v.string()),
    autoCreated: v.boolean(),
  },
  returns: boardSummaryValidator,
  handler: async (ctx, args) => {
    return await ensureBoardTargetForUser(ctx, args)
  },
})

export const saveGeneratedBoard = internalMutation({
  args: {
    userId: v.id('users'),
    name: v.string(),
    description: v.optional(v.string()),
    snapshotStorageId: v.id('_storage'),
  },
  returns: boardSummaryValidator,
  handler: async (ctx, args) => {
    const board = await ensureBoardTargetForUser(ctx, {
      userId: args.userId,
      boardName: args.name,
      description: args.description,
      autoCreated: true,
      boardId: undefined,
    })

    const latestSnapshot = (
      await ctx.db
        .query('boardSnapshots')
        .withIndex('by_board', (q) => q.eq('boardId', board._id))
        .order('desc')
        .take(1)
    )[0]

    await ctx.db.insert('boardSnapshots', {
      userId: args.userId,
      boardId: board._id,
      storageId: args.snapshotStorageId,
      version: (latestSnapshot?.version ?? 0) + 1,
      updatedAt: Date.now(),
    })

    return board
  },
})

export const listForUser = internalQuery({
  args: {
    userId: v.id('users'),
  },
  returns: v.array(boardSummaryValidator),
  handler: async (ctx, args) => {
    const boards = await ctx.db
      .query('boards')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()

    boards.sort((left, right) => right.updatedAt - left.updatedAt)
    return boards
  },
})
