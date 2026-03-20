import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action, internalMutation } from './_generated/server'
import { requireViewerAction } from './auth'
import { manualLinkIngestResultValidator } from './validators'
import { canonicalizeUrl, getDomainFromUrl } from './utils'

type ManualLinkIngestResult = {
  created: number
  skipped: number
  redirectBoardId?: Id<'boards'>
  redirectBoardName?: string
  affectedBoardCount: number
}

type PreparedIngestResult = {
  syncRunId: Id<'syncRuns'>
  created: number
  skipped: number
  createdItems: Array<{
    itemId: Id<'items'>
    canonicalUrl: string
  }>
}

function normalizeInputUrls(urls: string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of urls) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }

    let canonicalUrl: string
    try {
      canonicalUrl = canonicalizeUrl(trimmed)
    } catch {
      throw new ConvexError(`Invalid URL: ${trimmed}`)
    }

    if (seen.has(canonicalUrl)) {
      continue
    }

    seen.add(canonicalUrl)
    normalized.push(canonicalUrl)
  }

  return normalized
}

function describeCompletedImport(args: {
  successfulCount: number
  affectedBoardCount: number
  redirectBoardName?: string
}) {
  if (args.successfulCount === 0) {
    return 'Saved links, but routing did not finish'
  }

  if (args.affectedBoardCount <= 1 && args.redirectBoardName) {
    return `Saved ${args.successfulCount} link${args.successfulCount === 1 ? '' : 's'} into ${args.redirectBoardName}`
  }

  if (args.affectedBoardCount === 1) {
    return `Saved ${args.successfulCount} link${args.successfulCount === 1 ? '' : 's'} into 1 board`
  }

  return `Saved ${args.successfulCount} link${args.successfulCount === 1 ? '' : 's'} into ${args.affectedBoardCount} boards`
}

export const ingest = action({
  args: {
    urls: v.array(v.string()),
  },
  returns: manualLinkIngestResultValidator,
  handler: async (ctx, args): Promise<ManualLinkIngestResult> => {
    const viewer = await requireViewerAction(ctx)
    const normalizedUrls = normalizeInputUrls(args.urls)

    if (normalizedUrls.length === 0) {
      throw new ConvexError('Enter at least one URL')
    }

    const prepared: PreparedIngestResult = await ctx.runMutation(internal.manualLinks.prepareIngest, {
      userId: viewer._id,
      canonicalUrls: normalizedUrls,
    })

    if (prepared.created === 0) {
      await ctx.runMutation(internal.manualLinks.completeIngest, {
        userId: viewer._id,
        syncRunId: prepared.syncRunId,
        status: 'completed',
        processedCount: 0,
        message: 'All pasted links were already saved',
      })

      return {
        created: 0,
        skipped: prepared.skipped,
        redirectBoardId: undefined,
        redirectBoardName: undefined,
        affectedBoardCount: 0,
      }
    }

    try {
      const boardStats = new Map<
        Id<'boards'>,
        {
          count: number
          firstIndex: number
        }
      >()

      for (let index = 0; index < prepared.createdItems.length; index += 1) {
        const createdItem = prepared.createdItems[index]
        const processed = await ctx.runAction(internal.itemPipeline.extractAndAnalyze, {
          itemId: createdItem.itemId,
        })

        if (!processed?.boardId) {
          continue
        }

        const existing = boardStats.get(processed.boardId)
        if (existing) {
          existing.count += 1
          continue
        }

        boardStats.set(processed.boardId, {
          count: 1,
          firstIndex: index,
        })
      }

      const successfulCount = [...boardStats.values()].reduce(
        (total, current) => total + current.count,
        0,
      )

      const primaryBoardEntry = [...boardStats.entries()].sort((left, right) => {
        const countDelta = right[1].count - left[1].count
        if (countDelta !== 0) {
          return countDelta
        }

        return left[1].firstIndex - right[1].firstIndex
      })[0]

      const redirectBoardId = primaryBoardEntry?.[0]
      const redirectBoard: { name: string } | null = redirectBoardId
        ? await ctx.runQuery(internal.boardReaders.getOwnedBoard, {
            userId: viewer._id,
            boardId: redirectBoardId,
          })
        : null

      const redirectBoardName: string | undefined = redirectBoard?.name
      const message =
        successfulCount > 0
          ? describeCompletedImport({
              successfulCount,
              affectedBoardCount: boardStats.size,
              redirectBoardName,
            })
          : 'Saved links, but routing did not finish'

      await ctx.runMutation(internal.manualLinks.completeIngest, {
        userId: viewer._id,
        syncRunId: prepared.syncRunId,
        status: successfulCount > 0 ? 'completed' : 'failed',
        processedCount: successfulCount,
        message,
      })

      return {
        created: prepared.created,
        skipped: prepared.skipped,
        redirectBoardId,
        redirectBoardName,
        affectedBoardCount: boardStats.size,
      }
    } catch (error) {
      await ctx.runMutation(internal.manualLinks.completeIngest, {
        userId: viewer._id,
        syncRunId: prepared.syncRunId,
        status: 'failed',
        processedCount: 0,
        message:
          error instanceof Error ? error.message : 'Saving links failed',
      })

      throw error
    }
  },
})

export const prepareIngest = internalMutation({
  args: {
    userId: v.id('users'),
    canonicalUrls: v.array(v.string()),
  },
  returns: v.object({
    syncRunId: v.id('syncRuns'),
    created: v.number(),
    skipped: v.number(),
    createdItems: v.array(
      v.object({
        itemId: v.id('items'),
        canonicalUrl: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const now = Date.now()
    const syncRunId = await ctx.db.insert('syncRuns', {
      userId: args.userId,
      source: 'manual',
      status: 'running',
      startedAt: now,
      processedCount: 0,
      message: 'Saving links and routing boards',
    })

    let created = 0
    let skipped = 0
    const createdItems: Array<{
      itemId: Id<'items'>
      canonicalUrl: string
    }> = []

    for (const canonicalUrl of args.canonicalUrls) {
      const existing = await ctx.db
        .query('items')
        .withIndex('by_user_and_canonical_url', (q) =>
          q.eq('userId', args.userId).eq('canonicalUrl', canonicalUrl),
        )
        .unique()

      if (existing) {
        skipped += 1
        continue
      }

      const itemId = await ctx.db.insert('items', {
        userId: args.userId,
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

      created += 1
      createdItems.push({
        itemId,
        canonicalUrl,
      })
    }

    return {
      syncRunId,
      created,
      skipped,
      createdItems,
    }
  },
})

export const completeIngest = internalMutation({
  args: {
    userId: v.id('users'),
    syncRunId: v.id('syncRuns'),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
    ),
    processedCount: v.number(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const syncRun = await ctx.db.get(args.syncRunId)
    if (!syncRun || syncRun.userId !== args.userId) {
      throw new ConvexError('Sync run not found')
    }

    await ctx.db.patch(args.syncRunId, {
      status: args.status,
      completedAt: Date.now(),
      processedCount: args.processedCount,
      message: args.message,
    })

    return null
  },
})
