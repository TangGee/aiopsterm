import { computed, type ComputedRef, type Ref } from 'vue'
import { aiBridgeErrorMessage } from '@/services/ai/aiChatBackendGuards'
import { terminalClient } from '@/services/terminal/terminalClient'
import {
  isTerminalCommandGenerationRecord,
  terminalWriteExceptionReason,
  validateTerminalWriteResult
} from '@/services/terminal/terminalBackendGuards'
import {
  addTerminalCommandGenerationRecord,
  prepareTerminalCommandGeneration,
  terminalCommandGenerationRecordMatchesRequest,
  terminalCommandModelOptions as terminalCommandModelOptionsRuntime
} from '@/services/terminal/terminalCommandRuntime'
import {
  commandSecurityNotice,
  createGlobalTerminalSecurityExecution,
  createTerminalSecurityExecution,
  prepareTerminalSecurityExecution as prepareTerminalSecurityExecutionRuntime,
  terminalExecutionUnavailable,
  terminalSecurityExecutionShouldWrite,
  terminalSecurityPromptCancellationNotice,
  type TerminalCommandExecutionOptions,
  type TerminalCommandSource,
  type TerminalSecurityDecision,
  type TerminalSecurityExecution,
  type TerminalSecurityPrompt
} from '@/services/terminal/terminalExecutionRuntime'
import { waitForTerminalOutputAfter as waitForTerminalOutputAfterRuntime } from '@/services/terminal/terminalAgentLoopRuntime'
import {
  applyTerminalInputExecutionToPanels,
  appendGeneratedTerminalCommandToPanel,
  canWriteTerminalPanels,
  collectTerminalInputExecutionRecords,
  liveTerminalPanelIds,
  resolveActiveWritableTerminalPanel as resolveActiveWritableTerminalPanelFromCollection,
  resolveTerminalPanelSessionWrite,
  terminalPanelIds,
  type TerminalPanel
} from '@/services/terminal/terminalPanelRuntime'
import type { SecuritySettings, SettingsModelOption } from '@/services/settings/workspaceConfigRuntime'
import type { TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

export type {
  TerminalCommandSource,
  TerminalSecurityDecision,
  TerminalSecurityExecution,
  TerminalSecurityPrompt
} from '@/services/terminal/terminalExecutionRuntime'

type WorkspaceTerminalExecutionControllerState = {
  panels: Ref<TerminalPanel[]>
  activePanel: ComputedRef<TerminalPanel>
  securitySettings: Ref<SecuritySettings>
  settingModelOptions: Ref<SettingsModelOption[]>
  terminalSecurityPrompt: Ref<TerminalSecurityPrompt>
  terminalCommandGenerationRecords: Ref<TerminalCommandGenerationRecord[]>
}

type WorkspaceTerminalExecutionControllerDeps = {
  setTopNotice: (message: string) => void
  createRendererLocalId: (prefix: 'terminal-security') => string
  recordMacroTerminalInput: (panelId: string, data: string) => void
}

export const createWorkspaceTerminalExecutionController = (
  state: WorkspaceTerminalExecutionControllerState,
  deps: WorkspaceTerminalExecutionControllerDeps
) => {
  const {
    panels,
    activePanel,
    securitySettings,
    settingModelOptions,
    terminalSecurityPrompt,
    terminalCommandGenerationRecords
  } = state
  const { setTopNotice, createRendererLocalId, recordMacroTerminalInput } = deps

  const terminalCommandModelOptions = computed(() => terminalCommandModelOptionsRuntime(settingModelOptions.value))

  const applyTerminalExecution = (execution: TerminalSecurityExecution) => {
    applyTerminalInputExecutionToPanels(panels.value, execution).forEach(({ panel, text }) => recordMacroTerminalInput(panel.id, text))
  }

  const recordTerminalExecutionInput = (execution: TerminalSecurityExecution) => {
    collectTerminalInputExecutionRecords(panels.value, execution).forEach(({ panel, text }) => recordMacroTerminalInput(panel.id, text))
  }

  const reportTerminalExecutionUnavailable = (command: string, panelIds: string[] = [], reason = '终端会话不可用，请先打开本地 shell 或连接 SSH') => {
    setTopNotice(reason)
    terminalSecurityPrompt.value = null
    return terminalExecutionUnavailable(command, panelIds, reason)
  }

  const writeTerminalSegment = async (sessionId: string, data: string) => {
    const writeTerminal = terminalClient.writeTerminal()
    if (!writeTerminal) return { ok: false, reason: '终端写入服务不可用' }
    try {
      const result = await writeTerminal(sessionId, data)
      return validateTerminalWriteResult(result, sessionId, data)
    } catch (error) {
      return { ok: false, reason: terminalWriteExceptionReason(error) }
    }
  }

  const waitForSnippetDelay = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, delayMs)))

  const canWriteTerminalExecution = (execution: Pick<TerminalSecurityExecution, 'panelIds' | 'writeToShell'>) => {
    if (!execution.writeToShell) return true
    if (!terminalClient.writeTerminal()) return false
    return canWriteTerminalPanels(panels.value, execution)
  }

  const prepareTerminalSecurityExecution = (execution: TerminalSecurityExecution): TerminalSecurityDecision => {
    const decision = prepareTerminalSecurityExecutionRuntime(execution, {
      securitySettings: securitySettings.value,
      promptId: createRendererLocalId('terminal-security')
    })
    if (decision.status === 'needs-approval') {
      terminalSecurityPrompt.value = decision.prompt
      return decision
    }
    if (decision.status === 'blocked') {
      setTopNotice(commandSecurityNotice(decision.result, decision.command))
      terminalSecurityPrompt.value = null
      return decision
    }
    terminalSecurityPrompt.value = null
    if (!execution.writeToShell) applyTerminalExecution(execution)
    return decision
  }

  const writeTerminalExecution = async (execution: TerminalSecurityExecution): Promise<TerminalSecurityDecision> => {
    if (!execution.writeToShell) {
      applyTerminalExecution(execution)
      return { status: 'allow', execution }
    }
    if (!canWriteTerminalExecution(execution)) {
      return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
    }
    if (execution.source === 'snippet' && execution.snippetSegments?.length) {
      for (const segment of execution.snippetSegments) {
        if (segment.delayBeforeMs > 0) await waitForSnippetDelay(segment.delayBeforeMs)
        for (const panelId of execution.panelIds) {
          const write = resolveTerminalPanelSessionWrite(panels.value, panelId)
          if (!write) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
          const writeResult = await writeTerminalSegment(write.sessionId, segment.text)
          if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
        }
      }
      return { status: 'allow', execution }
    }
    for (const panelId of execution.panelIds) {
      const write = resolveTerminalPanelSessionWrite(panels.value, panelId)
      if (!write) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
      const writeData = execution.shellText || execution.inputText
      const writeResult = await writeTerminalSegment(write.sessionId, writeData)
      if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
    }
    recordTerminalExecutionInput(execution)
    return { status: 'allow', execution }
  }

  const executeTerminalCommand = (panelId: string, command: string, options: TerminalCommandExecutionOptions = {}) => {
    const decision = createTerminalSecurityExecution(panelId, command, options)
    if (decision.status !== 'allow' || !decision.execution) return decision
    return prepareTerminalSecurityExecution(decision.execution)
  }

  const runTerminalCommand = async (
    panelId: string,
    command: string,
    options: TerminalCommandExecutionOptions = {}
  ) => {
    const decision = executeTerminalCommand(panelId, command, options)
    if (!terminalSecurityExecutionShouldWrite(decision)) return decision
    return writeTerminalExecution(decision.execution)
  }

  const executeGlobalTerminalCommand = (command: string) => {
    const decision = createGlobalTerminalSecurityExecution(command, liveTerminalPanelIds(panels.value), terminalPanelIds(panels.value), Boolean(terminalClient.writeTerminal()))
    if (decision.status === 'unavailable') {
      setTopNotice(decision.reason)
      terminalSecurityPrompt.value = null
      return decision
    }
    if (decision.status !== 'allow' || !decision.execution) return decision
    return prepareTerminalSecurityExecution(decision.execution)
  }

  const runGlobalTerminalCommand = async (command: string) => {
    const decision = executeGlobalTerminalCommand(command)
    if (!terminalSecurityExecutionShouldWrite(decision)) return decision
    return writeTerminalExecution(decision.execution)
  }

  const approveTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    if (!canWriteTerminalExecution(prompt.execution)) {
      reportTerminalExecutionUnavailable(prompt.command, prompt.panelIds)
      return null
    }
    terminalSecurityPrompt.value = null
    if (!prompt.execution.writeToShell) applyTerminalExecution(prompt.execution)
    return prompt.execution
  }

  const cancelTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    setTopNotice(terminalSecurityPromptCancellationNotice(prompt.command))
    terminalSecurityPrompt.value = null
    return prompt.execution
  }

  const resolveActiveWritableTerminalPanel = () =>
    resolveActiveWritableTerminalPanelFromCollection(panels.value, activePanel.value)

  const waitForTerminalOutputAfter = (panelId: string, startLength: number, timeoutMs = 2_500) =>
    waitForTerminalOutputAfterRuntime(() => panels.value.find((item) => item.id === panelId || item.sessionId === panelId), startLength, timeoutMs)

  const stageActiveTerminalCommand = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return executeTerminalCommand(panel.id, text, { source: 'agent', writeToShell: true })
  }

  const runActiveTerminalCommand = async (command: string, source: TerminalCommandSource = 'agent') => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return runTerminalCommand(panel.id, text, { source, writeToShell: true })
  }

  const appendActiveTerminalInput = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    if (!panel) return null
    return executeTerminalCommand(panel.id, command, { writeToShell: false, source: 'agent' })
  }

  const generateTerminalCommand = async (panelId: string, instruction: string, modelName?: string) => {
    const plan = prepareTerminalCommandGeneration(panels.value, {
      panelId,
      instruction,
      modelName,
      modelOptions: terminalCommandModelOptions.value
    })
    if (!plan.ok) {
      if (plan.reason === 'missing-model') {
        setTopNotice('请先配置可用模型')
      }
      return null
    }
    const { request } = plan
    if (!request.modelName) {
      setTopNotice('请先配置可用模型')
      return null
    }
    const generateTerminalCommandBridge = terminalClient.generateTerminalCommand()
    if (!generateTerminalCommandBridge) {
      setTopNotice('终端命令生成服务不可用')
      return null
    }

    let result: Awaited<ReturnType<AiopsPreloadApi['generateTerminalCommand']>>
    try {
      result = await generateTerminalCommandBridge(request)
    } catch (error) {
      setTopNotice(aiBridgeErrorMessage(error, '终端命令生成失败'))
      return null
    }
    if (!result.ok) {
      setTopNotice(result.errorMessage || '终端命令生成失败')
      return null
    }
    if (!isTerminalCommandGenerationRecord(result.data) || !terminalCommandGenerationRecordMatchesRequest(result.data, request)) {
      setTopNotice('终端命令生成结果无效')
      return null
    }
    const record = result.data
    terminalCommandGenerationRecords.value = addTerminalCommandGenerationRecord(terminalCommandGenerationRecords.value, record)
    return record
  }

  const injectGeneratedTerminalCommand = (panelId: string, command: string) => {
    const applied = appendGeneratedTerminalCommandToPanel(panels.value, panelId, command)
    if (!applied) return null
    recordMacroTerminalInput(applied.panel.id, applied.text)
    return { status: 'allow' } as TerminalSecurityDecision
  }

  return {
    terminalCommandModelOptions,
    applyTerminalExecution,
    recordTerminalExecutionInput,
    reportTerminalExecutionUnavailable,
    canWriteTerminalExecution,
    prepareTerminalSecurityExecution,
    writeTerminalExecution,
    executeTerminalCommand,
    runTerminalCommand,
    executeGlobalTerminalCommand,
    runGlobalTerminalCommand,
    approveTerminalSecurityPrompt,
    cancelTerminalSecurityPrompt,
    resolveActiveWritableTerminalPanel,
    waitForTerminalOutputAfter,
    stageActiveTerminalCommand,
    runActiveTerminalCommand,
    appendActiveTerminalInput,
    generateTerminalCommand,
    injectGeneratedTerminalCommand
  }
}
