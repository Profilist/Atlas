import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { internalQuery, mutation, query } from './_generated/server'
import { requireViewer } from './auth'

const xConnectionValidator = v.object({
  _id: v.id('xConnections'),
  _creationTime: v.number(),
  userId: v.id('users'),
  xUserId: v.string(),
  username: v.string(),
  displayName: v.optional(v.string()),
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  scope: v.array(v.string()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastSyncedAt: v.optional(v.number()),
  autoSyncEnabled: v.optional(v.boolean()),
})

export const getState = query({
  args: {},
  returns: v.object({
    connection: v.union(
      v.object({
        xUserId: v.string(),
        username: v.string(),
        displayName: v.optional(v.string()),
        scope: v.array(v.string()),
        expiresAt: v.optional(v.number()),
        lastSyncedAt: v.optional(v.number()),
        autoSyncEnabled: v.boolean(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx)
    const connection = await ctx.db
      .query('xConnections')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique()

    if (!connection) {
      return { connection: null }
    }

    return {
      connection: {
        xUserId: connection.xUserId,
        username: connection.username,
        displayName: connection.displayName,
        scope: connection.scope,
        expiresAt: connection.expiresAt,
        lastSyncedAt: connection.lastSyncedAt,
        autoSyncEnabled: connection.autoSyncEnabled ?? false,
      },
    }
  },
})

export const completeXConnect = mutation({
  args: {
    xUserId: v.string(),
    username: v.string(),
    displayName: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    scope: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const existing = await ctx.db
      .query('xConnections')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique()

    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        xUserId: args.xUserId,
        username: args.username,
        displayName: args.displayName,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        scope: args.scope,
        expiresAt: args.expiresAt,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('xConnections', {
        userId: viewer._id,
        xUserId: args.xUserId,
        username: args.username,
        displayName: args.displayName,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        scope: args.scope,
        expiresAt: args.expiresAt,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: undefined,
        autoSyncEnabled: false,
      })
    }

    await ctx.scheduler.runAfter(0, internal.sync.syncNowInternal, {
      userId: viewer._id,
    })
    return null
  },
})

export const disconnectX = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx)
    const connection = await ctx.db
      .query('xConnections')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique()

    if (connection) {
      await ctx.db.delete(connection._id)
    }

    return null
  },
})

export const setAutoSyncEnabled = mutation({
  args: {
    enabled: v.boolean(),
  },
  returns: v.object({
    autoSyncEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const connection = await ctx.db
      .query('xConnections')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique()

    if (!connection) {
      throw new ConvexError('Connect X before changing auto sync')
    }

    await ctx.db.patch(connection._id, {
      autoSyncEnabled: args.enabled,
      updatedAt: Date.now(),
    })

    return {
      autoSyncEnabled: args.enabled,
    }
  },
})

export const getConnectionForUser = internalQuery({
  args: {
    userId: v.id('users'),
  },
  returns: v.union(xConnectionValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('xConnections')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .unique()
  },
})

export const markSynced = mutation({
  args: {
    connectionId: v.id('xConnections'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const connection = await ctx.db.get(args.connectionId)
    if (!connection || connection.userId !== viewer._id) {
      throw new ConvexError('Connection not found')
    }

    await ctx.db.patch(connection._id, {
      lastSyncedAt: Date.now(),
      updatedAt: Date.now(),
    })

    return null
  },
})
