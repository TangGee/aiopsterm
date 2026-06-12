export type ExternalHttpUrlNormalizeResult =
  | { valid: true; url: string }
  | { valid: false; reason: 'empty-url' | 'invalid-url' | 'unsupported-protocol' }

const trimUrl = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const normalizeExternalHttpUrl = (value: unknown, baseUrl?: string): ExternalHttpUrlNormalizeResult => {
  const text = trimUrl(value)
  if (!text) return { valid: false, reason: 'empty-url' }
  if (text.startsWith('//')) return { valid: false, reason: 'invalid-url' }

  try {
    const url = baseUrl ? new URL(text, baseUrl) : new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, reason: 'unsupported-protocol' }
    }
    if (!url.hostname.trim()) return { valid: false, reason: 'invalid-url' }
    if (url.username || url.password) return { valid: false, reason: 'invalid-url' }
    return { valid: true, url: url.toString() }
  } catch {
    return { valid: false, reason: 'invalid-url' }
  }
}

export const isExternalHttpUrl = (value: unknown, baseUrl?: string) => normalizeExternalHttpUrl(value, baseUrl).valid
