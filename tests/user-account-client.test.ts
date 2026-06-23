import { afterEach, describe, expect, it, vi } from 'vitest'
import { userAccountClient } from '@/services/user/userAccountClient'
import type {
  AiopsTrustedDevice,
  AiopsUserAccountSnapshot,
  AiopsUserAvatarPrepareResult,
  AiopsUserCodeResult,
  AiopsUserExternalActionResult,
  AiopsUserMutationResult,
  AiopsUserProfile
} from '@shared/contracts/userAccount'

const originalAiops = window.aiops

const userProfile: AiopsUserProfile = {
  uid: 42,
  name: 'Ops User',
  username: 'ops',
  avatarInitials: 'OU',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 1,
  authProvider: 'local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-12-31T00:00:00.000Z',
  email: 'ops@example.com',
  mobile: '+8613800000000',
  localIp: '127.0.0.1',
  macAddress: '00:11:22:33:44:55',
  isOfficeDevice: true,
  needDeviceVerification: false,
  skippedLogin: false,
  localDatabaseReady: true,
  lastLoginMethod: 'account',
  lastLoginAt: '2026-06-20T00:00:00.000Z',
  passwordUpdatedAt: '2026-06-20T00:00:00.000Z',
  avatarUpdatedAt: '2026-06-20T00:00:00.000Z'
}

const trustedDevice: AiopsTrustedDevice = {
  id: 7,
  deviceName: 'Workstation',
  macAddress: '00:11:22:33:44:55',
  lastLoginIp: '127.0.0.1',
  location: 'Local',
  lastLoginUserAgent: 'Vitest',
  current: false
}

const accountSnapshot: AiopsUserAccountSnapshot = {
  profile: userProfile,
  trustedDevices: [trustedDevice]
}

const mutationResult = (message: string, snapshot: AiopsUserAccountSnapshot = accountSnapshot): AiopsUserMutationResult => ({
  ok: true,
  data: {
    ...snapshot,
    message
  }
})

const externalActionResult = (action: 'login' | 'account-center', message: string): AiopsUserExternalActionResult => ({
  ok: true,
  data: {
    action,
    url: `aiopsterm://${action}`,
    opened: true,
    openedAt: '2026-06-20T00:00:00.000Z',
    message
  }
})

afterEach(() => {
  window.aiops = originalAiops
})

describe('userAccountClient', () => {
  it('returns undefined for unavailable bridge methods and binds User Account bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      getUserAccount: vi.fn(async () => ({ ok: true, data: accountSnapshot })),
      openUserLogin: vi.fn(async () => externalActionResult('login', 'login opened')),
      openUserAccountCenter: vi.fn(async () => externalActionResult('account-center', 'account center opened')),
      loginUserAccount: vi.fn(async (input) => mutationResult(`logged in with ${input.method}`)),
      logoutUserAccount: vi.fn(async () => mutationResult('logged out')),
      skipUserLogin: vi.fn(async () => mutationResult('skipped')),
      sendUserLoginCode: vi.fn(
        async (input): Promise<AiopsUserCodeResult> => ({
          ok: true,
          data: {
            challengeId: 'login-code-1',
            kind: input.kind,
            target: input.value,
            countdownSeconds: 60,
            remainingSeconds: 60,
            expiresAt: 1781913600000,
            message: 'login code sent'
          }
        })
      ),
      prepareUserAvatarImage: vi.fn(
        async (input): Promise<AiopsUserAvatarPrepareResult> => ({
          ok: true,
          data: {
            filePath: input.filePath,
            name: 'avatar.png',
            mimeType: 'image/png',
            size: 2,
            dataUrl: 'data:image/png;base64,AA==',
            avatarImageUrl: 'aiopsterm://avatar/avatar.png',
            assetFileName: 'avatar.png',
            message: 'avatar ready'
          }
        })
      ),
      updateUserProfile: vi.fn(async (input) =>
        mutationResult('profile saved', {
          ...accountSnapshot,
          profile: { ...accountSnapshot.profile, ...input }
        })
      ),
      resetUserPassword: vi.fn(async (input) => mutationResult(`password:${input.password.length}`)),
      sendUserContactCode: vi.fn(
        async (input): Promise<AiopsUserCodeResult> => ({
          ok: true,
          data: {
            challengeId: 'contact-code-1',
            kind: input.kind,
            target: input.value,
            countdownSeconds: 60,
            remainingSeconds: 60,
            expiresAt: 1781913600000,
            message: 'contact code sent'
          }
        })
      ),
      bindUserContact: vi.fn(async (input) => mutationResult(`${input.kind} bound`)),
      deactivateUserAccount: vi.fn(async (input) => mutationResult(`deactivated:${input.uid}`)),
      revokeTrustedDevice: vi.fn(async (id) => ({ ok: true, data: { deviceId: id, trustedDevices: [], message: 'device revoked' } }))
    }

    await expect(userAccountClient.getUserAccount()?.()).resolves.toEqual({ ok: true, data: accountSnapshot })
    await expect(userAccountClient.openUserLogin()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(userAccountClient.openUserAccountCenter()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(userAccountClient.loginUserAccount()?.({ method: 'account', username: 'ops', password: 'secret' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ message: 'logged in with account' }) })
    )
    await expect(userAccountClient.logoutUserAccount()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(userAccountClient.skipUserLogin()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(userAccountClient.sendUserLoginCode()?.({ kind: 'email', value: 'ops@example.com' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'email', target: 'ops@example.com', message: 'login code sent' }) })
    )
    await expect(userAccountClient.prepareUserAvatarImage()?.({ filePath: '/tmp/avatar.png' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ filePath: '/tmp/avatar.png', assetFileName: 'avatar.png' }) })
    )
    await expect(userAccountClient.updateUserProfile()?.({ name: 'Ops Lead' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ profile: expect.objectContaining({ name: 'Ops Lead' }) }) })
    )
    await expect(userAccountClient.resetUserPassword()?.({ password: 'pw1' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ message: 'password:3' }) })
    )
    await expect(userAccountClient.sendUserContactCode()?.({ kind: 'mobile', value: '+8613800000000' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'mobile', target: '+8613800000000', message: 'contact code sent' }) })
    )
    await expect(userAccountClient.bindUserContact()?.({ kind: 'email', value: 'ops@example.com', code: '123456' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ message: 'email bound' }) })
    )
    await expect(userAccountClient.deactivateUserAccount()?.({ uid: 42 })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ message: 'deactivated:42' }) })
    )
    await expect(userAccountClient.revokeTrustedDevice()?.(7)).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ deviceId: 7, message: 'device revoked' }) })
    )

    expect(window.aiops.loginUserAccount).toHaveBeenCalledWith({ method: 'account', username: 'ops', password: 'secret' })
    expect(window.aiops.sendUserLoginCode).toHaveBeenCalledWith({ kind: 'email', value: 'ops@example.com' })
    expect(window.aiops.prepareUserAvatarImage).toHaveBeenCalledWith({ filePath: '/tmp/avatar.png' })
    expect(window.aiops.updateUserProfile).toHaveBeenCalledWith({ name: 'Ops Lead' })
    expect(window.aiops.resetUserPassword).toHaveBeenCalledWith({ password: 'pw1' })
    expect(window.aiops.sendUserContactCode).toHaveBeenCalledWith({ kind: 'mobile', value: '+8613800000000' })
    expect(window.aiops.bindUserContact).toHaveBeenCalledWith({ kind: 'email', value: 'ops@example.com', code: '123456' })
    expect(window.aiops.deactivateUserAccount).toHaveBeenCalledWith({ uid: 42 })
    expect(window.aiops.revokeTrustedDevice).toHaveBeenCalledWith(7)

    window.aiops = {
      ...originalAiops,
      getUserAccount: undefined as any,
      openUserLogin: undefined as any,
      openUserAccountCenter: undefined as any,
      loginUserAccount: undefined as any,
      logoutUserAccount: undefined as any,
      skipUserLogin: undefined as any,
      sendUserLoginCode: undefined as any,
      prepareUserAvatarImage: undefined as any,
      updateUserProfile: undefined as any,
      resetUserPassword: undefined as any,
      sendUserContactCode: undefined as any,
      bindUserContact: undefined as any,
      deactivateUserAccount: undefined as any,
      revokeTrustedDevice: undefined as any
    }
    expect(userAccountClient.getUserAccount()).toBeUndefined()
    expect(userAccountClient.openUserLogin()).toBeUndefined()
    expect(userAccountClient.openUserAccountCenter()).toBeUndefined()
    expect(userAccountClient.loginUserAccount()).toBeUndefined()
    expect(userAccountClient.logoutUserAccount()).toBeUndefined()
    expect(userAccountClient.skipUserLogin()).toBeUndefined()
    expect(userAccountClient.sendUserLoginCode()).toBeUndefined()
    expect(userAccountClient.prepareUserAvatarImage()).toBeUndefined()
    expect(userAccountClient.updateUserProfile()).toBeUndefined()
    expect(userAccountClient.resetUserPassword()).toBeUndefined()
    expect(userAccountClient.sendUserContactCode()).toBeUndefined()
    expect(userAccountClient.bindUserContact()).toBeUndefined()
    expect(userAccountClient.deactivateUserAccount()).toBeUndefined()
    expect(userAccountClient.revokeTrustedDevice()).toBeUndefined()
  })
})
