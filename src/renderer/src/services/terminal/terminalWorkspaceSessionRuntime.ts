import { terminalClient } from '@/services/terminal/terminalClient'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'
import { shouldUseTerminalDebugLogs } from '@shared/runtimeSwitches'
import type {
  TerminalCreateOptions,
  TerminalKillResult,
  TerminalSessionInfo,
  TerminalWriteResult
} from '@shared/contracts/terminalSessions'

type TerminalWorkspaceSessionClient = {
  createTerminal: () => ((options: TerminalCreateOptions) => Promise<TerminalSessionInfo>) | undefined
  writeTerminal: () => ((id: string, data: string) => Promise<TerminalWriteResult>) | undefined
  killTerminal: () => ((id: string) => Promise<TerminalKillResult>) | undefined
}

export type TerminalWorkspaceSessionRuntimeOptions = {
  workspace: ReturnType<typeof useWorkspaceStore>
  terminalViewSize: (panelId: string) => { cols: number; rows: number }
  afterDomUpdate: () => void | Promise<void>
  client?: TerminalWorkspaceSessionClient
  writeRuntimeLog?: (level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: Record<string, unknown>) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isTerminalWorkspaceKillSuccess = (result: TerminalKillResult | null | undefined, sessionId: string) =>
  result?.ok === true && isRecord(result.data) && result.data.id === sessionId

export const createTerminalWorkspaceSessionRuntime = ({
  workspace,
  terminalViewSize,
  afterDomUpdate,
  client = terminalClient,
  writeRuntimeLog = writeRendererRuntimeLog
}: TerminalWorkspaceSessionRuntimeOptions) => {
  const writeTerminalDebugLog = (event: string, details?: Record<string, unknown>) => {
    if (shouldUseTerminalDebugLogs()) writeRuntimeLog('debug', event, details)
  }
  const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId)

  const writeXtermInput = async (panelId: string, data: string) => {
    const inputTimestamp = Date.now()
    const shouldRecordMacroInput = workspace.isMacroRecording
    const panel = panelById(panelId)
    const sessionId = panel?.sessionId
    const bytes = new TextEncoder().encode(data).length
    if (!panel || !sessionId) {
      workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
      writeRuntimeLog('warn', 'renderer.terminal-input.missing-session', {
        panelId,
        bytes
      })
      return
    }
    const writeTerminal = client.writeTerminal()
    if (!writeTerminal) {
      workspace.setTopNotice('终端写入服务不可用')
      writeRuntimeLog('warn', 'renderer.terminal-input.missing-bridge', {
        panelId,
        sessionId,
        bytes
      })
      return
    }
    try {
      writeTerminalDebugLog('renderer.terminal-input.write-request', {
        panelId,
        sessionId,
        bytes
      })
      const result = await writeTerminal(sessionId, data)
      if (!result?.ok || !isRecord(result.data) || result.data.id !== sessionId || result.data.bytes !== bytes) {
        workspace.setTopNotice(result?.errorMessage || '终端写入服务返回数据无效')
        writeRuntimeLog('warn', 'renderer.terminal-input.write-rejected', {
          panelId,
          sessionId,
          bytes,
          ok: result?.ok,
          errorCode: result?.errorCode,
          errorMessage: result?.errorMessage
        })
        return
      }
      if (shouldRecordMacroInput) workspace.recordMacroTerminalInput(panel.id, data, inputTimestamp)
      workspace.touchPanelActivity(panel.id, inputTimestamp)
      writeTerminalDebugLog('renderer.terminal-input.write-accepted', {
        panelId,
        sessionId,
        bytes
      })
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '终端写入失败，请重新打开本地 shell 或连接 SSH'
      workspace.setTopNotice(message)
      writeRuntimeLog('error', 'renderer.terminal-input.write-error', {
        panelId,
        sessionId,
        bytes,
        message
      })
    }
  }

  const startLocalTerminalForPanel = async (panel: TerminalPanel) => {
    const createTerminal = client.createTerminal()
    if (!createTerminal) {
      workspace.setTopNotice('本地终端启动服务不可用')
      return false
    }
    await afterDomUpdate()
    const size = terminalViewSize(panel.id)
    try {
      const session = await createTerminal({
        kind: 'local',
        panelId: panel.id,
        workspaceId: 'workspace',
        cols: size.cols,
        rows: size.rows,
        terminalType: workspace.terminalSettings.terminalType
      })
      const connected = Boolean(workspace.applyLocalTerminalSession(panel.id, session))
      if (!connected) workspace.setTopNotice('本地终端启动失败')
      return connected
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
      return false
    }
  }

  const startSshTerminalForPanel = async (panel: TerminalPanel) => {
    const ssh = panel.sshSession
    if (!ssh) return false
    const createTerminal = client.createTerminal()
    if (!createTerminal) {
      workspace.setTopNotice('SSH 终端启动服务不可用')
      return false
    }
    await afterDomUpdate()
    const size = terminalViewSize(panel.id)
    try {
      const session = await createTerminal({
        kind: 'ssh',
        panelId: panel.id,
        assetId: ssh.assetId,
        title: panel.title,
        cols: size.cols,
        rows: size.rows,
        terminalType: workspace.terminalSettings.terminalType,
        ssh: {
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          needProxy: Boolean(ssh.needProxy),
          proxyName: ssh.proxyName || '',
          ...(ssh.jumpHostId ? { jumpHostId: ssh.jumpHostId } : {}),
          ...(ssh.forkFromConnectionId ? { forkFromConnectionId: ssh.forkFromConnectionId } : {})
        }
      })
      const connected = Boolean(workspace.applySshTerminalSession(panel.id, session, {
        id: ssh.assetId,
        name: ssh.assetName,
        title: ssh.assetName,
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        group_name: ssh.organizationId,
        asset_type: ssh.assetType,
        auth_type: ssh.authType,
        needProxy: ssh.needProxy,
        proxyName: ssh.proxyName,
        jumpHostId: ssh.jumpHostId
      }))
      if (!connected) workspace.setTopNotice('SSH 终端启动失败')
      return connected
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : 'SSH 终端启动失败')
      return false
    }
  }

  const disconnectTerminalPanel = async (panel: TerminalPanel) => {
    if (!panel.sessionId) {
      workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
      return false
    }
    const killTerminal = client.killTerminal()
    if (!killTerminal) {
      workspace.setTopNotice('终端断开服务不可用')
      return false
    }
    const sessionId = panel.sessionId
    let result: TerminalKillResult
    try {
      result = await killTerminal(sessionId)
    } catch (error) {
      workspace.setTopNotice(error instanceof Error ? error.message : '终端断开失败')
      return false
    }
    if (!isTerminalWorkspaceKillSuccess(result, sessionId)) {
      workspace.setTopNotice(result?.ok ? '终端断开失败' : result?.errorMessage || '终端断开失败')
      return false
    }
    if (panel.sessionId === sessionId) {
      panel.sessionId = undefined
      panel.status = 'closed'
    }
    return true
  }

  const reconnectTerminalPanel = async (panel: TerminalPanel) => {
    return panel.sshSession ? startSshTerminalForPanel(panel) : startLocalTerminalForPanel(panel)
  }

  return {
    disconnectTerminalPanel,
    reconnectTerminalPanel,
    startLocalTerminalForPanel,
    startSshTerminalForPanel,
    writeXtermInput
  }
}
