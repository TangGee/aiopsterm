import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createTerminalWorkspaceSessionRuntime, isTerminalWorkspaceKillSuccess } from '@/services/terminal/terminalWorkspaceSessionRuntime'
import { createEmptyTerminalPanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { TerminalCreateOptions, TerminalSessionInfo } from '@shared/contracts/terminalSessions'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

const localPanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-local', 'Local'),
  status: 'ready'
})

const sshPanel = (): TerminalPanel => ({
  ...createEmptyTerminalPanel('panel-ssh', 'Prod SSH'),
  status: 'ready',
  sshSession: {
    host: '10.0.0.8',
    port: 2222,
    username: 'ops',
    assetId: 'asset-prod',
    assetName: 'prod-host',
    assetType: 'server',
    organizationId: 'org-prod',
    authType: 'keyBased',
    needProxy: true,
    proxyName: 'bastion',
    forkFromConnectionId: 'ssh-existing'
  }
})

const session = (id: string, kind: 'local' | 'ssh' = 'local'): TerminalSessionInfo => ({
  id,
  shell: kind === 'ssh' ? 'ssh' : '/bin/bash',
  cwd: kind === 'ssh' ? '/home/ops' : '/work/app',
  kind,
  ...(kind === 'ssh'
    ? {
        connection: {
          connectionId: 'ssh-new',
          host: '10.0.0.8',
          port: 2222,
          username: 'ops',
          assetId: 'asset-prod',
          assetName: 'prod-host',
          createdAt: 1781884800000
        }
      }
    : {})
})

const createHarness = (panels: TerminalPanel[], options: { isMacroRecording?: boolean } = {}) => {
  const notices: string[] = []
  const appliedLocal: Array<{ panelId: string; session: TerminalSessionInfo }> = []
  const appliedSsh: Array<{ panelId: string; session: TerminalSessionInfo; asset: unknown }> = []
  const createTerminal = vi.fn(async (options: TerminalCreateOptions) => session(options.kind === 'ssh' ? 'ssh-session' : 'local-session', options.kind || 'local'))
  const writeTerminal = vi.fn(async (id: string, data: string) => ({ ok: true, data: { id, bytes: new TextEncoder().encode(data).length } }))
  const killTerminal = vi.fn(async (id: string) => ({ ok: true, data: { id } }))
  const recordMacroTerminalInput = vi.fn()
  const touchPanelActivity = vi.fn()
  const logs: Array<{ level: string; event: string; details?: Record<string, unknown> }> = []
  const workspace = reactive({
    panels,
    isMacroRecording: Boolean(options.isMacroRecording),
    terminalSettings: { terminalType: 'xterm-256color' },
    setTopNotice: (message: string) => {
      notices.push(message)
    },
    recordMacroTerminalInput,
    touchPanelActivity,
    applyLocalTerminalSession: (panelId: string, terminalSession: TerminalSessionInfo) => {
      appliedLocal.push({ panelId, session: terminalSession })
      const panel = panels.find((item) => item.id === panelId)
      if (!panel) return null
      panel.sessionId = terminalSession.id
      panel.status = 'running'
      panel.cwd = terminalSession.cwd
      return panel
    },
    applySshTerminalSession: (panelId: string, terminalSession: TerminalSessionInfo, asset: unknown) => {
      appliedSsh.push({ panelId, session: terminalSession, asset })
      const panel = panels.find((item) => item.id === panelId)
      if (!panel) return null
      panel.sessionId = terminalSession.id
      panel.status = 'connecting'
      panel.cwd = terminalSession.cwd
      return panel
    }
  }) as unknown as WorkspaceStore
  const runtime = createTerminalWorkspaceSessionRuntime({
    workspace,
    terminalViewSize: (panelId) => (panelId === 'panel-ssh' ? { cols: 132, rows: 43 } : { cols: 100, rows: 30 }),
    afterDomUpdate: vi.fn(async () => undefined),
    client: {
      createTerminal: () => createTerminal,
      writeTerminal: () => writeTerminal,
      killTerminal: () => killTerminal
    },
    writeRuntimeLog: (level, event, details) => {
      logs.push({ level, event, details })
    }
  })
  return {
    appliedLocal,
    appliedSsh,
    createTerminal,
    killTerminal,
    logs,
    notices,
    recordMacroTerminalInput,
    runtime,
    workspace,
    writeTerminal
  }
}

describe('terminalWorkspaceSessionRuntime', () => {
  it.each(['local', 'ssh'] as const)('kills a late %s session after its panel was removed', async (kind) => {
    const panel = kind === 'local' ? localPanel() : sshPanel()
    const f = createHarness([panel])
    let resolve!: (info: TerminalSessionInfo) => void
    f.createTerminal.mockImplementationOnce(() => new Promise<TerminalSessionInfo>((done) => { resolve = done }))
    const starting = kind === 'local' ? f.runtime.startLocalTerminalForPanel(panel) : f.runtime.startSshTerminalForPanel(panel)
    await vi.waitFor(() => expect(f.createTerminal).toHaveBeenCalledTimes(1))
    f.workspace.panels = []
    resolve(session('orphan', kind))
    expect(await starting).toBe(false)
    expect(f.killTerminal).toHaveBeenCalledWith('orphan')
    expect(f.appliedLocal).toEqual([]); expect(f.appliedSsh).toEqual([])
  })
  it('lets the latest launch win and kills an older delayed SSH response', async () => {
    const panel = sshPanel(); const f = createHarness([panel])
    let resolve!: (info: TerminalSessionInfo) => void
    f.createTerminal.mockImplementationOnce(() => new Promise<TerminalSessionInfo>((done) => { resolve = done }))
    const old = f.runtime.startSshTerminalForPanel(panel)
    await vi.waitFor(() => expect(f.createTerminal).toHaveBeenCalledTimes(1))
    expect(await f.runtime.startSshTerminalForPanel(panel)).toBe(true)
    resolve(session('obsolete', 'ssh'))
    expect(await old).toBe(false)
    expect(f.killTerminal).toHaveBeenCalledWith('obsolete')
    expect(f.appliedSsh).toHaveLength(1)
    expect(f.workspace.panels[0].sessionId).toBe('ssh-session')
  })
  it.each(['local', 'ssh'] as const)('ignores an obsolete %s launch error after a successful replacement', async (kind) => {
    const panel = kind === 'local' ? localPanel() : sshPanel()
    const f = createHarness([panel])
    let reject!: (error: Error) => void
    f.createTerminal.mockImplementationOnce(() => new Promise<TerminalSessionInfo>((_done, fail) => { reject = fail }))
    const start = () => kind === 'local' ? f.runtime.startLocalTerminalForPanel(panel) : f.runtime.startSshTerminalForPanel(panel)
    const old = start()
    await vi.waitFor(() => expect(f.createTerminal).toHaveBeenCalledTimes(1))
    expect(await start()).toBe(true)
    reject(new Error('obsolete failure'))
    expect(await old).toBe(false)
    expect(f.notices).toEqual([])
    expect(f.killTerminal).not.toHaveBeenCalled()
  })
  it('passes local cwd and only verified remote cwd to new shells', async () => {
    const local = localPanel(); local.cwd = '/work/remembered'; local.restoredHistory = true
    const ssh = sshPanel(); ssh.cwd = '/srv/verified'
    const f = createHarness([local, ssh])
    await f.runtime.startLocalTerminalForPanel(local)
    expect(f.createTerminal.mock.calls[0][0]).toMatchObject({ cwd: '/work/remembered', restoreFromRecovery: true })
    await f.runtime.startSshTerminalForPanel(ssh)
    expect(f.createTerminal.mock.calls[1][0].cwd).toBeUndefined()
    ssh.cwd = '/srv/verified'; ssh.cwdVerified = true
    await f.runtime.startSshTerminalForPanel(ssh)
    expect(f.createTerminal.mock.calls[2][0].cwd).toBe('/srv/verified')
  })
  it('stops an existing reconnect attempt before manually starting another session', async () => {
    const panel = sshPanel(); panel.sessionId = 'retrying'
    const f = createHarness([panel])
    await f.runtime.reconnectTerminalPanel(panel)
    expect(f.killTerminal).toHaveBeenCalledWith('retrying')
    expect(f.killTerminal.mock.invocationCallOrder[0]).toBeLessThan(f.createTerminal.mock.invocationCallOrder[0])
  })
  it('starts local and SSH terminal sessions through one bridge boundary', async () => {
    const local = localPanel()
    const ssh = sshPanel()
    const { appliedLocal, appliedSsh, createTerminal, runtime } = createHarness([local, ssh])

    expect(await runtime.startLocalTerminalForPanel(local)).toBe(true)
    expect(await runtime.startSshTerminalForPanel(ssh)).toBe(true)

    expect(createTerminal).toHaveBeenNthCalledWith(1, {
      kind: 'local',
      panelId: 'panel-local',
      workspaceId: 'workspace',
      cols: 100,
      rows: 30,
      terminalType: 'xterm-256color'
    })
    expect(createTerminal).toHaveBeenNthCalledWith(2, {
      kind: 'ssh',
      panelId: 'panel-ssh',
      assetId: 'asset-prod',
      title: 'Prod SSH',
      cols: 132,
      rows: 43,
      terminalType: 'xterm-256color',
      ssh: {
        host: '10.0.0.8',
        port: 2222,
        username: 'ops',
        needProxy: true,
        proxyName: 'bastion',
        forkFromConnectionId: 'ssh-existing'
      }
    })
    expect(appliedLocal[0]).toMatchObject({ panelId: 'panel-local' })
    expect(appliedSsh[0]).toMatchObject({
      panelId: 'panel-ssh',
      asset: {
        id: 'asset-prod',
        name: 'prod-host',
        host: '10.0.0.8',
        port: 2222,
        username: 'ops',
        group_name: 'org-prod',
        asset_type: 'server',
        auth_type: 'keyBased',
        needProxy: true,
        proxyName: 'bastion'
      }
    })
  })

  it('writes xterm input only when the bridge confirms the exact session and byte count', async () => {
    const panel = localPanel()
    panel.sessionId = 'session-1'
    const { logs, notices, recordMacroTerminalInput, runtime, writeTerminal } = createHarness([panel], { isMacroRecording: true })

    await runtime.writeXtermInput('session-1', 'pwd\n')
    expect(writeTerminal).toHaveBeenCalledWith('session-1', 'pwd\n')
    expect(recordMacroTerminalInput).toHaveBeenCalledWith('panel-local', 'pwd\n', expect.any(Number))
    expect(notices).toEqual([])
    expect(logs.map((entry) => entry.event)).not.toContain('renderer.terminal-input.write-accepted')

    writeTerminal.mockResolvedValueOnce({ ok: true, data: { id: 'other-session', bytes: 4 } })
    await runtime.writeXtermInput('panel-local', 'date')
    expect(notices.at(-1)).toBe('终端写入服务返回数据无效')
    expect(recordMacroTerminalInput).toHaveBeenCalledTimes(1)
    expect(logs.map((entry) => entry.event)).toContain('renderer.terminal-input.write-rejected')

    const idle = createHarness([panel])
    await idle.runtime.writeXtermInput('panel-local', 'echo idle')
    expect(idle.recordMacroTerminalInput).not.toHaveBeenCalled()
  })

  it('disconnects only when kill result belongs to the active terminal session', async () => {
    const panel = localPanel()
    panel.sessionId = 'session-1'
    panel.status = 'running'
    const { killTerminal, notices, runtime } = createHarness([panel])

    killTerminal.mockResolvedValueOnce({ ok: true, data: { id: 'other-session' } })
    expect(await runtime.disconnectTerminalPanel(panel)).toBe(false)
    expect(panel.sessionId).toBe('session-1')
    expect(panel.status).toBe('running')
    expect(notices.at(-1)).toBe('终端断开失败')

    expect(await runtime.disconnectTerminalPanel(panel)).toBe(true)
    expect(panel.sessionId).toBeUndefined()
    expect(panel.status).toBe('closed')
  })

  it('validates kill envelopes independently', () => {
    expect(isTerminalWorkspaceKillSuccess({ ok: true, data: { id: 'session-1' } }, 'session-1')).toBe(true)
    expect(isTerminalWorkspaceKillSuccess({ ok: true, data: { id: 'other' } }, 'session-1')).toBe(false)
    expect(isTerminalWorkspaceKillSuccess({ ok: false, errorMessage: 'nope' }, 'session-1')).toBe(false)
  })
})
