import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation } from './_generated/server'
import { requireViewer } from './auth'
import { canonicalizeUrl, getDomainFromUrl } from './utils'

export const ingest = mutation({
  args: {
    urls: v.array(v.string()),
  },
  returns: v.object({
    created: v.number(),
    skipped: v.number(),
    itemIds: v.array(v.id('items')),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx)
    const normalizedUrls = [...new Set(args.urls.map((value) => value.trim()).filter(Boolean))]

    if (normalizedUrls.length === 0) {
      throw new ConvexError('Enter at least one URL')
    }

    const now = Date.now()
    const syncRunId = await ctx.db.insert('syncRuns', {
      userId: viewer._id,
      source: 'manual',
      status: 'running',
      startedAt: now,
      processedCount: 0,
      message: 'Preparing manual links',
    })

    let created = 0
    let skipped = 0
    const itemIds = []

    for (const rawUrl of normalizedUrls) {
      const canonicalUrl = canonicalizeUrl(rawUrl)
      const existing = await ctx.db
        .query('items')
        .withIndex('by_user_and_canonical_url', (q) =>
          q.eq('userId', viewer._id).eq('canonicalUrl', canonicalUrl),
        )
        .unique()

      if (existing) {
        skipped += 1
        continue
      }

      const itemId = await ctx.db.insert('items', {
        userId: viewer._id,
        sourceType: 'link',
        sourceId: undefined,
        url: canonicalUrl,
        canonicalUrl,
        domain: getDomainFromUrl(canonicalUrl),
        title: getDomainFromUrl(canonicalUrl) ?? 'Saved link',
        summary: '',
        contentText: '',
        searchText: canonicalUrl,
        authorName: undefined,
        authorHandle: undefined,
        previewImageUrl: undefined,
        tags: [],
        analysisStatus: 'queued',
        analysisError: undefined,
        sourceCreatedAt: undefined,
        createdAt: now,
        updatedAt: now,
        embedding: undefined,
      })

      itemIds.push(itemId)
      created += 1
      await ctx.scheduler.runAfter(0, internal.itemPipeline.extractAndAnalyze, {
        itemId,
      })
    }

    await ctx.db.patch(syncRunId, {
      status: 'completed',
      completedAt: Date.now(),
      processedCount: created,
      message:
        created === 0
          ? 'All pasted links were already saved'
          : `Queued ${created} link${created === 1 ? '' : 's'} for analysis`,
    })

    return {
      created,
      skipped,
      itemIds,
    }
  },
})
