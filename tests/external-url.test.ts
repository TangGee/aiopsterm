import { describe, expect, it } from 'vitest'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'

describe('external URL boundary', () => {
  it('normalizes absolute http and https URLs', () => {
    expect(normalizeExternalHttpUrl(' https://aiopsterm.local/docs?q=ops ')).toEqual({
      valid: true,
      url: 'https://aiopsterm.local/docs?q=ops'
    })
    expect(normalizeExternalHttpUrl('http://127.0.0.1:3000/callback')).toEqual({
      valid: true,
      url: 'http://127.0.0.1:3000/callback'
    })
  })

  it('resolves relative URLs only against an explicit http base URL', () => {
    expect(normalizeExternalHttpUrl('/packages/private.zip', 'https://store.aiopsterm.local/catalog.json')).toEqual({
      valid: true,
      url: 'https://store.aiopsterm.local/packages/private.zip'
    })
    expect(normalizeExternalHttpUrl('/packages/private.zip')).toEqual({ valid: false, reason: 'invalid-url' })
  })

  it('rejects non-http schemes and malformed URLs', () => {
    expect(normalizeExternalHttpUrl('javascript:alert(1)')).toEqual({ valid: false, reason: 'unsupported-protocol' })
    expect(normalizeExternalHttpUrl('file:///etc/passwd')).toEqual({ valid: false, reason: 'unsupported-protocol' })
    expect(normalizeExternalHttpUrl('aiopsterm://open/settings')).toEqual({ valid: false, reason: 'unsupported-protocol' })
    expect(normalizeExternalHttpUrl('   ')).toEqual({ valid: false, reason: 'empty-url' })
    expect(normalizeExternalHttpUrl('https://')).toEqual({ valid: false, reason: 'invalid-url' })
    expect(normalizeExternalHttpUrl('//aiopsterm.local/path', 'https://store.aiopsterm.local/catalog.json')).toEqual({ valid: false, reason: 'invalid-url' })
    expect(normalizeExternalHttpUrl('https://user:pass@aiopsterm.local/private')).toEqual({ valid: false, reason: 'invalid-url' })
  })
})
