import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createWorkspacePanelDragRuntime } from '@/services/workspace/workspacePanelDragRuntime'
import type { WorkspacePanelAsset } from '@/services/assets/workspaceAssetTreeRuntime'

const asset = (patch: Partial<WorkspacePanelAsset> = {}): WorkspacePanelAsset => ({
  id: 'asset-prod',
  uuid: 'asset-prod',
  name: 'prod-gateway',
  title: 'Production gateway',
  host: 'prod.internal',
  ip: '10.0.0.8',
  group: 'Production',
  group_name: 'Production',
  status: 'online',
  tags: [],
  username: 'ops',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  ...patch
})

describe('workspacePanelDragRuntime', () => {
  it('exports the managed asset name as the host context label and the endpoint as detail', () => {
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) || '')
    } as unknown as DataTransfer
    const runtime = createWorkspacePanelDragRuntime({
      visibleTreeRows: computed(() => []),
      groupByKey: () => null,
      isDescendantGroup: () => false,
      moveAssetToGroup: vi.fn(async () => true),
      moveGroupToParent: vi.fn(async () => true)
    })

    runtime.handleAssetDragStart({ dataTransfer } as DragEvent, asset())

    expect(dataTransfer.effectAllowed).toBe('move')
    expect(JSON.parse(values.get('application/x-aiopsterm-context') || '')).toMatchObject({
      contextType: 'host',
      id: 'asset-prod',
      kind: 'hosts',
      label: 'Production gateway',
      detail: 'prod.internal',
      host: 'prod.internal',
      assetName: 'Production gateway'
    })
    expect(values.get('text/plain')).toBe('Production gateway')
  })
})
