import { describe, expect, it } from 'vitest'
import { aiopstermProtocolPrefix, isAiopstermDeepLinkPayload, parseAiopstermDeepLink } from '@shared/deepLink'

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
    const result = parseAiopstermDeepLink('aiopsterm://open/settings?section=aiRemoteHostManagement')

    expect(result).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/settings?section=aiRemoteHostManagement',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'aiRemoteHostManagement'
      }
    })

    expect(parseAiopstermDeepLink('aiopsterm://open/settings?section=ai-notifications')).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/settings?section=ai-notifications',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'aiNotifications'
      }
    })

    expect(parseAiopstermDeepLink('aiopsterm://open/settings?section=ai-hooks')).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/settings?section=ai-hooks',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'aiNotifications'
      }
    })

    expect(parseAiopstermDeepLink('aiopsterm://open/settings?section=export-mcp')).toEqual({
      valid: true,
      payload: {
        url: 'aiopsterm://open/settings?section=export-mcp',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'exportMcp'
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

  it('rejects unsupported protocols and internal attachment URLs', () => {
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

  it('validates runtime payloads against their parsed URL identity', () => {
    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open/settings?section=shortcuts',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'shortcuts',
        source: 'tray',
        acceptedAt: 1780490000000
      })
    ).toBe(false)

    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open/settings?section=shortcuts&source=tray',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'shortcuts',
        source: 'tray',
        acceptedAt: 1780490000000
      })
    ).toBe(true)
  })

  it('rejects malformed runtime payload shapes', () => {
    expect(isAiopstermDeepLinkPayload(null)).toBe(false)
    expect(isAiopstermDeepLinkPayload([{ url: 'aiopsterm://open/files' }])).toBe(false)
    expect(
      isAiopstermDeepLinkPayload({
        url: 'external-term://open/files',
        action: 'open',
        target: 'files',
        module: 'files',
        acceptedAt: 1780490000000
      })
    ).toBe(false)
    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open/files',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'general',
        acceptedAt: 1780490000000
      })
    ).toBe(false)
    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open/settings?section=mcp',
        action: 'open',
        target: 'settings',
        module: 'settings',
        acceptedAt: 1780490000000
      })
    ).toBe(false)
    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open?target=agents',
        action: 'open',
        target: 'agents',
        module: 'workspace',
        acceptedAt: 1780490000000
      })
    ).toBe(false)
    expect(
      isAiopstermDeepLinkPayload({
        url: 'aiopsterm://open/files',
        action: 'open',
        target: 'files',
        module: 'files',
        acceptedAt: Number.NaN
      })
    ).toBe(false)
  })
})
