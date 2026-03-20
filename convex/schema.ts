import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const sourceType = v.union(v.literal('x'), v.literal('link'))
const analysisStatus = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('error'),
)
const assetKind = v.union(
  v.literal('image'),
  v.literal('video'),
  v.literal('gif'),
  v.literal('link-preview'),
)

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .index('by_email', ['email']),

  xConnections: defineTable({
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
    .index('by_user', ['userId'])
    .index('by_x_user_id', ['xUserId']),

  boards: defineTable({
    userId: v.id('users'),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    autoCreated: v.boolean(),
    itemCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_slug', ['userId', 'slug']),

  items: defineTable({
    userId: v.id('users'),
    boardId: v.optional(v.id('boards')),
    sourceType,
    sourceId: v.optional(v.string()),
    url: v.string(),
    canonicalUrl: v.string(),
    domain: v.optional(v.string()),
    title: v.string(),
    summary: v.string(),
    contentText: v.string(),
    searchText: v.string(),
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    previewImageUrl: v.optional(v.string()),
    tags: v.array(v.string()),
    analysisStatus,
    analysisError: v.optional(v.string()),
    sourceCreatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index('by_user_and_source_id', ['userId', 'sourceId'])
    .index('by_user_and_canonical_url', ['userId', 'canonicalUrl'])
    .index('by_user_and_board', ['userId', 'boardId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['userId', 'boardId', 'sourceType'],
    })
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 768,
      filterFields: ['userId', 'boardId'],
    }),

  itemAssets: defineTable({
    userId: v.id('users'),
    itemId: v.id('items'),
    kind: assetKind,
    url: v.string(),
    previewUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    altText: v.optional(v.string()),
    position: v.number(),
  })
    .index('by_item', ['itemId'])
    .index('by_item_and_position', ['itemId', 'position']),

  boardMemberships: defineTable({
    userId: v.id('users'),
    boardId: v.id('boards'),
    itemId: v.id('items'),
    createdAt: v.number(),
  })
    .index('by_board', ['boardId'])
    .index('by_item', ['itemId'])
    .index('by_board_and_item', ['boardId', 'itemId']),

  boardSnapshots: defineTable({
    userId: v.id('users'),
    boardId: v.id('boards'),
    storageId: v.id('_storage'),
    version: v.number(),
    updatedAt: v.number(),
  }).index('by_board', ['boardId']),

  syncRuns: defineTable({
    userId: v.id('users'),
    source: v.union(v.literal('x'), v.literal('manual')),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    processedCount: v.number(),
    message: v.optional(v.string()),
  }).index('by_user_and_started', ['userId', 'startedAt']),
})
