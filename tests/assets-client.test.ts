import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetsClient } from '@/services/assetsClient'

const originalAiops = window.aiops

const sshAgentKeychainOptions = [
  {
    key: 'key-1',
    label: 'prod-ed25519',
    fingerprint: 'SHA256:prod',
    keyType: 'ED25519'
  },
  {
    key: 'key-2',
    label: 'staging-rsa',
    fingerprint: 'SHA256:staging',
    keyType: 'RSA'
  }
]

afterEach(() => {
  window.aiops = originalAiops
})

describe('assetsClient', () => {
  it('returns undefined for unavailable bridge methods and binds SSH Agent keychain option lookup', async () => {
    window.aiops = {
      ...originalAiops,
      listSshAgentKeychainOptions: vi.fn(async () => sshAgentKeychainOptions)
    }

    await expect(assetsClient.listSshAgentKeychainOptions()?.()).resolves.toEqual(sshAgentKeychainOptions)
    expect(window.aiops.listSshAgentKeychainOptions).toHaveBeenCalledTimes(1)

    window.aiops = {
      ...originalAiops,
      listSshAgentKeychainOptions: undefined as any
    }
    expect(assetsClient.listSshAgentKeychainOptions()).toBeUndefined()
  })
})
