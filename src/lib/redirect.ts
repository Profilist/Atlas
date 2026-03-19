export function sanitizeRedirect(value: unknown) {
  if (typeof value !== 'string') {
    return '/'
  }

  if (!value.startsWith('/')) {
    return '/'
  }

  if (value.startsWith('//')) {
    return '/'
  }

  return value
}
