import { beforeEach, describe, expect, it, vi } from 'vitest'

type RendererMutationRuntime = {
  configureControlSocketRendererMutationRuntime: (config?: { publishControlEvent?: (input: Record<string, unknown>) => void }) => void
  publishRendererMutationEvent: (method: string, params: Record<string, unknown>, response: Record<string, unknown>) => void
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/control/controlSocketRendererMutationRuntime'
  return (await import(modulePath)) as RendererMutationRuntime
}

beforeEach(async () => {
  const runtime = await loadRuntime()
  runtime.configureControlSocketRendererMutationRuntime()
})

describe('controlSocketRendererMutationRuntime', () => {
  it('projects renderer workspace and pane mutations into compact control events', async () => {
    const runtime = await loadRuntime()
    const publishControlEvent = vi.fn()
    runtime.configureControlSocketRendererMutationRuntime({ publishControlEvent })

    runtime.publishRendererMutationEvent(
      'workspace.select',
      { panelId: 'fallback-panel' },
      {
        ok: true,
        data: {
          selectedPane: { panelId: 'panel-2' },
          previousActivePanelId: 'panel-1',
          action: 'next'
        }
      }
    )
    runtime.publishRendererMutationEvent(
      'surface.split',
      {},
      {
        ok: true,
        data: {
          createdPane: { panelId: 'panel-3' },
          pane: { panelId: 'panel-3', splitGroupId: 'group-1' }
        }
      }
    )

    expect(publishControlEvent).toHaveBeenCalledWith({
      name: 'workspace.selected',
      category: 'workspace',
      source: 'control.socket',
      surfaceId: 'panel-2',
      payload: expect.objectContaining({
        method: 'workspace.select',
        selected_pane_id: 'panel-2',
        selected_panel_id: 'panel-2',
        previous_panel_id: 'panel-1',
        action: 'next'
      })
    })
    expect(publishControlEvent).toHaveBeenCalledWith({
      name: 'pane.created',
      category: 'pane',
      source: 'control.socket',
      surfaceId: 'panel-3',
      payload: expect.objectContaining({
        method: 'surface.split',
        pane_id: 'panel-3',
        panel_id: 'panel-3',
        split_group_id: 'group-1',
        created_pane_id: 'panel-3',
        created_panel_id: 'panel-3'
      })
    })
  })

  it('projects specialized renderer mutation payloads and ignores non-events', async () => {
    const runtime = await loadRuntime()
    const publishControlEvent = vi.fn()
    runtime.configureControlSocketRendererMutationRuntime({ publishControlEvent })

    runtime.publishRendererMutationEvent('workspace.set_auto_title', { panelId: 'panel-1' }, { ok: true, data: { title: 'Generated', recorded: true } })
    runtime.publishRendererMutationEvent(
      'agent.team.launch',
      {},
      {
        ok: true,
        data: {
          team: {
            source: 'codex',
            requestedCount: 3,
            launchedCount: 2,
            approvalCount: 1,
            failedCount: 0
          }
        }
      }
    )
    runtime.publishRendererMutationEvent('workspace.set_auto_title', { panelId: 'panel-2' }, { ok: true, data: { title: 'Skipped' } })
    runtime.publishRendererMutationEvent('surface.create', {}, { ok: false, errorCode: 'FAILED' })
    runtime.publishRendererMutationEvent('workspace.list', {}, { ok: true, data: {} })

    expect(publishControlEvent).toHaveBeenCalledTimes(2)
    expect(publishControlEvent).toHaveBeenCalledWith({
      name: 'workspace.auto_title_set',
      category: 'workspace',
      source: 'control.socket',
      surfaceId: 'panel-1',
      payload: expect.objectContaining({
        method: 'workspace.set_auto_title',
        title: 'Generated',
        workspace_applied: false,
        panel_applied: false,
        panel_id: 'panel-1'
      })
    })
    expect(publishControlEvent).toHaveBeenCalledWith({
      name: 'agent_team.launched',
      category: 'agent',
      source: 'control.socket',
      surfaceId: '',
      payload: expect.objectContaining({
        method: 'agent.team.launch',
        source: 'codex',
        requested_count: 3,
        launched_count: 2,
        approval_count: 1,
        failed_count: 0
      })
    })
  })
})
