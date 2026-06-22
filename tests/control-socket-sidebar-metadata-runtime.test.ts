import { beforeEach, describe, expect, it, vi } from 'vitest'

type SidebarMetadataRuntime = {
  configureControlSocketSidebarMetadataRuntime: (config?: { publishControlEvent?: (input: Record<string, unknown>) => void }) => void
  handleSidebarMetadataControlRequest: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  isControlSidebarMetadataMethod: (method: string) => boolean
  resetControlSocketSidebarMetadataRuntime: () => void
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/controlSocketSidebarMetadataRuntime'
  return (await import(modulePath)) as SidebarMetadataRuntime
}

beforeEach(async () => {
  const runtime = await loadRuntime()
  runtime.configureControlSocketSidebarMetadataRuntime()
  runtime.resetControlSocketSidebarMetadataRuntime()
})

describe('controlSocketSidebarMetadataRuntime', () => {
  it('owns sidebar status, progress, log state and publishes compact sidebar events', async () => {
    const runtime = await loadRuntime()
    const publishControlEvent = vi.fn()
    runtime.configureControlSocketSidebarMetadataRuntime({ publishControlEvent })

    await expect(
      runtime.handleSidebarMetadataControlRequest('sidebar.status.set', {
        workspaceId: 'ops',
        panelId: 'panel-1',
        key: 'build',
        value: 'compiling',
        icon: 'hammer',
        color: '#ff9500',
        priority: 80
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: expect.objectContaining({
            workspaceId: 'ops',
            panelId: 'panel-1',
            key: 'build',
            value: 'compiling',
            priority: 80
          }),
          statusCount: 1,
          statuses: [expect.objectContaining({ key: 'build' })]
        })
      })
    )
    await expect(runtime.handleSidebarMetadataControlRequest('set-status', { workspaceId: 'ops', key: 'lint', value: 'ready', priority: 10 })).resolves.toEqual(
      expect.objectContaining({ ok: true })
    )
    await expect(runtime.handleSidebarMetadataControlRequest('set-progress', { workspaceId: 'ops', value: 1.5, label: 'Done' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          progress: expect.objectContaining({ workspaceId: 'ops', value: 1, label: 'Done' })
        })
      })
    )
    await expect(runtime.handleSidebarMetadataControlRequest('log', { workspaceId: 'ops', level: 'success', source: 'ci', message: 'All green' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          log: expect.objectContaining({ workspaceId: 'ops', level: 'success', source: 'ci', message: 'All green' })
        })
      })
    )

    await expect(runtime.handleSidebarMetadataControlRequest('sidebar.state', { workspaceId: 'ops' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          workspaceId: 'ops',
          statuses: [expect.objectContaining({ key: 'build' }), expect.objectContaining({ key: 'lint' })],
          statusCount: 2,
          progress: expect.objectContaining({ value: 1 }),
          logs: [expect.objectContaining({ message: 'All green' })],
          logCount: 1
        })
      })
    )
    expect(publishControlEvent).toHaveBeenCalledWith({ name: 'sidebar.status.set', category: 'sidebar', payload: { workspace_id: 'ops', key: 'build', priority: 80 } })
    expect(publishControlEvent).toHaveBeenCalledWith({ name: 'sidebar.progress.set', category: 'sidebar', payload: { workspace_id: 'ops', value: 1 } })
    expect(publishControlEvent).toHaveBeenCalledWith({ name: 'sidebar.log.appended', category: 'sidebar', payload: { workspace_id: 'ops', level: 'success', source: 'ci' } })
  })

  it('validates method aliases and clears state without leaking across control socket restarts', async () => {
    const runtime = await loadRuntime()

    expect(runtime.isControlSidebarMetadataMethod('sidebar.status.set')).toBe(true)
    expect(runtime.isControlSidebarMetadataMethod('set-status')).toBe(true)
    expect(runtime.isControlSidebarMetadataMethod('terminal.list')).toBe(false)

    await expect(runtime.handleSidebarMetadataControlRequest('set-status', { key: '../bad', value: 'bad' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'SIDEBAR_STATUS_INVALID' })
    )
    await expect(runtime.handleSidebarMetadataControlRequest('set-progress', { value: 'not-a-number' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'SIDEBAR_PROGRESS_INVALID' })
    )
    await expect(runtime.handleSidebarMetadataControlRequest('log', { message: '' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'SIDEBAR_LOG_MESSAGE_REQUIRED' })
    )

    await runtime.handleSidebarMetadataControlRequest('set-status', { key: 'build', value: 'compiling' })
    await expect(runtime.handleSidebarMetadataControlRequest('sidebar.state', {})).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ statusCount: 1 }) })
    )
    runtime.resetControlSocketSidebarMetadataRuntime()
    await expect(runtime.handleSidebarMetadataControlRequest('sidebar.state', {})).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ statusCount: 0, progress: null, logCount: 0 }) })
    )
  })
})
