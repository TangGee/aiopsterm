import { describe, expect, it } from 'vitest'
import {
  classicActiveHostContext,
  classicHostTargetId,
  classicOpenedHostContexts,
  classicSessionContextRefs,
  resolveClassicHostTerminalPanel,
  restoreClassicSessionContexts,
  sendableClassicSessionContexts
} from '@/services/ai/classicSessionContextRuntime'
import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'

const emptyCatalog = (): AiContextCatalog => ({ categories: [], openedHosts: [], selectedDefaults: [] })

describe('Classic session context runtime', () => {
  it('persists ordered stable refs without content or binary payloads', () => {
    const contexts: AiContextOption[] = [
      { id: 'asset-prod', kind: 'hosts', label: '10.0.0.8', host: '10.0.0.8', port: 22, username: 'ops', data: 'secret' },
      { id: 'kb-doc:runbook.md', kind: 'docs', label: 'runbook.md', relPath: 'runbook.md', content: 'large markdown' },
      { id: 'kb-image:diagram.png', kind: 'images', label: 'diagram.png', relPath: 'diagram.png', mediaType: 'image/png', data: 'BASE64' },
      { id: 'skill:triage', kind: 'skills', label: 'triage', content: 'skill body' },
      { id: 'chat:conv-7', kind: 'chats', label: 'Incident 7', detail: 'history' }
    ]

    const refs = classicSessionContextRefs(contexts)

    expect(refs.map((ref) => ref.kind)).toEqual(['hosts', 'docs', 'images', 'skills', 'chats'])
    expect(refs).toEqual([
      expect.objectContaining({ id: 'asset-prod', assetId: 'asset-prod', host: '10.0.0.8', port: 22, username: 'ops' }),
      expect.objectContaining({ id: 'kb-doc:runbook.md', relPath: 'runbook.md' }),
      expect.objectContaining({ id: 'kb-image:diagram.png', relPath: 'diagram.png', mediaType: 'image/png' }),
      expect.objectContaining({ id: 'skill:triage', skillName: 'triage' }),
      expect.objectContaining({ id: 'chat:conv-7', chatSessionId: 'conv-7' })
    ])
    expect(JSON.stringify(refs)).not.toContain('secret')
    expect(JSON.stringify(refs)).not.toContain('large markdown')
    expect(JSON.stringify(refs)).not.toContain('BASE64')
    expect(refs.every((ref) => !('content' in ref) && !('data' in ref))).toBe(true)
  })

  it('restores available refs in snapshot order and retains missing refs as unavailable', () => {
    const refs = classicSessionContextRefs([
      { id: 'missing-chat', kind: 'chats', label: 'Deleted chat', chatSessionId: 'deleted' },
      { id: 'old-host-id', kind: 'hosts', label: '10.0.0.8', detail: 'old endpoint label', assetId: 'asset-prod' },
      { id: 'kb-image:diagram.png', kind: 'images', label: 'diagram.png', relPath: 'images/diagram.png', mediaType: 'image/png' },
      { id: 'skill:triage', kind: 'skills', label: 'triage' }
    ])
    const catalog: AiContextCatalog = {
      categories: [
        {
          id: 'hosts',
          label: 'Hosts',
          options: [{
            id: 'asset-prod',
            kind: 'hosts',
            label: 'Production gateway',
            detail: 'prod.internal',
            host: 'prod.internal'
          }]
        },
        { id: 'docs', label: 'Docs', options: [{ id: 'kb-doc:images/diagram.png', kind: 'docs', label: 'diagram.png', relPath: 'images/diagram.png' }] },
        { id: 'skills', label: 'Skills', options: [{ id: 'skill:triage', kind: 'skills', label: 'triage' }] },
        { id: 'chats', label: 'Chats', options: [] }
      ],
      openedHosts: [],
      selectedDefaults: []
    }

    const restored = restoreClassicSessionContexts(refs, catalog)

    expect(restored.map((context) => context.kind)).toEqual(['chats', 'hosts', 'images', 'skills'])
    expect(restored[0]).toMatchObject({ id: 'missing-chat', label: 'Deleted chat', unavailable: true })
    expect(restored[1]).toMatchObject({
      id: 'asset-prod',
      assetId: 'asset-prod',
      label: 'Production gateway',
      detail: 'prod.internal',
      host: 'prod.internal',
      unavailable: false
    })
    expect(restored[2]).toMatchObject({ id: 'kb-image:diagram.png', kind: 'images', relPath: 'images/diagram.png', unavailable: false })
    expect(restored[3]).toMatchObject({ id: 'skill:triage', unavailable: false })
    expect(sendableClassicSessionContexts(restored).map((context) => context.kind)).toEqual(['hosts', 'images', 'skills'])
  })

  it('resolves every host by stable identity without falling back to an unrelated terminal', () => {
    const panels = [
      { id: 'panel-other', sessionId: 'terminal-other', sshSession: { assetId: 'asset-other', host: 'other.internal', port: 22, username: 'ops' } },
      { id: 'panel-reconnected', sessionId: 'terminal-new', sshSession: { assetId: 'asset-prod', host: 'prod.internal', port: 22, username: 'ops' } }
    ]

    expect(resolveClassicHostTerminalPanel(panels, {
      id: 'asset-prod',
      kind: 'hosts',
      label: 'prod',
      assetId: 'asset-prod',
      host: 'prod.internal'
    }))
      .toMatchObject({ id: 'panel-reconnected', sessionId: 'terminal-new' })
    expect(resolveClassicHostTerminalPanel(panels, {
      id: 'asset-missing',
      kind: 'hosts',
      label: 'missing',
      assetId: 'asset-missing'
    })).toBeNull()
    expect(resolveClassicHostTerminalPanel([
      {
        id: 'panel-same-endpoint',
        sessionId: 'terminal-same-endpoint',
        sshSession: { assetId: 'asset-other', host: 'prod.internal', port: 22, username: 'ops' }
      }
    ], {
      id: 'asset-prod',
      kind: 'hosts',
      label: 'prod',
      assetId: 'asset-prod',
      host: 'prod.internal',
      port: 22,
      username: 'ops'
    })).toBeNull()
    expect(resolveClassicHostTerminalPanel([
      {
        id: 'panel-unowned-endpoint',
        sessionId: 'terminal-unowned-endpoint',
        sshSession: { host: 'prod.internal', port: 22, username: 'ops' }
      }
    ], {
      id: 'asset-prod',
      kind: 'hosts',
      label: 'prod',
      assetId: 'asset-prod',
      host: 'prod.internal',
      port: 22,
      username: 'ops'
    })).toBeNull()
    expect(resolveClassicHostTerminalPanel(panels, {
      id: 'asset-prod',
      kind: 'hosts',
      label: 'unavailable',
      unavailable: true
    })).toBeNull()
    expect(restoreClassicSessionContexts([], emptyCatalog())).toEqual([])
  })

  it('does not restore a missing asset through an endpoint-only match', () => {
    const restored = restoreClassicSessionContexts([{
      id: 'asset-removed',
      kind: 'hosts',
      label: 'old production',
      assetId: 'asset-removed',
      host: 'prod.internal',
      port: 22,
      username: 'ops'
    }], {
      categories: [{
        id: 'hosts',
        label: 'Hosts',
        options: [{
          id: 'asset-replacement',
          kind: 'hosts',
          label: 'new production',
          host: 'prod.internal',
          port: 22,
          username: 'ops'
        }]
      }],
      openedHosts: []
    })

    expect(restored).toEqual([
      expect.objectContaining({ id: 'asset-removed', assetId: 'asset-removed', unavailable: true })
    ])
  })

  it('uses stable asset identities as tool target ids', () => {
    expect(classicHostTargetId({ id: 'asset-prod', assetId: 'asset-prod' })).toBe('asset-prod')
    expect(classicHostTargetId({ id: 'connection-prod', connectionId: 'connection-prod' })).toBe('connection-prod')
    expect(classicHostTargetId({ id: 'opened-local', isLocalShell: true })).toBe('opened-local')
    expect(classicHostTargetId({ id: 'hosts.127.0.0.1', label: '127.0.0.1' })).toBe('opened-local')
    expect(restoreClassicSessionContexts([{
      id: 'opened-local',
      kind: 'hosts',
      label: 'Local terminal'
    }], {
      categories: [],
      openedHosts: [{
        id: 'opened-local',
        kind: 'hosts',
        label: '127.0.0.1',
        isLocalShell: true
      }]
    })).toEqual([expect.objectContaining({ id: 'opened-local', unavailable: false })])
  })

  it('prefers the active local terminal for the built-in local host context', () => {
    const panels = [
      { id: 'local-first', sessionId: 'session-first', status: 'running' },
      { id: 'local-active', sessionId: 'session-active', status: 'running' }
    ]
    expect(resolveClassicHostTerminalPanel(panels, {
      id: 'hosts.127.0.0.1',
      kind: 'hosts',
      label: '127.0.0.1'
    }, 'local-active')).toEqual(expect.objectContaining({ id: 'local-active' }))
  })

  it('derives opened hosts only from live terminals with the active host first', () => {
    const opened = classicOpenedHostContexts([
      {
        id: 'remote-first',
        sessionId: 'session-first',
        status: 'running',
        title: 'Production first',
        sshSession: {
          assetId: 'asset-prod',
          connectionId: 'connection-first',
          assetName: 'Production',
          host: '10.0.0.8',
          port: 22,
          username: 'ops'
        }
      },
      {
        id: 'closed',
        sessionId: 'session-closed',
        status: 'closed',
        sshSession: {
          assetId: 'asset-closed',
          assetName: 'Closed',
          host: '10.0.0.9',
          port: 22,
          username: 'ops'
        }
      },
      {
        id: 'managed-session',
        kind: 'managed-ai-session',
        sessionId: 'managed-session-id',
        status: 'running',
        title: 'Managed AI session'
      },
      {
        id: 'remote-active',
        sessionId: 'session-active',
        status: 'running',
        title: 'Production active',
        sshSession: {
          assetId: 'asset-prod',
          connectionId: 'connection-active',
          assetName: 'Production',
          host: '10.0.0.8',
          port: 2222,
          username: 'admin'
        }
      },
      {
        id: 'local',
        sessionId: 'session-local',
        status: 'running',
        title: 'Local shell'
      }
    ], 'remote-active')

    expect(opened).toEqual([
      expect.objectContaining({
        id: 'asset-prod',
        assetId: 'asset-prod',
        connectionId: 'connection-active',
        label: 'Production',
        detail: 'admin@10.0.0.8:2222'
      }),
      expect.objectContaining({
        id: 'opened-local',
        label: '127.0.0.1',
        isLocalShell: true
      })
    ])
    expect(classicActiveHostContext([
      {
        id: 'remote-active',
        sessionId: 'session-active',
        status: 'running',
        sshSession: {
          assetId: 'asset-prod',
          assetName: 'Production',
          host: '10.0.0.8',
          port: 22,
          username: 'ops'
        }
      }
    ], 'remote-active')).toEqual(expect.objectContaining({ id: 'asset-prod', host: '10.0.0.8' }))
  })

  it('limits opened hosts and ignores terminals without stable host identity', () => {
    const panels = Array.from({ length: 6 }, (_, index) => ({
      id: `remote-${index}`,
      sessionId: `session-${index}`,
      status: 'running',
      sshSession: {
        assetId: `asset-${index}`,
        assetName: `Host ${index}`,
        host: `10.0.0.${index}`,
        port: 22,
        username: 'ops'
      }
    }))
    panels.unshift({
      id: 'unowned',
      sessionId: 'session-unowned',
      status: 'running',
      sshSession: {
        assetId: '',
        assetName: 'Unowned',
        host: '10.0.0.99',
        port: 22,
        username: 'ops'
      }
    })

    expect(classicOpenedHostContexts(panels, '', 4).map((context) => context.id)).toEqual([
      'asset-0',
      'asset-1',
      'asset-2',
      'asset-3'
    ])
  })
})
