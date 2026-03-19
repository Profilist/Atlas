"use node"

import { GoogleGenAI } from '@google/genai'
import { ConvexError, v } from 'convex/values'
import { load } from 'cheerio'
import { z } from 'zod'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import {
  boardNameFromTopic,
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

const analysisResponseSchema = z.object({
  summary: z.string().min(1).max(280),
  tags: z.array(z.string()).default([]),
  existingBoardName: z.string().nullable().optional(),
  newBoardName: z.string().nullable().optional(),
  reason: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1).optional(),
})

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

function fallbackBoardName(input: {
  title: string
  summary: string
  contentText: string
  domain?: string
  existingBoards: Array<{ name: string; slug: string }>
}) {
  const haystack = `${input.title} ${input.summary} ${input.contentText}`.toLowerCase()

  for (const board of input.existingBoards) {
    if (
      haystack.includes(board.name.toLowerCase()) ||
      haystack.includes(board.slug.toLowerCase())
    ) {
      return {
        existingBoardName: board.name,
        newBoardName: null,
      }
    }
  }

  const tags = pickTags(haystack)
  return {
    existingBoardName: null,
    newBoardName: boardNameFromTopic(tags[0] ?? input.domain ?? 'Collected'),
  }
}

async function classifyWithGemini(input: {
  title: string
  summary: string
  contentText: string
  url: string
  existingBoards: Array<{ name: string; slug: string }>
}) {
  if (!ai) {
    return null
  }

  const response = await ai.models.generateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      `You organize personal research bookmarks into boards.

Existing boards:
${input.existingBoards.map((board) => `- ${board.name}`).join('\n') || '- none yet'}

Rules:
- Always classify into either an exact existing board name or a new short board name.
- Prefer reusing an existing board when it is reasonably close.
- New board names should be 1 to 3 words in title case.
- Summary must be concise and useful on a whiteboard card.
- Tags should be 3 to 6 lowercase tags.
- Return JSON only.

Bookmark title: ${input.title}
Bookmark summary: ${input.summary}
Bookmark URL: ${input.url}
Bookmark content:
${input.contentText.slice(0, 8000)}

Return:
{
  "summary": string,
  "tags": string[],
  "existingBoardName": string | null,
  "newBoardName": string | null,
  "reason": string,
  "confidence": number
}`,
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  })

  return analysisResponseSchema.parse(JSON.parse(response.text ?? '{}'))
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

  const fallbackDecision = fallbackBoardName({
    title,
    summary,
    contentText,
    domain: item.domain,
    existingBoards,
  })

  const aiDecision =
    (await classifyWithGemini({
      title,
      summary,
      contentText,
      url: item.url,
      existingBoards,
    }).catch(() => null)) ?? null

  const finalSummary = normalizeWhitespace(aiDecision?.summary || summary || title).slice(
    0,
    280,
  )
  const tags = dedupeStrings(aiDecision?.tags?.length ? aiDecision.tags : pickTags(`${title} ${contentText}`)).slice(
    0,
    6,
  )

  const targetBoardName =
    aiDecision?.existingBoardName ||
    aiDecision?.newBoardName ||
    fallbackDecision.existingBoardName ||
    fallbackDecision.newBoardName ||
    'Collected'

  const matchedExistingBoard = boardList.find(
    (board: (typeof boardList)[number]) =>
      board.name.toLowerCase() === targetBoardName.toLowerCase(),
  )

  const board = await ctx.runMutation(internal.boards.ensureBoardTarget, {
    userId: item.userId,
    boardId: matchedExistingBoard?._id,
    boardName: matchedExistingBoard ? undefined : targetBoardName,
    description: aiDecision?.reason,
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
