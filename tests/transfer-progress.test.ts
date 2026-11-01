import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import type { FileTransferTask } from '@shared/contracts/files'
const bridge = vi.hoisted(() => ({ store: null as any, stop: vi.fn(), control: vi.fn(), cancel: vi.fn(), observe: vi.fn() }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => bridge.store }))
import TransferProgress from '@/components/files/TransferProgress.vue'
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  bridge.observe.mockReturnValue(bridge.stop)
  bridge.store = reactive({
    transferOverallPercent: 40, transferTaskCount: 1,
    transferTaskGroups: { upload: [{ id: 'test', name: 'test.bin', source: '/a', target: '/b', type: 'upload', progress: 40, speed: '已暂停', status: 'paused', resumable: true } as FileTransferTask], download: [], r2r: [] },
    observeFileTransferTasks: bridge.observe, controlFileTransferTask: bridge.control, cancelFileTransferTask: bridge.cancel
  })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })
describe('transfer progress recovery controls', () => {
  it('observes restored tasks even when initially empty and releases the observer', () => {
    bridge.store.transferTaskCount = 0
    const wrapper = mount(TransferProgress); wrappers.push(wrapper)
    expect(bridge.observe).toHaveBeenCalledOnce()
    expect(wrapper.find('.transfer-progress-panel').exists()).toBe(false)
    wrapper.unmount(); wrappers.pop()
    expect(bridge.stop).toHaveBeenCalledOnce()
  })
  it('routes pause, resume, retry and removal and retains stable task rows', async () => {
    const wrapper = mount(TransferProgress); wrappers.push(wrapper)
    const row = wrapper.get('.transfer-task').element
    await wrapper.get('[title="继续传输"]').trigger('click')
    expect(bridge.control).toHaveBeenLastCalledWith('test', 'resume')
    const task = bridge.store.transferTaskGroups.upload[0]
    task.status = 'running'; task.stage = 'verifying'
    await nextTick()
    expect(wrapper.text()).toContain('校验中')
    expect(wrapper.find('[title="移除任务并清理临时文件"]').exists()).toBe(false)
    await wrapper.get('[title="暂停传输"]').trigger('click')
    expect(bridge.control).toHaveBeenLastCalledWith('test', 'pause')
    await wrapper.get('[title="取消"]').trigger('click')
    expect(bridge.cancel).toHaveBeenLastCalledWith('test')
    task.status = 'error'; task.speed = 'Connection lost'
    await nextTick()
    expect(wrapper.text()).toContain('Connection lost')
    await wrapper.get('[title="重试未完成文件"]').trigger('click')
    expect(bridge.control).toHaveBeenLastCalledWith('test', 'resume')
    await wrapper.get('[title="移除任务并清理临时文件"]').trigger('click')
    expect(bridge.control).toHaveBeenLastCalledWith('test', 'remove')
    expect(wrapper.get('.transfer-task').element).toBe(row)
  })
})
