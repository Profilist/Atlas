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
    if (args.boardId) {
      return await ctx.db
        .query('items')
        .withSearchIndex('search_text', (q) =>
          q
            .search('searchText', args.query)
            .eq('userId', args.userId)
            .eq('boardId', args.boardId),
        )
        .take(args.limit)
    }

    return await ctx.db
      .query('items')
      .withSearchIndex('search_text', (q) =>
        q.search('searchText', args.query).eq('userId', args.userId),
      )
      .take(args.limit)
  },
})
