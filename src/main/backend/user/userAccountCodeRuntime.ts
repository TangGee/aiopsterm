import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import type { AiopsMutationResult } from '@shared/contracts/common'
import type { AiopsUserCodeInput, AiopsUserCodeResult, AiopsUserMutationResult } from '@shared/contracts/userAccount'
import { shouldUseUserAccountCodeBackendDouble } from '@shared/runtimeSwitches'

export type UserCodeCooldownScope = 'login' | 'contact'
export type UserCodeKind = AiopsUserCodeInput['kind']

type UserCodeCooldown = {
  challengeId: string
  expiresAt: number
  codeHash: string
  attempts: number
  debugCode?: string
}

export type UserAccountCodeRuntimeConfig = {
  stateFilePath: string
  useSeedData: boolean
}

export type UserAccountCodeRuntime = {
  clear(scope: UserCodeCooldownScope, kind: UserCodeKind, target: string): void
  issue(scope: UserCodeCooldownScope, kind: UserCodeKind, target: string, message: string): AiopsUserCodeResult
  verify(scope: UserCodeCooldownScope, kind: UserCodeKind, target: string, code: string): AiopsUserMutationResult | null
  peekForTests(scope: UserCodeCooldownScope, kind: UserCodeKind, target: string): string
  reset(): void
}

const userCodeCooldownMs = 300_000

const trimText = (value: unknown) => String(value || '').trim()

const errorResult = <T>(errorCode: string, errorMessage: string): AiopsMutationResult<T> => ({
  ok: false,
  errorCode,
  errorMessage
})

const userCodeCooldownKey = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string) =>
  [scope, kind, kind === 'email' ? target.toLowerCase() : target].join(':')

const userCodeChallengeId = () => randomBytes(12).toString('hex')

const remainingCodeCooldownSeconds = (expiresAt: number, now = Date.now()) => Math.max(0, Math.ceil((expiresAt - now) / 1000))

const generateUserCode = (scope: UserCodeCooldownScope, kind: UserCodeKind) => {
  if (shouldUseUserAccountCodeBackendDouble()) {
    if (scope === 'login' && kind === 'email') return '246810'
    if (scope === 'login' && kind === 'mobile') return '135790'
    return '123456'
  }
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

const userCodeHash = (stateFilePath: string, scope: UserCodeCooldownScope, kind: UserCodeKind, target: string, code: string) =>
  createHash('sha256')
    .update([stateFilePath, scope, kind, kind === 'email' ? target.toLowerCase() : target, code].join('\0'))
    .digest('hex')

const secureHashEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const normalizeUserAccountCode = (value: unknown) => trimText(value).replace(/\s+/g, '')

export function createUserAccountCodeRuntime(getConfig: () => UserAccountCodeRuntimeConfig): UserAccountCodeRuntime {
  const cooldowns = new Map<string, UserCodeCooldown>()

  const clear = (scope: UserCodeCooldownScope, kind: UserCodeKind, target: string) => {
    cooldowns.delete(userCodeCooldownKey(scope, kind, target))
  }

  return {
    clear,
    issue(scope, kind, target, message) {
      const config = getConfig()
      const now = Date.now()
      const key = userCodeCooldownKey(scope, kind, target)
      const active = cooldowns.get(key)
      const activeRemainingSeconds = active ? remainingCodeCooldownSeconds(active.expiresAt, now) : 0
      const expiresAt = activeRemainingSeconds > 0 ? active!.expiresAt : now + userCodeCooldownMs
      const remainingSeconds = activeRemainingSeconds > 0 ? activeRemainingSeconds : remainingCodeCooldownSeconds(expiresAt, now)

      const issued = activeRemainingSeconds > 0 ? active! : null
      const challenge =
        issued ||
        (() => {
          const code = generateUserCode(scope, kind)
          return {
            challengeId: userCodeChallengeId(),
            expiresAt,
            codeHash: userCodeHash(config.stateFilePath, scope, kind, target, code),
            attempts: 0,
            debugCode: config.useSeedData || shouldUseUserAccountCodeBackendDouble() ? code : undefined
          }
        })()

      if (!issued) {
        cooldowns.set(key, challenge)
      }

      return {
        ok: true,
        data: {
          challengeId: challenge.challengeId,
          kind,
          target,
          countdownSeconds: remainingSeconds,
          remainingSeconds,
          expiresAt,
          message: activeRemainingSeconds > 0 ? `验证码已发送，请 ${remainingSeconds} 秒后重试` : message
        }
      }
    },
    verify(scope, kind, target, code) {
      const key = userCodeCooldownKey(scope, kind, target)
      const active = cooldowns.get(key)
      if (!active) return errorResult('USER_CODE_NOT_SENT', '请先获取验证码')
      if (remainingCodeCooldownSeconds(active.expiresAt) <= 0) {
        cooldowns.delete(key)
        return errorResult('USER_CODE_EXPIRED', '验证码已过期，请重新获取')
      }
      const codeHash = userCodeHash(getConfig().stateFilePath, scope, kind, target, code)
      if (!secureHashEqual(active.codeHash, codeHash)) {
        const attempts = active.attempts + 1
        if (attempts >= 5) {
          cooldowns.delete(key)
          return errorResult('USER_CODE_LOCKED', '验证码错误次数过多，请重新获取')
        }
        cooldowns.set(key, { ...active, attempts })
        return errorResult('USER_CODE_INVALID', '验证码错误')
      }
      return null
    },
    peekForTests(scope, kind, target) {
      return cooldowns.get(userCodeCooldownKey(scope, kind, trimText(target)))?.debugCode || ''
    },
    reset() {
      cooldowns.clear()
    }
  }
}
