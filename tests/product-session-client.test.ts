import { afterEach, describe, expect, it, vi } from 'vitest'
import { productSessionClient } from '@/services/ai/productSessionClient'
import type {
  ProductSessionProjectionRevision,
  ProductSessionProjectionRevisionInput
} from '@shared/contracts/productSessions'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('productSessionClient', () => {
  it('forwards projection revisions and returns undefined when the bridge method is unavailable', async () => {
    const input: ProductSessionProjectionRevisionInput = {
      fromMessageId: 'assistant-42',
      replacementMessages: [
        { messageId: 'assistant-42-revised', payload: { role: 'assistant', content: 'Revised' } }
      ]
    }
    const revision: ProductSessionProjectionRevision = {
      deletedMessages: 3,
      appendedMessages: 1,
      totalMessages: 42,
      seedMessages: [
        {
          messageId: 'assistant-42-revised',
          ordinal: 41,
          payload: { role: 'assistant', content: 'Revised' },
          createdAt: 1781884800000,
          updatedAt: 1781884800000
        }
      ],
      seedTotalMessages: 42,
      seedOmittedMessages: 41,
      seedPayloadBytes: 63
    }
    const reviseProductSessionProjectionMessages = vi.fn(async () => ({ ok: true as const, data: revision }))

    window.aiops = {
      ...originalAiops,
      reviseProductSessionProjectionMessages
    }

    await expect(productSessionClient.reviseProjectionMessages()?.('classic-1', input)).resolves.toEqual({
      ok: true,
      data: revision
    })
    expect(reviseProductSessionProjectionMessages).toHaveBeenCalledWith('classic-1', input)

    window.aiops = {
      ...originalAiops,
      reviseProductSessionProjectionMessages: undefined as any
    }
    expect(productSessionClient.reviseProjectionMessages()).toBeUndefined()
  })
})
