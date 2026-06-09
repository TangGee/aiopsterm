import type {
  AiopsMutationResult,
  AiopsTrustedDevice,
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAvatarPrepareInput,
  AiopsUserAvatarPrepareResult,
  AiopsUserAccountResult,
  AiopsUserAccountSnapshot,
  AiopsUserCodeInput,
  AiopsUserCodeResult,
  AiopsUserContactBindInput,
  AiopsUserLoginInput,
  AiopsUserMutationResult,
  AiopsUserPasswordInput,
  AiopsUserProfile,
  AiopsUserProfileUpdateInput
} from '@shared/preload'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'

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

let profileStore: AiopsUserProfile = { ...defaultUserProfile }
let trustedDeviceStore: AiopsTrustedDevice[] = defaultTrustedDevices.map((device) => ({ ...device }))

type UserCodeCooldownScope = 'login' | 'contact'
type UserCodeKind = AiopsUserCodeInput['kind']
type UserCodeCooldown = {
  expiresAt: number
}

const userCodeCooldownMs = 300_000
const userCodeCooldowns = new Map<string, UserCodeCooldown>()

const cloneProfile = (profile: AiopsUserProfile = profileStore): AiopsUserProfile => ({ ...profile })

const cloneTrustedDevices = (devices: AiopsTrustedDevice[] = trustedDeviceStore) => devices.map((device) => ({ ...device }))

const snapshot = (): AiopsUserAccountSnapshot => ({
  profile: cloneProfile(),
  trustedDevices: cloneTrustedDevices()
})

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

const maxAvatarBytes = 2 * 1024 * 1024

const userCodeCooldownKey = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string) =>
  [scope, kind, kind === 'email' ? target.toLowerCase() : target].join(':')

const remainingCodeCooldownSeconds = (expiresAt: number, now = Date.now()) => Math.max(0, Math.ceil((expiresAt - now) / 1000))

const clearUserCodeCooldown = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string) => {
  userCodeCooldowns.delete(userCodeCooldownKey(scope, kind, target))
}

const issueUserCodeCooldown = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string, message: string): AiopsUserCodeResult => {
  const now = Date.now()
  const key = userCodeCooldownKey(scope, kind, target)
  const active = userCodeCooldowns.get(key)
  const activeRemainingSeconds = active ? remainingCodeCooldownSeconds(active.expiresAt, now) : 0
  const expiresAt = activeRemainingSeconds > 0 ? active!.expiresAt : now + userCodeCooldownMs
  const remainingSeconds = activeRemainingSeconds > 0 ? activeRemainingSeconds : remainingCodeCooldownSeconds(expiresAt, now)

  if (activeRemainingSeconds <= 0) {
    userCodeCooldowns.set(key, { expiresAt })
  }

  return {
    ok: true,
    data: {
      kind,
      target,
      countdownSeconds: remainingSeconds,
      remainingSeconds,
      expiresAt,
      message: activeRemainingSeconds > 0 ? `验证码已发送，请 ${remainingSeconds} 秒后重试` : message
    }
  }
}

const avatarMimeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

const avatarMimeFromHeader = (buffer: Buffer, filePath: string) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const gifHeader = buffer.subarray(0, 6).toString('ascii')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  const extensionMime = avatarMimeByExtension[extname(filePath).toLowerCase()] || ''
  if (extensionMime === 'image/svg+xml') {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf-8').trimStart().toLowerCase()
    if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return extensionMime
  }
  return ''
}

const passwordScore = (password: string) => {
  if (!password) return 0
  let score = password.length >= 8 ? 1 : 0
  if (/[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

const applyProfile = (patch: Partial<AiopsUserProfile>) => {
  profileStore = {
    ...profileStore,
    ...patch
  }
}

const loginProfile = (patch: Partial<AiopsUserProfile>) => {
  applyProfile({
    ...patch,
    skippedLogin: false,
    needDeviceVerification: patch.needDeviceVerification ?? false,
    localDatabaseReady: true,
    lastLoginAt: timestamp()
  })
}

const successMutation = (message: string): AiopsUserMutationResult => ({
  ok: true,
  data: {
    ...snapshot(),
    message
  }
})

export const resetUserAccountForTests = () => {
  profileStore = { ...defaultUserProfile }
  trustedDeviceStore = defaultTrustedDevices.map((device) => ({ ...device }))
  userCodeCooldowns.clear()
}

export const patchUserAccountForTests = (patch: Partial<AiopsUserProfile>) => {
  applyProfile(patch)
}

export const getUserAccount = (): AiopsUserAccountResult => ({
  ok: true,
  data: snapshot()
})

export const openUserLogin = (): AiopsUserMutationResult => {
  applyProfile({
    skippedLogin: true
  })
  return successMutation('已打开本地登录页')
}

export const loginUserAccount = (input: AiopsUserLoginInput): AiopsUserMutationResult => {
  if (input.method === 'account') {
    const username = trimText(input.username)
    if (!username || !input.password) return errorResult('USER_LOGIN_REQUIRED', '请输入用户名和密码')
    if (username.toLowerCase().includes('verify')) {
      applyProfile({
        needDeviceVerification: true,
        localDatabaseReady: false
      })
      return {
        ok: false,
        data: {
          ...snapshot(),
          message: '当前设备需要验证后才能登录'
        },
        errorCode: 'USER_DEVICE_VERIFICATION_REQUIRED',
        errorMessage: '当前设备需要验证后才能登录'
      }
    }
    loginProfile({
      username,
      name: profileStore.name || username,
      authProvider: 'local',
      registrationCode: 9,
      lastLoginMethod: 'account'
    })
    return successMutation('账号登录成功，本地数据库初始化完成')
  }

  if (input.method === 'email') {
    const email = trimText(input.email)
    if (!email || !trimText(input.code)) return errorResult('USER_EMAIL_LOGIN_REQUIRED', '请输入邮箱和验证码')
    if (!isValidEmail(email)) return errorResult('USER_EMAIL_INVALID', '邮箱格式不正确')
    loginProfile({
      email,
      username: email.split('@')[0] || profileStore.username,
      authProvider: 'local',
      registrationCode: 2,
      lastLoginMethod: 'email'
    })
    clearUserCodeCooldown('login', 'email', email)
    return successMutation('邮箱登录成功，本地数据库初始化完成')
  }

  const mobile = trimText(input.mobile)
  if (!mobile || !trimText(input.code)) return errorResult('USER_MOBILE_LOGIN_REQUIRED', '请输入手机号和验证码')
  if (!isValidMobile(mobile)) return errorResult('USER_MOBILE_INVALID', '手机号格式不正确')
  loginProfile({
    mobile,
    authProvider: 'local',
    registrationCode: 7,
    lastLoginMethod: 'mobile'
  })
  clearUserCodeCooldown('login', 'mobile', mobile)
  return successMutation('手机号登录成功，本地数据库初始化完成')
}

export const logoutUserAccount = (): AiopsUserMutationResult => {
  applyProfile({
    skippedLogin: true,
    localDatabaseReady: false,
    needDeviceVerification: false
  })
  return successMutation('已退出登录')
}

export const skipUserLogin = (): AiopsUserMutationResult => {
  loginProfile({
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
  return issueUserCodeCooldown('login', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}登录验证码已发送`)
}

export const prepareUserAvatarImage = async (input: AiopsUserAvatarPrepareInput): Promise<AiopsUserAvatarPrepareResult> => {
  const filePath = trimText(input?.filePath)
  if (!filePath) return errorResult('USER_AVATAR_PATH_REQUIRED', '请选择头像图片')
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return errorResult('USER_AVATAR_NOT_FILE', '请选择图片文件')
    if (info.size <= 0) return errorResult('USER_AVATAR_EMPTY', '头像图片不能为空')
    if (info.size > maxAvatarBytes) return errorResult('USER_AVATAR_TOO_LARGE', '头像图片不能超过 2MB')
    const content = await readFile(filePath)
    const mimeType = avatarMimeFromHeader(content, filePath)
    if (!mimeType) return errorResult('USER_AVATAR_INVALID_IMAGE', '请选择图片文件')
    return {
      ok: true,
      data: {
        filePath,
        name: basename(filePath),
        mimeType,
        size: content.byteLength,
        dataUrl: `data:${mimeType};base64,${content.toString('base64')}`,
        message: '头像图片已读取'
      }
    }
  } catch (error) {
    return errorResult('USER_AVATAR_READ_FAILED', error instanceof Error ? error.message : '图片读取失败')
  }
}

const validateProfileUpdate = (input: AiopsUserProfileUpdateInput) => {
  const username = trimText(input.username ?? profileStore.username)
  const name = trimText(input.name ?? profileStore.name)
  if (!username || username.length < 6 || username.length > 20) return '用户名长度需要在 6 到 20 个字符之间'
  if (!/^[A-Za-z0-9_]+$/.test(username)) return '用户名仅支持字母、数字和下划线'
  if (!name || name.length > 20) return '姓名不能为空且不能超过 20 个字符'
  return ''
}

export const updateUserProfile = (input: AiopsUserProfileUpdateInput): AiopsUserMutationResult => {
  const validation = validateProfileUpdate(input)
  if (validation) return errorResult('USER_PROFILE_INVALID', validation)
  const nextAvatarInitials = trimText(input.avatarInitials).toUpperCase().slice(0, 3)
  const avatarChanged = input.avatarImageUrl !== undefined || input.avatarInitials !== undefined
  applyProfile({
    ...input,
    name: input.name !== undefined ? trimText(input.name) : profileStore.name,
    username: input.username !== undefined ? trimText(input.username) : profileStore.username,
    avatarInitials: nextAvatarInitials || profileStore.avatarInitials,
    avatarUpdatedAt: avatarChanged ? timestamp() : profileStore.avatarUpdatedAt
  })
  return successMutation(avatarChanged ? '头像更新成功' : '个人信息已保存')
}

const canEditMobile = () => profileStore.registrationCode !== 7
const canEditEmail = () => ![2, 3, 4, 6].includes(profileStore.registrationCode)
const canResetPassword = () => profileStore.registrationCode !== 1 && profileStore.authProvider !== 'sso'

const validateContact = (kind: 'email' | 'mobile', value: string) => {
  if (kind === 'email') {
    if (!canEditEmail()) return '当前登录方式不允许修改邮箱'
    if (!isValidEmail(value)) return '邮箱格式不正确'
    return ''
  }
  if (!canEditMobile()) return '当前登录方式不允许修改手机号'
  if (!isValidMobile(value)) return '手机号格式不正确'
  return ''
}

export const sendUserContactCode = (input: AiopsUserCodeInput): AiopsUserCodeResult => {
  const value = trimText(input.value)
  const validation = validateContact(input.kind, value)
  if (validation) return errorResult(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
  return issueUserCodeCooldown('contact', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}验证码已发送`)
}

export const bindUserContact = (input: AiopsUserContactBindInput): AiopsUserMutationResult => {
  const value = trimText(input.value)
  const validation = validateContact(input.kind, value)
  if (validation) return errorResult(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
  if (!trimText(input.code)) return errorResult('USER_CONTACT_CODE_REQUIRED', `请输入${input.kind === 'email' ? '邮箱' : '手机'}验证码`)
  applyProfile({ [input.kind]: value })
  clearUserCodeCooldown('contact', input.kind, value)
  return successMutation(input.kind === 'email' ? '邮箱绑定成功' : '手机号绑定成功')
}

export const resetUserPassword = (input: AiopsUserPasswordInput): AiopsUserMutationResult => {
  if (!canResetPassword()) return errorResult('USER_PASSWORD_RESET_FORBIDDEN', 'SSO 用户不能修改密码')
  if (input.password.length < 6) return errorResult('USER_PASSWORD_TOO_SHORT', '密码长度不能小于6位')
  if (passwordScore(input.password) < 1) return errorResult('USER_PASSWORD_WEAK', '请具有弱以上的密码强度')
  applyProfile({ passwordUpdatedAt: timestamp() })
  return successMutation('密码重置成功')
}

export const revokeTrustedDevice = (id: number): AiopsTrustedDeviceRevokeResult => {
  const deviceId = Number(id)
  const device = trustedDeviceStore.find((item) => item.id === deviceId)
  if (!device) return errorResult('TRUSTED_DEVICE_NOT_FOUND', 'Trusted device not found.')
  if (device.current) return errorResult('TRUSTED_DEVICE_CURRENT', 'Current trusted device cannot be revoked.')
  trustedDeviceStore = trustedDeviceStore.filter((item) => item.id !== deviceId)
  return {
    ok: true,
    data: {
      deviceId,
      trustedDevices: cloneTrustedDevices(),
      message: '可信设备已移除'
    }
  }
}
