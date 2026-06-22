import { beforeEach, describe, expect, it, vi } from 'vitest'

type SystemRuntime = {
  configureControlSocketSystemRuntime: (config?: {
    userDataPath?: string
    socketPath?: string
    getWindows?: () => Array<Record<string, unknown>>
    dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<Record<string, unknown>> | Record<string, unknown>
  }) => void
  systemCapabilities: () => Record<string, unknown>
  systemIdentify: (params?: Record<string, unknown>) => Record<string, unknown>
  handleSystemTreeControlRequest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  handleSystemTopControlRequest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  handleSystemMemoryControlRequest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  mobileHostStatus: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/controlSocketSystemRuntime'
  return (await import(modulePath)) as unknown as SystemRuntime
}

const createWindow = (id: number, focused = false) => ({
  id,
  isDestroyed: () => false,
  isFocused: () => focused
})

const snapshot = {
  activePanelId: 'panel-1',
  workspaces: [{ id: 'main', title: 'Main Workspace', active: true }],
  terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', connected: true }],
  surfaces: [{ panelId: 'panel-1', title: 'Local', surfaceKind: 'terminal', sessionId: 'terminal-1' }]
}

beforeEach(async () => {
  const runtime = await loadRuntime()
  runtime.configureControlSocketSystemRuntime({
    userDataPath: '',
    socketPath: '',
    getWindows: () => [],
    dispatchRendererControlRequest: undefined
  })
})

describe('controlSocketSystemRuntime', () => {
  it('reports capabilities and runtime identity through injected process state', async () => {
    const runtime = await loadRuntime()
    runtime.configureControlSocketSystemRuntime({
      userDataPath: '/tmp/aiopsterm-user-data',
      socketPath: '/tmp/aiopsterm.sock',
      getWindows: () => [createWindow(1), createWindow(17, true)]
    })

    expect(runtime.systemCapabilities()).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          protocol: 'aiopsterm-control',
          socketPath: '/tmp/aiopsterm.sock',
          process: expect.objectContaining({ pid: process.pid, platform: process.platform }),
          capabilities: expect.arrayContaining(['system.capabilities', 'system.identify', 'system.top', 'mobile.host'])
        })
      })
    )
    expect(runtime.systemIdentify({ caller: { panelId: 'panel-1' } })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          caller: { panelId: 'panel-1' },
          runtime: expect.objectContaining({
            userDataPath: '/tmp/aiopsterm-user-data',
            windowCount: 2,
            eventCount: expect.any(Number),
            notificationCount: expect.any(Number)
          })
        })
      })
    )
  })

  it('projects system tree/top/memory from an injected workspace snapshot dispatch', async () => {
    const runtime = await loadRuntime()
    const dispatchRendererControlRequest = vi.fn(() => ({ ok: true, data: { snapshot } }))
    runtime.configureControlSocketSystemRuntime({
      socketPath: '/tmp/aiopsterm.sock',
      getWindows: () => [createWindow(1, true)],
      dispatchRendererControlRequest
    })

    await expect(runtime.handleSystemTreeControlRequest({ workspaceId: 'main' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          active: expect.objectContaining({ surface_id: 'panel-1' }),
          windows: [expect.objectContaining({ id: 'window:1', workspaces: [expect.objectContaining({ panes: [expect.objectContaining({ selected_surface_id: 'panel-1' })] })] })],
          snapshot
        })
      })
    )
    await expect(runtime.handleSystemTopControlRequest({ include_processes: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          sample: expect.objectContaining({ process_details: true, source: 'node.process.memoryUsage+os' }),
          totals: expect.objectContaining({ pids: [process.pid] }),
          memory_diagnostic: expect.objectContaining({ app: expect.objectContaining({ pid: process.pid }) }),
          compatibility: expect.objectContaining({ renderer_snapshot_available: true }),
          snapshot
        })
      })
    )
    await expect(runtime.handleSystemMemoryControlRequest({ top_group_limit: 3 })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          sample: expect.objectContaining({ source: 'node.process.memoryUsage+os' }),
          memory_diagnostic: expect.objectContaining({ children: expect.objectContaining({ groups: expect.any(Array) }) }),
          compatibility: expect.objectContaining({ control_compat_shape: true }),
          snapshot
        })
      })
    )
    expect(dispatchRendererControlRequest).toHaveBeenCalledWith('workspace.snapshot', expect.any(Object), {})
  })

  it('fails closed for invalid system memory parameters and missing renderer dispatch', async () => {
    const runtime = await loadRuntime()

    await expect(runtime.handleSystemMemoryControlRequest({ top_group_limit: 101 })).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'INVALID_PARAMS' }))
    await expect(runtime.handleSystemTreeControlRequest({})).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'NO_APP_WINDOW' }))
    await expect(runtime.handleSystemTopControlRequest({})).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          active: null,
          windows: [],
          compatibility: expect.objectContaining({ renderer_snapshot_available: false }),
          warning: expect.objectContaining({ ok: false, errorCode: 'NO_APP_WINDOW' })
        })
      })
    )
  })

  it('reports mobile host status from the injected workspace snapshot', async () => {
    const runtime = await loadRuntime()
    runtime.configureControlSocketSystemRuntime({
      socketPath: '/tmp/aiopsterm.sock',
      dispatchRendererControlRequest: () => ({ ok: true, data: { snapshot } })
    })

    await expect(runtime.mobileHostStatus({})).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          app: 'aiopsterm',
          protocol: 'aiopsterm-control',
          route: 'local-control-socket',
          socketPath: '/tmp/aiopsterm.sock',
          workspace_count: 1,
          terminal_count: 1,
          active_surface_id: 'panel-1',
          snapshot
        })
      })
    )
  })
})
