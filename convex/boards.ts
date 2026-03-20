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
import type { Doc, Id } from './_generated/dataModel'
import {
  boardCardRenderModelValidator,
  boardSnapshotValidator,
  boardSummaryValidator,
  deleteImpactValidator,
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
      deleteImpact: deleteImpactValidator,
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

    const memberships = await ctx.db
      .query('boardMemberships')
      .withIndex('by_board', (q) => q.eq('boardId', board._id))
      .collect()

    const primaryBoardItems = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', viewer._id).eq('boardId', board._id),
      )
      .collect()

    const primaryItemsById = new Map(
      primaryBoardItems.map((item) => [item._id, item]),
    )
    const membershipOnlyItemIds = [
      ...new Set(
        memberships
          .filter(
            (membership) =>
              membership.userId === viewer._id &&
              !primaryItemsById.has(membership.itemId),
          )
          .map((membership) => membership.itemId),
      ),
    ]
    const itemIds = [
      ...new Set([
        ...memberships
          .filter((membership) => membership.userId === viewer._id)
          .map((membership) => membership.itemId),
        ...primaryBoardItems.map((item) => item._id),
      ]),
    ]

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
    for (const itemId of itemIds) {
      const item =
        primaryItemsById.get(itemId) ?? (await ctx.db.get(itemId))

      if (!item || item.userId !== viewer._id) {
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
      deleteImpact: {
        ownedItemCount: primaryBoardItems.length,
        membershipOnlyItemCount: membershipOnlyItemIds.length,
      },
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

export const createFromSearch = mutation({
  args: {
    name: v.string(),
    itemIds: v.array(v.id('items')),
    snapshotStorageId: v.id('_storage'),
  },
  returns: v.object({
    boardId: v.id('boards'),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const itemIds = [...new Set(args.itemIds)]

    if (itemIds.length === 0) {
      throw new ConvexError('Add at least one search result before creating a board')
    }

    const rawName = boardNameFromTopic(args.name)
    const slug = slugify(rawName) || 'collected'
    const existingBoard = await ctx.db
      .query('boards')
      .withIndex('by_user_and_slug', (q) =>
        q.eq('userId', viewer._id).eq('slug', slug),
      )
      .unique()

    if (existingBoard) {
      throw new ConvexError('A board with that name already exists')
    }

    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId)
      if (!item || item.userId !== viewer._id) {
        throw new ConvexError('Some search results are no longer available')
      }
    }

    const now = Date.now()
    const boardId = await ctx.db.insert('boards', {
      userId: viewer._id,
      name: rawName,
      slug,
      description: undefined,
      autoCreated: false,
      itemCount: itemIds.length,
      createdAt: now,
      updatedAt: now,
    })

    for (const itemId of itemIds) {
      await ctx.db.insert('boardMemberships', {
        userId: viewer._id,
        boardId,
        itemId,
        createdAt: now,
      })
    }

    await ctx.db.insert('boardSnapshots', {
      userId: viewer._id,
      boardId,
      storageId: args.snapshotStorageId,
      version: 1,
      updatedAt: now,
    })

    return {
      boardId,
    }
  },
})

export const deleteBoard = action({
  args: {
    boardId: v.id('boards'),
  },
  returns: v.object({
    redirectBoardId: v.optional(v.id('boards')),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ redirectBoardId?: Id<'boards'> }> => {
    const viewer = await requireViewerAction(ctx)
    const board = await ctx.runQuery(internal.boardReaders.getOwnedBoard, {
      boardId: args.boardId,
      userId: viewer._id,
    })

    if (!board) {
      throw new ConvexError('Board not found')
    }

    const primaryItemIds = await ctx.runQuery(
      internal.boardReaders.getPrimaryBoardItemIds,
      {
        userId: viewer._id,
        boardId: args.boardId,
      },
    )

    const reroutes: Array<{
      itemId: Id<'items'>
      boardId?: Id<'boards'>
    }> = []

    for (const itemId of primaryItemIds) {
      const nextBoard = await ctx.runAction(
        internal.boardRouting.resolveExistingBoardForItem,
        {
          itemId,
          excludedBoardId: args.boardId,
        },
      )

      reroutes.push({
        itemId,
        boardId: nextBoard.boardId,
      })
    }

    const deleteResult: { redirectBoardId?: Id<'boards'> } =
      await ctx.runMutation(internal.boards.applyDeleteBoard, {
      userId: viewer._id,
      boardId: args.boardId,
      reroutes,
    })

    return deleteResult
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

export const applyDeleteBoard = internalMutation({
  args: {
    userId: v.id('users'),
    boardId: v.id('boards'),
    reroutes: v.array(
      v.object({
        itemId: v.id('items'),
        boardId: v.optional(v.id('boards')),
      }),
    ),
  },
  returns: v.object({
    redirectBoardId: v.optional(v.id('boards')),
  }),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId)
    if (!board || board.userId !== args.userId) {
      throw new ConvexError('Board not found')
    }

    const primaryBoardItems = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', args.userId).eq('boardId', args.boardId),
      )
      .collect()

    const reroutesByItemId = new Map(
      args.reroutes.map((reroute) => [reroute.itemId, reroute.boardId]),
    )

    if (
      primaryBoardItems.some((item) => !reroutesByItemId.has(item._id)) ||
      primaryBoardItems.length !== reroutesByItemId.size
    ) {
      throw new ConvexError('Board delete plan is out of date')
    }

    const now = Date.now()
    const needsFallbackOther = primaryBoardItems.some(
      (item) => !reroutesByItemId.get(item._id),
    )
    const fallbackItems = primaryBoardItems.filter(
      (item) => !reroutesByItemId.get(item._id),
    )
    const directMoves = primaryBoardItems.filter((item) =>
      Boolean(reroutesByItemId.get(item._id)),
    )
    const recreateOtherAfterDelete = needsFallbackOther && board.slug === 'other'
    let otherBoard: {
      _id: Id<'boards'>
      itemCount: number
    } | null =
      needsFallbackOther && !recreateOtherAfterDelete
        ? {
            _id: (
              await ensureBoardTargetForUser(ctx, {
                userId: args.userId,
                boardName: 'Other',
                description: undefined,
                autoCreated: true,
              })
            )._id,
            itemCount: 0,
          }
        : null
    const destinationAdjustments = new Map<
      Id<'boards'>,
      { boardId: Id<'boards'>; increment: number }
    >()

    const moveItemToBoard = async (
      item: Doc<'items'>,
      nextBoardId: Id<'boards'>,
    ) => {
      if (nextBoardId === args.boardId) {
        throw new ConvexError('Cannot move an item back onto the board being deleted')
      }

      const nextBoard = await ctx.db.get(nextBoardId)
      if (!nextBoard || nextBoard.userId !== args.userId) {
        throw new ConvexError('Destination board not found')
      }

      const existingDestinationMembership = await ctx.db
        .query('boardMemberships')
        .withIndex('by_board_and_item', (q) =>
          q.eq('boardId', nextBoardId).eq('itemId', item._id),
        )
        .unique()

      if (!existingDestinationMembership) {
        await ctx.db.insert('boardMemberships', {
          userId: args.userId,
          boardId: nextBoardId,
          itemId: item._id,
          createdAt: now,
        })

        const existingAdjustment = destinationAdjustments.get(nextBoardId)
        destinationAdjustments.set(nextBoardId, {
          boardId: nextBoardId,
          increment: (existingAdjustment?.increment ?? 0) + 1,
        })
      } else if (!destinationAdjustments.has(nextBoardId)) {
        destinationAdjustments.set(nextBoardId, {
          boardId: nextBoardId,
          increment: 0,
        })
      }

      await ctx.db.patch(item._id, {
        boardId: nextBoardId,
        updatedAt: now,
      })
    }

    for (const item of directMoves) {
      await moveItemToBoard(
        item,
        reroutesByItemId.get(item._id) as Id<'boards'>,
      )
    }

    const memberships = await ctx.db
      .query('boardMemberships')
      .withIndex('by_board', (q) => q.eq('boardId', args.boardId))
      .collect()

    for (const membership of memberships) {
      await ctx.db.delete(membership._id)
    }

    const snapshots = await ctx.db
      .query('boardSnapshots')
      .withIndex('by_board', (q) => q.eq('boardId', args.boardId))
      .collect()

    for (const snapshot of snapshots) {
      await ctx.db.delete(snapshot._id)
    }

    await ctx.db.delete(args.boardId)

    if (fallbackItems.length > 0) {
      if (!otherBoard) {
        const ensuredOtherBoard = await ensureBoardTargetForUser(ctx, {
          userId: args.userId,
          boardName: 'Other',
          description: undefined,
          autoCreated: true,
        })
        otherBoard = {
          _id: ensuredOtherBoard._id,
          itemCount: ensuredOtherBoard.itemCount,
        }
      }

      for (const item of fallbackItems) {
        await moveItemToBoard(item, otherBoard._id)
      }
    }

    for (const adjustment of destinationAdjustments.values()) {
      const destinationBoard = await ctx.db.get(adjustment.boardId)
      if (!destinationBoard || destinationBoard.userId !== args.userId) {
        continue
      }

      await ctx.db.patch(destinationBoard._id, {
        itemCount: destinationBoard.itemCount + adjustment.increment,
        updatedAt: now,
      })
    }

    const remainingBoards = await ctx.db
      .query('boards')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect() as Doc<'boards'>[]

    remainingBoards.sort((left, right) => right.updatedAt - left.updatedAt)

    return {
      redirectBoardId: remainingBoards[0]?._id,
    }
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
