import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindAutoClearingWorkspaceNotice } from '@/services/workspace/workspacePanelRuntimeController'

describe('workspace panel notice runtime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears a notice and safely replaces its timer', async () => {
    vi.useFakeTimers()
    const notice = ref('')
    const dispose = bindAutoClearingWorkspaceNotice(notice, 2400)
    notice.value = 'first'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1200)
    notice.value = 'second'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1300)
    expect(notice.value).toBe('second')
    await vi.advanceTimersByTimeAsync(1100)
    expect(notice.value).toBe('')
    dispose()
  })
})
