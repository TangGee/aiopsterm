import type { TerminalCreateOptions, TerminalSessionInfo } from '@shared/contracts/terminalSessions'
import { terminalClient } from '@/services/terminalClient'

type TerminalLaunchAsset = {
  id?: string
  name?: string
  title?: string
  host: string
  port?: number
  username?: string
  group_name?: string
  asset_type?: string
  auth_type?: string
  needProxy?: boolean
  proxyName?: string
  jumpHostId?: string
}

type TerminalLaunchContext = {
  panelId: string
  terminalType: string
  cols?: number
  rows?: number
  discardPendingPanel: () => void
  setNotice: (message: string) => void
  applyLocalTerminalSession: (panelId: string, session: TerminalSessionInfo) => unknown | null | undefined
  applySshTerminalSession: (panelId: string, session: TerminalSessionInfo, asset: TerminalLaunchAsset) => unknown | null | undefined
  registerSshSession: (panelId: string, asset: TerminalLaunchAsset) => unknown
  renamePanel?: (panelId: string, title: string) => void
}

export const openLocalTerminalLaunch = async (
  context: TerminalLaunchContext,
  options: { title: string; workspaceId?: string; cwd?: string; serviceUnavailableMessage?: string; failureMessage?: string }
) => {
  const createTerminal = terminalClient.createTerminal()
  const failureMessage = options.failureMessage || '本地终端启动失败'
  if (!createTerminal) {
    context.setNotice(options.serviceUnavailableMessage || '本地终端启动服务不可用')
    context.discardPendingPanel()
    return null
  }
  try {
    const createOptions: TerminalCreateOptions = {
      kind: 'local',
      panelId: context.panelId,
      workspaceId: options.workspaceId || 'workspace',
      title: options.title,
      cols: context.cols ?? 100,
      rows: context.rows ?? 30,
      terminalType: context.terminalType
    }
    if (options.cwd) createOptions.cwd = options.cwd
    const session = await createTerminal(createOptions)
    const panel = context.applyLocalTerminalSession(context.panelId, session)
    if (!panel) {
      context.setNotice(failureMessage)
      context.discardPendingPanel()
      return null
    }
    context.renamePanel?.(context.panelId, options.title)
    return panel
  } catch (error) {
    context.setNotice(error instanceof Error ? error.message : failureMessage)
    context.discardPendingPanel()
    return null
  }
}

export const openSshTerminalLaunch = async (
  context: TerminalLaunchContext,
  asset: TerminalLaunchAsset,
  options: { title: string; serviceUnavailableMessage?: string; failureMessage?: string }
) => {
  const createTerminal = terminalClient.createTerminal()
  const failureMessage = options.failureMessage || 'SSH 终端启动失败'
  if (!createTerminal) {
    context.setNotice(options.serviceUnavailableMessage || 'SSH 终端启动服务不可用')
    context.discardPendingPanel()
    return null
  }
  context.registerSshSession(context.panelId, asset)
  try {
    const session = await createTerminal({
      kind: 'ssh',
      assetId: asset.id,
      title: options.title,
      cols: context.cols ?? 100,
      rows: context.rows ?? 30,
      terminalType: context.terminalType
    })
    const panel = context.applySshTerminalSession(context.panelId, session, asset)
    if (!panel) {
      context.setNotice(failureMessage)
      context.discardPendingPanel()
      return null
    }
    return panel
  } catch (error) {
    context.setNotice(error instanceof Error ? error.message : failureMessage)
    context.discardPendingPanel()
    return null
  }
}
