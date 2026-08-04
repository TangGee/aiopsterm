import type { QuickCommandScriptSegment } from '@shared/contracts/quickCommands'
import type { SecurityUserConfig } from '@shared/contracts/appRuntime'
import { validateCommandSecurity, type CommandSecurityResult } from '@/services/terminal/commandSecurityRuntime'
import { isTerminalWorkspacePanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'

export type TerminalCommandSource = 'direct' | 'global' | 'snippet' | 'agent' | 'manual-paste'

export type TerminalSecurityExecution = {
  command: string
  securityCommands?: string[]
  panelIds: string[]
  inputText: string
  shellText?: string
  writeToShell: boolean
  source: TerminalCommandSource
  snippetSegments?: QuickCommandScriptSegment[]
}

export type TerminalSecurityPrompt = {
  id: string
  command: string
  panelIds: string[]
  source: TerminalCommandSource
  result: CommandSecurityResult
  execution: TerminalSecurityExecution
} | null

export type TerminalSecurityDecision =
  | { status: 'allow'; execution?: TerminalSecurityExecution }
  | { status: 'blocked'; command: string; result: CommandSecurityResult }
  | { status: 'needs-approval'; prompt: NonNullable<TerminalSecurityPrompt> }
  | { status: 'unavailable'; command: string; panelIds: string[]; reason: string }

export type TerminalExecutionPrepareOptions = {
  securitySettings: SecurityUserConfig
  promptId: string
}

export type TerminalCommandExecutionOptions = Partial<Pick<TerminalSecurityExecution, 'inputText' | 'shellText' | 'writeToShell' | 'source'>>

export const terminalSubmitText = (text: string) => {
  const value = String(text || '')
  if (value.endsWith('\r')) return value
  if (value.endsWith('\n')) return `${value.slice(0, -1)}\r`
  return `${value}\r`
}

export const terminalExecutionUnavailable = (
  command: string,
  panelIds: string[] = [],
  reason = '终端会话不可用，请先打开本地 shell 或连接 SSH'
): TerminalSecurityDecision => ({ status: 'unavailable', command, panelIds, reason })

export const quickCommandPlanUnavailable = (
  command: string,
  panelIds: string[],
  reason = '快捷命令执行计划服务不可用'
): TerminalSecurityDecision => terminalExecutionUnavailable(command, panelIds, reason)

export const resolveQuickCommandPanelIds = (panels: TerminalPanel[], activePanel: TerminalPanel, allTabs: boolean) => {
  const terminalPanels = panels.filter((panel) => isTerminalWorkspacePanel(panel))
  if (allTabs) {
    const writablePanelIds = terminalPanels.filter((panel) => panel.sessionId).map((panel) => panel.id)
    return writablePanelIds.length ? writablePanelIds : terminalPanels.map((panel) => panel.id)
  }
  const targetPanel = isTerminalWorkspacePanel(activePanel) ? activePanel : terminalPanels[0] || activePanel
  return [targetPanel.id]
}

export const commandSecurityNotice = (result: CommandSecurityResult, command: string) => {
  const reason = result.reason || 'Security policy requires review'
  return `命令已被安全策略阻止：${command}（${reason}）`
}

export const createTerminalSecurityPrompt = (
  execution: TerminalSecurityExecution,
  securityCommand: string,
  result: CommandSecurityResult,
  promptId: string
): NonNullable<TerminalSecurityPrompt> => {
  const promptExecution = { ...execution, command: securityCommand }
  return {
    id: promptId,
    command: securityCommand,
    panelIds: execution.panelIds,
    source: execution.source,
    result,
    execution: promptExecution
  }
}

export const prepareTerminalSecurityExecution = (
  execution: TerminalSecurityExecution,
  options: TerminalExecutionPrepareOptions
): TerminalSecurityDecision => {
  if (execution.source === 'manual-paste') return { status: 'allow', execution }
  const securityCommands = execution.securityCommands?.length ? execution.securityCommands : [execution.command]
  for (const securityCommand of securityCommands) {
    const result = validateCommandSecurity(options.securitySettings, securityCommand)
    if (result.requiresApproval) {
      return {
        status: 'needs-approval',
        prompt: createTerminalSecurityPrompt(execution, securityCommand, result, options.promptId)
      }
    }
    if (!result.isAllowed) {
      return { status: 'blocked', command: securityCommand, result }
    }
  }
  return { status: 'allow', execution }
}

export const createTerminalSecurityExecution = (
  panelId: string,
  command: string,
  options: TerminalCommandExecutionOptions = {}
): TerminalSecurityDecision => {
  const text = command.trim()
  if (!text) return { status: 'allow' }
  const writeToShell = options.writeToShell ?? true
  return {
    status: 'allow',
    execution: {
      command: text,
      panelIds: [panelId],
      inputText: options.inputText ?? terminalSubmitText(text),
      shellText: options.shellText ?? terminalSubmitText(text),
      writeToShell,
      source: options.source ?? 'direct'
    }
  }
}

export const createGlobalTerminalSecurityExecution = (
  command: string,
  writablePanelIds: string[],
  allTerminalPanelIds: string[],
  hasWriteBridge: boolean
): TerminalSecurityDecision => {
  const text = command.trim()
  if (!text) return { status: 'allow' }
  if (!writablePanelIds.length || !hasWriteBridge) return terminalExecutionUnavailable(text, allTerminalPanelIds)
  return {
    status: 'allow',
    execution: {
      command: text,
      panelIds: writablePanelIds,
      inputText: terminalSubmitText(text),
      shellText: terminalSubmitText(text),
      writeToShell: true,
      source: 'global'
    }
  }
}

export const terminalSecurityPromptCancellationNotice = (command: string) => `命令执行已取消：${command}`

export const terminalSecurityExecutionShouldWrite = (
  decision: TerminalSecurityDecision
): decision is { status: 'allow'; execution: TerminalSecurityExecution } =>
  decision.status === 'allow' && decision.execution?.writeToShell === true
