"use node"

import { GoogleGenAI } from '@google/genai'
import { ConvexError, v } from 'convex/values'
import { load } from 'cheerio'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { decideBoardTarget } from './boardRouting'
import {
  buildSearchText,
  dedupeStrings,
  getDomainFromUrl,
  makeAbsoluteUrl,
  normalizeWhitespace,
} from './utils'

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash'
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null

const stopWords = new Set([
  'about',
  'after',
  'again',
  'agent',
  'agents',
  'bookmark',
  'bookmarks',
  'could',
  'design',
  'first',
  'from',
  'have',
  'into',
  'just',
  'like',
  'more',
  'over',
  'personal',
  'saved',
  'search',
  'that',
  'their',
  'there',
  'these',
  'this',
  'tweet',
  'what',
  'when',
  'with',
  'your',
])

function pickTags(text: string) {
  const frequencies = new Map<string, number>()

  for (const token of text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
    if (stopWords.has(token)) {
      continue
    }

    frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  }

  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([value]) => value)
}

async function createEmbedding(searchText: string) {
  if (!ai) {
    return undefined
  }

  const response = await ai.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: [searchText],
    config: {
      outputDimensionality: 768,
    },
  })

  const values = response.embeddings?.[0]?.values
  return values && values.length > 0 ? values : undefined
}

async function extractLink(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BookmarkWhiteboardBot/1.0 (+https://example.com)',
    },
  })

  if (!response.ok) {
    throw new ConvexError(`Failed to fetch link metadata (${response.status})`)
  }

  const html = await response.text()
  const $ = load(html)

  const title = normalizeWhitespace(
    $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      getDomainFromUrl(url) ||
      'Saved link',
  )

  const summary = normalizeWhitespace(
    $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      '',
  )

  const contentText = normalizeWhitespace(
    [
      summary,
      $('article p, main p, p')
        .slice(0, 24)
        .toArray()
        .map((element) => $(element).text())
        .join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  ).slice(0, 12000)

  const previewImageUrl =
    makeAbsoluteUrl(
      url,
      $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content'),
    ) ?? undefined

  const assets = previewImageUrl
    ? [
        {
          kind: 'link-preview' as const,
          url: previewImageUrl,
          previewUrl: previewImageUrl,
          width: undefined,
          height: undefined,
          durationMs: undefined,
          mimeType: 'image/jpeg',
          altText: title,
          position: 0,
        },
      ]
    : []

  return {
    title,
    summary,
    contentText: contentText || summary || title,
    previewImageUrl,
    assets,
  }
}

async function processItem(
  ctx: ActionCtx,
  itemId: Id<'items'>,
  shouldExtractLink: boolean,
): Promise<{ itemId: Id<'items'>; boardId: Id<'boards'> } | null> {
  const payload = await ctx.runQuery(internal.items.getPipelineItem, {
    itemId,
  })

  if (!payload) {
    return null
  }

  await ctx.runMutation(internal.items.markProcessing, { itemId })

  const { item, assets: existingAssets } = payload
  const boardList = await ctx.runQuery(internal.boards.listForUser, {
    userId: item.userId,
  })

  let title = item.title
  let summary = item.summary
  let contentText = item.contentText
  let previewImageUrl = item.previewImageUrl
  let assets = existingAssets.map((asset: (typeof existingAssets)[number]) => ({
    kind: asset.kind,
    url: asset.url,
    previewUrl: asset.previewUrl,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    mimeType: asset.mimeType,
    altText: asset.altText,
    position: asset.position,
  }))

  if (shouldExtractLink) {
    try {
      const extracted = await extractLink(item.url)
      title = extracted.title
      summary = extracted.summary || extracted.title
      contentText = extracted.contentText
      previewImageUrl = extracted.previewImageUrl
      assets = extracted.assets
    } catch {
      title = item.title || getDomainFromUrl(item.url) || 'Saved link'
      summary = item.summary || title
      contentText = item.contentText || summary
    }
  } else {
    title = item.title || item.authorHandle || 'Saved X post'
    summary = item.summary || item.contentText || title
    contentText = item.contentText || summary
  }

  const existingBoards = boardList.map((board: (typeof boardList)[number]) => ({
    name: board.name,
    slug: board.slug,
  }))

  const boardDecision = await decideBoardTarget({
    title,
    summary,
    contentText,
    url: item.url,
    existingBoards,
    domain: item.domain,
  })

  const finalSummary = normalizeWhitespace(boardDecision.aiDecision?.summary || summary || title).slice(
    0,
    280,
  )
  const tags = dedupeStrings(boardDecision.aiDecision?.tags?.length ? boardDecision.aiDecision.tags : pickTags(`${title} ${contentText}`)).slice(
    0,
    6,
  )

  const matchedExistingBoard = boardList.find(
    (board: (typeof boardList)[number]) =>
      board.name.toLowerCase() === boardDecision.matchedExistingBoardName?.toLowerCase(),
  )

  const board = await ctx.runMutation(internal.boards.ensureBoardTarget, {
    userId: item.userId,
    boardId: matchedExistingBoard?._id,
    boardName: matchedExistingBoard ? undefined : boardDecision.targetBoardName,
    description: boardDecision.aiDecision?.reason,
    autoCreated: !matchedExistingBoard,
  })

  const searchText = buildSearchText({
    title,
    summary: finalSummary,
    contentText,
    tags,
    authorName: item.authorName,
    authorHandle: item.authorHandle,
  })

  const embedding = await createEmbedding(searchText).catch(() => undefined)

  await ctx.runMutation(internal.items.applyProcessedItem, {
    itemId,
    boardId: board._id,
    title,
    summary: finalSummary,
    contentText,
    searchText,
    authorName: item.authorName,
    authorHandle: item.authorHandle,
    previewImageUrl,
    tags,
    sourceCreatedAt: item.sourceCreatedAt,
    embedding,
    assets,
  })

  return {
    itemId,
    boardId: board._id,
  }
}

export const extractAndAnalyze = internalAction({
  args: {
    itemId: v.id('items'),
  },
  returns: v.union(
    v.object({
      itemId: v.id('items'),
      boardId: v.id('boards'),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      return await processItem(ctx, args.itemId, true)
    } catch (error) {
      await ctx.runMutation(internal.items.markFailed, {
        itemId: args.itemId,
        message: error instanceof Error ? error.message : 'Processing failed',
      })
      return null
    }
  },
})

export const embedAndRoute = internalAction({
  args: {
    itemId: v.id('items'),
  },
  returns: v.union(
    v.object({
      itemId: v.id('items'),
      boardId: v.id('boards'),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      return await processItem(ctx, args.itemId, false)
    } catch (error) {
      await ctx.runMutation(internal.items.markFailed, {
        itemId: args.itemId,
        message: error instanceof Error ? error.message : 'Processing failed',
      })
      return null
    }
  },
})
