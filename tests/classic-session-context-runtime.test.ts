import { describe, expect, it } from 'vitest'
import {
  classicHostTargetId,
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
})
