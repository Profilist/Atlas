import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  type TLBaseShape,
} from 'tldraw'

type BookmarkCardMedia = {
  kind: 'image' | 'video' | 'gif' | 'link-preview'
  url: string
  previewUrl?: string
  altText?: string
}

export type BookmarkCardShapeProps = {
  w: number
  h: number
  url: string
  title: string
  summary: string
  sourceType: string
  authorLabel: string
  tagsJson: string
  mediaJson: string
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'bookmark-card': BookmarkCardShapeProps
  }
}

export type BookmarkCardShape = TLBaseShape<'bookmark-card', BookmarkCardShapeProps>

const bookmarkCardShapeProps = {
  w: T.number,
  h: T.number,
  url: T.string,
  title: T.string,
  summary: T.string,
  sourceType: T.string,
  authorLabel: T.string,
  tagsJson: T.string,
  mediaJson: T.string,
}

function parseMedia(mediaJson: string) {
  try {
    return JSON.parse(mediaJson) as BookmarkCardMedia[]
  } catch {
    return []
  }
}

function parseTags(tagsJson: string) {
  try {
    return JSON.parse(tagsJson) as string[]
  } catch {
    return []
  }
}

export class BookmarkCardShapeUtil extends BaseBoxShapeUtil<BookmarkCardShape> {
  static override type = 'bookmark-card' as const
  static override props = bookmarkCardShapeProps

  override canResize() {
    return true
  }

  override canEdit() {
    return false
  }

  override getDefaultProps(): BookmarkCardShape['props'] {
    return {
      w: 320,
      h: 360,
      url: '',
      title: '',
      summary: '',
      sourceType: 'link',
      authorLabel: '',
      tagsJson: '[]',
      mediaJson: '[]',
    }
  }

  override getGeometry(shape: BookmarkCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override component(shape: BookmarkCardShape) {
    const media = parseMedia(shape.props.mediaJson)
    const tags = parseTags(shape.props.tagsJson)
    const showTitle = shape.props.sourceType !== 'x' && shape.props.title.trim().length > 0
    const mediaClassName =
      media.length <= 1 ? 'bookmark-card__media bookmark-card__media--single' : 'bookmark-card__media'

    return (
      <HTMLContainer className="bookmark-card" id={shape.id}>
        <div className="bookmark-card__body">
          <div className={mediaClassName}>
            {media.length > 0 ? (
              media.slice(0, 4).map((asset, index) => (
                <div
                  className="bookmark-card__media-tile"
                  key={`${asset.url}-${index}`}
                >
                  <img
                    alt={asset.altText || shape.props.title}
                    draggable={false}
                    src={asset.previewUrl || asset.url}
                  />
                  {asset.kind !== 'image' && asset.kind !== 'link-preview' ? (
                    <span className="bookmark-card__media-kind">
                      {asset.kind === 'gif' ? 'GIF' : 'VIDEO'}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="bookmark-card__placeholder">No preview</div>
            )}
          </div>

          <div className="bookmark-card__copy">
            <div className="bookmark-card__meta">
              <span>{shape.props.sourceType === 'x' ? 'X bookmark' : 'Link'}</span>
              {shape.props.authorLabel ? <span>{shape.props.authorLabel}</span> : null}
            </div>
            {showTitle ? <h3 className="bookmark-card__title">{shape.props.title}</h3> : null}
            <p className="bookmark-card__summary">{shape.props.summary}</p>
            {tags.length > 0 ? (
              <div className="bookmark-card__tags">
                {tags.slice(0, 4).map((tag) => (
                  <span className="bookmark-card__tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: BookmarkCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx="20" ry="20" />
  }
}
