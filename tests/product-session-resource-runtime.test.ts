import { describe, expect, it } from 'vitest'
import { productSessionResourceOptions } from '@/services/ai/productSessionResourceRuntime'

describe('product session resource runtime', () => {
  it('lists exact live terminal instances and only configured hosts that are not open', () => {
    const panels = [
      {
        id: 'panel-local',
        kind: 'terminal' as const,
        sessionId: 'terminal-local',
        title: 'Local terminal',
        status: 'running'
      },
      {
        id: 'panel-prod-1',
        kind: 'terminal' as const,
        sessionId: 'terminal-prod-1',
        title: 'Production one',
        status: 'running',
        sshSession: {
          assetId: 'asset-prod',
          connectionId: 'connection-prod-1',
          assetName: 'Production',
          host: '10.0.0.8',
          port: 22,
          username: 'ops'
        }
      },
      {
        id: 'panel-prod-2',
        kind: 'terminal' as const,
        sessionId: 'terminal-prod-2',
        title: 'Production two',
        status: 'running',
        sshSession: {
          assetId: 'asset-prod',
          connectionId: 'connection-prod-2',
          assetName: 'Production',
          host: '10.0.0.8',
          port: 22,
          username: 'ops'
        }
      }
    ]
    const options = productSessionResourceOptions(panels, {
      categories: [{
        id: 'hosts',
        label: 'Hosts',
        options: [
          { id: 'asset-prod', kind: 'hosts', label: 'Production', assetId: 'asset-prod' },
          { id: 'asset-stage', kind: 'hosts', label: 'Staging', assetId: 'asset-stage', host: '10.0.0.9' }
        ]
      }]
    }, 'panel-prod-2')

    expect(options.map((option) => option.id)).toEqual([
      'terminal:panel-prod-2',
      'terminal:panel-local',
      'terminal:panel-prod-1',
      'host:asset-stage'
    ])
    expect(options.filter((option) => option.kind === 'terminal')).toHaveLength(3)
    expect(options.filter((option) => option.kind === 'host').map((option) => option.context.assetId)).toEqual(['asset-stage'])
  })
})
