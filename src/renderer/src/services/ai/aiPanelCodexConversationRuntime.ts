import { computed, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  readStoredAiPanelMode,
  readStoredAiPanelWorkspaceLinkMode,
  storeAiPanelMode,
  storeAiPanelWorkspaceLinkMode,
  type AiPanelMode,
  type AiPanelWorkspaceLinkMode
} from '@/services/ai/aiPanelModeRuntime'
import {
  applyCodexTargetBinding,
  applyCodexTargetUnbinding,
  closeCodexConversationRecord,
  codexAttentionId as codexRuntimeAttentionId,
  codexBoundTargetDetail as codexRuntimeBoundTargetDetail,
  codexBoundTargetLabel as codexRuntimeBoundTargetLabel,
  codexConversationTitle as codexRuntimeConversationTitle,
  codexStatusLabelKey,
  codexTargetContextFromPanel,
  codexTargetTitle as codexRuntimeTargetTitle,
  createCodexConversationRecord as createCodexConversationRuntimeRecord,
  currentBoundCodexTarget as currentBoundCodexRuntimeTarget,
  resetCodexConversationForRestart,
  terminalSettingsSignature as codexTerminalSettingsSignature,
  type AiPanelCodexConversationRuntimeState
} from '@/services/ai/aiPanelCodexRuntime'
import {
  createAiPanelCodexTerminalRuntime,
  type AiPanelCodexTerminalConversation,
  type AiPanelCodexTerminalRuntimeOptions
} from '@/services/ai/aiPanelCodexTerminalRuntime'
import { codexTargetSignature } from '@/services/ai/codexTargetRuntime'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import type { I18nKey } from '@/i18n'
import type { AiAttentionInput, AiAttentionItem, TerminalPanel } from '@/stores/workspace'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

export type AiPanelCodexConversation = AiPanelCodexConversationRuntimeState & AiPanelCodexTerminalConversation

type AiPanelCodexConversationRuntimeInput = {
  agentMode: () => boolean
  activePanelId: () => string
  activePanel: () => TerminalPanel | undefined | null
  panels: () => TerminalPanel[]
  terminalSettings: () => TerminalSettings
  themeId?: () => string
  aiContextCatalog: () => AiContextCatalog
  loadClassicChatData: () => Promise<void>
  closePopups: () => void
  showNotice: (message: string) => void
  setTopNotice: (message: string) => void
  refreshAiContextCatalog: () => Promise<unknown>
  openTerminalForAiHostContext: (host: AiContextOption) => Promise<TerminalPanel | null | undefined>
  activateTerminalPanel: (panelId: string) => TerminalPanel | null | undefined
  upsertAiAttentionItem: (input: AiAttentionInput) => void
  removeAiAttentionItem: (id: string) => void | boolean
  markAiAttentionHandled: (id: string) => void | boolean
  afterDomUpdate: () => void | Promise<void>
  t: (key: I18nKey, params?: Record<string, string | number>) => string
  log?: (level: RuntimeLogLevel, event: string, fields?: Record<string, unknown>) => void
  terminalRuntimeFactory?: (options: AiPanelCodexTerminalRuntimeOptions<AiPanelCodexConversation>) => AiPanelCodexTerminalRuntime
}

type AiPanelCodexTerminalRuntime = ReturnType<typeof createAiPanelCodexTerminalRuntime<AiPanelCodexConversation>>

export const createAiPanelCodexConversationRuntime = (options: AiPanelCodexConversationRuntimeInput) => {
  const t = options.t
  const log = options.log || writeRendererRuntimeLog
  const aiPanelMode = ref<AiPanelMode>(readStoredAiPanelMode())
  const aiPanelWorkspaceLinkMode = ref<AiPanelWorkspaceLinkMode>(readStoredAiPanelWorkspaceLinkMode())
  const panelModeMenuOpen = ref(false)
  const codexTargetPickerOpen = ref(false)
  const codexTargetQuery = ref('')
  const codexConversations = ref<AiPanelCodexConversation[]>([])
  const activeCodexConversationId = ref('')
  const codexWorkspaceLinkNotice = ref('')
  let workspaceLinkSyncSource: 'workspace' | 'ai' | null = null
  let codexConversationSequence = 0

  const activeCodexConversation = computed(() => codexConversations.value.find((conversation) => conversation.id === activeCodexConversationId.value) || null)
  const activeCodexBoundTarget = computed(() => activeCodexConversation.value?.boundTarget || null)
  const currentAiPanelModeLabel = computed(() => (aiPanelMode.value === 'codex' ? t('ai.codexCliMode') : t('ai.classicChatMode')))
  const terminalSettingsSignature = () => `${options.themeId?.() || 'dark'}|${codexTerminalSettingsSignature(options.terminalSettings())}`

  const codexStatusLabel = computed(() => {
    const labelKey = codexStatusLabelKey(activeCodexConversation.value?.status || 'idle')
    if (labelKey === 'starting') return t('ai.codexStarting')
    if (labelKey === 'ready') return t('ai.codexReady')
    if (labelKey === 'error') return t('ai.codexError')
    if (labelKey === 'closed') return t('ai.codexClosed')
    return t('ai.codexIdle')
  })
  const codexBoundTargetLabel = computed(() => codexRuntimeBoundTargetLabel(activeCodexBoundTarget.value, t('ai.codexTargetUnbound')))
  const codexBoundTargetDetail = computed(() => codexRuntimeBoundTargetDetail(activeCodexBoundTarget.value, t('ai.codexTargetDropHint')))

  const currentCodexTargetContext = (): CodexSessionTargetContext => codexTargetContextFromPanel(options.activePanel())
  const currentPanelTarget = computed(() => {
    const target = currentCodexTargetContext()
    return target.sessionId && target.kind !== 'unknown' ? target : null
  })
  const codexHostTargets = computed(() => {
    const catalog = options.aiContextCatalog()
    const hosts = catalog.categories.find((category) => category.id === 'hosts')?.options || []
    const openedHosts = catalog.openedHosts || []
    const byId = new Map<string, AiContextOption>()
    ;[...openedHosts, ...hosts].forEach((host) => {
      if (host.kind === 'hosts' && !byId.has(host.id)) byId.set(host.id, { ...host })
    })
    return [...byId.values()]
  })
  const filteredCodexHostTargets = computed(() => {
    const keyword = codexTargetQuery.value.trim().toLowerCase()
    return codexHostTargets.value
      .filter((host) => !keyword || `${host.label} ${host.detail || ''} ${host.host || ''} ${host.assetName || ''}`.toLowerCase().includes(keyword))
      .slice(0, 20)
  })

  const nextCodexConversationId = () => `codex-${Date.now().toString(36)}-${++codexConversationSequence}`
  const codexTargetTitle = (target?: CodexSessionTargetContext | null) => codexRuntimeTargetTitle(target, t('ai.codexCliMode'))
  const codexConversationTitle = (conversation: Pick<AiPanelCodexConversation, 'title' | 'boundTarget'>) =>
    codexRuntimeConversationTitle(conversation, t('ai.codexCliMode'))
  const codexAttentionId = (conversation: Pick<AiPanelCodexConversation, 'id'>) => codexRuntimeAttentionId(conversation)

  const syncCodexAttentionState = (conversation: AiPanelCodexConversation) => {
    const id = codexAttentionId(conversation)
    if (conversation.status !== 'error') {
      options.removeAiAttentionItem(id)
      return
    }
    options.upsertAiAttentionItem({
      id,
      source: 'codex',
      kind: 'error',
      conversationId: conversation.id,
      sessionId: conversation.sessionId || undefined,
      surfaceId: options.agentMode() ? 'agents-ai-panel' : 'terminal-ai-panel',
      title: codexConversationTitle(conversation),
      summary: conversation.error || t('ai.codexError')
    })
  }

  const createCodexConversationRecord = (target?: CodexSessionTargetContext | null): AiPanelCodexConversation =>
    createCodexConversationRuntimeRecord<AiPanelCodexConversation>(nextCodexConversationId(), target, {
      host: null,
      terminal: null,
      fit: null,
      resizeObserver: null
    })

  const ensureActiveCodexConversation = (target?: CodexSessionTargetContext | null) => {
    let conversation = activeCodexConversation.value
    if (conversation) return conversation
    conversation = createCodexConversationRecord(target || null)
    codexConversations.value = [...codexConversations.value, conversation]
    activeCodexConversationId.value = conversation.id
    return conversation
  }

  const currentBoundCodexTarget = (conversation = activeCodexConversation.value) => currentBoundCodexRuntimeTarget(conversation, options.panels())

  const codexConversationMatchesPanel = (conversation: AiPanelCodexConversation, panel: TerminalPanel | undefined | null) => {
    const target = currentBoundCodexTarget(conversation) || conversation.boundTarget
    if (!target?.sessionId || !panel?.sessionId) return false
    return target.panelId === panel.id || target.sessionId === panel.sessionId
  }

  const matchingCodexConversationForPanel = (panel: TerminalPanel | undefined | null) => {
    const active = activeCodexConversation.value
    if (active && codexConversationMatchesPanel(active, panel)) return active
    return [...codexConversations.value].reverse().find((conversation) => codexConversationMatchesPanel(conversation, panel)) || null
  }

  const setWorkspaceLinkNotice = (message: string) => {
    codexWorkspaceLinkNotice.value = message
  }

  const clearWorkspaceLinkNotice = () => {
    if (codexWorkspaceLinkNotice.value) codexWorkspaceLinkNotice.value = ''
  }

  const selectCodexConversationForWorkspacePanel = async (panel: TerminalPanel | undefined | null) => {
    if (aiPanelMode.value !== 'codex' || aiPanelWorkspaceLinkMode.value !== 'follow-workspace') return false
    if (!panel?.sessionId || panel.kind !== 'terminal') return false
    const conversation = matchingCodexConversationForPanel(panel)
    if (!conversation) {
      setWorkspaceLinkNotice(t('ai.codexWorkspaceLinkNoConversation'))
      return false
    }
    clearWorkspaceLinkNotice()
    if (conversation.id === activeCodexConversationId.value) return true
    workspaceLinkSyncSource = 'workspace'
    try {
      await selectCodexConversation(conversation.id, { syncWorkspace: false })
    } finally {
      workspaceLinkSyncSource = null
    }
    return true
  }

  const activateWorkspacePanelForCodexConversation = (conversation: AiPanelCodexConversation | null | undefined) => {
    if (aiPanelWorkspaceLinkMode.value !== 'follow-workspace') return false
    const target = conversation ? currentBoundCodexTarget(conversation) || conversation.boundTarget : null
    if (!target?.sessionId) return false
    const panel = options.activateTerminalPanel(target.panelId || target.sessionId)
    if (!panel) {
      if (conversation) conversation.error = t('ai.codexTargetClosed')
      return false
    }
    if (conversation) conversation.error = ''
    clearWorkspaceLinkNotice()
    return true
  }

  const createTerminalRuntime = options.terminalRuntimeFactory || createAiPanelCodexTerminalRuntime
  const aiPanelCodexTerminalRuntime = createTerminalRuntime({
    conversations: () => codexConversations.value,
    activeConversation: () => activeCodexConversation.value,
    activeConversationId: () => activeCodexConversationId.value,
    terminalSettings: options.terminalSettings,
    themeId: options.themeId,
    currentBoundTarget: (conversation) => currentBoundCodexTarget(conversation),
    isConversationVisible: (conversation) => aiPanelMode.value === 'codex' && activeCodexConversationId.value === conversation.id,
    syncAttentionState: syncCodexAttentionState,
    labels: {
      error: () => t('ai.codexError'),
      bridgeMissing: () => t('ai.codexBridgeMissing'),
      startFailed: () => t('ai.codexStartFailed'),
      copyEmpty: () => '请先选择 Codex 终端内容',
      copySuccess: () => 'Codex 终端内容已复制',
      copyFailure: () => 'Codex 终端复制失败'
    },
    notify: options.setTopNotice,
    afterDomUpdate: options.afterDomUpdate,
    log
  })

  const closeCodexTargetPicker = () => {
    codexTargetPickerOpen.value = false
    codexTargetQuery.value = ''
  }

  const setCodexTerminalHostRef = (conversationId: string, element: Element | ComponentPublicInstance | null) => {
    const conversation = codexConversations.value.find((item) => item.id === conversationId)
    if (!conversation) return
    aiPanelCodexTerminalRuntime.setHostElement(conversation, element instanceof HTMLElement ? element : null)
  }

  const startCodexSession = async (targetConversation?: AiPanelCodexConversation | null) => {
    if (aiPanelMode.value !== 'codex') return
    const conversation = targetConversation || ensureActiveCodexConversation()
    return aiPanelCodexTerminalRuntime.startSession(conversation)
  }

  const bindCodexTarget = async (target: CodexSessionTargetContext | null, bindOptions: { reason?: string; start?: boolean } = {}) => {
    const conversation = ensureActiveCodexConversation(target)
    if (!target?.sessionId || target.kind === 'unknown') {
      conversation.error = t('ai.codexTargetMissing')
      return false
    }
    const previous = applyCodexTargetBinding(conversation, target, { fallbackLabel: t('ai.codexCliMode') })
    closeCodexTargetPicker()
    log('info', 'renderer.codex-target.bound', {
      reason: bindOptions.reason,
      sessionId: target.sessionId,
      panelId: target.panelId,
      targetKind: target.kind,
      targetLabel: target.label,
      previousSessionId: previous?.sessionId
    })
    if (conversation.sessionId) {
      await aiPanelCodexTerminalRuntime.syncTargetContext({ force: true, conversation })
      await aiPanelCodexTerminalRuntime.setPendingTargetContext(conversation, previous ? 'changed' : 'bound', target)
    } else if (bindOptions.start !== false && aiPanelMode.value === 'codex') {
      await startCodexSession(conversation)
    }
    clearWorkspaceLinkNotice()
    return true
  }

  const bindTerminalPanelToCodex = (panel: TerminalPanel, reason: string) => bindCodexTarget(codexTargetContextFromPanel(panel), { reason })

  const unbindCodexTarget = async () => {
    const conversation = activeCodexConversation.value
    if (!conversation) return
    applyCodexTargetUnbinding(conversation, t('ai.codexCliMode'))
    closeCodexTargetPicker()
    await aiPanelCodexTerminalRuntime.clearSessionTarget(conversation, 'unbound')
  }

  const locateCodexBoundTarget = () => {
    const conversation = activeCodexConversation.value
    if (!conversation) return
    const target = conversation.boundTarget
    if (!target?.sessionId) return
    const panel = options.activateTerminalPanel(target.panelId || target.sessionId)
    if (!panel) {
      conversation.error = t('ai.codexTargetClosed')
      return
    }
    conversation.error = ''
  }

  const toggleCodexTargetPicker = async () => {
    codexTargetPickerOpen.value = !codexTargetPickerOpen.value
    if (!codexTargetPickerOpen.value) {
      codexTargetQuery.value = ''
      return
    }
    await options.refreshAiContextCatalog()
  }

  const bindHostContextToCodex = async (host: AiContextOption) => {
    const panel = await options.openTerminalForAiHostContext(host)
    if (!panel?.sessionId) {
      ensureActiveCodexConversation().error = t('ai.codexTargetOpenFailed')
      return false
    }
    return bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'host-picker' })
  }

  const restartCodexSession = async () => {
    const conversation = ensureActiveCodexConversation()
    await aiPanelCodexTerminalRuntime.stopSession(conversation)
    resetCodexConversationForRestart(conversation)
    syncCodexAttentionState(conversation)
    aiPanelCodexTerminalRuntime.clearConversationOutput(conversation)
    await startCodexSession(conversation)
  }

  const createNewCodexConversation = async () => {
    const conversation = createCodexConversationRecord(currentPanelTarget.value || null)
    codexConversations.value = [...codexConversations.value, conversation]
    activeCodexConversationId.value = conversation.id
    closeCodexTargetPicker()
    await options.afterDomUpdate()
    aiPanelCodexTerminalRuntime.ensureTerminal(conversation)
    if (conversation.boundTarget && aiPanelMode.value === 'codex') await startCodexSession(conversation)
  }

  const selectCodexConversation = async (id: string, selectOptions: { syncWorkspace?: boolean } = {}) => {
    const conversation = codexConversations.value.find((item) => item.id === id)
    if (!conversation) return
    const alreadyActive = activeCodexConversationId.value === id
    activeCodexConversationId.value = id
    closeCodexTargetPicker()
    if (selectOptions.syncWorkspace !== false && workspaceLinkSyncSource !== 'workspace') {
      workspaceLinkSyncSource = 'ai'
      try {
        activateWorkspacePanelForCodexConversation(conversation)
      } finally {
        workspaceLinkSyncSource = null
      }
    }
    if (alreadyActive) return
    await options.afterDomUpdate()
    aiPanelCodexTerminalRuntime.ensureTerminal(conversation)
    await aiPanelCodexTerminalRuntime.syncActiveBridgeTarget()
    aiPanelCodexTerminalRuntime.fitTerminal({ force: true, conversation })
    aiPanelCodexTerminalRuntime.syncConversationOutput(conversation)
    aiPanelCodexTerminalRuntime.focusActiveTerminal()
  }

  const focusAiAttentionItem = async (item: AiAttentionItem | null) => {
    if (!item || item.source !== 'codex' || !item.conversationId) return
    const conversation = codexConversations.value.find((entry) => entry.id === item.conversationId)
    if (!conversation) {
      options.removeAiAttentionItem(item.id)
      return
    }
    if (aiPanelMode.value !== 'codex') await selectAiPanelMode('codex')
    else panelModeMenuOpen.value = false
    await selectCodexConversation(conversation.id)
    aiPanelCodexTerminalRuntime.focusActiveTerminal()
    if (conversation.status !== 'error') {
      options.markAiAttentionHandled(item.id)
      return
    }
    options.setTopNotice(`已定位到 ${codexConversationTitle(conversation)}`)
  }

  const closeCodexConversation = async (id: string) => {
    const closeResult = closeCodexConversationRecord(codexConversations.value, activeCodexConversationId.value, id)
    if (closeResult.status === 'missing') return
    if (closeResult.status === 'keep-one') {
      options.showNotice(t('ai.keepOneTab'))
      return
    }
    const conversation = closeResult.conversation
    await aiPanelCodexTerminalRuntime.stopSession(conversation)
    options.removeAiAttentionItem(codexAttentionId(conversation))
    aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    codexConversations.value = closeResult.nextConversations
    if (closeResult.status === 'closed-active' && closeResult.nextConversation) {
      const nextConversation = closeResult.nextConversation
      activeCodexConversationId.value = closeResult.nextActiveId
      await options.afterDomUpdate()
      aiPanelCodexTerminalRuntime.ensureTerminal(nextConversation)
      await aiPanelCodexTerminalRuntime.syncActiveBridgeTarget()
      aiPanelCodexTerminalRuntime.fitTerminal({ force: true, conversation: nextConversation })
      aiPanelCodexTerminalRuntime.syncConversationOutput(nextConversation)
    }
    options.showNotice(t('ai.tabClosed'))
  }

  async function selectAiPanelMode(mode: AiPanelMode) {
    if (aiPanelMode.value === mode) {
      if (mode === 'codex') void startCodexSession()
      panelModeMenuOpen.value = false
      return
    }
    aiPanelMode.value = mode
    storeAiPanelMode(mode)
    options.closePopups()
    if (mode === 'classic') {
      await options.loadClassicChatData()
      return
    }
    ensureActiveCodexConversation()
    void startCodexSession()
    void selectCodexConversationForWorkspacePanel(options.activePanel())
  }

  const toggleAiPanelModeMenu = () => {
    panelModeMenuOpen.value = !panelModeMenuOpen.value
  }

  const toggleAiPanelWorkspaceLinkMode = async () => {
    aiPanelWorkspaceLinkMode.value = aiPanelWorkspaceLinkMode.value === 'follow-workspace' ? 'manual' : 'follow-workspace'
    storeAiPanelWorkspaceLinkMode(aiPanelWorkspaceLinkMode.value)
    if (aiPanelWorkspaceLinkMode.value === 'follow-workspace') {
      await selectCodexConversationForWorkspacePanel(options.activePanel())
      activateWorkspacePanelForCodexConversation(activeCodexConversation.value)
    } else {
      clearWorkspaceLinkNotice()
    }
  }

  const activeCodexTargetSignature = computed(() => {
    const conversation = activeCodexConversation.value
    const target = conversation ? currentBoundCodexTarget(conversation) || conversation.boundTarget : null
    return target ? `${conversation?.id || ''}:${codexTargetSignature(target)}` : ''
  })

  const syncActiveCodexTargetContext = () => {
    if (aiPanelMode.value !== 'codex') return
    void aiPanelCodexTerminalRuntime.syncTargetContext()
  }

  const applyCodexTerminalSettingsToAll = () => {
    codexConversations.value.forEach((conversation) => aiPanelCodexTerminalRuntime.applyTerminalSettings(conversation))
  }

  const startInitialMode = () => {
    if (aiPanelMode.value === 'classic') void options.loadClassicChatData()
    if (aiPanelMode.value === 'codex') void startCodexSession()
  }

  const dispose = () => {
    codexConversations.value.forEach((conversation) => {
      options.removeAiAttentionItem(codexAttentionId(conversation))
      void aiPanelCodexTerminalRuntime.stopSession(conversation)
      aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    })
    aiPanelCodexTerminalRuntime.disposeSubscriptions()
    stopWorkspaceLinkWatcher()
  }

  const stopWorkspaceLinkWatcher = watch(
    () => [
      aiPanelMode.value,
      aiPanelWorkspaceLinkMode.value,
      options.activePanelId(),
      options.panels()
        .map((panel) => `${panel.id}:${panel.sessionId || ''}:${panel.status || ''}:${panel.kind || ''}`)
        .join('|'),
      codexConversations.value
        .map((conversation) => `${conversation.id}:${conversation.boundTarget?.panelId || ''}:${conversation.boundTarget?.sessionId || ''}`)
        .join('|')
    ],
    () => {
      if (workspaceLinkSyncSource === 'ai') return
      void selectCodexConversationForWorkspacePanel(options.activePanel())
    },
    { flush: 'post' }
  )

  return {
    activeCodexBoundTarget,
    activeCodexConversation,
    activeCodexConversationId,
    activeCodexTargetSignature,
    aiPanelWorkspaceLinkMode,
    aiPanelMode,
    applyCodexTerminalSettingsToAll,
    bindCodexTarget,
    bindHostContextToCodex,
    bindTerminalPanelToCodex,
    closeCodexConversation,
    closeCodexTargetPicker,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    codexWorkspaceLinkNotice,
    copyCodexSelectionFromContextMenu: aiPanelCodexTerminalRuntime.copySelectionFromContextMenu,
    createNewCodexConversation,
    currentAiPanelModeLabel,
    currentPanelTarget,
    dispose,
    filteredCodexHostTargets,
    focusAiAttentionItem,
    focusCodexTerminal: aiPanelCodexTerminalRuntime.focusActiveTerminal,
    locateCodexBoundTarget,
    panelModeMenuOpen,
    restartCodexSession,
    selectAiPanelMode,
    selectCodexConversation,
    setCodexTerminalHostRef,
    startInitialMode,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    toggleAiPanelModeMenu,
    toggleAiPanelWorkspaceLinkMode,
    toggleCodexTargetPicker,
    unbindCodexTarget
  }
}
