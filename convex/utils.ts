export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function slugify(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function ensureLeadingProtocol(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return `https://${value}`
}

export function canonicalizeUrl(rawUrl: string) {
  const url = new URL(ensureLeadingProtocol(rawUrl.trim()))

  url.hash = ''
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }

  if (url.pathname !== '/') {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  const sorted = [...url.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
  url.search = ''
  for (const [key, value] of sorted) {
    url.searchParams.append(key, value)
  }

  return url.toString()
}

export function getDomainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function dedupeStrings(values: string[]) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))]
}

export function buildSearchText(input: {
  title: string
  summary: string
  contentText: string
  tags: string[]
  authorName?: string
  authorHandle?: string
}) {
  return normalizeWhitespace(
    [
      input.title,
      input.summary,
      input.contentText,
      input.authorName,
      input.authorHandle,
      input.tags.join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

export function boardNameFromTopic(topic: string) {
  const normalized = normalizeWhitespace(topic)
  if (!normalized) {
    return 'Collected'
  }

  return normalized
    .split(' ')
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function makeAbsoluteUrl(baseUrl: string, maybeRelative: string | null | undefined) {
  if (!maybeRelative) {
    return undefined
  }

  try {
    return new URL(maybeRelative, baseUrl).toString()
  } catch {
    return undefined
  }
}
