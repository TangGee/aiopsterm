import { describe, expect, it } from 'vitest'
import { validateCommandSecurity } from '@/services/terminal/commandSecurityRuntime'
import type { SecurityUserConfig } from '@shared/contracts/appRuntime'

const config = (patch: Partial<SecurityUserConfig['security']> = {}): SecurityUserConfig => {
  const { securityPolicy, ...restPatch } = patch
  const defaultPolicy = {
    blockCritical: true,
    askForMedium: true,
    askForHigh: true,
    askForBlacklist: false
  }
  return {
    security: {
      enableCommandSecurity: true,
      enableStrictMode: false,
      blacklistPatterns: [],
      whitelistPatterns: ['ls *'],
      dangerousCommands: ['rm', 'sudo'],
      maxCommandLength: 100,
      ...restPatch,
      securityPolicy: {
        ...defaultPolicy,
        ...(securityPolicy || {})
      }
    }
  }
}

describe('command security runtime', () => {
  it('blocks commands longer than the configured maximum', () => {
    const result = validateCommandSecurity(config({ maxCommandLength: 5 }), 'echo verylong')
    expect(result).toEqual(expect.objectContaining({ isAllowed: false, category: 'permission', action: 'block' }))
  })

  it('blocks blacklist matches unless blacklist approval is enabled', () => {
    const blocked = validateCommandSecurity(config({ blacklistPatterns: ['rm *'] }), 'rm -rf /tmp')
    expect(blocked).toEqual(expect.objectContaining({ isAllowed: false, category: 'blacklist', action: 'block', requiresApproval: false }))

    const ask = validateCommandSecurity(config({ blacklistPatterns: ['rm *'], securityPolicy: { askForBlacklist: true } as any }), 'rm -rf /tmp')
    expect(ask).toEqual(expect.objectContaining({ isAllowed: true, category: 'blacklist', action: 'ask', requiresApproval: true }))
  })

  it('asks for critical dangerous commands and inspects compound commands', () => {
    const result = validateCommandSecurity(config({ blacklistPatterns: [] }), 'pwd && rm /etc/passwd')
    expect(result).toEqual(expect.objectContaining({ isAllowed: true, category: 'dangerous', severity: 'critical', action: 'ask', requiresApproval: true }))
  })

  it('blocks commands outside the whitelist in strict mode', () => {
    const result = validateCommandSecurity(config({ enableStrictMode: true, whitelistPatterns: ['ls *'] }), 'cat /etc/passwd')
    expect(result).toEqual(expect.objectContaining({ isAllowed: false, category: 'whitelist', action: 'block' }))
  })
})
