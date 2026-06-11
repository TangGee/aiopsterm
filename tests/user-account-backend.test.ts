import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type UserBackend = {
  configureUserAccountBackendRuntime: (config?: { stateFilePath?: string; useSeedData?: boolean }) => void
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
const tempDirs: string[] = []

beforeAll(async () => {
  const modulePath = '../src/main/backend/userAccount'
  backend = (await import(modulePath)) as UserBackend
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const expectOkData = <T extends { ok: boolean; data?: unknown }>(result: T) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as NonNullable<T['data']> & Record<string, any>
}

describe('user account backend boundary', () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-'))
    tempDirs.push(dir)
    backend.configureUserAccountBackendRuntime({ stateFilePath: join(dir, 'user-account.json'), useSeedData: true })
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

      const result = backend.sendUserLoginCode({ kind: 'email', value: '  login@example.local  ' })
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

    const mobileCode = backend.sendUserContactCode({ kind: 'mobile', value: '  13800000002  ' })
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

  it('does not expose development seed trusted devices in non-seed runtime defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-nonseed-'))
    tempDirs.push(dir)
    backend.configureUserAccountBackendRuntime({ stateFilePath: join(dir, 'user-account.json'), useSeedData: false })
    backend.resetUserAccountForTests()

    const data = expectOkData(backend.getUserAccount())

    expect(data.profile).toMatchObject({
      uid: 0,
      subscription: 'free',
      skippedLogin: true,
      localDatabaseReady: false,
      lastLoginMethod: 'skip'
    })
    expect(data.profile.email).toBe('')
    expect(data.profile.mobile).toBe('')
    expect(data.trustedDevices).toHaveLength(1)
    expect(data.trustedDevices[0]).toMatchObject({ id: 1, current: true })
    expect(data.trustedDevices.some((device: { deviceName: string }) => device.deviceName === 'MacBook')).toBe(false)
  })

  it('strips unmodified legacy seed profile and trusted devices in non-seed runtime state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-legacy-seed-empty-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'user-account.json')
    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: true })
    backend.resetUserAccountForTests()
    expectOkData(backend.updateUserProfile({ username: 'local_ops', name: 'Local Operator' }))

    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: false })
    const data = expectOkData(backend.getUserAccount())

    expect(data.profile).toMatchObject({
      uid: 0,
      subscription: 'free',
      skippedLogin: true,
      localDatabaseReady: false,
      lastLoginMethod: 'skip'
    })
    expect(data.profile.name).not.toBe('Local Operator')
    expect(data.profile.email).toBe('')
    expect(data.profile.mobile).toBe('')
    expect(data.trustedDevices).toHaveLength(1)
    expect(data.trustedDevices[0]).toMatchObject({ id: 1, current: true })
    expect(data.trustedDevices[0].deviceName).not.toBe('Linux Workstation')
    expect(JSON.parse(await readFile(stateFilePath, 'utf-8'))).toMatchObject({
      profile: expect.objectContaining({
        uid: 0,
        subscription: 'free',
        skippedLogin: true,
        localDatabaseReady: false
      }),
      trustedDevices: [expect.objectContaining({ id: 1, current: true })]
    })
  })

  it('preserves user-edited seed-derived account rows while stripping unchanged seed devices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-legacy-seed-edited-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'user-account.json')
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        profile: {
          uid: 2001007,
          name: 'Ops Owner',
          username: 'ops_owner',
          avatarInitials: 'OO',
          avatarImageUrl: '',
          registrationType: 'personal',
          registrationCode: 9,
          authProvider: 'local',
          subscription: 'pro',
          subscriptionExpiresAt: '2026-12-31',
          email: 'owner@example.local',
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
        },
        trustedDevices: [
          {
            id: 1,
            deviceName: 'Primary Ops Workstation',
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
      }),
      'utf-8'
    )

    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: false })
    const data = expectOkData(backend.getUserAccount())

    expect(data.profile).toMatchObject({
      uid: 2001007,
      name: 'Ops Owner',
      username: 'ops_owner',
      email: 'owner@example.local',
      subscription: 'pro',
      skippedLogin: false
    })
    expect(data.trustedDevices).toEqual([
      expect.objectContaining({
        id: 1,
        deviceName: 'Primary Ops Workstation',
        current: true
      })
    ])
    expect(JSON.parse(await readFile(stateFilePath, 'utf-8')).trustedDevices).toEqual([
      expect.objectContaining({
        id: 1,
        deviceName: 'Primary Ops Workstation',
        current: true
      })
    ])
  })

  it('persists account mutations and restores profile plus trusted devices through the backend store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-persist-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'user-account.json')
    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: true })
    backend.resetUserAccountForTests()

    expectOkData(backend.loginUserAccount({ method: 'account', username: 'ops_login', password: 'secret' }))
    expectOkData(backend.updateUserProfile({ name: 'Ops Lead', username: 'ops_lead', avatarInitials: 'ol' }))
    expectOkData(backend.bindUserContact({ kind: 'email', value: 'ops@example.local', code: '123456' }))
    expectOkData(backend.resetUserPassword({ password: 'Aa123456!' }))
    expectOkData(backend.revokeTrustedDevice(2))

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      profile: { name: string; username: string; email: string; passwordUpdatedAt: string; avatarInitials: string }
      trustedDevices: Array<{ id: number; deviceName: string }>
    }
    expect(persisted.profile).toMatchObject({
      name: 'Ops Lead',
      username: 'ops_lead',
      email: 'ops@example.local',
      avatarInitials: 'OL'
    })
    expect(persisted.profile.passwordUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(persisted.trustedDevices.map((device) => device.id)).toEqual([1])

    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: true })
    const restored = expectOkData(backend.getUserAccount())

    expect(restored.profile).toMatchObject({
      name: 'Ops Lead',
      username: 'ops_lead',
      email: 'ops@example.local',
      avatarInitials: 'OL',
      lastLoginMethod: 'account',
      localDatabaseReady: true
    })
    expect(restored.profile.passwordUpdatedAt).toBe(persisted.profile.passwordUpdatedAt)
    expect(restored.trustedDevices.map((device: { id: number }) => device.id)).toEqual([1])
  })

  it('normalizes malformed persisted account state instead of leaking invalid client data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-malformed-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'user-account.json')
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        profile: {
          name: '  Restored User  ',
          username: '',
          email: 'not-an-email',
          mobile: '10000000000',
          registrationCode: 99,
          authProvider: 'remote',
          subscription: 'lifetime',
          needDeviceVerification: true,
          localDatabaseReady: true
        },
        trustedDevices: [
          { id: 5, deviceName: 'Recovered Workstation', current: false },
          { id: 5, deviceName: 'Duplicate Id Device', current: true }
        ]
      }),
      'utf-8'
    )

    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: true })
    const restored = expectOkData(backend.getUserAccount())

    expect(restored.profile).toMatchObject({
      name: 'Restored User',
      username: 'local_ops',
      email: 'operator@example.local',
      mobile: '13800000000',
      registrationCode: 9,
      authProvider: 'local',
      subscription: 'pro',
      needDeviceVerification: false,
      localDatabaseReady: true
    })
    expect(restored.trustedDevices).toEqual([
      expect.objectContaining({ id: 5, deviceName: 'Recovered Workstation', current: false }),
      expect.objectContaining({ id: 6, deviceName: 'Duplicate Id Device', current: true })
    ])
  })

  it('falls back to backend-owned defaults when persisted account state is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-user-account-corrupt-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'user-account.json')
    await writeFile(stateFilePath, '{bad json', 'utf-8')

    backend.configureUserAccountBackendRuntime({ stateFilePath, useSeedData: true })
    const restored = expectOkData(backend.getUserAccount())

    expect(restored.profile).toMatchObject({
      name: 'Local Operator',
      username: 'local_ops'
    })
    expect(restored.trustedDevices.map((device: { deviceName: string }) => device.deviceName)).toEqual(['Linux Workstation', 'MacBook'])
  })
})
