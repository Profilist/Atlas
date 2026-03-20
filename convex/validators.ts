import { v } from 'convex/values'

export const sourceTypeValidator = v.union(v.literal('x'), v.literal('link'))

export const analysisStatusValidator = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('error'),
)

export const assetKindValidator = v.union(
  v.literal('image'),
  v.literal('video'),
  v.literal('gif'),
  v.literal('link-preview'),
)

export const viewerValidator = v.object({
  _id: v.id('users'),
  _creationTime: v.number(),
  authUserId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const itemMediaAssetValidator = v.object({
  _id: v.id('itemAssets'),
  _creationTime: v.number(),
  userId: v.id('users'),
  itemId: v.id('items'),
  kind: assetKindValidator,
  url: v.string(),
  previewUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  altText: v.optional(v.string()),
  position: v.number(),
})

export const itemValidator = v.object({
  _id: v.id('items'),
  _creationTime: v.number(),
  userId: v.id('users'),
  boardId: v.optional(v.id('boards')),
  sourceType: sourceTypeValidator,
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
  analysisStatus: analysisStatusValidator,
  analysisError: v.optional(v.string()),
  sourceCreatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  embedding: v.optional(v.array(v.float64())),
})

export const boardCardRenderModelValidator = v.object({
  itemId: v.id('items'),
  boardId: v.optional(v.id('boards')),
  sourceType: sourceTypeValidator,
  sourceId: v.optional(v.string()),
  url: v.string(),
  canonicalUrl: v.string(),
  title: v.string(),
  summary: v.string(),
  contentText: v.string(),
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  previewImageUrl: v.optional(v.string()),
  tags: v.array(v.string()),
  sourceCreatedAt: v.optional(v.number()),
  media: v.array(itemMediaAssetValidator),
})

export const boardSnapshotCardValidator = v.object({
  itemId: v.id('items'),
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
})

export const boardSnapshotValidator = v.object({
  version: v.number(),
  cards: v.array(boardSnapshotCardValidator),
})

export const boardSummaryValidator = v.object({
  _id: v.id('boards'),
  _creationTime: v.number(),
  userId: v.id('users'),
  name: v.string(),
  slug: v.string(),
  description: v.optional(v.string()),
  autoCreated: v.boolean(),
  itemCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const deleteImpactValidator = v.object({
  ownedItemCount: v.number(),
  membershipOnlyItemCount: v.number(),
})

export const syncRunSummaryValidator = v.object({
  _id: v.id('syncRuns'),
  _creationTime: v.number(),
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
})

export const boardDecisionValidator = v.object({
  boardId: v.optional(v.id('boards')),
  existingBoardName: v.optional(v.string()),
  newBoardName: v.optional(v.string()),
  reason: v.string(),
  confidence: v.number(),
})

export const generatedSearchBoardValidator = v.object({
  boardTitle: v.string(),
  query: v.string(),
  cards: v.array(
    v.object({
      itemId: v.id('items'),
      x: v.number(),
      y: v.number(),
      w: v.number(),
      h: v.number(),
      cluster: v.string(),
    }),
  ),
})

export const manualLinkIngestResultValidator = v.object({
  created: v.number(),
  skipped: v.number(),
  redirectBoardId: v.optional(v.id('boards')),
  redirectBoardName: v.optional(v.string()),
  affectedBoardCount: v.number(),
})
