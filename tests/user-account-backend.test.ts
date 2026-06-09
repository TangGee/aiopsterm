import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type UserBackend = {
  resetUserAccountForTests: () => void
  patchUserAccountForTests: (patch: Record<string, unknown>) => void
  getUserAccount: () => any
  openUserLogin: () => any
  loginUserAccount: (input: any) => any
  logoutUserAccount: () => any
  skipUserLogin: () => any
  sendUserLoginCode: (input: any) => any
  prepareUserAvatarImage: (input: any) => Promise<any>
  updateUserProfile: (input: any) => any
  sendUserContactCode: (input: any) => any
  bindUserContact: (input: any) => any
  resetUserPassword: (input: any) => any
  revokeTrustedDevice: (id: number) => any
}

let backend: UserBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/userAccount'
  backend = (await import(modulePath)) as UserBackend
})

const expectOkData = <T extends { ok: boolean; data?: unknown }>(result: T) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as NonNullable<T['data']> & Record<string, any>
}

describe('user account backend boundary', () => {
  beforeEach(() => {
    backend.resetUserAccountForTests()
  })

  it('returns backend-owned profile and trusted device snapshots', () => {
    const result = backend.getUserAccount()

    const data = expectOkData(result)
    expect(data.profile).toMatchObject({
      name: 'Local Operator',
      username: 'local_ops',
      registrationCode: 9,
      localDatabaseReady: true
    })
    expect(data.trustedDevices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, deviceName: 'Linux Workstation', current: true }),
        expect.objectContaining({ id: 2, deviceName: 'MacBook', current: false })
      ])
    )
  })

  it('keeps device verification state behind the login boundary', () => {
    const result = backend.loginUserAccount({ method: 'account', username: 'verify-device', password: 'secret' })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('USER_DEVICE_VERIFICATION_REQUIRED')
    expect(result.data?.profile).toMatchObject({
      needDeviceVerification: true,
      localDatabaseReady: false
    })
  })

  it('updates profile identity from account, email, mobile, and skip login methods', () => {
    expect(backend.loginUserAccount({ method: 'account', username: '', password: '' })).toEqual({
      ok: false,
      errorCode: 'USER_LOGIN_REQUIRED',
      errorMessage: '请输入用户名和密码'
    })

    const account = backend.loginUserAccount({ method: 'account', username: 'ops_login', password: 'secret' })
    expect(expectOkData(account).profile).toMatchObject({
      username: 'ops_login',
      registrationCode: 9,
      lastLoginMethod: 'account',
      localDatabaseReady: true
    })

    const email = backend.loginUserAccount({ method: 'email', email: 'login@example.local', code: '246810' })
    expect(expectOkData(email).profile).toMatchObject({
      email: 'login@example.local',
      username: 'login',
      registrationCode: 2,
      lastLoginMethod: 'email'
    })

    const mobile = backend.loginUserAccount({ method: 'mobile', mobile: '13800000001', code: '135790' })
    expect(expectOkData(mobile).profile).toMatchObject({
      mobile: '13800000001',
      registrationCode: 7,
      lastLoginMethod: 'mobile'
    })

    const guest = backend.skipUserLogin()
    expect(expectOkData(guest).profile).toMatchObject({
      uid: 999999999,
      username: 'guest',
      lastLoginMethod: 'skip'
    })
  })

  it('validates login code targets before issuing backend-owned cooldowns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-09T10:00:00Z'))

    try {
      expect(backend.sendUserLoginCode({ kind: 'email', value: 'bad' })).toEqual({
        ok: false,
        errorCode: 'USER_EMAIL_INVALID',
        errorMessage: '邮箱格式不正确'
      })
      expect(backend.sendUserLoginCode({ kind: 'mobile', value: '10000000000' })).toEqual({
        ok: false,
        errorCode: 'USER_MOBILE_INVALID',
        errorMessage: '手机号格式不正确'
      })

      const result = backend.sendUserLoginCode({ kind: 'email', value: 'login@example.local' })
      const first = expectOkData(result)
      expect(first).toMatchObject({
        kind: 'email',
        target: 'login@example.local',
        countdownSeconds: 300,
        remainingSeconds: 300,
        message: '邮箱登录验证码已发送'
      })
      expect(first.expiresAt).toBe(Date.now() + 300_000)

      vi.advanceTimersByTime(60_000)
      const repeated = expectOkData(backend.sendUserLoginCode({ kind: 'email', value: 'login@example.local' }))
      expect(repeated.expiresAt).toBe(first.expiresAt)
      expect(repeated.countdownSeconds).toBe(240)
      expect(repeated.remainingSeconds).toBe(240)
      expect(repeated.message).toBe('验证码已发送，请 240 秒后重试')

      const contact = expectOkData(backend.sendUserContactCode({ kind: 'email', value: 'login@example.local' }))
      expect(contact.expiresAt).toBe(Date.now() + 300_000)
      expect(contact.expiresAt).not.toBe(first.expiresAt)

      expect(expectOkData(backend.loginUserAccount({ method: 'email', email: 'login@example.local', code: '246810' })).profile.email).toBe(
        'login@example.local'
      )
      const afterLogin = expectOkData(backend.sendUserLoginCode({ kind: 'email', value: 'login@example.local' }))
      expect(afterLogin.expiresAt).toBe(Date.now() + 300_000)
      expect(afterLogin.expiresAt).not.toBe(first.expiresAt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('validates and applies profile edits through backend-owned mutations', () => {
    expect(backend.updateUserProfile({ username: 'bad-name!' })).toEqual({
      ok: false,
      errorCode: 'USER_PROFILE_INVALID',
      errorMessage: '用户名仅支持字母、数字和下划线'
    })

    const result = backend.updateUserProfile({ name: '  Ops Lead  ', username: 'ops_lead', avatarInitials: 'ol' })
    const data = expectOkData(result)
    expect(data.profile).toMatchObject({
      name: 'Ops Lead',
      username: 'ops_lead',
      avatarInitials: 'OL'
    })
    expect(data.message).toBe('头像更新成功')
  })

  it('prepares local avatar images through the backend file boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-avatar-'))
    const filePath = join(dir, 'avatar.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

    try {
      await writeFile(filePath, bytes)
      const result = await backend.prepareUserAvatarImage({ filePath })

      const data = expectOkData(result)
      expect(data).toMatchObject({
        filePath,
        name: 'avatar.png',
        mimeType: 'image/png',
        size: bytes.byteLength,
        message: '头像图片已读取'
      })
      expect(data.dataUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects non-image avatar files before profile mutation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-avatar-invalid-'))
    const filePath = join(dir, 'avatar.txt')

    try {
      await writeFile(filePath, 'not an image')
      const result = await backend.prepareUserAvatarImage({ filePath })

      expect(result).toEqual({
        ok: false,
        errorCode: 'USER_AVATAR_INVALID_IMAGE',
        errorMessage: '请选择图片文件'
      })
      expect(backend.getUserAccount().data?.profile.avatarImageUrl).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('enforces contact binding gates based on the current login registration code', () => {
    backend.loginUserAccount({ method: 'email', email: 'login@example.local', code: '246810' })

    expect(backend.sendUserContactCode({ kind: 'email', value: 'ops@example.local' })).toEqual({
      ok: false,
      errorCode: 'USER_EMAIL_INVALID',
      errorMessage: '当前登录方式不允许修改邮箱'
    })

    const mobileCode = backend.sendUserContactCode({ kind: 'mobile', value: '13800000002' })
    expect(expectOkData(mobileCode)).toMatchObject({
      target: '13800000002',
      countdownSeconds: 300,
      remainingSeconds: 300,
      message: '手机验证码已发送'
    })

    const bindMissingCode = backend.bindUserContact({ kind: 'mobile', value: '13800000002', code: '' })
    expect(bindMissingCode).toEqual({
      ok: false,
      errorCode: 'USER_CONTACT_CODE_REQUIRED',
      errorMessage: '请输入手机验证码'
    })

    const bound = backend.bindUserContact({ kind: 'mobile', value: '13800000002', code: '123456' })
    expect(expectOkData(bound).profile.mobile).toBe('13800000002')

    backend.loginUserAccount({ method: 'mobile', mobile: '13800000003', code: '135790' })
    expect(backend.sendUserContactCode({ kind: 'mobile', value: '13800000004' })).toEqual({
      ok: false,
      errorCode: 'USER_MOBILE_INVALID',
      errorMessage: '当前登录方式不允许修改手机号'
    })
  })

  it('enforces password reset gates and records password update timestamps', () => {
    backend.patchUserAccountForTests({ authProvider: 'sso' })
    expect(backend.resetUserPassword({ password: 'Aa123456!' })).toEqual({
      ok: false,
      errorCode: 'USER_PASSWORD_RESET_FORBIDDEN',
      errorMessage: 'SSO 用户不能修改密码'
    })

    backend.patchUserAccountForTests({ authProvider: 'local' })
    expect(backend.resetUserPassword({ password: '12345' })).toEqual({
      ok: false,
      errorCode: 'USER_PASSWORD_TOO_SHORT',
      errorMessage: '密码长度不能小于6位'
    })

    const result = backend.resetUserPassword({ password: 'Aa123456!' })
    expect(expectOkData(result).profile.passwordUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('rejects current trusted device revocation and removes non-current devices', () => {
    expect(backend.revokeTrustedDevice(1)).toEqual({
      ok: false,
      errorCode: 'TRUSTED_DEVICE_CURRENT',
      errorMessage: 'Current trusted device cannot be revoked.'
    })

    const result = backend.revokeTrustedDevice(2)
    const data = expectOkData(result)
    expect(data).toMatchObject({
      deviceId: 2,
      message: '可信设备已移除'
    })
    expect(data.trustedDevices.map((device: { id: number }) => device.id)).toEqual([1])
  })
})
