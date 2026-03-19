import { convex } from '@convex-dev/better-auth/plugins'
import { createClient, type AuthFunctions, type GenericCtx } from '@convex-dev/better-auth'
import { ConvexError, v } from 'convex/values'
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal'
import { components, internal } from './_generated/api'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import {
  type ActionCtx,
  internalAction,
  internalQuery,
  type MutationCtx,
  query,
  type QueryCtx,
} from './_generated/server'
import authConfig from './auth.config'
import betterAuthSchema from './betterAuth/schema'
import { viewerValidator } from './validators'

const authFunctions: AuthFunctions = internal.auth

export const authComponent = createClient<DataModel, typeof betterAuthSchema>(
  components.betterAuth,
  {
    authFunctions,
    local: {
      schema: betterAuthSchema,
    },
    verbose: false,
    triggers: {
      user: {
        onCreate: async (ctx, authUser) => {
          const now = Date.now()
          const userId = await ctx.db.insert('users', {
            authUserId: authUser._id,
            email: authUser.email,
            name: authUser.name ?? undefined,
            image: authUser.image ?? undefined,
            createdAt: now,
            updatedAt: now,
          })

          await authComponent.setUserId(ctx, authUser._id, userId)
        },
        onUpdate: async (ctx, newUser) => {
          const userId = newUser.userId as Id<'users'> | undefined
          if (!userId) {
            return
          }

          await ctx.db.patch(userId, {
            authUserId: newUser._id,
            email: newUser.email,
            name: newUser.name ?? undefined,
            image: newUser.image ?? undefined,
            updatedAt: Date.now(),
          })
        },
        onDelete: async (ctx, authUser) => {
          const userId = authUser.userId as Id<'users'> | undefined
          if (!userId) {
            return
          }

          const xConnections = await ctx.db
            .query('xConnections')
            .withIndex('by_user', (q) => q.eq('userId', userId))
            .collect()

          const boards = await ctx.db
            .query('boards')
            .withIndex('by_user', (q) => q.eq('userId', userId))
            .collect()

          const items = await ctx.db
            .query('items')
            .withIndex('by_user_and_board', (q) =>
              q.eq('userId', userId).eq('boardId', undefined),
            )
            .collect()

          const syncRuns = await ctx.db
            .query('syncRuns')
            .withIndex('by_user_and_started', (q) => q.eq('userId', userId))
            .collect()

          for (const connection of xConnections) {
            await ctx.db.delete(connection._id)
          }

          for (const board of boards) {
            const memberships = await ctx.db
              .query('boardMemberships')
              .withIndex('by_board', (q) => q.eq('boardId', board._id))
              .collect()

            const snapshots = await ctx.db
              .query('boardSnapshots')
              .withIndex('by_board', (q) => q.eq('boardId', board._id))
              .collect()

            const boardItems = await ctx.db
              .query('items')
              .withIndex('by_user_and_board', (q) =>
                q.eq('userId', userId).eq('boardId', board._id),
              )
              .collect()

            for (const membership of memberships) {
              await ctx.db.delete(membership._id)
            }

            for (const snapshot of snapshots) {
              await ctx.db.delete(snapshot._id)
            }

            for (const item of boardItems) {
              const assets = await ctx.db
                .query('itemAssets')
                .withIndex('by_item', (q) => q.eq('itemId', item._id))
                .collect()

              for (const asset of assets) {
                await ctx.db.delete(asset._id)
              }

              await ctx.db.delete(item._id)
            }

            await ctx.db.delete(board._id)
          }

          for (const item of items) {
            const assets = await ctx.db
              .query('itemAssets')
              .withIndex('by_item', (q) => q.eq('itemId', item._id))
              .collect()

            for (const asset of assets) {
              await ctx.db.delete(asset._id)
            }

            await ctx.db.delete(item._id)
          }

          for (const syncRun of syncRuns) {
            await ctx.db.delete(syncRun._id)
          }

          await ctx.db.delete(userId)
        },
      },
    },
  },
)

export const { onCreate, onDelete, onUpdate } = authComponent.triggersApi()

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.SITE_URL ?? process.env.VITE_APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    plugins: [
      convex({
        authConfig,
      }),
    ],
  }) satisfies BetterAuthOptions

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))

export const rotateKeys = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const auth = createAuth(ctx)
    await auth.api.rotateKeys()
    return null
  },
})

async function getViewerByAuthUserId(ctx: QueryCtx | MutationCtx, authUserId: string) {
  return await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
    .unique()
}

async function getCurrentAuthUserId(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.subject ?? null
}

export async function getCurrentViewer(ctx: QueryCtx | MutationCtx) {
  const authUserId = await getCurrentAuthUserId(ctx)
  if (!authUserId) {
    return null
  }

  return await getViewerByAuthUserId(ctx, authUserId)
}

export async function requireViewer(ctx: QueryCtx | MutationCtx) {
  const viewer = await getCurrentViewer(ctx)
  if (!viewer) {
    throw new ConvexError('Unauthenticated')
  }

  return viewer
}

export async function requireViewerAction(ctx: ActionCtx): Promise<Doc<'users'>> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity?.subject) {
    throw new ConvexError('Unauthenticated')
  }

  const viewer: Doc<'users'> | null = await ctx.runQuery(
    internal.auth.viewerByAuthUserId,
    {
      authUserId: identity.subject,
    },
  )

  if (!viewer) {
    throw new ConvexError('Unauthenticated')
  }

  return viewer
}

export const viewerByAuthUserId = internalQuery({
  args: {
    authUserId: v.string(),
  },
  returns: v.union(viewerValidator, v.null()),
  handler: async (ctx, args) => {
    return await getViewerByAuthUserId(ctx, args.authUserId)
  },
})

export const currentUser = query({
  args: {},
  returns: v.union(viewerValidator, v.null()),
  handler: async (ctx) => {
    return await getCurrentViewer(ctx)
  },
})
