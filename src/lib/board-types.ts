import type { Id } from '../../convex/_generated/dataModel'

export type BoardCard = {
  itemId: Id<'items'>
  boardId?: Id<'boards'>
  sourceType: 'x' | 'link'
  sourceId?: string
  url: string
  canonicalUrl: string
  title: string
  summary: string
  contentText: string
  authorName?: string
  authorHandle?: string
  previewImageUrl?: string
  tags: string[]
  sourceCreatedAt?: number
  media: Array<{
    _id?: Id<'itemAssets'>
    itemId?: Id<'items'>
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

export type BoardSnapshot = {
  version: number
  cards: Array<{
    itemId: Id<'items'>
    x: number
    y: number
    w: number
    h: number
  }>
}
