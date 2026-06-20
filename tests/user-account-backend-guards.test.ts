import { describe, expect, it } from 'vitest'
import {
  createEmptyUserProfile,
  isTrustedDeviceRevokeData,
  isUserAccountSnapshot,
  isUserAvatarPrepareData,
  isUserCodeDataForRequest,
  isUserExternalActionData,
  isUserMutationData
} from '@/services/userAccountBackendGuards'
import type { AiopsTrustedDevice, AiopsUserProfile } from '@shared/contracts/userAccount'

const profile: AiopsUserProfile = {
  ...createEmptyUserProfile(),
  uid: 1001,
  name: 'Ops User',
  username: 'ops_user',
  avatarInitials: 'OU',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-07-01T00:00:00.000Z',
  email: 'ops@example.local',
  mobile: '13800000001',
  localIp: '127.0.0.1',
  macAddress: '00:11:22:33:44:55',
  skippedLogin: false,
  localDatabaseReady: true,
  lastLoginMethod: 'account',
  lastLoginAt: '2026-06-20T00:00:00.000Z',
  passwordUpdatedAt: '2026-06-20T00:00:00.000Z',
  avatarUpdatedAt: '2026-06-20T00:00:00.000Z'
}

const trustedDevice: AiopsTrustedDevice = {
  id: 1,
  deviceName: 'Workstation',
  macAddress: '00:11:22:33:44:55',
  lastLoginIp: '127.0.0.1',
  location: 'Local',
  lastLoginUserAgent: 'aiopsterm',
  current: true
}

const snapshot = {
  profile,
  trustedDevices: [trustedDevice]
}

describe('userAccountBackendGuards', () => {
  it('validates account snapshots and mutation data', () => {
    expect(createEmptyUserProfile()).toEqual(expect.objectContaining({ uid: 0, skippedLogin: true, lastLoginMethod: 'skip' }))
    expect(isUserAccountSnapshot(snapshot)).toBe(true)
    expect(isUserAccountSnapshot({ profile: { ...profile, registrationCode: 5 }, trustedDevices: [trustedDevice] })).toBe(false)
    expect(isUserAccountSnapshot({ profile, trustedDevices: [{ ...trustedDevice, id: 0 }] })).toBe(false)
    expect(isUserMutationData({ ...snapshot, message: 'saved' })).toBe(true)
    expect(isUserMutationData({ ...snapshot })).toBe(false)
  })

  it('validates external actions and request-matched code cooldowns', () => {
    expect(isUserExternalActionData({ action: 'login', url: 'https://accounts.aiopsterm.local/login', opened: true, openedAt: '2026-06-20T00:00:00.000Z', message: 'opened' }, 'login')).toBe(true)
    expect(isUserExternalActionData({ action: 'account-center', url: 'https://accounts.aiopsterm.local/login', opened: true, openedAt: '2026-06-20T00:00:00.000Z', message: 'opened' }, 'login')).toBe(false)
    expect(isUserExternalActionData({ action: 'login', url: '//accounts.aiopsterm.local/login', opened: true, openedAt: '2026-06-20T00:00:00.000Z', message: 'opened' }, 'login')).toBe(false)
    const emailCode = {
      challengeId: 'abcdef1234567890',
      kind: 'email' as const,
      target: 'Ops@Example.Local',
      countdownSeconds: 300,
      remainingSeconds: 300,
      expiresAt: Date.now() + 300_000,
      message: 'code sent'
    }
    expect(isUserCodeDataForRequest(emailCode, 'email', 'ops@example.local')).toBe(true)
    expect(isUserCodeDataForRequest(emailCode, 'mobile', 'ops@example.local')).toBe(false)
    expect(isUserCodeDataForRequest({ ...emailCode, challengeId: 'bad' }, 'email', 'ops@example.local')).toBe(false)
  })

  it('validates avatar preparation and trusted-device revoke data', () => {
    const avatar = {
      filePath: '/tmp/avatar.png',
      name: 'avatar.png',
      mimeType: 'image/png',
      size: 16,
      dataUrl: 'data:image/png;base64,abcd',
      avatarImageUrl: 'aiopsterm-user-avatar://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      assetFileName: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      message: 'avatar ready'
    }
    expect(isUserAvatarPrepareData(avatar)).toBe(true)
    expect(isUserAvatarPrepareData({ ...avatar, mimeType: 'text/plain' })).toBe(false)
    expect(isUserAvatarPrepareData({ ...avatar, avatarImageUrl: 'aiopsterm-user-avatar://bbbb.png' })).toBe(false)
    expect(isTrustedDeviceRevokeData({ deviceId: 1, trustedDevices: [trustedDevice], message: 'removed' })).toBe(true)
    expect(isTrustedDeviceRevokeData({ deviceId: 0, trustedDevices: [trustedDevice], message: 'removed' })).toBe(false)
  })
})
