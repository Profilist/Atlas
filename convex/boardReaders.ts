import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { boardSummaryValidator } from './validators'

export const getOwnedBoard = internalQuery({
  args: {
    userId: v.id('users'),
    boardId: v.id('boards'),
  },
  returns: v.union(boardSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId)
    if (!board || board.userId !== args.userId) {
      return null
    }

    return board
  },
})

export const getLatestSnapshotMeta = internalQuery({
  args: {
    boardId: v.id('boards'),
  },
  returns: v.union(
    v.object({
      storageId: v.id('_storage'),
      version: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const latestSnapshot = (
      await ctx.db
        .query('boardSnapshots')
        .withIndex('by_board', (q) => q.eq('boardId', args.boardId))
        .order('desc')
        .take(1)
    )[0]

    if (!latestSnapshot) {
      return null
    }

    return {
      storageId: latestSnapshot.storageId,
      version: latestSnapshot.version,
      updatedAt: latestSnapshot.updatedAt,
    }
  },
})

export const getBoardItemIds = internalQuery({
  args: {
    userId: v.id('users'),
    boardId: v.id('boards'),
  },
  returns: v.array(v.id('items')),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query('boardMemberships')
      .withIndex('by_board', (q) => q.eq('boardId', args.boardId))
      .collect()
    const primaryBoardItems = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', args.userId).eq('boardId', args.boardId),
      )
      .collect()

    return [
      ...new Set([
        ...memberships
          .filter((membership) => membership.userId === args.userId)
          .map((membership) => membership.itemId),
        ...primaryBoardItems.map((item) => item._id),
      ]),
    ]
  },
})

export const getPrimaryBoardItemIds = internalQuery({
  args: {
    userId: v.id('users'),
    boardId: v.id('boards'),
  },
  returns: v.array(v.id('items')),
  handler: async (ctx, args) => {
    const primaryBoardItems = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', args.userId).eq('boardId', args.boardId),
      )
      .collect()

    return primaryBoardItems.map((item) => item._id)
  },
})
