import { afterEach, describe, expect, it, vi } from 'vitest'

type UserAccountCodeRuntimeModule = {
  createUserAccountCodeRuntime(getConfig: () => { stateFilePath: string; useSeedData: boolean }): {
    clear(scope: 'login' | 'contact', kind: 'email' | 'mobile', target: string): void
    issue(scope: 'login' | 'contact', kind: 'email' | 'mobile', target: string, message: string): any
    verify(scope: 'login' | 'contact', kind: 'email' | 'mobile', target: string, code: string): any
    peekForTests(scope: 'login' | 'contact', kind: 'email' | 'mobile', target: string): string
    reset(): void
  }
  normalizeUserAccountCode(value: unknown): string
}

const originalCodeDoubleEnv = process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE

afterEach(() => {
  vi.useRealTimers()
  if (originalCodeDoubleEnv === undefined) {
    delete process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE
  } else {
    process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE = originalCodeDoubleEnv
  }
})

describe('userAccountCodeRuntime', () => {
  it('normalizes code input and keeps debug codes behind seed or explicit backend-double mode', async () => {
    const modulePath = '../src/main/backend/user/userAccountCodeRuntime'
    const runtimeModule = (await import(modulePath)) as UserAccountCodeRuntimeModule

    expect(runtimeModule.normalizeUserAccountCode(' 12 34 56 ')).toBe('123456')

    delete process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE
    const nonSeed = runtimeModule.createUserAccountCodeRuntime(() => ({ stateFilePath: '/tmp/user-account.json', useSeedData: false }))
    expect(nonSeed.issue('login', 'email', 'login@example.local', 'sent').ok).toBe(true)
    expect(nonSeed.peekForTests('login', 'email', 'login@example.local')).toBe('')

    process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE = '1'
    const seeded = runtimeModule.createUserAccountCodeRuntime(() => ({ stateFilePath: '/tmp/user-account.json', useSeedData: true }))
    expect(seeded.issue('login', 'email', 'login@example.local', 'sent').data).toMatchObject({
      kind: 'email',
      target: 'login@example.local',
      countdownSeconds: 300
    })
    expect(seeded.peekForTests('login', 'email', 'login@example.local')).toBe('246810')
  })

  it('reuses active cooldowns, verifies once, expires, and locks repeated failures', async () => {
    const modulePath = '../src/main/backend/user/userAccountCodeRuntime'
    const { createUserAccountCodeRuntime } = (await import(modulePath)) as UserAccountCodeRuntimeModule
    process.env.AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE = '1'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-09T10:00:00Z'))

    const runtime = createUserAccountCodeRuntime(() => ({ stateFilePath: '/tmp/user-account.json', useSeedData: true }))
    const first = runtime.issue('login', 'email', 'login@example.local', 'sent').data
    vi.advanceTimersByTime(60_000)
    const second = runtime.issue('login', 'email', 'login@example.local', 'sent').data
    expect(second.challengeId).toBe(first.challengeId)
    expect(second.remainingSeconds).toBe(240)
    expect(second.message).toBe('验证码已发送，请 240 秒后重试')

    expect(runtime.verify('login', 'email', 'login@example.local', '246810')).toBeNull()
    runtime.clear('login', 'email', 'login@example.local')
    expect(runtime.verify('login', 'email', 'login@example.local', '246810')).toEqual({
      ok: false,
      errorCode: 'USER_CODE_NOT_SENT',
      errorMessage: '请先获取验证码'
    })

    runtime.issue('login', 'mobile', '13800000001', 'sent')
    const mobileCode = runtime.peekForTests('login', 'mobile', '13800000001')
    vi.advanceTimersByTime(300_001)
    expect(runtime.verify('login', 'mobile', '13800000001', mobileCode)).toEqual({
      ok: false,
      errorCode: 'USER_CODE_EXPIRED',
      errorMessage: '验证码已过期，请重新获取'
    })

    runtime.issue('contact', 'email', 'ops@example.local', 'sent')
    for (let index = 0; index < 4; index += 1) {
      expect(runtime.verify('contact', 'email', 'ops@example.local', '000000')).toEqual({
        ok: false,
        errorCode: 'USER_CODE_INVALID',
        errorMessage: '验证码错误'
      })
    }
    expect(runtime.verify('contact', 'email', 'ops@example.local', '000000')).toEqual({
      ok: false,
      errorCode: 'USER_CODE_LOCKED',
      errorMessage: '验证码错误次数过多，请重新获取'
    })
  })
})
