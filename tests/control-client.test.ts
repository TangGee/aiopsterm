import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlClient } from '@/services/app/controlClient'
import type { ControlRequest } from '@shared/contracts/control'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('controlClient', () => {
  it('returns undefined for unavailable bridge methods and binds Control bridge methods', async () => {
    const offControl = vi.fn()
    const listener = vi.fn(async (_request: ControlRequest) => ({ ok: true, data: {} }))

    window.aiops = {
      ...originalAiops,
      invokeControlRequest: vi.fn(async () => ({ ok: true, data: { handled: true } })),
      respondControlRequest: vi.fn(() => undefined),
      onControlRequest: vi.fn(() => offControl)
    }

    await expect(controlClient.invokeControlRequest()?.('notification.open', { id: 'notification-1' })).resolves.toEqual({
      ok: true,
      data: { handled: true }
    })
    expect(controlClient.respondControlRequest()?.('request-1', { ok: true, data: {} })).toBeUndefined()
    expect(controlClient.onControlRequest()?.(listener)).toBe(offControl)

    expect(window.aiops.invokeControlRequest).toHaveBeenCalledWith('notification.open', { id: 'notification-1' })
    expect(window.aiops.respondControlRequest).toHaveBeenCalledWith('request-1', { ok: true, data: {} })
    expect(window.aiops.onControlRequest).toHaveBeenCalledWith(listener)

    window.aiops = {
      ...originalAiops,
      invokeControlRequest: undefined as any,
      respondControlRequest: undefined as any,
      onControlRequest: undefined as any
    }
    expect(controlClient.invokeControlRequest()).toBeUndefined()
    expect(controlClient.respondControlRequest()).toBeUndefined()
    expect(controlClient.onControlRequest()).toBeUndefined()
  })
})
