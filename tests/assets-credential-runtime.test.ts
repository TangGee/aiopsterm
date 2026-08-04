import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
  jumpserverToken?: string
}

type AssetCredentialRuntimeModule = {
  assetSecretNeedsEncryption(secret?: AssetSecret): boolean
  configureAssetCredentialRuntime(config?: {
    credentialKeyPath?: string
    safeStorage?: {
      isEncryptionAvailable: () => boolean
      encryptString: (plain: string) => Buffer
      decryptString: (cipher: Buffer) => string
    } | null
  }): void
  decryptAssetSecret(secret?: AssetSecret): AssetSecret
  encryptAssetSecretForStorage(secret?: AssetSecret): AssetSecret
  isAssetCredentialCiphertext(value: unknown): boolean
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/assets/assetsCredentialRuntime'
  return import(modulePath) as Promise<AssetCredentialRuntimeModule>
}

const passwordField = 'password' as const

const withCredentialKeyPath = async <T>(run: (credentialKeyPath: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-asset-credential-'))
  try {
    return await run(join(dir, 'asset-credential.key'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('asset credential runtime', () => {
  afterEach(async () => {
    const { configureAssetCredentialRuntime } = await loadRuntime()
    configureAssetCredentialRuntime({ safeStorage: null })
  })

  it('encrypts and decrypts asset secret fields with a local AES key fallback', async () => {
    await withCredentialKeyPath(async (credentialKeyPath) => {
      const {
        assetSecretNeedsEncryption,
        configureAssetCredentialRuntime,
        decryptAssetSecret,
        encryptAssetSecretForStorage,
        isAssetCredentialCiphertext
      } = await loadRuntime()
      configureAssetCredentialRuntime({ credentialKeyPath, safeStorage: null })

      const encrypted = encryptAssetSecretForStorage({
        [passwordField]: 'runtime-password-material',
        privateKey: 'runtime-private-material',
        passphrase: '',
        jumpserverToken: 'runtime-jumpserver-token',
        extra: 'ignored'
      } as AssetSecret & { extra: string })

      expect(encrypted.password).toMatch(/^ak1:/)
      expect(encrypted.privateKey).toMatch(/^ak1:/)
      expect(encrypted.passphrase).toBe('')
      expect(encrypted.jumpserverToken).toMatch(/^ak1:/)
      expect(encrypted).not.toHaveProperty('extra')
      expect(encrypted.password).not.toContain('runtime-password-material')
      expect(encrypted.privateKey).not.toContain('runtime-private-material')
      expect(encrypted.jumpserverToken).not.toContain('runtime-jumpserver-token')
      expect(assetSecretNeedsEncryption(encrypted)).toBe(false)
      expect(isAssetCredentialCiphertext(encrypted.password)).toBe(true)

      expect(decryptAssetSecret(encrypted)).toEqual({
        [passwordField]: 'runtime-password-material',
        privateKey: 'runtime-private-material',
        passphrase: '',
        jumpserverToken: 'runtime-jumpserver-token'
      })
      expect(await readFile(credentialKeyPath)).toHaveLength(32)
      if (process.platform !== 'win32') {
        expect((await stat(credentialKeyPath)).mode & 0o777).toBe(0o600)
      }
    })
  })

  it('keeps ciphertext stable and detects plaintext fields that need migration', async () => {
    await withCredentialKeyPath(async (credentialKeyPath) => {
      const { assetSecretNeedsEncryption, configureAssetCredentialRuntime, decryptAssetSecret, encryptAssetSecretForStorage } = await loadRuntime()
      configureAssetCredentialRuntime({ credentialKeyPath, safeStorage: null })

      const encrypted = encryptAssetSecretForStorage({ [passwordField]: 'stable-runtime-material' })

      expect(encryptAssetSecretForStorage(encrypted)).toEqual(encrypted)
      expect(assetSecretNeedsEncryption({ [passwordField]: 'stable-runtime-material' })).toBe(true)
      expect(assetSecretNeedsEncryption({ password: '', privateKey: encrypted.password })).toBe(false)
      expect(decryptAssetSecret({ [passwordField]: 'stable-runtime-material' })).toEqual({ [passwordField]: 'stable-runtime-material' })
    })
  })

  it('resets the cached local key when the configured key path changes', async () => {
    await withCredentialKeyPath(async (firstKeyPath) => {
      await withCredentialKeyPath(async (secondKeyPath) => {
        const { configureAssetCredentialRuntime, decryptAssetSecret, encryptAssetSecretForStorage } = await loadRuntime()
        configureAssetCredentialRuntime({ credentialKeyPath: firstKeyPath, safeStorage: null })
        const firstEncrypted = encryptAssetSecretForStorage({ [passwordField]: 'first-runtime-material' })
        const firstKey = await readFile(firstKeyPath)

        configureAssetCredentialRuntime({ credentialKeyPath: secondKeyPath, safeStorage: null })
        const secondEncrypted = encryptAssetSecretForStorage({ [passwordField]: 'second-runtime-material' })
        const secondKey = await readFile(secondKeyPath)

        expect(firstKey).toHaveLength(32)
        expect(secondKey).toHaveLength(32)
        expect(secondKey.equals(firstKey)).toBe(false)
        expect(decryptAssetSecret(firstEncrypted)).toEqual({ password: '' })
        expect(decryptAssetSecret(secondEncrypted)).toEqual({ [passwordField]: 'second-runtime-material' })

        configureAssetCredentialRuntime({ credentialKeyPath: firstKeyPath, safeStorage: null })
        expect(decryptAssetSecret(firstEncrypted)).toEqual({ [passwordField]: 'first-runtime-material' })
      })
    })
  })

  it('uses injected safeStorage when available without creating a local key file', async () => {
    await withCredentialKeyPath(async (credentialKeyPath) => {
      const { configureAssetCredentialRuntime, decryptAssetSecret, encryptAssetSecretForStorage } = await loadRuntime()
      const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => Buffer.from(`sealed:${plain}`, 'utf-8'),
        decryptString: (cipher: Buffer) => cipher.toString('utf-8').replace(/^sealed:/, '')
      }
      configureAssetCredentialRuntime({ credentialKeyPath, safeStorage })

      const encrypted = encryptAssetSecretForStorage({ [passwordField]: 'safe-storage-material' })

      expect(encrypted.password).toMatch(/^as1:/)
      expect(decryptAssetSecret(encrypted)).toEqual({ [passwordField]: 'safe-storage-material' })
      await expect(readFile(credentialKeyPath)).rejects.toThrow()
    })
  })

  it('fails closed for malformed or mismatched ciphertext', async () => {
    await withCredentialKeyPath(async (credentialKeyPath) => {
      const { configureAssetCredentialRuntime, decryptAssetSecret, encryptAssetSecretForStorage } = await loadRuntime()
      configureAssetCredentialRuntime({ credentialKeyPath, safeStorage: null })
      const encrypted = encryptAssetSecretForStorage({ [passwordField]: 'mismatch-runtime-material' })

      await writeFile(credentialKeyPath, Buffer.alloc(32, 7))
      configureAssetCredentialRuntime({ credentialKeyPath, safeStorage: null })

      expect(decryptAssetSecret(encrypted)).toEqual({ password: '' })
      expect(decryptAssetSecret({ privateKey: 'ak1:not.valid', passphrase: 'as1:not-base64' })).toEqual({ privateKey: '', passphrase: '' })
    })
  })
})
