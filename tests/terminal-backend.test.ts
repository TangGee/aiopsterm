import { beforeAll, describe, expect, it } from 'vitest'

let createSshTerminalConnectionInfo: (terminalId: string, target: any, options?: any, createdAt?: number) => any
let createTerminalErrorLifecycleEvent: (id: string, kind: any, error: unknown, event?: any, at?: number) => any
let createTerminalKillResult: (id: string, exists: boolean) => any
let createTerminalLifecycleEvent: (id: string, event: any, at?: number) => any
let createTerminalWriteResult: (id: string, data: string, exists: boolean) => any

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminal'
  const backend = await import(modulePath)
  createSshTerminalConnectionInfo = backend.createSshTerminalConnectionInfo
  createTerminalErrorLifecycleEvent = backend.createTerminalErrorLifecycleEvent
  createTerminalKillResult = backend.createTerminalKillResult
  createTerminalLifecycleEvent = backend.createTerminalLifecycleEvent
  createTerminalWriteResult = backend.createTerminalWriteResult
})

describe('terminal backend boundary', () => {
  it('creates backend-owned SSH connection metadata for renderer terminal panels', () => {
    const result = createSshTerminalConnectionInfo(
      'terminal-unit-1',
      {
        host: '10.8.0.6',
        port: 2222,
        username: 'ops',
        title: 'fork-source',
        asset: {
          id: 'asset-fork-unit',
          name: 'fork-source',
          title: 'fork-source',
          asset_type: 'person',
          organizationId: 'org-prod',
          group_name: '生产',
          auth_type: 'keyBased',
          needProxy: true,
          proxyName: 'release-proxy'
        }
      },
      { kind: 'ssh', assetId: 'asset-fork-unit' },
      1717200001000
    )

    expect(result).toEqual({
      connectionId: 'ssh-terminal-unit-1',
      host: '10.8.0.6',
      port: 2222,
      username: 'ops',
      assetId: 'asset-fork-unit',
      assetName: 'fork-source',
      assetType: 'person',
      organizationId: 'org-prod',
      authType: 'keyBased',
      needProxy: true,
      proxyName: 'release-proxy',
      title: 'fork-source',
      createdAt: 1717200001000
    })
  })

  it('carries fork source identity through the backend terminal boundary', () => {
    const result = createSshTerminalConnectionInfo(
      'terminal-fork-1',
      {
        host: '10.8.0.6',
        port: 22,
        username: 'ops',
        title: 'forked'
      },
      {
        kind: 'ssh',
        ssh: {
          host: '10.8.0.6',
          username: 'ops',
          forkFromConnectionId: 'ssh-source-1'
        }
      },
      1717200002000
    )

    expect(result).toMatchObject({
      connectionId: 'ssh-terminal-fork-1',
      forkFromConnectionId: 'ssh-source-1',
      createdAt: 1717200002000
    })
  })

  it('reports terminal write success and missing-session failures without renderer output fabrication', () => {
    expect(createTerminalWriteResult('terminal-write-unit', 'uptime\n', true)).toEqual({
      ok: true,
      data: {
        id: 'terminal-write-unit',
        bytes: 7
      }
    })

    expect(createTerminalWriteResult('missing-session', 'uptime\n', false)).toEqual({
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    })
  })

  it('reports terminal kill success and missing-session failures without renderer output fabrication', () => {
    expect(createTerminalKillResult('terminal-kill-unit', true)).toEqual({
      ok: true,
      data: {
        id: 'terminal-kill-unit'
      }
    })

    expect(createTerminalKillResult('missing-session', false)).toEqual({
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    })
  })

  it('normalizes terminal lifecycle events at the backend boundary', () => {
    expect(
      createTerminalLifecycleEvent(
        'terminal-life-unit',
        {
          kind: 'ssh',
          stage: 'proxy-opening',
          shell: 'ssh',
          cwd: '/home/ops',
          host: '10.8.0.6',
          port: 70000,
          username: 'ops',
          connectionId: 'ssh-terminal-life-unit',
          proxyName: 'release-proxy',
          message: 'Opening proxy'
        },
        1717200003000
      )
    ).toEqual({
      id: 'terminal-life-unit',
      kind: 'ssh',
      stage: 'proxy-opening',
      at: 1717200003000,
      shell: 'ssh',
      cwd: '/home/ops',
      host: '10.8.0.6',
      port: 65535,
      username: 'ops',
      connectionId: 'ssh-terminal-life-unit',
      proxyName: 'release-proxy',
      message: 'Opening proxy'
    })
  })

  it('classifies terminal transport failures for reconnect-aware UI state', () => {
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    expect(
      createTerminalErrorLifecycleEvent(
        'terminal-error-unit',
        'ssh',
        error,
        {
          shell: 'ssh',
          host: '10.8.0.6',
          port: 22,
          username: 'ops',
          code: 1,
          message: 'SSH connection failed.'
        },
        1717200004000
      )
    ).toEqual({
      id: 'terminal-error-unit',
      kind: 'ssh',
      stage: 'error',
      at: 1717200004000,
      shell: 'ssh',
      host: '10.8.0.6',
      port: 22,
      username: 'ops',
      message: 'SSH connection failed.',
      code: 1,
      reason: 'network',
      isNetworkDisconnect: true,
      errorCode: 'ECONNRESET',
      errorMessage: 'read ECONNRESET'
    })
  })
})
