"use node"

import { GoogleGenAI } from '@google/genai'
import { ConvexError, v } from 'convex/values'
import { z } from 'zod'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'
import { boardNameFromTopic } from './utils'

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash'

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

type ExistingBoardOption = {
  _id?: Id<'boards'>
  name: string
  slug: string
}

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
  existingBoards: ExistingBoardOption[]
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
  existingBoards: ExistingBoardOption[]
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

function findExistingBoardByName<T extends ExistingBoardOption>(
  boards: T[],
  name: string | null | undefined,
) {
  if (!name) {
    return null
  }

  return (
    boards.find((board) => board.name.toLowerCase() === name.toLowerCase()) ??
    null
  )
}

export async function decideBoardTarget(input: {
  title: string
  summary: string
  contentText: string
  url: string
  domain?: string
  existingBoards: ExistingBoardOption[]
}) {
  const fallbackDecision = fallbackBoardName(input)
  const aiDecision =
    (await classifyWithGemini(input).catch(() => null)) ?? null

  const targetBoardName =
    aiDecision?.existingBoardName ||
    aiDecision?.newBoardName ||
    fallbackDecision.existingBoardName ||
    fallbackDecision.newBoardName ||
    'Collected'

  const matchedExistingBoard =
    findExistingBoardByName(
      input.existingBoards,
      aiDecision?.existingBoardName,
    ) ??
    findExistingBoardByName(input.existingBoards, targetBoardName)

  return {
    aiDecision,
    matchedExistingBoardName: matchedExistingBoard?.name ?? null,
    targetBoardName,
  }
}

export const resolveExistingBoardForItem = internalAction({
  args: {
    itemId: v.id('items'),
    excludedBoardId: v.optional(v.id('boards')),
  },
  returns: v.object({
    boardId: v.optional(v.id('boards')),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ boardId?: Id<'boards'> }> => {
    const payload = await ctx.runQuery(internal.items.getPipelineItem, {
      itemId: args.itemId,
    })

    if (!payload) {
      throw new ConvexError('Item not found')
    }

    const { item } = payload
    const boardList: Doc<'boards'>[] = await ctx.runQuery(
      internal.boards.listForUser,
      {
        userId: item.userId,
      },
    )
    const remainingBoards: Doc<'boards'>[] = boardList.filter(
      (board: Doc<'boards'>) => board._id !== args.excludedBoardId,
    )
    const decision = await decideBoardTarget({
      title: item.title,
      summary: item.summary,
      contentText: item.contentText,
      url: item.url,
      domain: item.domain,
      existingBoards: remainingBoards.map((board: Doc<'boards'>) => ({
        _id: board._id,
        name: board.name,
        slug: board.slug,
      })),
    })

    return {
      boardId:
        remainingBoards.find(
          (board: Doc<'boards'>) =>
            board.name.toLowerCase() ===
            decision.matchedExistingBoardName?.toLowerCase(),
        )?._id,
    }
  },
})
