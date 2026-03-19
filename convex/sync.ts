"use node"

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, type ActionCtx, internalAction } from './_generated/server'
import { requireViewerAction } from './auth'
import { canonicalizeUrl, normalizeWhitespace } from './utils'

const syncResultValidator = v.object({
  created: v.number(),
  updated: v.number(),
  queued: v.number(),
})

type SyncResult = {
  created: number
  updated: number
  queued: number
}

type ImportResult = {
  created: number
  updated: number
  itemIds: Id<'items'>[]
}

type ImportedPost = {
  sourceId: string
  url: string
  canonicalUrl: string
  title: string
  text: string
  authorName?: string
  authorHandle?: string
  sourceCreatedAt?: number
  previewImageUrl?: string
  assets: Array<{
    kind: 'image' | 'video' | 'gif' | 'link-preview'
    url: string
    previewUrl?: string
    width?: number
    height?: number
    durationMs?: number
    mimeType?: string
    altText?: string
    position: number
  }>
}

type XMedia = {
  media_key: string
  type?: 'photo' | 'video' | 'animated_gif'
  url?: string
  preview_image_url?: string
  width?: number
  height?: number
  alt_text?: string
  duration_ms?: number
  variants?: Array<{ url?: string; content_type?: string }>
}

type XUser = {
  id: string
  username?: string
  name?: string
}

type XPost = {
  id: string
  text?: string
  author_id?: string
  created_at?: string
  attachments?: { media_keys?: string[] }
}

function pickMediaUrl(media: XMedia) {
  if (media.type === 'photo') {
    return media.url ?? media.preview_image_url
  }

  return (
    media.variants?.find((variant) => variant.content_type === 'video/mp4')?.url ??
    media.preview_image_url ??
    media.url
  )
}

function mapXPost(post: XPost, usersById: Map<string, XUser>, mediaByKey: Map<string, XMedia>): ImportedPost {
  const author = post.author_id ? usersById.get(post.author_id) : undefined
  const canonicalUrl = canonicalizeUrl(
    `https://x.com/${author?.username ?? 'i'}/status/${post.id}`,
  )

  const assets: ImportedPost['assets'] = []
  for (const [index, mediaKey] of (post.attachments?.media_keys ?? []).entries()) {
    const media = mediaByKey.get(mediaKey)
    if (!media) {
      continue
    }

    const url = pickMediaUrl(media)
    if (!url) {
      continue
    }

    assets.push({
      kind:
        media.type === 'video'
          ? 'video'
          : media.type === 'animated_gif'
            ? 'gif'
            : 'image',
      url,
      previewUrl: media.preview_image_url ?? media.url,
      width: media.width,
      height: media.height,
      durationMs: media.duration_ms,
      mimeType:
        media.type === 'video' || media.type === 'animated_gif'
          ? 'video/mp4'
          : 'image/jpeg',
      altText: media.alt_text,
      position: index,
    })
  }

  return {
    sourceId: post.id,
    url: canonicalUrl,
    canonicalUrl,
    title: author?.username ? `@${author.username}` : 'Saved X post',
    text: normalizeWhitespace(post.text ?? ''),
    authorName: author?.name,
    authorHandle: author?.username,
    sourceCreatedAt: post.created_at ? Date.parse(post.created_at) : undefined,
    previewImageUrl: assets[0]?.previewUrl ?? assets[0]?.url,
    assets,
  }
}

async function fetchAllBookmarks(accessToken: string, xUserId: string) {
  const posts: ImportedPost[] = []
  let paginationToken: string | undefined
  let pageCount = 0

  while (pageCount < 5) {
    const url = new URL(`https://api.x.com/2/users/${xUserId}/bookmarks`)
    url.searchParams.set('max_results', '100')
    url.searchParams.set('expansions', 'author_id,attachments.media_keys')
    url.searchParams.set('tweet.fields', 'created_at,attachments,text,author_id')
    url.searchParams.set('user.fields', 'name,username')
    url.searchParams.set(
      'media.fields',
      'alt_text,duration_ms,height,media_key,preview_image_url,type,url,variants,width',
    )

    if (paginationToken) {
      url.searchParams.set('pagination_token', paginationToken)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new ConvexError(`X sync failed with status ${response.status}`)
    }

    const payload = await response.json()
    const usersById = new Map<string, XUser>(
      ((payload.includes?.users ?? []) as XUser[]).map((user) => [user.id, user]),
    )
    const mediaByKey = new Map<string, XMedia>(
      ((payload.includes?.media ?? []) as XMedia[]).map((media) => [
        media.media_key,
        media,
      ]),
    )

    for (const post of (payload.data ?? []) as XPost[]) {
      posts.push(mapXPost(post, usersById, mediaByKey))
    }

    paginationToken = payload.meta?.next_token
    pageCount += 1

    if (!paginationToken) {
      break
    }
  }

  return posts
}

async function runSyncForUser(
  ctx: ActionCtx,
  userId: Id<'users'>,
): Promise<SyncResult> {
  const connection = await ctx.runQuery(internal.connections.getConnectionForUser, {
    userId,
  })

  if (!connection) {
    return {
      created: 0,
      updated: 0,
      queued: 0,
    }
  }

  const syncRunId = await ctx.runMutation(internal.syncState.startRun, {
    userId,
    source: 'x',
    message: 'Syncing X bookmarks',
  })

  try {
    const posts = await fetchAllBookmarks(connection.accessToken, connection.xUserId)
    const importResult: ImportResult = await ctx.runMutation(
      internal.syncState.enqueueXImport,
      {
        userId,
        posts,
      },
    )

    await ctx.runAction(internal.sync.processImportBatch, {
      itemIds: importResult.itemIds,
    })

    await ctx.runMutation(internal.syncState.finishRun, {
      syncRunId,
      processedCount: importResult.created + importResult.updated,
      message:
        importResult.created + importResult.updated === 0
          ? 'No new bookmarks found'
          : `Queued ${importResult.itemIds.length} X bookmark${
              importResult.itemIds.length === 1 ? '' : 's'
            }`,
    })

    await ctx.runMutation(internal.syncState.markConnectionSynced, {
      connectionId: connection._id,
    })

    return {
      created: importResult.created,
      updated: importResult.updated,
      queued: importResult.itemIds.length,
    }
  } catch (error) {
    await ctx.runMutation(internal.syncState.failRun, {
      syncRunId,
      message: error instanceof Error ? error.message : 'Unknown sync failure',
    })
    throw error
  }
}

export const syncNow = action({
  args: {},
  returns: syncResultValidator,
  handler: async (ctx): Promise<SyncResult> => {
    const viewer: Doc<'users'> = await requireViewerAction(ctx)
    return await runSyncForUser(ctx, viewer._id)
  },
})

export const syncNowInternal = internalAction({
  args: {
    userId: v.id('users'),
  },
  returns: syncResultValidator,
  handler: async (ctx, args): Promise<SyncResult> => {
    return await runSyncForUser(ctx, args.userId)
  },
})

export const processImportBatch = internalAction({
  args: {
    itemIds: v.array(v.id('items')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const itemId of args.itemIds) {
      await ctx.scheduler.runAfter(0, internal.itemPipeline.embedAndRoute, {
        itemId,
      })
    }

    return null
  },
})

export const runScheduledSyncs = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const users = await ctx.runQuery(internal.syncState.listConnectedUserIds, {})

    for (const user of users) {
      await runSyncForUser(ctx, user.userId)
    }

    return null
  },
})
