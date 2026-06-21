import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { dirname, isAbsolute, join, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { trim } from './databaseTableRuntime'

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (cipher: Buffer) => string
}

export type DatabaseCredentialStorageConfig = {
  stateFilePath?: string
  credentialKeyPath?: string
}

const databaseSafeStorageCredentialPrefix = 'ds1:'
const databaseLocalKeyCredentialPrefix = 'dk1:'

let credentialConfig: DatabaseCredentialStorageConfig = {}
let cachedDatabaseCredentialKeyPath = ''
let cachedDatabaseCredentialKey: Buffer | null = null

export const configureDatabaseCredentialStorage = (config?: DatabaseCredentialStorageConfig) => {
  credentialConfig = config ? { ...config } : {}
  resetDatabaseCredentialKeyCache()
}

export const resetDatabaseCredentialKeyCache = () => {
  cachedDatabaseCredentialKeyPath = ''
  cachedDatabaseCredentialKey = null
}

const resolveDatabaseSafeStorage = (): SafeStorageLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { safeStorage?: SafeStorageLike }
    return electron.safeStorage || null
  } catch {
    return null
  }
}

const defaultDatabaseCredentialKeyPath = () => {
  const envPath = trim(typeof process !== 'undefined' ? process.env?.AIOPSTERM_DATABASE_CREDENTIAL_KEY_FILE : '')
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  const statePath = trim(credentialConfig.stateFilePath)
  if (statePath) return join(dirname(statePath), 'database-credential.key')
  return join(typeof process !== 'undefined' ? process.cwd() : '.', '.aiopsterm-database-credential.key')
}

const databaseCredentialKeyPath = () => {
  const configured = trim(credentialConfig.credentialKeyPath)
  return configured ? (isAbsolute(configured) ? configured : resolve(configured)) : defaultDatabaseCredentialKeyPath()
}

const readOrCreateDatabaseCredentialKey = () => {
  const keyPath = databaseCredentialKeyPath()
  if (cachedDatabaseCredentialKey && cachedDatabaseCredentialKeyPath === keyPath) return cachedDatabaseCredentialKey
  cachedDatabaseCredentialKeyPath = keyPath
  cachedDatabaseCredentialKey = null
  if (existsSync(keyPath)) {
    const current = readFileSync(keyPath)
    if (current.length === 32) {
      cachedDatabaseCredentialKey = current
      return cachedDatabaseCredentialKey
    }
  }
  mkdirSync(dirname(keyPath), { recursive: true })
  cachedDatabaseCredentialKey = randomBytes(32)
  writeFileSync(keyPath, cachedDatabaseCredentialKey, { mode: 0o600 })
  return cachedDatabaseCredentialKey
}

export const isDatabaseCredentialCiphertext = (value: unknown) =>
  typeof value === 'string' && (value.startsWith(databaseSafeStorageCredentialPrefix) || value.startsWith(databaseLocalKeyCredentialPrefix))

const databaseSafeStorageAvailable = (safeStorage = resolveDatabaseSafeStorage()) => {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

const encryptDatabaseCredentialWithLocalKey = (plain: string) => {
  const key = readOrCreateDatabaseCredentialKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${databaseLocalKeyCredentialPrefix}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

const decryptDatabaseCredentialWithLocalKey = (cipherText: string) => {
  const body = cipherText.slice(databaseLocalKeyCredentialPrefix.length)
  const [ivB64, encryptedB64, tagB64] = body.split('.')
  if (!ivB64 || !encryptedB64 || !tagB64) throw new Error('Malformed local database credential ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', readOrCreateDatabaseCredentialKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf-8')
}

export const encryptDatabaseCredentialForStorage = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (isDatabaseCredentialCiphertext(value)) return value
  const safeStorage = resolveDatabaseSafeStorage()
  if (databaseSafeStorageAvailable(safeStorage)) {
    return `${databaseSafeStorageCredentialPrefix}${safeStorage!.encryptString(value).toString('base64')}`
  }
  return encryptDatabaseCredentialWithLocalKey(value)
}

export const decryptDatabaseCredentialFromStorage = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (value.startsWith(databaseSafeStorageCredentialPrefix)) {
    try {
      return resolveDatabaseSafeStorage()?.decryptString(Buffer.from(value.slice(databaseSafeStorageCredentialPrefix.length), 'base64')) || ''
    } catch {
      return ''
    }
  }
  if (value.startsWith(databaseLocalKeyCredentialPrefix)) {
    try {
      return decryptDatabaseCredentialWithLocalKey(value)
    } catch {
      return ''
    }
  }
  return value
}
