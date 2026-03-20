import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import { itemValidator } from './validators'

export const searchTextHits = internalQuery({
  args: {
    userId: v.id('users'),
    query: v.string(),
    boardId: v.optional(v.id('boards')),
    limit: v.number(),
  },
  returns: v.array(itemValidator),
  handler: async (ctx, args) => {
    const boardId = args.boardId

    if (!boardId) {
      return await ctx.db
        .query('items')
        .withSearchIndex('search_text', (q) =>
          q.search('searchText', args.query).eq('userId', args.userId),
        )
        .take(args.limit)
    }

    const memberships = await ctx.db
      .query('boardMemberships')
      .withIndex('by_board', (q) => q.eq('boardId', boardId))
      .collect()
    const primaryBoardItems = await ctx.db
      .query('items')
      .withIndex('by_user_and_board', (q) =>
        q.eq('userId', args.userId).eq('boardId', boardId),
      )
      .collect()
    const allowedItemIds = new Set(
      [
        ...memberships
          .filter((membership) => membership.userId === args.userId)
          .map((membership) => membership.itemId),
        ...primaryBoardItems.map((item) => item._id),
      ],
    )

    if (allowedItemIds.size === 0) {
      return []
    }

    const searchResults = await ctx.db
      .query('items')
      .withSearchIndex('search_text', (q) =>
        q.search('searchText', args.query).eq('userId', args.userId),
      )
      .take(Math.max(args.limit * 5, 60))

    return searchResults
      .filter((item) => allowedItemIds.has(item._id))
      .slice(0, args.limit)
  },
})
