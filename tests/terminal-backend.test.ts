import { beforeAll, describe, expect, it } from 'vitest'

let createSshTerminalConnectionInfo: (terminalId: string, target: any, options?: any, createdAt?: number) => any
let createTerminalBinaryWriteResult: (id: string, bytes: number, exists: boolean) => any
let createTerminalDataEvent: (id: string, chunk: string | Buffer) => any
let createTerminalErrorLifecycleEvent: (id: string, kind: any, error: unknown, event?: any, at?: number) => any
let createTerminalKillResult: (id: string, exists: boolean) => any
let createTerminalLifecycleEvent: (id: string, event: any, at?: number) => any
let createTerminalWriteResult: (id: string, data: string, exists: boolean) => any
let diagnoseSshConnectionError: (error: unknown, context?: any) => any

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminal'
  const backend = await import(modulePath)
  createSshTerminalConnectionInfo = backend.createSshTerminalConnectionInfo
  createTerminalBinaryWriteResult = backend.createTerminalBinaryWriteResult
  createTerminalDataEvent = backend.createTerminalDataEvent
  createTerminalErrorLifecycleEvent = backend.createTerminalErrorLifecycleEvent
  createTerminalKillResult = backend.createTerminalKillResult
  createTerminalLifecycleEvent = backend.createTerminalLifecycleEvent
  createTerminalWriteResult = backend.createTerminalWriteResult
  diagnoseSshConnectionError = backend.diagnoseSshConnectionError
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

  it('carries raw terminal bytes for ZMODEM detection while preserving display text', () => {
    expect(createTerminalDataEvent('terminal-raw-unit', Buffer.from([0x2a, 0x2a, 0x18, 0x42, 0xff]))).toEqual({
      id: 'terminal-raw-unit',
      data: '**\u0018B�',
      raw: [42, 42, 24, 66, 255]
    })

    expect(createTerminalDataEvent('terminal-text-unit', 'uptime\n')).toEqual({
      id: 'terminal-text-unit',
      data: 'uptime\n',
      raw: [117, 112, 116, 105, 109, 101, 10]
    })
  })

  it('reports terminal binary write success and missing-session failures for protocol payloads', () => {
    expect(createTerminalBinaryWriteResult('terminal-binary-unit', 20, true)).toEqual({
      ok: true,
      data: {
        id: 'terminal-binary-unit',
        bytes: 20
      }
    })

    expect(createTerminalBinaryWriteResult('missing-session', 20, false)).toEqual({
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
          targetHost: '10.8.0.7',
          targetPort: 70001,
          targetUsername: 'root',
          jumpHost: '10.8.0.5',
          jumpPort: 0,
          jumpUsername: 'relay',
          authScope: 'jump',
          authPurpose: 'keyboard-interactive',
          sshTransport: 'relay-shell',
          sshAuthMethods: 'password,keyboard-interactive',
          connectionReuse: 'reused',
          remoteHop: 'target',
          expectedHost: '10.8.0.7',
          actualHost: 'target.internal',
          actualUsername: 'root',
          endpointConfidence: 'confirmed',
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
      targetHost: '10.8.0.7',
      targetPort: 65535,
      targetUsername: 'root',
      jumpHost: '10.8.0.5',
      jumpPort: 1,
      jumpUsername: 'relay',
      authScope: 'jump',
      authPurpose: 'keyboard-interactive',
      sshTransport: 'relay-shell',
      sshAuthMethods: 'password,keyboard-interactive',
      connectionReuse: 'reused',
      remoteHop: 'target',
      expectedHost: '10.8.0.7',
      actualHost: 'target.internal',
      actualUsername: 'root',
      endpointConfidence: 'confirmed',
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

  it('diagnoses ssh authentication failures into actionable backend messages', () => {
    const passwordDisabled = diagnoseSshConnectionError(Object.assign(new Error('Permission denied (publickey).'), { level: 'client-authentication' }), {
      authType: 'password',
      hasPassword: true,
      username: 'root',
      host: '10.8.0.6'
    })
    expect(passwordDisabled).toEqual(
      expect.objectContaining({
        errorCode: 'SSH_AUTH_PASSWORD_DISABLED',
        reason: 'error',
        isNetworkDisconnect: false
      })
    )
    expect(passwordDisabled.errorMessage).toContain('服务器未开放密码登录')
    expect(passwordDisabled.errorMessage).toContain('PasswordAuthentication')

    const passwordRejected = diagnoseSshConnectionError(Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }), {
      authType: 'password',
      hasPassword: true
    })
    expect(passwordRejected).toEqual(
      expect.objectContaining({
        errorCode: 'SSH_AUTH_PASSWORD_REJECTED',
        reason: 'error',
        isNetworkDisconnect: false
      })
    )
    expect(passwordRejected.errorMessage).toContain('用户名或密码不正确')

    const keyRejected = diagnoseSshConnectionError(Object.assign(new Error('Permission denied (publickey,password).'), { level: 'client-authentication' }), {
      authType: 'keyBased',
      hasPrivateKey: true
    })
    expect(keyRejected).toEqual(
      expect.objectContaining({
        errorCode: 'SSH_AUTH_KEY_REJECTED',
        reason: 'error',
        isNetworkDisconnect: false
      })
    )
    expect(keyRejected.errorMessage).toContain('服务器拒绝当前密钥')
  })

  it('allows ssh diagnostics to override terminal error lifecycle metadata', () => {
    const diagnostic = diagnoseSshConnectionError(Object.assign(new Error('Permission denied (publickey).'), { level: 'client-authentication' }), {
      authType: 'password',
      hasPassword: true
    })

    expect(
      createTerminalErrorLifecycleEvent(
        'terminal-auth-unit',
        'ssh',
        new Error('Permission denied (publickey).'),
        {
          shell: 'ssh',
          host: '10.8.0.6',
          username: 'root',
          code: 1,
          message: 'SSH connection failed.',
          reason: diagnostic.reason,
          isNetworkDisconnect: diagnostic.isNetworkDisconnect,
          errorCode: diagnostic.errorCode,
          errorMessage: diagnostic.errorMessage
        },
        1717200005000
      )
    ).toEqual(
      expect.objectContaining({
        id: 'terminal-auth-unit',
        kind: 'ssh',
        stage: 'error',
        at: 1717200005000,
        message: 'SSH connection failed.',
        reason: 'error',
        isNetworkDisconnect: false,
        errorCode: 'SSH_AUTH_PASSWORD_DISABLED',
        errorMessage: expect.stringContaining('服务器未开放密码登录')
      })
    )
  })
})
