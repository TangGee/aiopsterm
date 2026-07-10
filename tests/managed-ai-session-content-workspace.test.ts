import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ManagedAiSessionContentWorkspace from '@/components/ManagedAiSessionContentWorkspace.vue'
import { useWorkspaceStore } from '@/stores/workspace'
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
  total = records.length
): ManagedAiSessionContentSnapshot => ({
  source: 'codex',
  sessionId: 'codex-active-1',
  title: 'Active Codex session',
  format: 'jsonl',
  sourceRevision,
  total,
  offset: 0,
  limit: 80,
  editable: true,
  sessionState: 'working',
  storagePath: '/tmp/codex-active-1.jsonl',
  records
})

const mountWorkspace = () => mount(ManagedAiSessionContentWorkspace, {
  props: {
    source: 'codex',
    sessionId: 'codex-active-1'
  },
  global: {
    stubs: {
      teleport: true
    }
  }
})

const makeRecordPage = (count: number, sourceRevision: string, prefix = 'record') =>
  Array.from({ length: count }, (_, ordinal) => makeRecord(`${prefix} ${ordinal + 1}`, sourceRevision, ordinal))

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
  it('shows the restart notice in the large editor and keeps it through a manual reload', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    const savedRecord = makeRecord('after', 'revision-2')
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([savedRecord], 'revision-2') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([savedRecord], 'revision-2') }),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { record: savedRecord, sourceRevision: 'revision-2', backupPath: '/tmp/backup.jsonl' }
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()

    await wrapper.find('.managed-ai-session-record-actions button').trigger('click')
    await flushPromises()
    await wrapper.find('.managed-ai-session-record-modal-editor').setValue('after')
    await wrapper.find('.managed-ai-session-record-modal-footer-actions .primary').trigger('click')
    await flushPromises()

    expect(window.aiops.updateManagedAiSessionContentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'after', sourceRevision: 'revision-1' })
    )
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    expect(wrapper.find('.managed-ai-session-record-modal-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')

    await wrapper.find('.managed-ai-session-content-actions button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    expect(wrapper.find('.managed-ai-session-record-modal-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('prompts for an AI conversation restart after deleting content', async () => {
    const initialRecord = makeRecord('remove me', 'revision-1')
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([], 'revision-2') }),
      deleteManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { recordId: initialRecord.recordId, sourceRevision: 'revision-2', backupPath: '/tmp/backup.jsonl' }
      }))
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()

    await wrapper.find('.managed-ai-session-record-actions .danger').trigger('click')
    await flushPromises()

    expect(window.aiops.deleteManagedAiSessionContentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: initialRecord.recordId, sourceRevision: 'revision-1' })
    )
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('keeps the restart notice while an automatic fill page loads', async () => {
    vi.useFakeTimers()
    const initialRecords = makeRecordPage(80, 'revision-1', 'before')
    const savedRecords = initialRecords.map((record, ordinal) =>
      ordinal === 0 ? makeRecord('after', 'revision-2', ordinal) : { ...record, sourceRevision: 'revision-2' }
    )
    const appendedRecord = makeRecord('appended', 'revision-2', 80)
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(initialRecords, 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(savedRecords, 'revision-2', 81) })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([appendedRecord], 'revision-2', 81) }),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { record: savedRecords[0], sourceRevision: 'revision-2' }
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.managed-ai-session-content-status .notice').exists()).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    await flushPromises()

    expect(window.aiops.listManagedAiSessionContent).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 80 }))
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('keeps the restart notice while a search-prefetch page loads', async () => {
    vi.useFakeTimers()
    const initialRecords = makeRecordPage(80, 'revision-1', 'before')
    const savedRecords = initialRecords.map((record, ordinal) =>
      ordinal === 0 ? makeRecord('after', 'revision-2', ordinal) : { ...record, sourceRevision: 'revision-2' }
    )
    const searchRecord = makeRecord('needle result', 'revision-2', 80)
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(initialRecords, 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(savedRecords, 'revision-2', 81) })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([searchRecord], 'revision-2', 81) }),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { record: savedRecords[0], sourceRevision: 'revision-2' }
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    await wrapper.find('.managed-ai-session-record-search input').setValue('needle')
    await flushPromises()
    await vi.runOnlyPendingTimersAsync()
    await flushPromises()

    expect(window.aiops.listManagedAiSessionContent).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 80 }))
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('keeps the restart notice while a scroll page loads', async () => {
    vi.useFakeTimers()
    const initialRecords = makeRecordPage(80, 'revision-1', 'before')
    const savedRecords = initialRecords.map((record, ordinal) =>
      ordinal === 0 ? makeRecord('after', 'revision-2', ordinal) : { ...record, sourceRevision: 'revision-2' }
    )
    const appendedRecord = makeRecord('appended', 'revision-2', 80)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(initialRecords, 'revision-1') })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot(savedRecords, 'revision-2', 81) })
        .mockResolvedValueOnce({ ok: true, data: makeSnapshot([appendedRecord], 'revision-2', 81) }),
      updateManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: true,
        data: { record: savedRecords[0], sourceRevision: 'revision-2' }
      }))
    }
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    await wrapper.find('.managed-ai-session-record-list').trigger('scroll')
    await flushPromises()

    expect(window.aiops.listManagedAiSessionContent).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 80 }))
    expect(wrapper.find('.managed-ai-session-content-status .notice').text()).toContain('重启该 AI 对话后修改才会生效')
    wrapper.unmount()
  })

  it('does not show a restart notice when saving fails', async () => {
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
    await wrapper.find('textarea').setValue('after')
    await wrapper.find('.managed-ai-session-record-actions .primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.managed-ai-session-content-error').text()).toBe('reload first')
    expect(wrapper.find('.managed-ai-session-content-status .notice').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not show a restart notice when deleting fails', async () => {
    const initialRecord = makeRecord('before', 'revision-1')
    window.aiops = {
      ...originalAiops,
      listManagedAiSessionContent: vi.fn(async () => ({ ok: true, data: makeSnapshot([initialRecord], 'revision-1') })),
      deleteManagedAiSessionContentRecord: vi.fn(async () => ({
        ok: false,
        errorCode: 'MANAGED_AI_CONTENT_REVISION_CONFLICT',
        errorMessage: 'reload first'
      }))
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    await wrapper.find('.managed-ai-session-record-actions .danger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.managed-ai-session-content-error').text()).toBe('reload first')
    expect(wrapper.find('.managed-ai-session-content-status .notice').exists()).toBe(false)
    wrapper.unmount()
  })
})
