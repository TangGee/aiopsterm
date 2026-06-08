import { beforeAll, describe, expect, it } from 'vitest'

let createSshTerminalConnectionInfo: (terminalId: string, target: any, options?: any, createdAt?: number) => any
let createTerminalKillResult: (id: string, exists: boolean) => any
let createTerminalWriteResult: (id: string, data: string, exists: boolean) => any

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminal'
  const backend = await import(modulePath)
  createSshTerminalConnectionInfo = backend.createSshTerminalConnectionInfo
  createTerminalKillResult = backend.createTerminalKillResult
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
          auth_type: 'keyBased'
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
})
