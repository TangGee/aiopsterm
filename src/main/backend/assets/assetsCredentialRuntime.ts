import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { dirname, isAbsolute, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

export type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
  jumpserverToken?: string
}

type AssetSafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (cipher: Buffer) => string
}

export type AssetCredentialRuntimeConfig = {
  credentialKeyPath?: string
  safeStorage?: AssetSafeStorageLike | null
}

const safeStorageCredentialPrefix = 'as1:'
const localKeyCredentialPrefix = 'ak1:'
const credentialFields = ['password', 'privateKey', 'passphrase', 'jumpserverToken'] as const

let runtimeConfig: AssetCredentialRuntimeConfig = {}
let cachedCredentialKeyPath = ''
let cachedCredentialKey: Buffer | null = null

export const configureAssetCredentialRuntime = (config: AssetCredentialRuntimeConfig = {}) => {
  runtimeConfig = { ...config }
  resetAssetCredentialRuntime()
}

export const resetAssetCredentialRuntime = () => {
  cachedCredentialKeyPath = ''
  cachedCredentialKey = null
}

const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

const resolveSafeStorage = () => {
  if (hasOwn(runtimeConfig, 'safeStorage')) return runtimeConfig.safeStorage || null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { safeStorage?: AssetSafeStorageLike }
    return electron.safeStorage || null
  } catch {
    return null
  }
}

const credentialKeyPath = () => {
  const configured = String(runtimeConfig.credentialKeyPath || '').trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(configured)
  return resolve('.aiopsterm-assets-credential.key')
}

const readOrCreateCredentialKey = () => {
  const keyPath = credentialKeyPath()
  if (cachedCredentialKey && cachedCredentialKeyPath === keyPath) return cachedCredentialKey
  cachedCredentialKeyPath = keyPath
  cachedCredentialKey = null
  if (existsSync(keyPath)) {
    const current = readFileSync(keyPath)
    if (current.length === 32) {
      cachedCredentialKey = current
      return cachedCredentialKey
    }
  }
  mkdirSync(dirname(keyPath), { recursive: true })
  cachedCredentialKey = randomBytes(32)
  writeFileSync(keyPath, cachedCredentialKey, { mode: 0o600 })
  return cachedCredentialKey
}

const safeStorageAvailable = (safeStorage = resolveSafeStorage()) => {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

const encryptWithLocalCredentialKey = (plain: string) => {
  const key = readOrCreateCredentialKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${localKeyCredentialPrefix}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

const decryptWithLocalCredentialKey = (cipherText: string) => {
  const body = cipherText.slice(localKeyCredentialPrefix.length)
  const [ivB64, encryptedB64, tagB64] = body.split('.')
  if (!ivB64 || !encryptedB64 || !tagB64) throw new Error('Malformed local asset credential ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', readOrCreateCredentialKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf-8')
}

export const isAssetCredentialCiphertext = (value: unknown) =>
  typeof value === 'string' && (value.startsWith(safeStorageCredentialPrefix) || value.startsWith(localKeyCredentialPrefix))

const encryptCredentialValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  if (!value) return ''
  if (isAssetCredentialCiphertext(value)) return value
  const safeStorage = resolveSafeStorage()
  if (safeStorageAvailable(safeStorage)) {
    return `${safeStorageCredentialPrefix}${safeStorage!.encryptString(value).toString('base64')}`
  }
  return encryptWithLocalCredentialKey(value)
}

const decryptCredentialValue = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (value.startsWith(safeStorageCredentialPrefix)) {
    try {
      return resolveSafeStorage()?.decryptString(Buffer.from(value.slice(safeStorageCredentialPrefix.length), 'base64')) || ''
    } catch {
      return ''
    }
  }
  if (value.startsWith(localKeyCredentialPrefix)) {
    try {
      return decryptWithLocalCredentialKey(value)
    } catch {
      return ''
    }
  }
  return value
}

export const decryptAssetSecret = (secret: AssetSecret = {}): AssetSecret => ({
  ...(hasOwn(secret, 'password') ? { password: decryptCredentialValue(secret.password) } : {}),
  ...(hasOwn(secret, 'privateKey') ? { privateKey: decryptCredentialValue(secret.privateKey) } : {}),
  ...(hasOwn(secret, 'passphrase') ? { passphrase: decryptCredentialValue(secret.passphrase) } : {}),
  ...(hasOwn(secret, 'jumpserverToken') ? { jumpserverToken: decryptCredentialValue(secret.jumpserverToken) } : {})
})

export const encryptAssetSecretForStorage = (secret: AssetSecret = {}): AssetSecret => ({
  ...(hasOwn(secret, 'password') ? { password: encryptCredentialValue(secret.password) } : {}),
  ...(hasOwn(secret, 'privateKey') ? { privateKey: encryptCredentialValue(secret.privateKey) } : {}),
  ...(hasOwn(secret, 'passphrase') ? { passphrase: encryptCredentialValue(secret.passphrase) } : {}),
  ...(hasOwn(secret, 'jumpserverToken') ? { jumpserverToken: encryptCredentialValue(secret.jumpserverToken) } : {})
})

export const assetSecretNeedsEncryption = (secret: AssetSecret = {}) =>
  credentialFields.some((key) => {
    const value = secret[key]
    return typeof value === 'string' && value.length > 0 && !isAssetCredentialCiphertext(value)
  })
