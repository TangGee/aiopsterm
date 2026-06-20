import type { AiopsMutationResult } from './common'

export type AiopsUserRegistrationCode = 1 | 2 | 3 | 4 | 6 | 7 | 9

export type AiopsUserLastLoginMethod = 'account' | 'email' | 'mobile' | 'skip' | 'external'

export type AiopsUserProfile = {
  uid: number
  name: string
  username: string
  avatarInitials: string
  avatarImageUrl: string
  registrationType: 'enterprise' | 'personal'
  registrationCode: AiopsUserRegistrationCode
  authProvider: 'local' | 'sso' | 'oauth'
  subscription: 'free' | 'pro' | 'ultra'
  subscriptionExpiresAt: string
  email: string
  mobile: string
  localIp: string
  macAddress: string
  isOfficeDevice: boolean
  needDeviceVerification: boolean
  skippedLogin: boolean
  localDatabaseReady: boolean
  lastLoginMethod: AiopsUserLastLoginMethod
  lastLoginAt: string
  passwordUpdatedAt: string
  avatarUpdatedAt: string
}

export type AiopsTrustedDevice = {
  id: number
  deviceName: string
  macAddress: string
  lastLoginIp: string
  location: string
  lastLoginUserAgent: string
  current: boolean
}

export type AiopsUserAccountSnapshot = {
  profile: AiopsUserProfile
  trustedDevices: AiopsTrustedDevice[]
}

export type AiopsUserLoginInput =
  | { method: 'account'; username: string; password: string }
  | { method: 'email'; email: string; code: string }
  | { method: 'mobile'; mobile: string; code: string }

export type AiopsUserProfileUpdateInput = Partial<Pick<AiopsUserProfile, 'name' | 'username' | 'avatarInitials' | 'avatarImageUrl'>>

export type AiopsUserAvatarPrepareInput = {
  filePath: string
}

export type AiopsUserAvatarPrepareResult = AiopsMutationResult<{
  filePath: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
  avatarImageUrl: string
  assetFileName: string
  message: string
}>

export type AiopsUserCodeInput = {
  kind: 'email' | 'mobile'
  value: string
}

export type AiopsUserContactBindInput = AiopsUserCodeInput & {
  code: string
}

export type AiopsUserDeactivateInput = {
  uid: number
}

export type AiopsUserPasswordInput = {
  password: string
}

export type AiopsUserAccountResult = AiopsMutationResult<AiopsUserAccountSnapshot>

export type AiopsUserMutationResult = AiopsMutationResult<AiopsUserAccountSnapshot & { message: string }>

export type AiopsUserExternalAction = 'login' | 'account-center'

export type AiopsUserExternalActionResult = AiopsMutationResult<{
  action: AiopsUserExternalAction
  url: string
  opened: true
  openedAt: string
  message: string
}>

export type AiopsUserCodeResult = AiopsMutationResult<{
  challengeId: string
  kind: 'email' | 'mobile'
  target: string
  countdownSeconds: number
  remainingSeconds: number
  expiresAt: number
  message: string
}>

export type AiopsTrustedDeviceRevokeResult = AiopsMutationResult<{
  deviceId: number
  trustedDevices: AiopsTrustedDevice[]
  message: string
}>
