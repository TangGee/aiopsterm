import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ManagedAiSessionContentWorkspace from '@/components/ManagedAiSessionContentWorkspace.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { createManagedAiSessionContentViewState } from '@/services/terminal/terminalPanelRuntime'
import type { ManagedAiSessionContentRecord, ManagedAiSessionContentSnapshot } from '@shared/contracts/managedAiSessionContent'

const originalAiops = window.aiops

const makeRecord = (content: string, sourceRevision: string, ordinal = 0): ManagedAiSessionContentRecord => ({
  source: 'codex',
  sessionId: 'codex-active-1',
  format: 'jsonl',
  recordId: `jsonl:${ordinal + 1}:%2Fpayload%2Fmessage`,
  ordinal,
  locationLabel: `line ${ordinal + 1} /payload/message`,
  role: 'user',
  messageType: 'event_msg / user_message',
  content,
  contentTruncated: false,
  fullLength: content.length,
  editable: true,
  sourceRevision
})

const makeSnapshot = (
  records: ManagedAiSessionContentRecord[],
  sourceRevision: string,
  total = records.length,
  input: { offset?: number; matchTotal?: number } = {}
): ManagedAiSessionContentSnapshot => ({
  source: 'codex',
  sessionId: 'codex-active-1',
  title: 'Active Codex session',
  format: 'jsonl',
  sourceRevision,
  total,
  matchTotal: input.matchTotal ?? total,
  offset: input.offset ?? 0,
  limit: 20,
  editable: true,
  sessionState: 'working',
  storagePath: '/tmp/codex-active-1.jsonl',
  records
})

const mountWorkspace = (viewState = createManagedAiSessionContentViewState()) => mount(ManagedAiSessionContentWorkspace, {
  props: {
    source: 'codex',
    sessionId: 'codex-active-1',
    viewState
  },
  global: {
    stubs: {
      teleport: true
    }
  }
})

const makeRecordPage = (start: number, count: number, sourceRevision: string, prefix = 'record') =>
  Array.from({ length: count }, (_, index) => makeRecord(`${prefix} ${start + index + 1}`, sourceRevision, start + index))

beforeEach(() => {
  setActivePinia(createPinia())
  useWorkspaceStore().config.language = 'zh-CN'
  vi.clearAllMocks()
})

afterEach(() => {
  window.aiops = originalAiops
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ManagedAiSessionContentWorkspace', () => {
  it('loads 20 records once and changes pages only from pagination controls', async () => {
    const firstPage = makeRecordPage(0, 20, 'revision-1')
    const secondPage = makeRecordPage(20, 5, 'revision-1')
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot(firstPage, 'revision-1', 25) })
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot(secondPage, 'revision-1', 25, { offset: 20 }) })
    window.aiops = { ...originalAiops, listManagedAiSessionContent: list }
    const wrapper = mountWorkspace()
    await flushPromises()

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, limit: 20 }))
    expect(wrapper.findAll('.managed-ai-session-record-card')).toHaveLength(20)

    await wrapper.findAll('.managed-ai-session-content-pagination button')[2].trigger('click')
    await flushPromises()

    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20, limit: 20 }))
    expect((wrapper.find('.managed-ai-session-record-card textarea').element as HTMLTextAreaElement).value).toBe('record 21')

    await wrapper.find('.managed-ai-session-record-list').trigger('scroll')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('searches the full conversation through the backend and paginates matches', async () => {
    vi.useFakeTimers()
    const firstResultPage = makeRecordPage(40, 20, 'revision-1', 'needle')
    const secondResultPage = makeRecordPage(60, 3, 'revision-1', 'needle')
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot(makeRecordPage(0, 20, 'revision-1'), 'revision-1', 100) })
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot(firstResultPage, 'revision-1', 100, { matchTotal: 23 }) })
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot(secondResultPage, 'revision-1', 100, { offset: 20, matchTotal: 23 }) })
    window.aiops = { ...originalAiops, listManagedAiSessionContent: list }
    const wrapper = mountWorkspace()
    await flushPromises()

    await wrapper.find('.managed-ai-session-record-search input').setValue(' needle ')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'needle', offset: 0, limit: 20 }))
    expect(wrapper.find('.managed-ai-session-content-page-count').text()).toContain('2')

    await wrapper.findAll('.managed-ai-session-content-pagination button')[2].trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'needle', offset: 20, limit: 20 }))
    wrapper.unmount()
  })

  it('restores the cached page, search and drafts without loading again after a tab switch', async () => {
    const viewState = createManagedAiSessionContentViewState()
    const page = makeRecordPage(20, 5, 'revision-1')
    const list = vi.fn(async () => ({
      ok: true,
      data: makeSnapshot(page, 'revision-1', 25, { offset: 20 })
    }))
    window.aiops = { ...originalAiops, listManagedAiSessionContent: list }
    viewState.page = 2
    viewState.query = 'record'
    const firstWrapper = mountWorkspace(viewState)
    await flushPromises()
    await firstWrapper.find('textarea').setValue('draft kept across tabs')
    firstWrapper.unmount()

    const secondWrapper = mountWorkspace(viewState)
    await flushPromises()

    expect(list).toHaveBeenCalledTimes(1)
    expect((secondWrapper.find('.managed-ai-session-record-search input').element as HTMLInputElement).value).toBe('record')
    expect((secondWrapper.find('.managed-ai-session-content-pagination input').element as HTMLInputElement).value).toBe('2')
    expect((secondWrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('draft kept across tabs')
    secondWrapper.unmount()
  })

  it('asks before manual refresh with a draft and clears all drafts after confirmation', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    const refreshedRecord = makeRecord('from disk', 'revision-2')
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })
      .mockResolvedValueOnce({ ok: true, data: makeSnapshot([refreshedRecord], 'revision-2') })
    window.aiops = { ...originalAiops, listManagedAiSessionContent: list }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('local draft')

    await wrapper.find('.managed-ai-session-content-refresh').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('local draft')

    await wrapper.find('.managed-ai-session-content-refresh').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalledTimes(2)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('from disk')
    wrapper.unmount()
  })

  it('reloads the current page after saving and shows the restart notice', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    const savedRecord = makeRecord('after', 'revision-2')
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([savedRecord], 'revision-2') }),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { record: savedRecord, sourceRevision: 'revision-2' }
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    expect(window.aiops.updateManagedAiSessionContentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'after', sourceRevision: 'revision-1' })
    )
    expect(window.aiops.listManagedAiSessionContent).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('clamps to the last valid page after deleting the only record on the current page', async () => {
    const lastRecord = makeRecord('last', 'revision-1', 20)
    const previousPage = makeRecordPage(0, 20, 'revision-2')
    const viewState = createManagedAiSessionContentViewState()
    viewState.page = 2
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([lastRecord], 'revision-1', 21, { offset: 20 }) })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(previousPage, 'revision-2', 20) }),
      deleteManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { recordId: lastRecord.recordId, sourceRevision: 'revision-2' }
      }))
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWorkspace(viewState)
    await flushPromises()
    await wrapper.find('.managed-ai-session-record-actions .danger').trigger('click')
    await flushPromises()

    expect(window.aiops.listManagedAiSessionContent).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, limit: 20 }))
    expect((wrapper.find('.managed-ai-session-content-pagination input').element as HTMLInputElement).value).toBe('1')
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('asks before forcing a stale save and keeps the conflict when declined', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi.fn(async () => ({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: false,
        errorCode: 'MANAGED_AI_CONTENT_REVISION_CONFLICT',
        errorMessage: 'reload first'
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.managed-ai-session-content-error').text()).toBe('reload first')
    expect(wrapper.find('.managed-ai-session-content-status .notice').exists()).toBe(false)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('覆盖'))
    wrapper.unmount()
  })

  it('retries a stale save with force after confirmation', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    const savedRecord = makeRecord('after', 'revision-3')
    const updateRecord = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, errorCode: 'MANAGED_AI_CONTENT_REVISION_CONFLICT', errorMessage: 'reload first' })
      .mockResolvedValueOnce({ ok: true, data: { record: savedRecord, sourceRevision: 'revision-3' } })
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([savedRecord], 'revision-3') }),
      updateManagedAiSessionContentRecord: updateRecord
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    expect(updateRecord).toHaveBeenCalledTimes(2)
    expect(updateRecord).toHaveBeenLastCalledWith(expect.objectContaining({ force: true, sourceRevision: 'revision-1' }))
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })
})
