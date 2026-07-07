import type { AiopsMutationResult } from '@shared/contracts/common'
import type {
  AiopsTrustedDevice,
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAvatarPrepareInput,
  AiopsUserAvatarPrepareResult,
  AiopsUserAccountResult,
  AiopsUserAccountSnapshot,
  AiopsUserCodeInput,
  AiopsUserCodeResult,
  AiopsUserContactBindInput,
  AiopsUserDeactivateInput,
  AiopsUserExternalAction,
  AiopsUserExternalActionResult,
  AiopsUserLoginInput,
  AiopsUserMutationResult,
  AiopsUserPasswordInput,
  AiopsUserProfile,
  AiopsUserProfileUpdateInput
} from '@shared/contracts/userAccount'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'
import { shouldUseUserAccountSeedData } from '@shared/runtimeSwitches'
import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { hostname, networkInterfaces, userInfo } from 'os'
import { dirname, isAbsolute, resolve } from 'path'
import { createUserAccountAvatarRuntime } from './userAccountAvatarRuntime'
import { createUserAccountCodeRuntime, normalizeUserAccountCode, type UserCodeCooldownScope, type UserCodeKind } from './userAccountCodeRuntime'

const defaultUserProfile: AiopsUserProfile = {
  uid: 2001007,
  name: 'Local Operator',
  username: 'local_ops',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-12-31',
  email: 'operator@example.local',
  mobile: '13800000000',
  localIp: '127.0.0.1',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  isOfficeDevice: true,
  needDeviceVerification: false,
  skippedLogin: false,
  localDatabaseReady: true,
  lastLoginMethod: 'account',
  lastLoginAt: '2026-06-04 10:30',
  passwordUpdatedAt: '2026-06-01 09:00',
  avatarUpdatedAt: '2026-06-01 09:00'
}

const defaultTrustedDevices: AiopsTrustedDevice[] = [
  {
    id: 1,
    deviceName: 'Linux Workstation',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    lastLoginIp: '10.24.8.12',
    location: 'Shanghai',
    lastLoginUserAgent: 'Chrome/125 Linux',
    current: true
  },
  {
    id: 2,
    deviceName: 'MacBook',
    macAddress: '11:22:33:44:55:66',
    lastLoginIp: '10.18.3.42',
    location: 'Hangzhou',
    lastLoginUserAgent: 'Safari/17 macOS',
    current: false
  }
]

type UserAccountBackendRuntimeConfig = {
  stateFilePath?: string
  useSeedData?: boolean
  loginUrl?: string
  accountCenterUrl?: string
  openExternal?: (url: string) => Promise<void> | void
}

type UserAccountBackendRuntime = {
  stateFilePath: string
  useSeedData: boolean
  loginUrl: string
  accountCenterUrl: string
  openExternal?: (url: string) => Promise<void> | void
}

type UserAccountPersistedState = {
  version: 1
  profile: AiopsUserProfile
  trustedDevices: AiopsTrustedDevice[]
  credentials: UserAccountCredential[]
}

type UserAccountCredential = {
  username: string
  passwordHash: string
  salt: string
  updatedAt: string
  requiresDeviceVerification?: boolean
}

type SeedUserAccountCredential = {
  username: string
  password: string
  requiresDeviceVerification?: boolean
}

const defaultUserAccountStateFilePath = () => {
  const envPath = String(process.env.AIOPSTERM_USER_ACCOUNT_STATE_FILE || '').trim()
  return envPath ? (isAbsolute(envPath) ? envPath : resolve(envPath)) : resolve(process.cwd(), '.aiopsterm-user-account.json')
}

const defaultUserAccountSeedMode = shouldUseUserAccountSeedData

let runtimeConfig: UserAccountBackendRuntime = {
  stateFilePath: defaultUserAccountStateFilePath(),
  useSeedData: defaultUserAccountSeedMode(),
  loginUrl: String(process.env.AIOPSTERM_USER_LOGIN_URL || '').trim(),
  accountCenterUrl: String(process.env.AIOPSTERM_USER_ACCOUNT_CENTER_URL || '').trim()
}

const firstLocalInterface = () => {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry
    }
  }
  return null
}

const safeLocalUsername = () => {
  try {
    return userInfo().username || 'local_user'
  } catch {
    return 'local_user'
  }
}

const normalizedUsername = (value: string) => {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20)
  if (cleaned.length >= 6) return cleaned
  return `${cleaned || 'local'}_user`.slice(0, 20)
}

const initialsFromName = (value: string) => {
  const letters = value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (letters || 'AI').slice(0, 3)
}

const createLocalUserProfile = (): AiopsUserProfile => {
  const net = firstLocalInterface()
  const rawUsername = safeLocalUsername()
  const username = normalizedUsername(rawUsername)
  const name = rawUsername || username
  return {
    uid: 0,
    name,
    username,
    avatarInitials: initialsFromName(name),
    avatarImageUrl: '',
    registrationType: 'personal',
    registrationCode: 9,
    authProvider: 'local',
    subscription: 'free',
    subscriptionExpiresAt: '',
    email: '',
    mobile: '',
    localIp: net?.address || '127.0.0.1',
    macAddress: net?.mac || '',
    isOfficeDevice: false,
    needDeviceVerification: false,
    skippedLogin: true,
    localDatabaseReady: false,
    lastLoginMethod: 'skip',
    lastLoginAt: '',
    passwordUpdatedAt: '',
    avatarUpdatedAt: ''
  }
}

const createLocalTrustedDevices = (): AiopsTrustedDevice[] => {
  const net = firstLocalInterface()
  return [
    {
      id: 1,
      deviceName: hostname() || 'Local Device',
      macAddress: net?.mac || '',
      lastLoginIp: net?.address || '127.0.0.1',
      location: 'Local',
      lastLoginUserAgent: `${process.platform} ${process.arch}`,
      current: true
    }
  ]
}

const createInitialUserProfile = () => (runtimeConfig.useSeedData ? { ...defaultUserProfile } : createLocalUserProfile())
const createInitialTrustedDevices = () =>
  runtimeConfig.useSeedData ? defaultTrustedDevices.map((device) => ({ ...device })) : createLocalTrustedDevices()

const seedUserAccountCredentials: SeedUserAccountCredential[] = [
  { username: 'ops_login', password: 'secret' },
  { username: 'ops_return', password: 'secret' },
  { username: 'privacy_ops', password: 'secret' },
  { username: 'verify-device', password: 'secret', requiresDeviceVerification: true }
]

const credentialText = (value: unknown) => String(value || '').trim()

const userCredentialKey = (username: string) => credentialText(username).toLowerCase()

const isUsableCredentialUsername = (username: string) => {
  const value = credentialText(username)
  return value.length > 0 && value.length <= 64
}

// scrypt 派生耗时 30-100ms，必须走异步版本，避免阻塞主进程事件循环。
const userPasswordHash = (password: string, salt: string) =>
  new Promise<string>((resolve, reject) => {
    scrypt(password, `aiopsterm-user-account-v1\0${salt}`, 32, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey.toString('hex'))
    })
  })

const createUserCredential = async (
  username: string,
  password: string,
  options: { salt?: string; updatedAt?: string; requiresDeviceVerification?: boolean } = {}
): Promise<UserAccountCredential> => {
  const salt = options.salt || randomBytes(16).toString('hex')
  return {
    username: credentialText(username),
    salt,
    passwordHash: await userPasswordHash(password, salt),
    updatedAt: options.updatedAt || defaultUserProfile.passwordUpdatedAt,
    ...(options.requiresDeviceVerification ? { requiresDeviceVerification: true } : {})
  }
}

const createSeedUserCredentials = () =>
  Promise.all(
    seedUserAccountCredentials.map((credential) =>
      createUserCredential(credential.username, credential.password, {
        updatedAt: defaultUserProfile.passwordUpdatedAt,
        requiresDeviceVerification: credential.requiresDeviceVerification
      })
    )
  )

const createInitialCredentials = (): Promise<UserAccountCredential[]> => (runtimeConfig.useSeedData ? createSeedUserCredentials() : Promise.resolve([]))

// 种子凭据的批量 hash 延迟到首次状态加载时异步执行，模块加载阶段不做 scrypt。
let profileStore: AiopsUserProfile = createInitialUserProfile()
let trustedDeviceStore: AiopsTrustedDevice[] = createInitialTrustedDevices()
let credentialStore: UserAccountCredential[] = []
let userAccountStateLoaded = false
let userAccountLoadedStateFilePath = ''
let userAccountStateLoadPromise: Promise<void> | null = null

const codeRuntime = createUserAccountCodeRuntime(() => ({
  stateFilePath: runtimeConfig.stateFilePath,
  useSeedData: runtimeConfig.useSeedData
}))

const avatarRuntime = createUserAccountAvatarRuntime(() => ({
  stateFilePath: runtimeConfig.stateFilePath
}))

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = stableValue(value[key])
      if (nextValue !== undefined) result[key] = nextValue
      return result
    }, {})
}

const stableJson = (value: unknown) => JSON.stringify(stableValue(value))

const persistedString = (value: unknown, fallback = '') => (typeof value === 'string' ? value.trim() || fallback : fallback)

const persistedRawString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

const persistedBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const persistedNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const persistedPositiveInteger = (value: unknown, fallback: number) => {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

const registrationCodes = new Set([1, 2, 3, 4, 6, 7, 9])
const lastLoginMethods = new Set(['account', 'email', 'mobile', 'skip', 'external'])
const authProviders = new Set(['local', 'sso', 'oauth'])
const subscriptions = new Set(['free', 'pro', 'ultra'])

const normalizeRegistrationCode = (value: unknown, fallback: AiopsUserProfile['registrationCode']) => {
  const numeric = Number(value)
  return registrationCodes.has(numeric) ? (numeric as AiopsUserProfile['registrationCode']) : fallback
}

const normalizeLastLoginMethod = (value: unknown, fallback: AiopsUserProfile['lastLoginMethod']) =>
  typeof value === 'string' && lastLoginMethods.has(value) ? (value as AiopsUserProfile['lastLoginMethod']) : fallback

const normalizeAuthProvider = (value: unknown, fallback: AiopsUserProfile['authProvider']) =>
  typeof value === 'string' && authProviders.has(value) ? (value as AiopsUserProfile['authProvider']) : fallback

const normalizeSubscription = (value: unknown, fallback: AiopsUserProfile['subscription']) =>
  typeof value === 'string' && subscriptions.has(value) ? (value as AiopsUserProfile['subscription']) : fallback

const normalizeRegistrationType = (value: unknown, fallback: AiopsUserProfile['registrationType']) =>
  value === 'enterprise' || value === 'personal' ? value : fallback

const normalizePersistedAvatarImageUrl = (value: unknown, fallback: string) => {
  const avatarImageUrl = persistedRawString(value, fallback)
  if (!avatarImageUrl) return ''
  return avatarRuntime.assetExists(avatarImageUrl) ? avatarImageUrl : fallback
}

const normalizePersistedProfile = (value: unknown): AiopsUserProfile => {
  const base = createInitialUserProfile()
  const record = isRecord(value) ? value : {}
  const name = persistedString(record.name, base.name)
  const avatarInitials = persistedString(record.avatarInitials, initialsFromName(name)).toUpperCase().slice(0, 3) || base.avatarInitials
  const email = persistedString(record.email, base.email)
  const mobile = persistedString(record.mobile, base.mobile)
  return {
    uid: persistedNumber(record.uid, base.uid),
    name,
    username: persistedString(record.username, base.username),
    avatarInitials,
    avatarImageUrl: normalizePersistedAvatarImageUrl(record.avatarImageUrl, base.avatarImageUrl),
    registrationType: normalizeRegistrationType(record.registrationType, base.registrationType),
    registrationCode: normalizeRegistrationCode(record.registrationCode, base.registrationCode),
    authProvider: normalizeAuthProvider(record.authProvider, base.authProvider),
    subscription: normalizeSubscription(record.subscription, base.subscription),
    subscriptionExpiresAt: persistedString(record.subscriptionExpiresAt, base.subscriptionExpiresAt),
    email: !email || isValidEmail(email) ? email : base.email,
    mobile: !mobile || isValidMobile(mobile) ? mobile : base.mobile,
    localIp: persistedString(record.localIp, base.localIp),
    macAddress: persistedString(record.macAddress, base.macAddress),
    isOfficeDevice: persistedBoolean(record.isOfficeDevice, base.isOfficeDevice),
    needDeviceVerification: false,
    skippedLogin: persistedBoolean(record.skippedLogin, base.skippedLogin),
    localDatabaseReady: persistedBoolean(record.localDatabaseReady, base.localDatabaseReady),
    lastLoginMethod: normalizeLastLoginMethod(record.lastLoginMethod, base.lastLoginMethod),
    lastLoginAt: persistedString(record.lastLoginAt, base.lastLoginAt),
    passwordUpdatedAt: persistedString(record.passwordUpdatedAt, base.passwordUpdatedAt),
    avatarUpdatedAt: persistedString(record.avatarUpdatedAt, base.avatarUpdatedAt)
  }
}

const withSingleCurrentTrustedDevice = (devices: AiopsTrustedDevice[], fallback: AiopsTrustedDevice[]) => {
  if (!devices.length) return fallback
  const currentIndex = Math.max(0, devices.findIndex((device) => device.current))
  return devices.map((device, index) => ({ ...device, current: index === currentIndex }))
}

const normalizePersistedTrustedDevices = (value: unknown): AiopsTrustedDevice[] => {
  const fallback = createInitialTrustedDevices()
  if (!Array.isArray(value)) return fallback
  const ids = new Set<number>()
  const devices: AiopsTrustedDevice[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) return
    const deviceName = persistedString(item.deviceName)
    if (!deviceName) return
    let id = persistedPositiveInteger(item.id, index + 1)
    while (ids.has(id)) id += 1
    ids.add(id)
    devices.push({
      id,
      deviceName,
      macAddress: persistedString(item.macAddress),
      lastLoginIp: persistedString(item.lastLoginIp),
      location: persistedString(item.location),
      lastLoginUserAgent: persistedString(item.lastLoginUserAgent),
      current: persistedBoolean(item.current, false)
    })
  })
  return withSingleCurrentTrustedDevice(devices, fallback)
}

const seedTrustedDevicesById = new Map(defaultTrustedDevices.map((device) => [device.id, device]))
const seedUserAccountCredentialsByKey = new Map(seedUserAccountCredentials.map((credential) => [userCredentialKey(credential.username), credential]))

const normalizePersistedCredential = (value: unknown): UserAccountCredential | null => {
  if (!isRecord(value)) return null
  const username = persistedString(value.username)
  const salt = persistedString(value.salt)
  const passwordHash = persistedString(value.passwordHash)
  if (!isUsableCredentialUsername(username)) return null
  if (!/^[a-f0-9]{32,128}$/i.test(salt)) return null
  if (!/^[a-f0-9]{64}$/i.test(passwordHash)) return null
  return {
    username,
    salt: salt.toLowerCase(),
    passwordHash: passwordHash.toLowerCase(),
    updatedAt: persistedString(value.updatedAt, defaultUserProfile.passwordUpdatedAt),
    ...(persistedBoolean(value.requiresDeviceVerification, false) ? { requiresDeviceVerification: true } : {})
  }
}

const normalizePersistedCredentials = (value: unknown) => {
  if (!Array.isArray(value)) return []
  const credentialsByKey = new Map<string, UserAccountCredential>()
  value.forEach((item) => {
    const credential = normalizePersistedCredential(item)
    if (credential) credentialsByKey.set(userCredentialKey(credential.username), credential)
  })
  return [...credentialsByKey.values()]
}

const mergeSeedUserCredentials = async (credentials: UserAccountCredential[]) => {
  const credentialsByKey = new Map<string, UserAccountCredential>()
  ;(await createSeedUserCredentials()).forEach((credential) => {
    credentialsByKey.set(userCredentialKey(credential.username), credential)
  })
  credentials.forEach((credential) => {
    credentialsByKey.set(userCredentialKey(credential.username), { ...credential })
  })
  return [...credentialsByKey.values()]
}

const isUnchangedSeedUserCredential = async (credential: UserAccountCredential) => {
  const seed = seedUserAccountCredentialsByKey.get(userCredentialKey(credential.username))
  if (!seed || Boolean(credential.requiresDeviceVerification) !== Boolean(seed.requiresDeviceVerification)) return false
  return verifyUserCredentialPassword(credential, seed.password)
}

const stripLegacySeedUserAccountState = async (state: UserAccountPersistedState): Promise<UserAccountPersistedState> => {
  if (runtimeConfig.useSeedData) return state
  const profile = stableJson(state.profile) === stableJson(defaultUserProfile) ? createLocalUserProfile() : state.profile
  const trustedDevices = state.trustedDevices.filter((device) => {
    const seed = seedTrustedDevicesById.get(device.id)
    return !seed || stableJson(device) !== stableJson(seed)
  })
  const unchangedSeedFlags = await Promise.all(state.credentials.map((credential) => isUnchangedSeedUserCredential(credential)))
  return {
    version: 1,
    profile,
    trustedDevices: withSingleCurrentTrustedDevice(trustedDevices, createLocalTrustedDevices()),
    credentials: state.credentials.filter((_, index) => !unchangedSeedFlags[index])
  }
}

const normalizePersistedUserAccountState = async (value: unknown): Promise<UserAccountPersistedState | null> => {
  if (!isRecord(value)) return null
  const credentials = normalizePersistedCredentials(value.credentials)
  const state: UserAccountPersistedState = {
    version: 1,
    profile: normalizePersistedProfile(value.profile),
    trustedDevices: normalizePersistedTrustedDevices(value.trustedDevices),
    credentials: runtimeConfig.useSeedData ? await mergeSeedUserCredentials(credentials) : credentials
  }
  return runtimeConfig.useSeedData ? state : stripLegacySeedUserAccountState(state)
}

const applyInitialUserAccountState = async () => {
  profileStore = createInitialUserProfile()
  trustedDeviceStore = createInitialTrustedDevices()
  credentialStore = await createInitialCredentials()
}

const applyDeactivatedUserAccountState = async () => {
  profileStore = createLocalUserProfile()
  trustedDeviceStore = createLocalTrustedDevices()
  credentialStore = await createInitialCredentials()
}

const applyPersistedUserAccountState = (state: UserAccountPersistedState) => {
  profileStore = { ...state.profile }
  trustedDeviceStore = state.trustedDevices.map((device) => ({ ...device }))
  credentialStore = state.credentials.map((credential) => ({ ...credential }))
}

const loadUserAccountState = async () => {
  await applyInitialUserAccountState()
  if (!existsSync(runtimeConfig.stateFilePath)) return
  try {
    const parsed = JSON.parse(readFileSync(runtimeConfig.stateFilePath, 'utf-8')) as unknown
    const state = await normalizePersistedUserAccountState(parsed)
    if (state) {
      applyPersistedUserAccountState(state)
      if (!runtimeConfig.useSeedData) persistUserAccountState()
    }
  } catch {
    /* Keep the backend-owned default account state when local account state is corrupt. */
  }
}

const ensureUserAccountStateLoaded = async () => {
  if (userAccountStateLoaded && userAccountLoadedStateFilePath === runtimeConfig.stateFilePath) return
  if (!userAccountStateLoadPromise || userAccountLoadedStateFilePath !== runtimeConfig.stateFilePath) {
    userAccountLoadedStateFilePath = runtimeConfig.stateFilePath
    userAccountStateLoadPromise = loadUserAccountState().then(() => {
      userAccountStateLoaded = true
    })
  }
  await userAccountStateLoadPromise
}

// 调用方必须先通过 ensureUserAccountStateLoaded 完成状态加载。
const persistUserAccountState = () => {
  const state: UserAccountPersistedState = {
    version: 1,
    profile: { ...profileStore },
    trustedDevices: trustedDeviceStore.map((device) => ({ ...device })),
    credentials: credentialStore.map((credential) => ({ ...credential }))
  }
  try {
    mkdirSync(dirname(runtimeConfig.stateFilePath), { recursive: true })
    const tempPath = `${runtimeConfig.stateFilePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tempPath, runtimeConfig.stateFilePath)
  } catch {
    /* Persistence failures must not turn a successful local account action into a UI failure. */
  }
}

const cloneProfile = (profile: AiopsUserProfile = profileStore): AiopsUserProfile => ({ ...profile })

const cloneTrustedDevices = (devices: AiopsTrustedDevice[] = trustedDeviceStore) => devices.map((device) => ({ ...device }))

const snapshot = async (): Promise<AiopsUserAccountSnapshot> => {
  await ensureUserAccountStateLoaded()
  return {
    profile: cloneProfile(),
    trustedDevices: cloneTrustedDevices()
  }
}

const errorResult = <T>(errorCode: string, errorMessage: string): AiopsMutationResult<T> => ({
  ok: false,
  errorCode,
  errorMessage
})

const timestamp = (value = new Date()) => {
  const pad = (input: number) => input.toString().padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`
}

const trimText = (value: unknown) => String(value || '').trim()

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const isValidMobile = (value: string) => /^1[3-9]\d{9}$/.test(value)

const secureHashEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const verifyUserCredentialPassword = async (credential: UserAccountCredential, password: string) =>
  secureHashEqual(credential.passwordHash, await userPasswordHash(password, credential.salt))

const findUserCredential = (username: string) => {
  const key = userCredentialKey(username)
  return credentialStore.find((credential) => userCredentialKey(credential.username) === key) || null
}

const upsertUserCredential = async (
  username: string,
  password: string,
  options: { updatedAt?: string; requiresDeviceVerification?: boolean } = {}
) => {
  const normalizedUsername = credentialText(username)
  if (!isUsableCredentialUsername(normalizedUsername)) return null
  const key = userCredentialKey(normalizedUsername)
  const existing = credentialStore.find((credential) => userCredentialKey(credential.username) === key)
  const credential = await createUserCredential(normalizedUsername, password, {
    updatedAt: options.updatedAt || timestamp(),
    requiresDeviceVerification: options.requiresDeviceVerification ?? existing?.requiresDeviceVerification
  })
  credentialStore = existing
    ? credentialStore.map((item) => (userCredentialKey(item.username) === key ? credential : item))
    : [...credentialStore, credential]
  return credential
}

const renameCurrentUserCredential = (previousUsername: string, nextUsername: string) => {
  const previousKey = userCredentialKey(previousUsername)
  const nextKey = userCredentialKey(nextUsername)
  if (!previousKey || !nextKey || previousKey === nextKey) return
  const existing = credentialStore.find((credential) => userCredentialKey(credential.username) === previousKey)
  if (!existing) return
  credentialStore = credentialStore
    .filter((credential) => userCredentialKey(credential.username) !== nextKey)
    .map((credential) => (userCredentialKey(credential.username) === previousKey ? { ...credential, username: credentialText(nextUsername) } : credential))
}

export const peekUserCodeForTests = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string) =>
  codeRuntime.peekForTests(scope, kind, target)

export const resolveUserAvatarAssetPath = (avatarImageUrl: string) => {
  return avatarRuntime.resolveAssetPath(avatarImageUrl)
}

const passwordScore = (password: string) => {
  if (!password) return 0
  let score = password.length >= 8 ? 1 : 0
  if (/[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

const applyProfile = async (patch: Partial<AiopsUserProfile>) => {
  await ensureUserAccountStateLoaded()
  profileStore = {
    ...profileStore,
    ...patch
  }
}

const loginProfile = (patch: Partial<AiopsUserProfile>) =>
  applyProfile({
    ...patch,
    skippedLogin: false,
    needDeviceVerification: patch.needDeviceVerification ?? false,
    localDatabaseReady: true,
    lastLoginAt: timestamp()
  })

const successMutation = async (message: string): Promise<AiopsUserMutationResult> => {
  persistUserAccountState()
  return {
    ok: true,
    data: {
      ...(await snapshot()),
      message
    }
  }
}

const externalActionUrl = (action: AiopsUserExternalAction) =>
  action === 'login' ? runtimeConfig.loginUrl : runtimeConfig.accountCenterUrl

const externalActionUnavailableCode = (action: AiopsUserExternalAction) =>
  action === 'login' ? 'USER_LOGIN_EXTERNAL_UNAVAILABLE' : 'USER_ACCOUNT_CENTER_EXTERNAL_UNAVAILABLE'

const externalActionFailedCode = (action: AiopsUserExternalAction) =>
  action === 'login' ? 'USER_LOGIN_EXTERNAL_FAILED' : 'USER_ACCOUNT_CENTER_EXTERNAL_FAILED'

const externalActionMessage = (action: AiopsUserExternalAction) => (action === 'login' ? '登录页面已打开' : '账号中心已打开')

const externalActionOpenFailureMessage = (action: AiopsUserExternalAction) => (action === 'login' ? '登录服务打开失败' : '账号中心打开失败')

const openUserExternalAction = async (action: AiopsUserExternalAction): Promise<AiopsUserExternalActionResult> => {
  const normalized = normalizeExternalHttpUrl(externalActionUrl(action))
  if (!normalized.valid || typeof runtimeConfig.openExternal !== 'function') {
    return errorResult(externalActionUnavailableCode(action), action === 'login' ? '登录服务不可用' : '账号中心服务不可用')
  }

  try {
    await runtimeConfig.openExternal(normalized.url)
    return {
      ok: true,
      data: {
        action,
        url: normalized.url,
        opened: true,
        openedAt: timestamp(),
        message: externalActionMessage(action)
      }
    }
  } catch (error) {
    return errorResult(
      externalActionFailedCode(action),
      error instanceof Error && error.message.trim() ? error.message : externalActionOpenFailureMessage(action)
    )
  }
}

export const configureUserAccountBackendRuntime = (config: UserAccountBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    stateFilePath: config.stateFilePath
      ? isAbsolute(config.stateFilePath)
        ? config.stateFilePath
        : resolve(config.stateFilePath)
      : defaultUserAccountStateFilePath(),
    useSeedData: config.useSeedData ?? defaultUserAccountSeedMode(),
    loginUrl: String(config.loginUrl ?? process.env.AIOPSTERM_USER_LOGIN_URL ?? '').trim(),
    accountCenterUrl: String(config.accountCenterUrl ?? process.env.AIOPSTERM_USER_ACCOUNT_CENTER_URL ?? '').trim(),
    openExternal: config.openExternal
  }
  codeRuntime.reset()
  userAccountStateLoaded = false
  userAccountLoadedStateFilePath = ''
  userAccountStateLoadPromise = null
  // 种子凭据 hash 留给下一次异步状态加载，这里保持同步配置语义。
  profileStore = createInitialUserProfile()
  trustedDeviceStore = createInitialTrustedDevices()
  credentialStore = []
}

export const resetUserAccountForTests = async () => {
  await applyInitialUserAccountState()
  codeRuntime.reset()
  userAccountStateLoaded = true
  userAccountLoadedStateFilePath = runtimeConfig.stateFilePath
  userAccountStateLoadPromise = Promise.resolve()
}

export const patchUserAccountForTests = async (patch: Partial<AiopsUserProfile>) => {
  await applyProfile(patch)
  persistUserAccountState()
}

export const getUserAccount = async (): Promise<AiopsUserAccountResult> => ({
  ok: true,
  data: await snapshot()
})

export const openUserLogin = () => openUserExternalAction('login')

export const openUserAccountCenter = () => openUserExternalAction('account-center')

export const loginUserAccount = async (input: AiopsUserLoginInput): Promise<AiopsUserMutationResult> => {
  await ensureUserAccountStateLoaded()
  if (input.method === 'account') {
    const username = trimText(input.username)
    if (!username || !input.password) return errorResult('USER_LOGIN_REQUIRED', '请输入用户名和密码')
    const credential = findUserCredential(username)
    if (!credential || !(await verifyUserCredentialPassword(credential, input.password))) {
      return errorResult('USER_LOGIN_INVALID', '用户名或密码不正确')
    }
    if (credential.requiresDeviceVerification) {
      await applyProfile({
        username: credential.username,
        needDeviceVerification: true,
        localDatabaseReady: false
      })
      persistUserAccountState()
      return {
        ok: false,
        data: {
          ...(await snapshot()),
          message: '当前设备需要验证后才能登录'
        },
        errorCode: 'USER_DEVICE_VERIFICATION_REQUIRED',
        errorMessage: '当前设备需要验证后才能登录'
      }
    }
    await loginProfile({
      username: credential.username,
      name: profileStore.name || credential.username,
      authProvider: 'local',
      registrationCode: 9,
      lastLoginMethod: 'account'
    })
    return successMutation('账号登录成功，本地数据库初始化完成')
  }

  if (input.method === 'email') {
    const email = trimText(input.email)
    const code = normalizeUserAccountCode(input.code)
    if (!email || !code) return errorResult('USER_EMAIL_LOGIN_REQUIRED', '请输入邮箱和验证码')
    if (!isValidEmail(email)) return errorResult('USER_EMAIL_INVALID', '邮箱格式不正确')
    const verificationError = codeRuntime.verify('login', 'email', email, code)
    if (verificationError) return verificationError
    await loginProfile({
      email,
      username: email.split('@')[0] || profileStore.username,
      authProvider: 'local',
      registrationCode: 2,
      lastLoginMethod: 'email'
    })
    codeRuntime.clear('login', 'email', email)
    return successMutation('邮箱登录成功，本地数据库初始化完成')
  }

  const mobile = trimText(input.mobile)
  const code = normalizeUserAccountCode(input.code)
  if (!mobile || !code) return errorResult('USER_MOBILE_LOGIN_REQUIRED', '请输入手机号和验证码')
  if (!isValidMobile(mobile)) return errorResult('USER_MOBILE_INVALID', '手机号格式不正确')
  const verificationError = codeRuntime.verify('login', 'mobile', mobile, code)
  if (verificationError) return verificationError
  await loginProfile({
    mobile,
    authProvider: 'local',
    registrationCode: 7,
    lastLoginMethod: 'mobile'
  })
  codeRuntime.clear('login', 'mobile', mobile)
  return successMutation('手机号登录成功，本地数据库初始化完成')
}

export const logoutUserAccount = async (): Promise<AiopsUserMutationResult> => {
  await applyProfile({
    skippedLogin: true,
    localDatabaseReady: false,
    needDeviceVerification: false
  })
  return successMutation('已退出登录')
}

export const deactivateUserAccount = async (input: AiopsUserDeactivateInput): Promise<AiopsUserMutationResult> => {
  await ensureUserAccountStateLoaded()
  const uid = Number(input?.uid)
  if (!Number.isFinite(uid) || uid <= 0) return errorResult('USER_DEACTIVATE_UID_REQUIRED', '无法确定当前用户账号')
  if (profileStore.skippedLogin || profileStore.lastLoginMethod === 'skip' || !profileStore.uid) {
    return errorResult('USER_DEACTIVATE_LOGIN_REQUIRED', '请先登录账号')
  }
  if (uid !== profileStore.uid) return errorResult('USER_DEACTIVATE_UID_MISMATCH', '当前用户账号不匹配')
  await applyDeactivatedUserAccountState()
  return successMutation('账号已停用，当前登录状态已清除')
}

export const skipUserLogin = async (): Promise<AiopsUserMutationResult> => {
  await loginProfile({
    uid: 999999999,
    name: 'Guest',
    username: 'guest',
    email: 'guest@example.local',
    mobile: '',
    authProvider: 'local',
    registrationCode: 9,
    lastLoginMethod: 'skip'
  })
  return successMutation('已跳过登录，使用本地访客状态')
}

export const sendUserLoginCode = (input: AiopsUserCodeInput): AiopsUserCodeResult => {
  const value = trimText(input.value)
  if (input.kind === 'email' && !isValidEmail(value)) return errorResult('USER_EMAIL_INVALID', '邮箱格式不正确')
  if (input.kind === 'mobile' && !isValidMobile(value)) return errorResult('USER_MOBILE_INVALID', '手机号格式不正确')
  return codeRuntime.issue('login', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}登录验证码已发送`)
}

export const prepareUserAvatarImage = (input: AiopsUserAvatarPrepareInput): Promise<AiopsUserAvatarPrepareResult> => avatarRuntime.prepare(input)

const validateProfileUpdate = async (input: AiopsUserProfileUpdateInput) => {
  await ensureUserAccountStateLoaded()
  const username = trimText(input.username ?? profileStore.username)
  const name = trimText(input.name ?? profileStore.name)
  if (!username || username.length < 6 || username.length > 20) return '用户名长度需要在 6 到 20 个字符之间'
  if (!/^[A-Za-z0-9_]+$/.test(username)) return '用户名仅支持字母、数字和下划线'
  if (!name || name.length > 20) return '姓名不能为空且不能超过 20 个字符'
  return ''
}

export const updateUserProfile = async (input: AiopsUserProfileUpdateInput): Promise<AiopsUserMutationResult> => {
  const validation = await validateProfileUpdate(input)
  if (validation) return errorResult('USER_PROFILE_INVALID', validation)
  const nextAvatarInitials = trimText(input.avatarInitials).toUpperCase().slice(0, 3)
  const avatarChanged = input.avatarImageUrl !== undefined || input.avatarInitials !== undefined
  const previousUsername = profileStore.username
  const nextUsername = input.username !== undefined ? trimText(input.username) : profileStore.username
  const nextAvatarImageUrl = input.avatarImageUrl !== undefined ? trimText(input.avatarImageUrl) : profileStore.avatarImageUrl
  if (input.avatarImageUrl !== undefined && nextAvatarImageUrl && !avatarRuntime.assetExists(nextAvatarImageUrl)) {
    return errorResult('USER_AVATAR_ASSET_INVALID', '头像图片必须来自后端头像上传结果')
  }
  if (!profileStore.skippedLogin) renameCurrentUserCredential(previousUsername, nextUsername)
  await applyProfile({
    name: input.name !== undefined ? trimText(input.name) : profileStore.name,
    username: nextUsername,
    avatarInitials: nextAvatarInitials || profileStore.avatarInitials,
    avatarImageUrl: nextAvatarImageUrl,
    avatarUpdatedAt: avatarChanged ? timestamp() : profileStore.avatarUpdatedAt
  })
  return successMutation(avatarChanged ? '头像更新成功' : '个人信息已保存')
}

const canEditMobile = () => profileStore.registrationCode !== 7
const canEditEmail = () => ![2, 3, 4, 6].includes(profileStore.registrationCode)
const canResetPassword = () => profileStore.registrationCode !== 1 && profileStore.authProvider !== 'sso'

const validateContact = async (kind: 'email' | 'mobile', value: string) => {
  await ensureUserAccountStateLoaded()
  if (kind === 'email') {
    if (!canEditEmail()) return '当前登录方式不允许修改邮箱'
    if (!isValidEmail(value)) return '邮箱格式不正确'
    return ''
  }
  if (!canEditMobile()) return '当前登录方式不允许修改手机号'
  if (!isValidMobile(value)) return '手机号格式不正确'
  return ''
}

export const sendUserContactCode = async (input: AiopsUserCodeInput): Promise<AiopsUserCodeResult> => {
  const value = trimText(input.value)
  const validation = await validateContact(input.kind, value)
  if (validation) return errorResult(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
  return codeRuntime.issue('contact', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}验证码已发送`)
}

export const bindUserContact = async (input: AiopsUserContactBindInput): Promise<AiopsUserMutationResult> => {
  const value = trimText(input.value)
  const code = normalizeUserAccountCode(input.code)
  const validation = await validateContact(input.kind, value)
  if (validation) return errorResult(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
  if (!code) return errorResult('USER_CONTACT_CODE_REQUIRED', `请输入${input.kind === 'email' ? '邮箱' : '手机'}验证码`)
  const verificationError = codeRuntime.verify('contact', input.kind, value, code)
  if (verificationError) return verificationError
  await applyProfile({ [input.kind]: value })
  codeRuntime.clear('contact', input.kind, value)
  return successMutation(input.kind === 'email' ? '邮箱绑定成功' : '手机号绑定成功')
}

export const resetUserPassword = async (input: AiopsUserPasswordInput): Promise<AiopsUserMutationResult> => {
  await ensureUserAccountStateLoaded()
  if (!canResetPassword()) return errorResult('USER_PASSWORD_RESET_FORBIDDEN', 'SSO 用户不能修改密码')
  if (input.password.length < 6) return errorResult('USER_PASSWORD_TOO_SHORT', '密码长度不能小于6位')
  if (passwordScore(input.password) < 1) return errorResult('USER_PASSWORD_WEAK', '请具有弱以上的密码强度')
  const updatedAt = timestamp()
  if (!profileStore.skippedLogin && isUsableCredentialUsername(profileStore.username)) {
    const existing = findUserCredential(profileStore.username)
    await upsertUserCredential(profileStore.username, input.password, {
      updatedAt,
      requiresDeviceVerification: existing?.requiresDeviceVerification
    })
  }
  await applyProfile({ passwordUpdatedAt: updatedAt })
  return successMutation('密码重置成功')
}

export const revokeTrustedDevice = async (id: number): Promise<AiopsTrustedDeviceRevokeResult> => {
  await ensureUserAccountStateLoaded()
  const deviceId = Number(id)
  const device = trustedDeviceStore.find((item) => item.id === deviceId)
  if (!device) return errorResult('TRUSTED_DEVICE_NOT_FOUND', 'Trusted device not found.')
  if (device.current) return errorResult('TRUSTED_DEVICE_CURRENT', 'Current trusted device cannot be revoked.')
  trustedDeviceStore = trustedDeviceStore.filter((item) => item.id !== deviceId)
  persistUserAccountState()
  return {
    ok: true,
    data: {
      deviceId,
      trustedDevices: cloneTrustedDevices(),
      message: '可信设备已移除'
    }
  }
}
