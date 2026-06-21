import { computed, type ComputedRef, type Ref } from 'vue'
import {
  isQuickCommandGroupDeleteData,
  isQuickCommandGroupSaveData,
  isQuickCommandMacroSaveData,
  isQuickCommandReorderData,
  isQuickCommandsSnapshotData,
  isQuickCommandScriptPlanForRequest,
  isQuickCommandSnippetDeleteData,
  isQuickCommandSnippetSaveData,
  malformedQuickCommandsBackendResultMessage
} from '@/services/quickCommandsBackendGuards'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import {
  addMacroCommandEntry as addMacroCommandEntryRuntime,
  cloneMacroRecordingState,
  cloneQuickCommandsSnapshot,
  commitMacroCurrentLine as commitMacroCurrentLineRuntime,
  currentSnippetGroupName as resolveCurrentSnippetGroupName,
  filteredQuickCommands as filterQuickCommands,
  macroSaveDraft,
  recordedMacroCommands,
  recordMacroCommandText,
  recordMacroTerminalInputState,
  reorderQuickCommandPlan,
  resetMacroRecordingState as resetMacroRecordingStateRuntime,
  selectedGroupAfterDelete,
  startMacroRecordingState,
  type MacroRecordingState,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quickCommandsRuntime'
import {
  MACRO_MAX_RECORDING_DURATION_MS,
  normalizeMacroSleepThreshold,
  type MacroCommandEntry
} from '@/services/terminalMacroRuntime'
import {
  quickCommandPlanUnavailable,
  resolveQuickCommandPanelIds,
  type TerminalSecurityDecision,
  type TerminalSecurityExecution
} from '@/services/terminalExecutionRuntime'
import { mergeUserConfig } from '@/services/workspaceConfigRuntime'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { QuickCommandScriptPlan } from '@shared/contracts/quickCommands'

type QuickCommandScriptPlanResolution =
  | { ok: true; plan: QuickCommandScriptPlan }
  | { ok: false; reason: string }

type WorkspaceQuickCommandsControllerState = {
  config: Ref<UserConfig>
  snippetGroups: Ref<SnippetGroup[]>
  quickCommands: Ref<QuickCommandSnippet[]>
  selectedSnippetGroupUuid: Ref<string | null>
  snippetSearchQuery: Ref<string>
  macroRecording: Ref<MacroRecordingState>
  macroRecordControlKeys: Ref<boolean>
  macroSleepThresholdMs: Ref<number>
  panels: Ref<TerminalPanel[]>
  activePanel: ComputedRef<TerminalPanel>
}

type WorkspaceQuickCommandsControllerDeps = {
  setTopNotice: (message: string) => void
  clearTerminalSecurityPrompt: () => void
  prepareTerminalSecurityExecution: (execution: TerminalSecurityExecution) => TerminalSecurityDecision
  writeTerminalExecution: (execution: TerminalSecurityExecution) => Promise<TerminalSecurityDecision>
}

export const createWorkspaceQuickCommandsController = (
  state: WorkspaceQuickCommandsControllerState,
  deps: WorkspaceQuickCommandsControllerDeps
) => {
  const {
    config,
    snippetGroups,
    quickCommands,
    selectedSnippetGroupUuid,
    snippetSearchQuery,
    macroRecording,
    macroRecordControlKeys,
    macroSleepThresholdMs,
    panels,
    activePanel
  } = state
  const { setTopNotice, clearTerminalSecurityPrompt, prepareTerminalSecurityExecution, writeTerminalExecution } = deps

  let macroAutoStopTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  const filteredQuickCommands = computed(() => filterQuickCommands(quickCommands.value, snippetSearchQuery.value, selectedSnippetGroupUuid.value))
  const currentSnippetGroupName = computed(() => resolveCurrentSnippetGroupName(snippetGroups.value, selectedSnippetGroupUuid.value))
  const isMacroRecording = computed(() => macroRecording.value.isRecording)
  const recordedCommands = computed(() => recordedMacroCommands(macroRecording.value))
  const macroCurrentLineBuffer = computed(() => macroRecording.value.currentLineBuffer)
  const macroTerminalId = computed(() => macroRecording.value.terminalId)
  const macroLimitReason = computed(() => macroRecording.value.limitReason)

  const applyQuickCommandsSnapshot = (snapshot: unknown) => {
    if (!isQuickCommandsSnapshotData(snapshot)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    const quickCommandsSnapshot = cloneQuickCommandsSnapshot(snapshot)
    snippetGroups.value = quickCommandsSnapshot.groups
    quickCommands.value = quickCommandsSnapshot.snippets
    config.value = mergeUserConfig(config.value, { quickCommands: quickCommandsSnapshot })
    return true
  }

  const refreshQuickCommands = async () => {
    const getQuickCommands = quickCommandsClient.getQuickCommands()
    if (!getQuickCommands) {
      setTopNotice('快捷命令加载服务不可用')
      return false
    }
    try {
      const snapshot = await getQuickCommands()
      return applyQuickCommandsSnapshot(snapshot)
    } catch {
      setTopNotice('快捷命令加载失败')
      return false
    }
  }

  const createSnippetGroup = async (groupName: string) => {
    const name = groupName.trim()
    if (!name) return null
    const saveQuickCommandGroup = quickCommandsClient.saveQuickCommandGroup()
    if (!saveQuickCommandGroup) {
      setTopNotice('快捷命令分组写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveQuickCommandGroup({ group_name: name })
    } catch {
      setTopNotice('快捷命令分组写入失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组写入失败')
      return null
    }
    if (!isQuickCommandGroupSaveData(result.data, { groupName: name })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    return result.data.group
  }

  const renameSnippetGroup = async (uuid: string, groupName: string) => {
    const name = groupName.trim()
    if (!name) return false
    const saveQuickCommandGroup = quickCommandsClient.saveQuickCommandGroup()
    if (!saveQuickCommandGroup) {
      setTopNotice('快捷命令分组写入服务不可用')
      return false
    }
    let result
    try {
      result = await saveQuickCommandGroup({ uuid, group_name: name })
    } catch {
      setTopNotice('快捷命令分组写入失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组写入失败')
      return false
    }
    if (!isQuickCommandGroupSaveData(result.data, { uuid, groupName: name })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const deleteSnippetGroup = async (uuid: string) => {
    const deleteQuickCommandGroup = quickCommandsClient.deleteQuickCommandGroup()
    if (!deleteQuickCommandGroup) {
      setTopNotice('快捷命令分组删除服务不可用')
      return false
    }
    let result
    try {
      result = await deleteQuickCommandGroup(uuid)
    } catch {
      setTopNotice('快捷命令分组删除失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组删除失败')
      return false
    }
    if (!isQuickCommandGroupDeleteData(result.data, uuid)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    selectedSnippetGroupUuid.value = selectedGroupAfterDelete(selectedSnippetGroupUuid.value, uuid)
    return true
  }

  const createQuickCommand = async (payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return null
    const saveQuickCommandSnippet = quickCommandsClient.saveQuickCommandSnippet()
    if (!saveQuickCommandSnippet) {
      setTopNotice('快捷命令写入服务不可用')
      return null
    }
    const result = await saveQuickCommandSnippet({
      snippet_name: snippetName,
      snippet_content: payload.snippet_content,
      group_uuid: payload.group_uuid ?? null
    }).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令写入失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令写入失败')
      return null
    }
    if (!isQuickCommandSnippetSaveData(result.data, { snippetName, snippetContent: payload.snippet_content, groupUuid: payload.group_uuid ?? null })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('快捷命令已保存。')
    return result.data.snippet
  }

  const updateQuickCommand = async (id: number, payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return false
    const saveQuickCommandSnippet = quickCommandsClient.saveQuickCommandSnippet()
    if (!saveQuickCommandSnippet) {
      setTopNotice('快捷命令写入服务不可用')
      return false
    }
    const result = await saveQuickCommandSnippet({
        id,
        snippet_name: snippetName,
        snippet_content: payload.snippet_content,
        group_uuid: payload.group_uuid ?? null
      })
      .catch(() => null)
    if (!result) {
      setTopNotice('快捷命令写入失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令写入失败')
      return false
    }
    if (!isQuickCommandSnippetSaveData(result.data, { id, snippetName, snippetContent: payload.snippet_content, groupUuid: payload.group_uuid ?? null })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('快捷命令已保存。')
    return true
  }

  const deleteQuickCommand = async (id: number) => {
    const deleteQuickCommandSnippet = quickCommandsClient.deleteQuickCommandSnippet()
    if (!deleteQuickCommandSnippet) {
      setTopNotice('快捷命令删除服务不可用')
      return false
    }
    const result = await deleteQuickCommandSnippet(id).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令删除失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令删除失败')
      return false
    }
    if (!isQuickCommandSnippetDeleteData(result.data, id)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const reorderQuickCommand = async (sourceId: number, targetId: number) => {
    const reorderQuickCommands = quickCommandsClient.reorderQuickCommands()
    if (!reorderQuickCommands) {
      setTopNotice('快捷命令排序服务不可用')
      return false
    }
    const plan = reorderQuickCommandPlan(filteredQuickCommands.value, sourceId, targetId, selectedSnippetGroupUuid.value || null)
    if (!plan) return false
    const { orderedIds, groupUuid } = plan
    const result = await reorderQuickCommands({ orderedIds, groupUuid }).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令排序失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令排序失败')
      return false
    }
    if (!isQuickCommandReorderData(result.data, orderedIds, groupUuid)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const reportQuickCommandPlanUnavailable = (command: string, panelIds: string[], reason = '快捷命令执行计划服务不可用') => {
    setTopNotice(reason)
    clearTerminalSecurityPrompt()
    return quickCommandPlanUnavailable(command, panelIds, reason)
  }

  const resolveQuickCommandScriptPlan = async (command: QuickCommandSnippet, autoExecute: boolean): Promise<QuickCommandScriptPlanResolution> => {
    const planQuickCommandScriptBridge = quickCommandsClient.planQuickCommandScript()
    if (!planQuickCommandScriptBridge) return { ok: false, reason: '快捷命令执行计划服务不可用' }
    try {
      const result = await planQuickCommandScriptBridge({ snippetId: command.id, autoExecute })
      if (!result) return { ok: false, reason: '快捷命令执行计划生成失败' }
      if (!result.ok) return { ok: false, reason: result.errorMessage || '快捷命令执行计划生成失败' }
      if (!isQuickCommandScriptPlanForRequest(result.data, { snippetId: command.id, snippetName: command.snippet_name, autoExecute })) {
        return { ok: false, reason: malformedQuickCommandsBackendResultMessage }
      }
      return { ok: true, plan: result.data }
    } catch {
      return { ok: false, reason: '快捷命令执行计划生成失败' }
    }
  }

  const runQuickCommand = async (id: number, autoExecute = true, allTabs = false) => {
    const command = quickCommands.value.find((item) => item.id === id)
    if (!command) return
    const targetPanelIds = resolveQuickCommandPanelIds(panels.value, activePanel.value, allTabs)
    const planResolution = await resolveQuickCommandScriptPlan(command, autoExecute)
    if (!planResolution.ok) {
      return reportQuickCommandPlanUnavailable(command.snippet_name, targetPanelIds, planResolution.reason)
    }
    const plan = planResolution.plan
    if (!plan.segments.length) {
      return reportQuickCommandPlanUnavailable(command.snippet_name, targetPanelIds, '快捷命令内容为空')
    }
    const decision = prepareTerminalSecurityExecution({
      command: plan.securityCommand || command.snippet_name,
      securityCommands: plan.commands,
      panelIds: targetPanelIds,
      inputText: plan.shellText,
      shellText: plan.shellText,
      writeToShell: true,
      source: 'snippet',
      snippetSegments: plan.segments
    })
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
  }

  const clearMacroAutoStopTimer = () => {
    if (macroAutoStopTimer !== null) {
      clearTimeout(macroAutoStopTimer)
      macroAutoStopTimer = null
    }
  }

  const applyMacroRecordingState = (state: MacroRecordingState) => {
    macroRecording.value = cloneMacroRecordingState(state)
  }

  const commitMacroCurrentLine = (timestamp = Date.now()) => {
    const result = commitMacroCurrentLineRuntime(macroRecording.value, timestamp)
    applyMacroRecordingState(result.state)
    if (result.limitReached) void autoStopMacroRecording('count')
    return result.added
  }

  function addMacroCommandEntry(command: string, timestamp = Date.now()) {
    const result = addMacroCommandEntryRuntime(macroRecording.value, command, timestamp)
    applyMacroRecordingState(result.state)
    if (result.limitReached) void autoStopMacroRecording('count')
    return result.added
  }

  const saveMacroSnippet = async (
    entries: MacroCommandEntry[],
    snippetName: string,
    groupUuid: string | null,
    sleepThresholdMs = macroSleepThresholdMs.value
  ) => {
    if (!entries.length) return null
    const saveQuickCommandMacro = quickCommandsClient.saveQuickCommandMacro()
    if (!saveQuickCommandMacro) {
      setTopNotice('宏录制保存服务不可用')
      return null
    }
    let result
    try {
      result = await saveQuickCommandMacro({
        snippet_name: snippetName,
        group_uuid: groupUuid,
        entries: entries.map((entry) => ({ command: entry.command, timestamp: entry.timestamp })),
        sleepThresholdMs
      })
    } catch {
      setTopNotice('宏录制保存失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '宏录制保存失败')
      return null
    }
    if (!isQuickCommandMacroSaveData(result.data, { snippetName, groupUuid })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('宏录制已保存为快捷命令。')
    return result.data.snippet
  }

  const resetMacroRecordingState = () => {
    clearMacroAutoStopTimer()
    applyMacroRecordingState(resetMacroRecordingStateRuntime(macroRecording.value.limitReason))
  }

  async function autoStopMacroRecording(reason: 'time' | 'count') {
    if (!isMacroRecording.value) return null
    applyMacroRecordingState({ ...macroRecording.value, limitReason: reason })
    commitMacroCurrentLine()
    const draft = macroSaveDraft(macroRecording.value, macroSleepThresholdMs.value)
    resetMacroRecordingState()
    const saved = await saveMacroSnippet(draft.entries, draft.snippetName, draft.groupUuid, draft.sleepThresholdMs)
    if (saved) setTopNotice(reason === 'count' ? '宏录制达到命令上限，已保存为快捷命令。' : '宏录制达到时间上限，已保存为快捷命令。')
    return saved
  }

  const startMacroRecording = (terminalId?: string | null) => {
    if (isMacroRecording.value) return
    applyMacroRecordingState(
      startMacroRecordingState({
        terminalId: terminalId || (activePanel.value.kind === 'knowledge' ? panels.value.find((panel) => panel.kind !== 'knowledge')?.id || null : activePanel.value.id),
        selectedGroupUuid: selectedSnippetGroupUuid.value
      })
    )
    clearMacroAutoStopTimer()
    macroAutoStopTimer = setTimeout(() => {
      void autoStopMacroRecording('time')
    }, MACRO_MAX_RECORDING_DURATION_MS)
  }

  const recordMacroCommand = (command: string, timestamp = Date.now()) => {
    const result = recordMacroCommandText(macroRecording.value, command, timestamp)
    applyMacroRecordingState(result.state)
    if (result.limitReached) void autoStopMacroRecording('count')
  }

  const setMacroRecordControlKeys = (enabled: boolean) => {
    macroRecordControlKeys.value = enabled
  }

  const setMacroSleepThreshold = (milliseconds: number) => {
    macroSleepThresholdMs.value = normalizeMacroSleepThreshold(milliseconds)
  }

  const recordMacroTerminalInput = (panelId: string, data: string, timestamp = Date.now()) => {
    const result = recordMacroTerminalInputState(macroRecording.value, {
      panelId,
      data,
      recordControlKeys: macroRecordControlKeys.value,
      timestamp
    })
    applyMacroRecordingState(result.state)
    if (result.shouldAutoStop) void autoStopMacroRecording(result.shouldAutoStop)
  }

  const stopMacroRecording = async () => {
    if (!isMacroRecording.value) return
    commitMacroCurrentLine()
    const draft = macroSaveDraft(macroRecording.value, macroSleepThresholdMs.value)
    if (!draft.entries.length) {
      resetMacroRecordingState()
      setTopNotice('没有录制到命令。')
      return null
    }
    const saved = await saveMacroSnippet(draft.entries, draft.snippetName, draft.groupUuid, draft.sleepThresholdMs)
    if (saved) resetMacroRecordingState()
    return saved
  }

  const cancelMacroRecording = () => {
    if (!isMacroRecording.value) return
    resetMacroRecordingState()
  }

  return {
    filteredQuickCommands,
    currentSnippetGroupName,
    isMacroRecording,
    recordedCommands,
    macroCurrentLineBuffer,
    macroTerminalId,
    macroLimitReason,
    applyQuickCommandsSnapshot,
    refreshQuickCommands,
    createSnippetGroup,
    renameSnippetGroup,
    deleteSnippetGroup,
    createQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    reorderQuickCommand,
    runQuickCommand,
    startMacroRecording,
    recordMacroCommand,
    recordMacroTerminalInput,
    setMacroRecordControlKeys,
    setMacroSleepThreshold,
    stopMacroRecording,
    cancelMacroRecording
  }
}
