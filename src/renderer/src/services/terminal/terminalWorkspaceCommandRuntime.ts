import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue'
import { terminalClient } from '@/services/terminal/terminalClient'
import type { TerminalView } from '@/services/terminal/terminalWorkspaceViewRuntime'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'
import type { TerminalCommandSuggestion, TerminalCommandSuggestionContext } from '@shared/contracts/terminalTools'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type TerminalSuggestion = TerminalCommandSuggestion

type TerminalWorkspaceCommandRuntimeInput = {
  workspace: WorkspaceStore
  state: TerminalWorkspaceCommandState
  menu: { visible: boolean; panelId: string }
  termMenu: { visible: boolean; panelId: string }
  aiButtonPanelId: Ref<string>
  activeView: () => TerminalView | undefined
  estimateTerminalCellSize: (
    view: { terminal: TerminalView['terminal'] },
    panelId: string
  ) => { width: number; height: number; hostWidth: number; hostHeight: number }
  focusActivePanel: () => void
  focusPanel: (panelId: string) => void
  getTerminalElement: (panelId: string) => HTMLElement | null
  syncTerminalView: (panel: TerminalPanel) => void
  terminalViews: Map<string, TerminalView>
  updateSuggestionsPosition: (panelId?: string) => void
}

export const createTerminalWorkspaceCommandState = () => {
  const search = ref('')
  const command = ref('')
  const globalCommand = ref('')
  const globalInputVisible = ref(false)
  const searchOverlayInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
  const commandLineInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
  const commandDialogInput = ref<HTMLTextAreaElement | HTMLTextAreaElement[] | null>(null)
  const commandDialogRef = ref<HTMLElement | HTMLElement[] | null>(null)
  const searchOverlayPanelId = ref('')
  const searchMatchCount = ref(0)
  const searchMatchIndex = ref(0)
  const suggestionPanel = reactive({ panelId: '' })
  const suggestionPosition = reactive({ left: 38, top: 0 })
  const suggestionSelectionMode = ref(false)
  const activeSuggestion = ref(-1)
  const aiSuggestLoading = ref(false)
  const commandLinePanelId = ref('')
  const suggestionItems = ref<TerminalSuggestion[]>([])
  const hasAiSuggestion = computed(() => suggestionItems.value.some((item) => item.source === 'ai'))
  const commandDialog = reactive({
    visible: false,
    panelId: '',
    instruction: '',
    modelName: '',
    generatedCommand: '',
    loading: false,
    error: '',
    top: 0,
    left: 0,
    width: 520
  })

  return {
    activeSuggestion,
    aiSuggestLoading,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandLineInput,
    commandLinePanelId,
    globalCommand,
    globalInputVisible,
    hasAiSuggestion,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    suggestionItems,
    suggestionPanel,
    suggestionPosition,
    suggestionSelectionMode
  }
}

export type TerminalWorkspaceCommandState = ReturnType<typeof createTerminalWorkspaceCommandState>

export const createTerminalWorkspaceCommandRuntime = ({
  workspace,
  state,
  menu,
  termMenu,
  aiButtonPanelId,
  activeView,
  estimateTerminalCellSize,
  focusActivePanel,
  focusPanel,
  getTerminalElement,
  syncTerminalView,
  terminalViews,
  updateSuggestionsPosition
}: TerminalWorkspaceCommandRuntimeInput) => {
  const {
    activeSuggestion,
    aiSuggestLoading,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandLineInput,
    commandLinePanelId,
    globalCommand,
    globalInputVisible,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    suggestionItems,
    suggestionPanel,
    suggestionSelectionMode
  } = state

  const terminalSuggestionSources = new Set<TerminalSuggestion['source']>(['base', 'history', 'ai'])
  const malformedTerminalSuggestionMessage = '终端命令建议服务返回数据无效'
  const failedTerminalSuggestionMessage = '终端命令建议加载失败'
  const unavailableTerminalSuggestionMessage = '终端命令建议服务不可用'
  let suggestionRequestId = 0
  let commandGenerationRequestId = 0

  const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)

  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

  const isTerminalSuggestionData = (value: unknown): value is TerminalSuggestion => {
    if (!isRecord(value)) return false
    if (typeof value.command !== 'string' || !value.command.trim()) return false
    if (!terminalSuggestionSources.has(value.source as TerminalSuggestion['source'])) return false
    if (value.explanation !== undefined && typeof value.explanation !== 'string') return false
    return true
  }

  const normalizeTerminalSuggestions = (value: unknown): TerminalSuggestion[] | null => {
    if (!Array.isArray(value)) return null
    if (!value.every(isTerminalSuggestionData)) return null
    return value.map((item) => ({
      command: item.command.trim(),
      source: item.source,
      ...(item.explanation !== undefined ? { explanation: item.explanation } : {})
    }))
  }

  const bridgeErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) return error.message
    if (typeof error === 'string' && error.trim()) return error.trim()
    return fallback
  }

  const getSuggestionContext = (panelId: string, mode: TerminalCommandSuggestionContext['mode'] = 'base'): TerminalCommandSuggestionContext => {
    const panel = panelById(panelId)
    return {
      panelId,
      mode,
      ...(panel?.sshSession?.host ? { host: panel.sshSession.host } : { host: 'local' }),
      shell: panel?.sessionId ? (panel.sshSession ? 'ssh' : 'local-shell') : 'bash',
      modelName: workspace.terminalCommandModelOptions[0] || ''
    }
  }

  const refocusSearchOverlayInput = (options: { select?: boolean } = {}) => {
    const focus = () => {
      const input = getSearchOverlayInput()
      if (input && typeof input.focus === 'function') {
        input.focus({ preventScroll: true })
        if (options.select) input.select?.()
      }
    }
    focus()
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus)
    } else {
      setTimeout(focus, 0)
    }
  }

  const findNext = () => {
    if (!search.value.trim() || searchMatchCount.value === 0) return
    const found = activeView()?.search.findNext(search.value, { caseSensitive: false })
    if (found && searchMatchCount.value > 0) {
      searchMatchIndex.value = searchMatchIndex.value >= searchMatchCount.value ? 1 : searchMatchIndex.value + 1
    }
  }

  const findPrevious = () => {
    if (!search.value.trim() || searchMatchCount.value === 0) return
    const found = activeView()?.search.findPrevious(search.value, { caseSensitive: false })
    if (found && searchMatchCount.value > 0) {
      searchMatchIndex.value = searchMatchIndex.value <= 1 ? searchMatchCount.value : searchMatchIndex.value - 1
    }
  }

  const recalculateSearchMatches = () => {
    const panel = workspace.activePanel
    const needle = search.value.trim().toLowerCase()
    if (!needle) {
      searchMatchCount.value = 0
      searchMatchIndex.value = 0
      return
    }
    const count = panel.output.toLowerCase().split(needle).length - 1
    searchMatchCount.value = Math.max(0, count)
    searchMatchIndex.value = count > 0 ? 1 : 0
  }

  const runIncrementalSearch = () => {
    const term = search.value.trim()
    const searchAddon = activeView()?.search
    if (!term) {
      searchAddon?.clearDecorations()
      searchMatchCount.value = 0
      searchMatchIndex.value = 0
      return
    }
    searchAddon?.findNext(term, { incremental: true, caseSensitive: false })
    recalculateSearchMatches()
  }

  const getSearchOverlayInput = () => {
    const input = searchOverlayInput.value
    if (Array.isArray(input)) {
      return input.find((item) => item?.isConnected) || input[0] || null
    }
    return input
  }

  const getCommandDialogInput = () => {
    const input = commandDialogInput.value
    if (Array.isArray(input)) {
      return input.find((item) => item?.isConnected) || input[0] || null
    }
    return input
  }

  const getCommandLineInput = () => {
    const input = commandLineInput.value
    if (Array.isArray(input)) {
      return input.find((item) => item?.isConnected) || input[0] || null
    }
    return input
  }

  const focusCommandLineInput = () => {
    const input = getCommandLineInput()
    if (input && typeof input.focus === 'function') input.focus({ preventScroll: true })
  }

  const commandLineStyle = (panelId: string) => {
    if (commandLinePanelId.value !== panelId) return {}
    const view = terminalViews.get(panelId)
    if (!view) return {}
    const { width: cellWidth, height: cellHeight, hostWidth, hostHeight } = estimateTerminalCellSize(view, panelId)
    const width = Math.max(320, Math.min(720, hostWidth - 24))
    const cursorLeft = (view.terminal.buffer.active.cursorX || 0) * cellWidth
    const cursorTop = (view.terminal.buffer.active.cursorY || 0) * cellHeight + cellHeight + 6
    const top = Math.min(Math.max(42, cursorTop), Math.max(42, hostHeight - 56))
    const left = Math.min(Math.max(12, cursorLeft), Math.max(12, hostWidth - width - 12))
    return {
      width: `${Math.floor(width)}px`,
      left: `${Math.floor(left)}px`,
      top: `${Math.floor(top)}px`
    }
  }

  const hideSuggestions = () => {
    suggestionRequestId += 1
    suggestionItems.value = []
    suggestionPanel.panelId = ''
    suggestionSelectionMode.value = false
    activeSuggestion.value = -1
    aiSuggestLoading.value = false
  }

  const openCommandLine = async (panelId = workspace.activePanelId) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return
    workspace.activePanelId = panel.id
    commandLinePanelId.value = panel.id
    command.value = ''
    hideSuggestions()
    termMenu.visible = false
    menu.visible = false
    aiButtonPanelId.value = ''
    await nextTick()
    focusCommandLineInput()
  }

  const openCommandLineFromMenu = () => {
    void openCommandLine(termMenu.panelId)
  }

  const closeCommandLine = () => {
    command.value = ''
    commandLinePanelId.value = ''
    hideSuggestions()
    focusActivePanel()
  }

  const focusCommandDialogInput = () => {
    const input = getCommandDialogInput()
    if (input && typeof input.focus === 'function') {
      input.focus({ preventScroll: true })
    }
  }

  const resizeCommandDialogInput = () => {
    const input = getCommandDialogInput()
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.max(28, input.scrollHeight)}px`
    nextTick(() => updateCommandDialogPosition(commandDialog.panelId))
  }

  const commandDialogStyle = (panelId: string) => {
    if (commandDialog.panelId !== panelId) return {}
    return {
      top: `${commandDialog.top}px`,
      left: `${commandDialog.left}px`,
      width: `${commandDialog.width}px`
    }
  }

  const updateCommandDialogPosition = async (panelId = commandDialog.panelId) => {
    if (!commandDialog.visible || !panelId) return
    const host = getTerminalElement(panelId)
    const pane = host?.closest('.terminal-pane') as HTMLElement | null
    if (!host || !pane) return
    const view = terminalViews.get(panelId)
    const margin = 18
    const paneWidth = pane.clientWidth || pane.getBoundingClientRect().width || 640
    const paneHeight = pane.clientHeight || pane.getBoundingClientRect().height || 420
    const dialogWidth = Math.max(320, Math.min(600, paneWidth - margin * 2, 520))
    commandDialog.width = Math.floor(dialogWidth)

    await nextTick()
    const dialogElement = (Array.isArray(commandDialogRef.value) ? commandDialogRef.value.find((item) => item?.isConnected) : commandDialogRef.value) as HTMLElement | null
    const dialogHeight = dialogElement?.querySelector('.command-dialog-card')?.clientHeight || dialogElement?.clientHeight || 118
    const cell = view ? estimateTerminalCellSize(view, panelId) : { height: 18 }
    const cursorY = view?.terminal.buffer.active.cursorY || 0
    const cursorTop = host.offsetTop + cursorY * cell.height
    const below = cursorTop + cell.height + margin
    const bottom = paneHeight - dialogHeight - margin
    const top = below + dialogHeight <= paneHeight - margin ? below : bottom

    commandDialog.left = Math.max(margin, Math.min(Math.round((paneWidth - dialogWidth) / 2), paneWidth - dialogWidth - margin))
    commandDialog.top = Math.max(margin, Math.min(Math.round(top), Math.max(margin, bottom)))
  }

  const resetCommandDialog = () => {
    commandDialog.instruction = ''
    commandDialog.generatedCommand = ''
    commandDialog.loading = false
    commandDialog.error = ''
  }

  const openCommandDialog = async (panelId = workspace.activePanelId) => {
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (!panel || panel.kind === 'knowledge') return
    workspace.activePanelId = panelId
    commandDialog.visible = true
    commandDialog.panelId = panelId
    commandDialog.modelName = commandDialog.modelName || workspace.terminalCommandModelOptions[0] || ''
    commandDialog.error = ''
    termMenu.visible = false
    menu.visible = false
    aiButtonPanelId.value = ''
    void workspace.refreshAiModelCatalog()
    await nextTick()
    resizeCommandDialogInput()
    await updateCommandDialogPosition(panelId)
    focusCommandDialogInput()
  }

  const openCommandDialogFromTabMenu = () => {
    void openCommandDialog(menu.panelId)
  }

  const openCommandDialogFromTermMenu = () => {
    void openCommandDialog(termMenu.panelId)
  }

  const closeCommandDialog = () => {
    resetCommandDialog()
    commandDialog.visible = false
    commandDialog.panelId = ''
    const active = workspace.activePanel
    if (active?.kind !== 'knowledge') {
      focusPanel(active.id)
    }
  }

  const applyGeneratedCommand = (panelId: string) => {
    if (!commandDialog.generatedCommand.trim()) return
    const result = workspace.injectGeneratedTerminalCommand(panelId, commandDialog.generatedCommand)
    if (result?.status === 'allow') {
      const panel = panelById(panelId)
      if (panel) syncTerminalView(panel)
      command.value = commandDialog.generatedCommand
      commandDialog.instruction = ''
      commandDialog.generatedCommand = ''
      commandDialog.error = ''
      nextTick(() => {
        resizeCommandDialogInput()
        focusCommandDialogInput()
      })
    }
  }

  const submitCommandDialog = async () => {
    const panelId = commandDialog.panelId
    if (!panelId || commandDialog.loading) return
    if (!commandDialog.instruction.trim()) {
      commandDialog.error = '请输入命令描述'
      return
    }
    if (!workspace.terminalCommandModelOptions.length) {
      await workspace.refreshAiModelCatalog()
    }
    if (!workspace.terminalCommandModelOptions.length) {
      commandDialog.error = '没有可用命令模型'
      return
    }
    if (!workspace.terminalCommandModelOptions.includes(commandDialog.modelName)) {
      commandDialog.modelName = workspace.terminalCommandModelOptions[0]
    }
    commandDialog.loading = true
    commandDialog.error = ''
    commandDialog.generatedCommand = ''
    const instruction = commandDialog.instruction.trim()
    const requestId = ++commandGenerationRequestId
    try {
      const record = await workspace.generateTerminalCommand(panelId, instruction, commandDialog.modelName)
      if (requestId !== commandGenerationRequestId || !commandDialog.visible || commandDialog.panelId !== panelId) return
      commandDialog.loading = false
      if (!record) {
        commandDialog.error = '命令生成失败'
        commandDialog.instruction = instruction
        return
      }
      commandDialog.generatedCommand = record.command
      applyGeneratedCommand(panelId)
    } catch (error) {
      if (requestId !== commandGenerationRequestId || !commandDialog.visible || commandDialog.panelId !== panelId) return
      commandDialog.loading = false
      commandDialog.error = error instanceof Error ? error.message : '命令生成失败'
      commandDialog.instruction = instruction
    }
  }

  const openSearchOverlay = async (panelId = workspace.activePanelId) => {
    workspace.activePanelId = panelId
    searchOverlayPanelId.value = panelId
    termMenu.visible = false
    aiButtonPanelId.value = ''
    await nextTick()
    refocusSearchOverlayInput({ select: true })
    recalculateSearchMatches()
  }

  const closeSearchOverlay = () => {
    clearSearch({ refocus: false })
    searchOverlayPanelId.value = ''
    aiButtonPanelId.value = ''
  }

  const clearSearch = (options: { refocus?: boolean } = {}) => {
    activeView()?.search.clearDecorations()
    search.value = ''
    searchMatchCount.value = 0
    searchMatchIndex.value = 0
    if (options.refocus !== false && searchOverlayPanelId.value) {
      nextTick(() => refocusSearchOverlayInput({ select: true }))
    }
  }

  const clearSearchFromButton = () => {
    clearSearch()
  }

  const sendCommand = async (panel: TerminalPanel) => {
    if (suggestionSelectionMode.value && activeSuggestion.value >= 0 && suggestionItems.value[activeSuggestion.value]) {
      command.value = suggestionItems.value[activeSuggestion.value].command
    }
    const text = command.value.trim()
    if (!text) return
    hideSuggestions()
    const decision = await workspace.runTerminalCommand(panel.id, text, {
      writeToShell: true,
      source: 'direct'
    })
    if (decision.status === 'allow') {
      command.value = ''
      commandLinePanelId.value = ''
      syncTerminalView(panel)
    }
  }

  const updateSuggestions = async (panelId: string) => {
    const rawQuery = command.value.trim()
    const query = rawQuery.toLowerCase()
    const requestId = ++suggestionRequestId
    suggestionPanel.panelId = panelId
    suggestionSelectionMode.value = false
    activeSuggestion.value = -1
    aiSuggestLoading.value = false
    if (!query) {
      suggestionItems.value = []
      suggestionPanel.panelId = ''
      return
    }
    if (!workspace.extensionSettings.autoCompleteStatus) {
      suggestionItems.value = []
      suggestionPanel.panelId = ''
      return
    }
    let base: TerminalSuggestion[] = []
    let suggestionNotice = ''
    try {
      const getTerminalCommandSuggestions = terminalClient.getTerminalCommandSuggestions()
      if (!getTerminalCommandSuggestions) {
        suggestionNotice = unavailableTerminalSuggestionMessage
        throw new Error(unavailableTerminalSuggestionMessage)
      }
      const result = await getTerminalCommandSuggestions(rawQuery, getSuggestionContext(panelId, 'base'))
      const normalized = normalizeTerminalSuggestions(result)
      if (!normalized) {
        suggestionNotice = malformedTerminalSuggestionMessage
        throw new Error(malformedTerminalSuggestionMessage)
      }
      base = normalized
    } catch (error) {
      base = []
      suggestionNotice = suggestionNotice || bridgeErrorMessage(error, failedTerminalSuggestionMessage)
    }
    if (requestId !== suggestionRequestId || suggestionPanel.panelId !== panelId || command.value.trim().toLowerCase() !== query) return
    if (suggestionNotice) workspace.setTopNotice(suggestionNotice)
    suggestionItems.value = base.slice(0, 6)
    nextTick(() => updateSuggestionsPosition(panelId))
  }

  const enterSuggestionSelection = () => {
    if (!suggestionItems.value.length) return
    suggestionSelectionMode.value = true
    activeSuggestion.value = Math.max(0, activeSuggestion.value)
    updateSuggestionsPosition()
  }

  const moveSuggestion = (delta: number) => {
    if (!suggestionItems.value.length) return
    suggestionSelectionMode.value = true
    const max = suggestionItems.value.length - 1
    activeSuggestion.value = activeSuggestion.value < 0 ? 0 : Math.min(max, Math.max(0, activeSuggestion.value + delta))
    updateSuggestionsPosition()
  }

  const applySuggestion = (value: string) => {
    command.value = value
    hideSuggestions()
  }

  const triggerAiSuggestion = async () => {
    const rawQuery = command.value.trim()
    const query = rawQuery.toLowerCase()
    const panelId = suggestionPanel.panelId || workspace.activePanelId
    if (!workspace.extensionSettings.autoCompleteStatus || !rawQuery || suggestionSelectionMode.value || aiSuggestLoading.value || state.hasAiSuggestion.value) return
    const requestId = ++suggestionRequestId
    aiSuggestLoading.value = true
    updateSuggestionsPosition()
    let suggestionErrorMessage = ''
    try {
      const getTerminalCommandSuggestions = terminalClient.getTerminalCommandSuggestions()
      if (!getTerminalCommandSuggestions) {
        suggestionErrorMessage = unavailableTerminalSuggestionMessage
        throw new Error(unavailableTerminalSuggestionMessage)
      }
      const result = await getTerminalCommandSuggestions(rawQuery, getSuggestionContext(panelId, 'ai'))
      const aiSuggestions = normalizeTerminalSuggestions(result)
      if (!aiSuggestions) {
        suggestionErrorMessage = malformedTerminalSuggestionMessage
        throw new Error(malformedTerminalSuggestionMessage)
      }
      if (requestId !== suggestionRequestId || command.value.trim().toLowerCase() !== query) return
      suggestionItems.value = [...aiSuggestions, ...suggestionItems.value].slice(0, 6)
    } catch (error) {
      if (requestId !== suggestionRequestId) return
      suggestionItems.value = suggestionItems.value.filter((item) => item.source !== 'ai')
      workspace.setTopNotice(suggestionErrorMessage || bridgeErrorMessage(error, failedTerminalSuggestionMessage))
    } finally {
      if (requestId !== suggestionRequestId) return
      aiSuggestLoading.value = false
      nextTick(() => updateSuggestionsPosition())
    }
  }

  const sendGlobalCommand = async () => {
    const text = globalCommand.value.trim()
    if (!text) return
    const decision = await workspace.runGlobalTerminalCommand(text)
    workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
    if (decision.status !== 'allow') return
    globalCommand.value = ''
  }

  const approveSecurityPrompt = async () => {
    const execution = workspace.approveTerminalSecurityPrompt()
    if (!execution) return
    const decision = execution.writeToShell ? await workspace.writeTerminalExecution(execution) : null
    if (!execution.writeToShell || decision?.status === 'allow') {
      command.value = ''
      commandLinePanelId.value = ''
      hideSuggestions()
    }
    workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
  }

  const cancelSecurityPrompt = () => {
    workspace.cancelTerminalSecurityPrompt()
    workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
  }

  const toggleGlobalInput = () => {
    globalInputVisible.value = !globalInputVisible.value
    termMenu.visible = false
    aiButtonPanelId.value = ''
  }

  const hideCommandDialogForActivePanel = (panelId: string) => {
    if (commandDialog.visible && commandDialog.panelId !== panelId) {
      resetCommandDialog()
      commandDialog.visible = false
      commandDialog.panelId = ''
    }
  }

  watch(search, runIncrementalSearch)

  watch(
    () => workspace.extensionSettings.autoCompleteStatus,
    (enabled) => {
      if (!enabled) hideSuggestions()
    }
  )

  watch(
    () => workspace.terminalCommandModelOptions.join('|'),
    (models) => {
      if (!commandDialog.modelName || !models.split('|').includes(commandDialog.modelName)) {
        commandDialog.modelName = workspace.terminalCommandModelOptions[0] || ''
      }
    },
    { immediate: true }
  )

  return {
    applyGeneratedCommand,
    applySuggestion,
    approveSecurityPrompt,
    cancelSecurityPrompt,
    clearSearchFromButton,
    closeCommandDialog,
    closeCommandLine,
    closeSearchOverlay,
    commandDialogStyle,
    commandLineStyle,
    enterSuggestionSelection,
    findNext,
    findPrevious,
    focusCommandDialogInput,
    getCommandDialogInput,
    hideCommandDialogForActivePanel,
    hideSuggestions,
    moveSuggestion,
    openCommandDialog,
    openCommandDialogFromTabMenu,
    openCommandDialogFromTermMenu,
    openCommandLineFromMenu,
    openSearchOverlay,
    resizeCommandDialogInput,
    sendCommand,
    sendGlobalCommand,
    submitCommandDialog,
    toggleGlobalInput,
    triggerAiSuggestion,
    updateSuggestions
  }
}
