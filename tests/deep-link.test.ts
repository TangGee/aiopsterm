import { describe, expect, it } from 'vitest'
import { aiopstermProtocolPrefix, parseAiopstermDeepLink } from '@shared/deepLink'

describe('aiopsterm deep links', () => {
  it('accepts self-owned module links', () => {
    const result = parseAiopstermDeepLink(`${aiopstermProtocolPrefix}open/files?source=e2e`)

    expect(result).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/files?source=e2e',
        action: 'open',
        target: 'files',
        module: 'files',
        source: 'e2e'
      }
    })
  })

  it('accepts settings section links', () => {
    const result = parseAiopstermDeepLink('aiopsterm://open/settings?section=mcp')

    expect(result).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/settings?section=mcp',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'mcp'
      }
    })
  })

  it('accepts agents mode links through target query', () => {
    const result = parseAiopstermDeepLink('aiopsterm://open?target=agents')

    expect(result).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open?target=agents',
        action: 'open',
        target: 'agents'
      }
    })
  })

  it('rejects External reference and internal attachment URLs', () => {
    expect(parseAiopstermDeepLink('external-term://open/files')).toEqual({ valid: false, reason: 'unsupported-protocol' })
    expect(parseAiopstermDeepLink('aiopsterm://chat-attachment/task/readme.md')).toEqual({ valid: false, reason: 'internal-ref' })
  })

  it('rejects unsupported targets and settings sections', () => {
    expect(parseAiopstermDeepLink('aiopsterm://open/unknown')).toEqual({ valid: false, reason: 'unsupported-target' })
    expect(parseAiopstermDeepLink('aiopsterm://open/settings?section=unknown')).toEqual({
      valid: false,
      reason: 'unsupported-settings-section'
    })
  })
})
