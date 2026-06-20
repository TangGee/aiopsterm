import type {
  AiopsTrustedDevice,
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAccountSnapshot,
  AiopsUserAvatarPrepareResult,
  AiopsUserCodeResult,
  AiopsUserExternalAction,
  AiopsUserExternalActionResult,
  AiopsUserMutationResult,
  AiopsUserProfile
} from '@shared/contracts/userAccount'

export type UserExternalActionData = NonNullable<AiopsUserExternalActionResult['data']>
export type UserMutationData = NonNullable<AiopsUserMutationResult['data']>
export type UserCodeData = NonNullable<AiopsUserCodeResult['data']>
export type UserAvatarPrepareData = NonNullable<AiopsUserAvatarPrepareResult['data']>
export type UserTrustedDeviceRevokeData = NonNullable<AiopsTrustedDeviceRevokeResult['data']>

const userRegistrationCodes: AiopsUserProfile['registrationCode'][] = [1, 2, 3, 4, 6, 7, 9]
const userRegistrationTypes: AiopsUserProfile['registrationType'][] = ['enterprise', 'personal']
const userAuthProviders: AiopsUserProfile['authProvider'][] = ['local', 'sso', 'oauth']
const userSubscriptions: AiopsUserProfile['subscription'][] = ['free', 'pro', 'ultra']
const userLastLoginMethods: AiopsUserProfile['lastLoginMethod'][] = ['account', 'email', 'mobile', 'skip', 'external']
const userExternalActions: AiopsUserExternalAction[] = ['login', 'account-center']
const userCodeKinds: UserCodeData['kind'][] = ['email', 'mobile']
const userAvatarMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const userAvatarAssetUrlPattern = /^aiopsterm-user-avatar:\/\/[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createEmptyUserProfile = (): AiopsUserProfile => ({
  uid: 0,
  name: '',
  username: '',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'free',
  subscriptionExpiresAt: '',
  email: '',
  mobile: '',
  localIp: '',
  macAddress: '',
  isOfficeDevice: false,
  needDeviceVerification: false,
  skippedLogin: true,
  localDatabaseReady: false,
  lastLoginMethod: 'skip',
  lastLoginAt: '',
  passwordUpdatedAt: '',
  avatarUpdatedAt: ''
})

export const isUserProfileSnapshot = (source: unknown): source is AiopsUserProfile =>
  isRecord(source) &&
  typeof source.uid === 'number' &&
  Number.isInteger(source.uid) &&
  source.uid >= 0 &&
  typeof source.name === 'string' &&
  typeof source.username === 'string' &&
  typeof source.avatarInitials === 'string' &&
  typeof source.avatarImageUrl === 'string' &&
  userRegistrationTypes.includes(source.registrationType as AiopsUserProfile['registrationType']) &&
  userRegistrationCodes.includes(source.registrationCode as AiopsUserProfile['registrationCode']) &&
  userAuthProviders.includes(source.authProvider as AiopsUserProfile['authProvider']) &&
  userSubscriptions.includes(source.subscription as AiopsUserProfile['subscription']) &&
  typeof source.subscriptionExpiresAt === 'string' &&
  typeof source.email === 'string' &&
  typeof source.mobile === 'string' &&
  typeof source.localIp === 'string' &&
  typeof source.macAddress === 'string' &&
  typeof source.isOfficeDevice === 'boolean' &&
  typeof source.needDeviceVerification === 'boolean' &&
  typeof source.skippedLogin === 'boolean' &&
  typeof source.localDatabaseReady === 'boolean' &&
  userLastLoginMethods.includes(source.lastLoginMethod as AiopsUserProfile['lastLoginMethod']) &&
  typeof source.lastLoginAt === 'string' &&
  typeof source.passwordUpdatedAt === 'string' &&
  typeof source.avatarUpdatedAt === 'string'

export const isTrustedDeviceSnapshot = (source: unknown): source is AiopsTrustedDevice =>
  isRecord(source) &&
  typeof source.id === 'number' &&
  Number.isInteger(source.id) &&
  source.id > 0 &&
  typeof source.deviceName === 'string' &&
  source.deviceName.trim() !== '' &&
  typeof source.macAddress === 'string' &&
  typeof source.lastLoginIp === 'string' &&
  typeof source.location === 'string' &&
  typeof source.lastLoginUserAgent === 'string' &&
  typeof source.current === 'boolean'

export const isUserAccountSnapshot = (source: unknown): source is AiopsUserAccountSnapshot =>
  isRecord(source) && isUserProfileSnapshot(source.profile) && Array.isArray(source.trustedDevices) && source.trustedDevices.every(isTrustedDeviceSnapshot)

export const isUserMutationData = (source: unknown): source is UserMutationData => {
  if (!isRecord(source) || !isUserAccountSnapshot(source)) return false
  return typeof (source as Record<string, unknown>).message === 'string'
}

export const isHttpUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('//')) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname.trim()) && !url.username && !url.password
  } catch {
    return false
  }
}

export const isUserExternalActionData = (source: unknown, action: AiopsUserExternalAction): source is UserExternalActionData =>
  isRecord(source) &&
  source.action === action &&
  userExternalActions.includes(source.action as AiopsUserExternalAction) &&
  isHttpUrl(source.url) &&
  source.opened === true &&
  typeof source.openedAt === 'string' &&
  source.openedAt.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

export const isUserCodeData = (source: unknown): source is UserCodeData =>
  isRecord(source) &&
  typeof source.challengeId === 'string' &&
  /^[a-f0-9]{16,64}$/i.test(source.challengeId) &&
  userCodeKinds.includes(source.kind as UserCodeData['kind']) &&
  typeof source.target === 'string' &&
  source.target.trim() !== '' &&
  typeof source.countdownSeconds === 'number' &&
  Number.isFinite(source.countdownSeconds) &&
  source.countdownSeconds >= 0 &&
  typeof source.remainingSeconds === 'number' &&
  Number.isFinite(source.remainingSeconds) &&
  source.remainingSeconds >= 0 &&
  typeof source.expiresAt === 'number' &&
  Number.isFinite(source.expiresAt) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

export const normalizeUserCodeTarget = (kind: UserCodeData['kind'], value: string) => {
  const normalized = value.trim()
  return kind === 'email' ? normalized.toLowerCase() : normalized
}

export const isUserCodeDataForRequest = (source: unknown, kind: UserCodeData['kind'], value: string): source is UserCodeData =>
  isUserCodeData(source) && source.kind === kind && normalizeUserCodeTarget(source.kind, source.target) === normalizeUserCodeTarget(kind, value)

export const isUserAvatarPrepareData = (source: unknown): source is UserAvatarPrepareData =>
  isRecord(source) &&
  typeof source.filePath === 'string' &&
  source.filePath.trim() !== '' &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  typeof source.mimeType === 'string' &&
  userAvatarMimeTypes.includes(source.mimeType) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size > 0 &&
  typeof source.dataUrl === 'string' &&
  /^data:image\/[a-z0-9.+-]+;base64,/i.test(source.dataUrl) &&
  typeof source.avatarImageUrl === 'string' &&
  userAvatarAssetUrlPattern.test(source.avatarImageUrl) &&
  typeof source.assetFileName === 'string' &&
  /^[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i.test(source.assetFileName) &&
  source.avatarImageUrl === `aiopsterm-user-avatar://${source.assetFileName}` &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

export const isTrustedDeviceRevokeData = (source: unknown): source is UserTrustedDeviceRevokeData =>
  isRecord(source) &&
  typeof source.deviceId === 'number' &&
  Number.isInteger(source.deviceId) &&
  source.deviceId > 0 &&
  Array.isArray(source.trustedDevices) &&
  source.trustedDevices.every(isTrustedDeviceSnapshot) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''
