import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { getDomainFromUrl, normalizeWhitespace } from './utils'

const importedAssetValidator = v.object({
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

const importedPostValidator = v.object({
  sourceId: v.string(),
  url: v.string(),
  canonicalUrl: v.string(),
  title: v.string(),
  text: v.string(),
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  sourceCreatedAt: v.optional(v.number()),
  previewImageUrl: v.optional(v.string()),
  assets: v.array(importedAssetValidator),
})

export const startRun = internalMutation({
  args: {
    userId: v.id('users'),
    source: v.union(v.literal('x'), v.literal('manual')),
    message: v.string(),
  },
  returns: v.id('syncRuns'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('syncRuns', {
      userId: args.userId,
      source: args.source,
      status: 'running',
      startedAt: Date.now(),
      processedCount: 0,
      message: args.message,
    })
  },
})

export const finishRun = internalMutation({
  args: {
    syncRunId: v.id('syncRuns'),
    processedCount: v.number(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.syncRunId, {
      status: 'completed',
      completedAt: Date.now(),
      processedCount: args.processedCount,
      message: args.message,
    })

    return null
  },
})

export const failRun = internalMutation({
  args: {
    syncRunId: v.id('syncRuns'),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.syncRunId, {
      status: 'failed',
      completedAt: Date.now(),
      message: args.message,
    })

    return null
  },
})

export const markConnectionSynced = internalMutation({
  args: {
    connectionId: v.id('xConnections'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      lastSyncedAt: Date.now(),
      updatedAt: Date.now(),
    })

    return null
  },
})

export const listConnectedUserIds = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      userId: v.id('users'),
    }),
  ),
  handler: async (ctx) => {
    const connections = await ctx.db.query('xConnections').collect()
    return connections
      .filter((connection) => connection.autoSyncEnabled === true)
      .map((connection) => ({
        userId: connection.userId,
      }))
  },
})

export const enqueueXImport = internalMutation({
  args: {
    userId: v.id('users'),
    posts: v.array(importedPostValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    itemIds: v.array(v.id('items')),
  }),
  handler: async (ctx, args) => {
    let created = 0
    let updated = 0
    const itemIds = []

    for (const post of args.posts) {
      const existing = await ctx.db
        .query('items')
        .withIndex('by_user_and_source_id', (q) =>
          q.eq('userId', args.userId).eq('sourceId', post.sourceId),
        )
        .unique()

      if (existing) {
        await ctx.db.patch(existing._id, {
          url: post.url,
          canonicalUrl: post.canonicalUrl,
          domain: getDomainFromUrl(post.canonicalUrl),
          title: post.title,
          summary: post.text,
          contentText: post.text,
          searchText: normalizeWhitespace(
            [post.title, post.text, post.authorName, post.authorHandle]
              .filter(Boolean)
              .join(' '),
          ),
          authorName: post.authorName,
          authorHandle: post.authorHandle,
          previewImageUrl: post.previewImageUrl,
          sourceCreatedAt: post.sourceCreatedAt,
          updatedAt: Date.now(),
          analysisStatus: 'queued',
          analysisError: undefined,
        })

        const previousAssets = await ctx.db
          .query('itemAssets')
          .withIndex('by_item', (q) => q.eq('itemId', existing._id))
          .collect()

        for (const asset of previousAssets) {
          await ctx.db.delete(asset._id)
        }

        for (const asset of post.assets) {
          await ctx.db.insert('itemAssets', {
            userId: args.userId,
            itemId: existing._id,
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

        itemIds.push(existing._id)
        updated += 1
        continue
      }

      const itemId = await ctx.db.insert('items', {
        userId: args.userId,
        sourceType: 'x',
        sourceId: post.sourceId,
        url: post.url,
        canonicalUrl: post.canonicalUrl,
        domain: getDomainFromUrl(post.canonicalUrl),
        title: post.title,
        summary: post.text,
        contentText: post.text,
        searchText: normalizeWhitespace(
          [post.title, post.text, post.authorName, post.authorHandle]
            .filter(Boolean)
            .join(' '),
        ),
        authorName: post.authorName,
        authorHandle: post.authorHandle,
        previewImageUrl: post.previewImageUrl,
        tags: [],
        analysisStatus: 'queued',
        analysisError: undefined,
        sourceCreatedAt: post.sourceCreatedAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        embedding: undefined,
      })

      for (const asset of post.assets) {
        await ctx.db.insert('itemAssets', {
          userId: args.userId,
          itemId,
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

      itemIds.push(itemId)
      created += 1
    }

    return {
      created,
      updated,
      itemIds,
    }
  },
})
