import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch, type Component, type ComponentPublicInstance } from 'vue'
import 'highlight.js/styles/atom-one-dark.css'
import '@xterm/xterm/css/xterm.css'
import {
  Bot,
  Brain,
  BookOpen,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Focus,
  Link2,
  LoaderCircle,
  FileText,
  FolderGit2,
  Image,
  LockKeyhole,
  Maximize2,
  Mic,
  Monitor,
  MinusSquare,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Square,
  Star,
  History,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { readStoredAiPanelMode, storeAiPanelMode, type AiPanelMode } from '@/services/aiPanelModeRuntime'
import {
  aiChipPartFromContext,
  aiImagePartFromContext
} from '@/services/aiPanelInputRuntime'
import {
  aiPanelChipLabel,
  aiPanelEditablePlainText,
  createAiPanelChipElement,
  createAiPanelCommandChipElement,
  createAiPanelContextChipElement,
  createAiPanelImageElement,
  extractAiPanelContentPartsFromEditable,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  insertAiPanelPlainTextIntoEditableCursor,
  removeAiPanelTokenBeforeRange,
  removeAiPanelTokenFromEditableCursor,
  renderAiPanelMainEditableFromState,
  renderAiPanelPartsIntoEditable,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import {
  allVisibleAiPanelHostsSelected,
  clearAiPanelHostContexts,
  cloneAiPanelCommandOptions,
  cloneAiPanelContextCategories,
  filteredAiPanelCommands,
  filteredAiPanelContextOptions,
  filteredAiPanelOpenedHosts,
  planAiPanelCommandApply,
  planAiPanelContextApply,
  selectedAiPanelCommand,
  selectedAiPanelCommandRef,
  selectedAiPanelContextCategory,
  selectedAiPanelVisibleHostContexts,
  sortedAiPanelDocsContextOptions,
  visibleAiPanelContextCategories,
  visibleAiPanelHostContextOptions,
  type AiPanelContextCategoryView
} from '@/services/aiPanelPopupRuntime'
import {
  createAiPanelPopupInteractionRuntime,
  createEmptyAiPanelPopupInteractionState
} from '@/services/aiPanelPopupInteractionRuntime'
import {
  createAiPanelModelRuntime,
  createEmptyAiPanelModelRuntimeState,
  displayAiPanelModelName,
  isThinkingAiPanelModelName
} from '@/services/aiPanelModelRuntime'
import {
  aiPanelChatExportMessage as chatExportMessage,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandLineCountForText,
  commandOutputLineCount,
  commandTextForMessage,
  formatAiPanelLineCount as formatLineCount,
  isAiPanelCommandSuggestionMessage as isCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  renderAiPanelMarkdownParts as renderedMarkdownParts,
  type AiPanelCommandSuggestionMessage as CommandSuggestionMessage
} from '@/services/aiPanelMessageRuntime'
import { createAiPanelMessageActionRuntime } from '@/services/aiPanelMessageActionRuntime'
import {
  createAiPanelCommandActionRuntime,
  createEmptyAiPanelCommandActionRuntimeState
} from '@/services/aiPanelCommandActionRuntime'
import {
  aiConversationTabTooltip,
  aiHistoryDateLabel,
  displayAiConversationTitle,
  filterAiHistoryConversations,
  formatAiHistoryTime,
  groupAiHistoryConversations,
  hasMoreAiHistoryConversations,
  visibleAiConversationTabs,
  visibleAiHistoryConversations
} from '@/services/aiPanelConversationRuntime'
import { createAiPanelChatSearchRuntime, createEmptyAiPanelChatSearchRuntimeState } from '@/services/aiPanelChatSearchRuntime'
import { createAiPanelHistoryRuntime, createEmptyAiPanelHistoryRuntimeState } from '@/services/aiPanelHistoryRuntime'
import {
  aiPanelDropEffect,
  canAcceptAiPanelDrop as canAcceptAiPanelRuntimeDrop,
  clipboardHasImageItems,
  planAiPanelDrop
} from '@/services/aiPanelMediaRuntime'
import { createAiPanelAttachmentRuntime } from '@/services/aiPanelAttachmentRuntime'
import {
  cancelAiPanelMessageEdit,
  prepareAiPanelMessageEditConfirmation,
  removeAiPanelEditPartFromClickTarget,
  startAiPanelMessageEdit,
  syncAiPanelEditStateFromParts
} from '@/services/aiPanelEditRuntime'
import { createAiPanelComposerRuntime, isAiPanelComposerEmpty } from '@/services/aiPanelComposerRuntime'
import { createAiPanelVoiceRuntime } from '@/services/aiPanelVoiceRuntime'
import { aiChatClient } from '@/services/aiChatClient'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { codexTargetSignature } from '@/services/codexTargetRuntime'
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
} from '@/services/aiPanelCodexRuntime'
import {
  createAiPanelCodexTerminalRuntime,
  type AiPanelCodexTerminalConversation
} from '@/services/aiPanelCodexTerminalRuntime'
import { writeRendererRuntimeLog as writeAiRuntimeLog } from '@/services/runtimeLogClient'
import { malformedAiBackendResultMessage } from '@/services/aiBackendGuards'
import { useI18n } from '@/i18n'
import type {
  AiChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  ConversationItem,
  TerminalPanel
} from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

export type AiPanelContainerRuntimeProps = { agentMode?: boolean }

export const useAiPanelContainerRuntime = (props: AiPanelContainerRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const agentMode = computed(() => Boolean(props.agentMode))
  type AiChatMode = 'agent' | 'cmd'
  type AiContextCategoryView = AiPanelContextCategoryView<Component>

  const aiChatModeOptions: Array<{ id: AiChatMode; label: string; detail: string }> = [
    { id: 'agent', label: 'Agent', detail: '上下文辅助与工具调用' },
    { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
  ]

  const aiContextCategoryIcons: Record<AiContextKind, Component> = {
    hosts: Server,
    docs: FileText,
    images: Image,
    skills: Bot,
    chats: Search
  }
  const draft = ref('')
  const aiPanelMode = ref<AiPanelMode>(readStoredAiPanelMode())
  const imageInputParts = ref<AiImageContentPart[]>([])
  const fileInputParts = ref<AiDocChipContentPart[]>([])
  const chatScrollRef = ref<HTMLElement | null>(null)
  const editableRef = ref<HTMLElement | null>(null)
  const editEditableRef = ref<HTMLElement | null>(null)
  const chatSearchInputRef = ref<HTMLInputElement | null>(null)
  const historySearchInputRef = ref<HTMLInputElement | null>(null)
  const editingMessageId = ref<string | null>(null)
  const editDraft = ref('')
  const editImageInputParts = ref<AiImageContentPart[]>([])
  const editFileInputParts = ref<AiDocChipContentPart[]>([])
  const editHostContexts = ref<AiContextOption[]>([])
  const modelSearchInputRef = ref<HTMLInputElement | null>(null)
  const contextSearchInputRef = ref<HTMLInputElement | null>(null)
  const commandSearchInputRef = ref<HTMLInputElement | null>(null)
  const savedRange = ref<Range | null>(null)
  const editSavedRange = ref<Range | null>(null)
  const popupInteractionState = reactive(createEmptyAiPanelPopupInteractionState())
  const contextPopupOpen = toRef(popupInteractionState, 'contextPopupOpen')
  const commandPopupOpen = toRef(popupInteractionState, 'commandPopupOpen')
  const contextTarget = toRef(popupInteractionState, 'contextTarget')
  const commandTarget = toRef(popupInteractionState, 'commandTarget')
  const contextLevel = toRef(popupInteractionState, 'contextLevel')
  const contextQuery = toRef(popupInteractionState, 'contextQuery')
  const commandQuery = toRef(popupInteractionState, 'commandQuery')
  const contextKeyboardIndex = toRef(popupInteractionState, 'contextKeyboardIndex')
  const commandKeyboardIndex = toRef(popupInteractionState, 'commandKeyboardIndex')
  const docsCurrentRelDir = toRef(popupInteractionState, 'docsCurrentRelDir')
  const docsDirStack = toRef(popupInteractionState, 'docsDirStack')
  const modelRuntimeState = reactive(createEmptyAiPanelModelRuntimeState())
  const chatMode = toRef(modelRuntimeState, 'chatMode')
  const modeMenuOpen = toRef(modelRuntimeState, 'modeMenuOpen')
  const modelMenuOpen = toRef(modelRuntimeState, 'modelMenuOpen')
  const modelQuery = toRef(modelRuntimeState, 'modelQuery')
  const dropActive = ref(false)
  const syncingFromEditable = ref(false)
  const inputPlaceholderNotice = ref('')
  const historyRuntimeState = reactive(createEmptyAiPanelHistoryRuntimeState())
  const chatSearchRuntimeState = reactive(createEmptyAiPanelChatSearchRuntimeState())
  const commandActionRuntimeState = reactive(createEmptyAiPanelCommandActionRuntimeState())
  const chatSearchOpen = toRef(historyRuntimeState, 'chatSearchOpen')
  const chatSearchTerm = toRef(chatSearchRuntimeState, 'term')
  const chatSearchMatchCount = toRef(chatSearchRuntimeState, 'matchCount')
  const chatSearchCurrentIndex = toRef(chatSearchRuntimeState, 'currentIndex')
  const panelModeMenuOpen = ref(false)
  const moreActionsMenuOpen = toRef(historyRuntimeState, 'moreActionsMenuOpen')
  const historyMenuOpen = toRef(historyRuntimeState, 'historyMenuOpen')
  const historySearchTerm = toRef(historyRuntimeState, 'historySearchTerm')
  const historyFavoritesOnly = toRef(historyRuntimeState, 'historyFavoritesOnly')
  const historyCurrentPage = toRef(historyRuntimeState, 'historyCurrentPage')
  const historyLoadingMore = toRef(historyRuntimeState, 'historyLoadingMore')
  const editingHistoryId = toRef(historyRuntimeState, 'editingHistoryId')
  const editingHistoryTitle = toRef(historyRuntimeState, 'editingHistoryTitle')
  const chatExportNotice = toRef(historyRuntimeState, 'chatExportNotice')
  const openConversationTabIds = toRef(historyRuntimeState, 'openConversationTabIds')
  const commandAuditTextareaRef = ref<HTMLTextAreaElement | null>(null)
  const commandAuditDialog = toRef(commandActionRuntimeState, 'commandAuditDialog')
  const codexTargetPickerOpen = ref(false)
  const codexTargetQuery = ref('')
  type CodexConversation = AiPanelCodexConversationRuntimeState & AiPanelCodexTerminalConversation & {
    host: HTMLElement | null
  }
  const codexConversations = ref<CodexConversation[]>([])
  const activeCodexConversationId = ref('')
  let classicChatDataLoaded = false
  let inputPlaceholderNoticeTimer: number | undefined
  let chatScrollFrame: number | undefined
  const historyPageSize = 20
  const historyFavoriteLabel = computed(() => t('ai.historyFavoriteGroup'))
  const maxHostContexts = 5
  const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))
  const activeCodexConversation = computed(() => codexConversations.value.find((conversation) => conversation.id === activeCodexConversationId.value) || null)
  const terminalSettingsSignature = () => codexTerminalSettingsSignature(workspace.terminalSettings)
  const activeCodexBoundTarget = computed(() => activeCodexConversation.value?.boundTarget || null)
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
  const currentAiPanelModeLabel = computed(() => (aiPanelMode.value === 'codex' ? t('ai.codexCliMode') : t('ai.classicChatMode')))
  const visibleConversationTabs = computed(() => visibleAiConversationTabs(openConversationTabIds.value, workspace.conversations))
  const displayConversationTitle = (conversation: Pick<ConversationItem, 'title'>) =>
    displayAiConversationTitle(conversation, t('ai.untitledChat'))
  const conversationTabTooltip = (conversation: ConversationItem) => aiConversationTabTooltip(conversation, t('ai.untitledChat'))
  const currentPanelTarget = computed(() => {
    const target = currentCodexTargetContext()
    return target.sessionId && target.kind !== 'unknown' ? target : null
  })
  const codexHostTargets = computed(() => {
    const hosts = workspace.aiContextCatalog.categories.find((category) => category.id === 'hosts')?.options || []
    const openedHosts = workspace.aiContextCatalog.openedHosts || []
    const byId = new Map<string, AiContextOption>()
    ;[...openedHosts, ...hosts].forEach((host) => {
      if (host.kind === 'hosts' && !byId.has(host.id)) byId.set(host.id, { ...host })
    })
    return [...byId.values()]
  })
  let codexConversationSequence = 0

  const nextCodexConversationId = () => `codex-${Date.now().toString(36)}-${++codexConversationSequence}`

  const codexTargetTitle = (target?: CodexSessionTargetContext | null) => codexRuntimeTargetTitle(target, t('ai.codexCliMode'))

  const codexConversationTitle = (conversation: Pick<CodexConversation, 'title' | 'boundTarget'>) =>
    codexRuntimeConversationTitle(conversation, t('ai.codexCliMode'))

  const codexAttentionId = (conversation: Pick<CodexConversation, 'id'>) => codexRuntimeAttentionId(conversation)

  const syncCodexAttentionState = (conversation: CodexConversation) => {
    const id = codexAttentionId(conversation)
    if (conversation.status !== 'error') {
      workspace.removeAiAttentionItem(id)
      return
    }
    workspace.upsertAiAttentionItem({
      id,
      source: 'codex',
      kind: 'error',
      conversationId: conversation.id,
      sessionId: conversation.sessionId || undefined,
      surfaceId: props.agentMode ? 'agents-ai-panel' : 'terminal-ai-panel',
      title: codexConversationTitle(conversation),
      summary: conversation.error || t('ai.codexError')
    })
  }

  const createCodexConversationRecord = (target?: CodexSessionTargetContext | null): CodexConversation =>
    createCodexConversationRuntimeRecord<CodexConversation>(nextCodexConversationId(), target, {
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

  const filteredCodexHostTargets = computed(() => {
    const keyword = codexTargetQuery.value.trim().toLowerCase()
    return codexHostTargets.value
      .filter((host) => !keyword || `${host.label} ${host.detail || ''} ${host.host || ''} ${host.assetName || ''}`.toLowerCase().includes(keyword))
      .slice(0, 20)
  })
  const ensureConversationTab = (id: string) => aiPanelHistoryRuntime.ensureConversationTab(id)
  const pruneConversationTabs = () => aiPanelHistoryRuntime.pruneConversationTabs()
  const historyLabels = computed(() => ({
    today: t('ai.historyToday'),
    yesterday: t('ai.historyYesterday'),
    daysAgo: (count: number) => t('ai.historyDaysAgo').replace('{count}', String(count)),
    favoriteGroup: t('ai.historyFavoriteGroup')
  }))
  const filteredHistoryConversations = computed(() =>
    filterAiHistoryConversations(workspace.sortedConversations, historySearchTerm.value, historyFavoritesOnly.value)
  )
  const visibleHistoryConversations = computed(() =>
    visibleAiHistoryConversations(filteredHistoryConversations.value, historyCurrentPage.value, historyPageSize)
  )
  const hasMoreHistoryConversations = computed(() =>
    hasMoreAiHistoryConversations(filteredHistoryConversations.value.length, visibleHistoryConversations.value.length)
  )
  const groupedVisibleHistory = computed(() => {
    const labels = historyLabels.value
    return groupAiHistoryConversations(visibleHistoryConversations.value, (conversation) =>
      historyFavoritesOnly.value ? labels.favoriteGroup : aiHistoryDateLabel(conversation.ts, new Date(), locale.value, labels)
    )
  })

  const aiPanelHistoryRuntime = createAiPanelHistoryRuntime<ConversationItem>({
    state: historyRuntimeState,
    conversations: () => workspace.conversations,
    selectedConversationId: () => workspace.selectedConversationId,
    visibleTabs: () => visibleConversationTabs.value,
    visibleHistoryCount: () => visibleHistoryConversations.value.length,
    chatMessageCount: () => workspace.chatMessages.length,
    currentConversationTitle: () => getCurrentConversationTitle(),
    exportMessages: () => workspace.chatMessages.map(chatExportMessage),
    createConversation: () => workspace.createConversation(),
    restoreConversation: (id) => workspace.restoreConversation(id),
    renameConversation: (id, title) => workspace.renameConversation(id, title),
    deleteConversation: (id) => workspace.deleteConversation(id),
    toggleConversationFavorite: (id) => workspace.toggleConversationFavorite(id),
    loadConversations: () => workspace.loadChatConversationsFromBackend({ restoreIfEmpty: false }),
    exportChat: () => aiChatClient.exportChat(),
    closeContextPopup: () => closeContextPopup(),
    closeCommandPopup: () => closeCommandPopup(),
    closeModelMenu: () => {
      aiPanelModelRuntime.closeModeMenu()
      aiPanelModelRuntime.closeModelMenu()
    },
    focusHistorySearchInput: () => nextTick(() => historySearchInputRef.value?.focus()),
    focusHistoryTitleInput: () =>
      nextTick(() => {
        const input = historySearchInputRef.value?.closest('.ai-history-dropdown')?.querySelector<HTMLInputElement>('.ai-history-title-input')
        input?.focus()
        input?.select()
      }),
    setNoticeTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearNoticeTimer: (timer) => window.clearTimeout(timer as number),
    labels: {
      chatCreated: () => t('ai.chatCreated'),
      chatCreateFailed: () => t('ai.chatCreateFailed'),
      chatRestored: () => t('ai.chatRestored'),
      chatRestoreFailed: () => t('ai.chatRestoreFailed'),
      keepOneTab: () => t('ai.keepOneTab'),
      tabClosed: () => t('ai.tabClosed'),
      historyTitleUpdated: () => t('ai.historyTitleUpdated'),
      historyTitleUpdateFailed: () => t('ai.historyTitleUpdateFailed'),
      chatDeleted: () => t('ai.chatDeleted'),
      chatDeleteFailed: () => t('ai.chatDeleteFailed'),
      historyFavorited: () => t('ai.historyFavorited'),
      historyUnfavorited: () => t('ai.historyUnfavorited'),
      historyFavoriteUpdateFailed: () => t('ai.historyFavoriteUpdateFailed'),
      exportEmpty: () => '当前会话为空，无法导出。',
      exportUnavailable: () => '聊天导出服务不可用。',
      exportFailed: (message) => `导出失败：${message}`,
      exportMalformed: () => `导出失败：${malformedAiBackendResultMessage}`,
      exportSuccess: () => '聊天已导出。'
    }
  })

  const loadClassicChatData = async () => {
    if (classicChatDataLoaded) return
    classicChatDataLoaded = true
    await Promise.all([workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }), workspace.hydrateClassicChatData()])
  }

  const currentCodexTargetContext = (): CodexSessionTargetContext => codexTargetContextFromPanel(workspace.activePanel)

  const currentBoundCodexTarget = (conversation = activeCodexConversation.value) => currentBoundCodexRuntimeTarget(conversation, workspace.panels)

  const aiPanelCodexTerminalRuntime = createAiPanelCodexTerminalRuntime<CodexConversation>({
    conversations: () => codexConversations.value,
    activeConversation: () => activeCodexConversation.value,
    activeConversationId: () => activeCodexConversationId.value,
    terminalSettings: () => workspace.terminalSettings,
    currentBoundTarget: (conversation) => currentBoundCodexTarget(conversation),
    syncAttentionState: syncCodexAttentionState,
    labels: {
      error: () => t('ai.codexError'),
      bridgeMissing: () => t('ai.codexBridgeMissing'),
      startFailed: () => t('ai.codexStartFailed'),
      copyEmpty: () => '请先选择 Codex 终端内容',
      copySuccess: () => 'Codex 终端内容已复制',
      copyFailure: () => 'Codex 终端复制失败'
    },
    notify: (message) => workspace.setTopNotice(message),
    afterDomUpdate: () => nextTick(),
    log: writeAiRuntimeLog
  })

  const setCodexTerminalHostRef = (conversationId: string, element: Element | ComponentPublicInstance | null) => {
    const conversation = codexConversations.value.find((item) => item.id === conversationId)
    if (!conversation) return
    aiPanelCodexTerminalRuntime.setHostElement(conversation, element instanceof HTMLElement ? element : null)
  }

  const fitCodexTerminal = aiPanelCodexTerminalRuntime.fitTerminal
  const focusCodexTerminal = aiPanelCodexTerminalRuntime.focusActiveTerminal
  const copyCodexSelectionFromContextMenu = aiPanelCodexTerminalRuntime.copySelectionFromContextMenu
  const syncActiveCodexBridgeTarget = aiPanelCodexTerminalRuntime.syncActiveBridgeTarget
  const syncCodexTargetContext = aiPanelCodexTerminalRuntime.syncTargetContext
  const setCodexPendingTargetContext = aiPanelCodexTerminalRuntime.setPendingTargetContext
  const ensureCodexTerminal = (conversation = ensureActiveCodexConversation()) => aiPanelCodexTerminalRuntime.ensureTerminal(conversation)
  const applyCodexTerminalSettings = (conversation: CodexConversation) => aiPanelCodexTerminalRuntime.applyTerminalSettings(conversation)
  const stopCodexSession = (conversation = activeCodexConversation.value) => aiPanelCodexTerminalRuntime.stopSession(conversation)
  const disposeCodexSubscriptions = aiPanelCodexTerminalRuntime.disposeSubscriptions

  const bindCodexTarget = async (target: CodexSessionTargetContext | null, options: { reason?: string; start?: boolean } = {}) => {
    const conversation = ensureActiveCodexConversation(target)
    if (!target?.sessionId || target.kind === 'unknown') {
      conversation.error = t('ai.codexTargetMissing')
      return false
    }
    const previous = applyCodexTargetBinding(conversation, target, { fallbackLabel: t('ai.codexCliMode') })
    codexTargetPickerOpen.value = false
    codexTargetQuery.value = ''
    writeAiRuntimeLog('info', 'renderer.codex-target.bound', {
      reason: options.reason,
      sessionId: target.sessionId,
      panelId: target.panelId,
      targetKind: target.kind,
      targetLabel: target.label,
      previousSessionId: previous?.sessionId
    })
    if (conversation.sessionId) {
      await syncCodexTargetContext({ force: true, conversation })
      await setCodexPendingTargetContext(conversation, previous ? 'changed' : 'bound', target)
    } else if (options.start !== false && aiPanelMode.value === 'codex') {
      await startCodexSession(conversation)
    }
    return true
  }

  const unbindCodexTarget = async () => {
    const conversation = activeCodexConversation.value
    if (!conversation) return
    const previous = applyCodexTargetUnbinding(conversation, t('ai.codexCliMode'))
    codexTargetPickerOpen.value = false
    codexTargetQuery.value = ''
    void previous
    await aiPanelCodexTerminalRuntime.clearSessionTarget(conversation, 'unbound')
  }

  const locateCodexBoundTarget = () => {
    const conversation = activeCodexConversation.value
    if (!conversation) return
    const target = conversation?.boundTarget
    if (!target?.sessionId) return
    const panel = workspace.activateTerminalPanel(target.panelId || target.sessionId)
    if (!panel) {
      conversation.error = t('ai.codexTargetClosed')
      return
    }
    conversation.error = ''
  }

  const closeCodexTargetPicker = () => {
    codexTargetPickerOpen.value = false
    codexTargetQuery.value = ''
  }

  const toggleCodexTargetPicker = async () => {
    codexTargetPickerOpen.value = !codexTargetPickerOpen.value
    if (!codexTargetPickerOpen.value) {
      codexTargetQuery.value = ''
      return
    }
    await workspace.refreshAiContextCatalog({ hydrateSelection: false })
  }

  const bindHostContextToCodex = async (host: AiContextOption) => {
    const panel = await workspace.openTerminalForAiHostContext(host)
    if (!panel?.sessionId) {
      ensureActiveCodexConversation().error = t('ai.codexTargetOpenFailed')
      return false
    }
    return bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'host-picker' })
  }

  const startCodexSession = async (targetConversation?: CodexConversation | null) => {
    if (aiPanelMode.value !== 'codex') return
    const conversation = targetConversation || ensureActiveCodexConversation()
    return aiPanelCodexTerminalRuntime.startSession(conversation)
  }

  const restartCodexSession = async () => {
    const conversation = ensureActiveCodexConversation()
    await stopCodexSession(conversation)
    resetCodexConversationForRestart(conversation)
    syncCodexAttentionState(conversation)
    conversation.terminal?.clear()
    await startCodexSession(conversation)
  }

  const createNewCodexConversation = async () => {
    const conversation = createCodexConversationRecord(currentPanelTarget.value || null)
    codexConversations.value = [...codexConversations.value, conversation]
    activeCodexConversationId.value = conversation.id
    closeCodexTargetPicker()
    await nextTick()
    ensureCodexTerminal(conversation)
    if (conversation.boundTarget && aiPanelMode.value === 'codex') await startCodexSession(conversation)
  }

  const selectCodexConversation = async (id: string) => {
    if (activeCodexConversationId.value === id) return
    const conversation = codexConversations.value.find((item) => item.id === id)
    if (!conversation) return
    activeCodexConversationId.value = id
    closeCodexTargetPicker()
    await nextTick()
    ensureCodexTerminal(conversation)
    await syncActiveCodexBridgeTarget()
    fitCodexTerminal({ force: true, conversation })
    focusCodexTerminal()
  }

  const focusAiAttentionItem = async (item: typeof workspace.currentAiAttentionItem) => {
    if (!item || item.source !== 'codex' || !item.conversationId) return
    const conversation = codexConversations.value.find((entry) => entry.id === item.conversationId)
    if (!conversation) {
      workspace.removeAiAttentionItem(item.id)
      return
    }
    if (aiPanelMode.value !== 'codex') await selectAiPanelMode('codex')
    else panelModeMenuOpen.value = false
    await selectCodexConversation(conversation.id)
    focusCodexTerminal()
    if (conversation.status !== 'error') {
      workspace.markAiAttentionHandled(item.id)
      return
    }
    workspace.setTopNotice(`已定位到 ${codexConversationTitle(conversation)}`)
  }

  const closeCodexConversation = async (id: string) => {
    const closeResult = closeCodexConversationRecord(codexConversations.value, activeCodexConversationId.value, id)
    if (closeResult.status === 'missing') return
    if (closeResult.status === 'keep-one') {
      showChatExportNotice(t('ai.keepOneTab'))
      return
    }
    const conversation = closeResult.conversation
    await stopCodexSession(conversation)
    workspace.removeAiAttentionItem(codexAttentionId(conversation))
    aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    codexConversations.value = closeResult.nextConversations
    if (closeResult.status === 'closed-active' && closeResult.nextConversation) {
      const nextConversation = closeResult.nextConversation
      activeCodexConversationId.value = closeResult.nextActiveId
      await nextTick()
      ensureCodexTerminal(nextConversation)
      await syncActiveCodexBridgeTarget()
      fitCodexTerminal({ force: true, conversation: nextConversation })
    }
    showChatExportNotice(t('ai.tabClosed'))
  }

  async function selectAiPanelMode(mode: AiPanelMode) {
    if (aiPanelMode.value === mode) {
      if (mode === 'codex') void startCodexSession()
      panelModeMenuOpen.value = false
      return
    }
    aiPanelMode.value = mode
    storeAiPanelMode(mode)
    closePopups()
    if (mode === 'classic') {
      await loadClassicChatData()
      return
    }
    ensureActiveCodexConversation()
    void startCodexSession()
  }

  const toggleAiPanelModeMenu = () => {
    panelModeMenuOpen.value = !panelModeMenuOpen.value
  }

  const closeModelMenu = () => {
    aiPanelModelRuntime.closeModelMenu()
  }

  const formatHistoryTime = (timestamp: number) => formatAiHistoryTime(timestamp, new Date(), locale.value, historyLabels.value)

  const getCurrentConversationTitle = () =>
    workspace.conversations.find((conversation) => conversation.id === workspace.selectedConversationId)?.title || 'Chat Export'

  const showChatExportNotice = (message: string) => {
    aiPanelHistoryRuntime.showNotice(message)
  }

  const aiPanelMessageActionRuntime = createAiPanelMessageActionRuntime({
    messages: () => workspace.chatMessages,
    copyText: copyTextToClipboard,
    notify: showChatExportNotice,
    approveMcpToolCall: (id, options) => workspace.approveAiMcpToolCall(id, options),
    rejectMcpToolCall: (id) => workspace.rejectAiMcpToolCall(id),
    approveMcpResourceAccess: (id) => workspace.approveAiMcpResourceAccess(id),
    rejectMcpResourceAccess: (id) => workspace.rejectAiMcpResourceAccess(id),
    toggleMessageFavorite: (id) => workspace.toggleMessageFavorite(id),
    setMessageFeedback: (id, feedback) => workspace.setMessageFeedback(id, feedback),
    retryAssistantMessage: (id) => workspace.retryAssistantMessage(id),
    summarizeMessageToKnowledge: (id) => workspace.summarizeMessageToKnowledge(id),
    summarizeMessageToSkill: (id) => workspace.summarizeMessageToSkill(id)
  })

  const copyRenderedTextToClipboard = aiPanelMessageActionRuntime.copyRenderedTextToClipboard
  const copyMessageToClipboard = aiPanelMessageActionRuntime.copyMessageToClipboard

  const scrollChatToBottom = () => {
    const root = chatScrollRef.value
    if (!root) return
    root.scrollTop = root.scrollHeight
  }

  const scheduleChatScrollToBottom = () => {
    void nextTick(() => {
      if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
      chatScrollFrame = window.requestAnimationFrame(() => {
        chatScrollFrame = undefined
        scrollChatToBottom()
      })
    })
  }

  const aiPanelChatSearchRuntime = createAiPanelChatSearchRuntime({
    state: chatSearchRuntimeState,
    isOpen: () => chatSearchOpen.value,
    setOpen: (open) => {
      chatSearchOpen.value = open
      if (open) moreActionsMenuOpen.value = false
    },
    root: () => chatScrollRef.value,
    closePopups: () => closePopups(),
    focusSearchInput: () => chatSearchInputRef.value?.focus(),
    afterDomUpdate: () => nextTick(),
    scheduleScrollToBottom: scheduleChatScrollToBottom,
    setSearchTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearSearchTimer: (timer) => window.clearTimeout(timer as number)
  })

  const openChatSearch = () => aiPanelChatSearchRuntime.openSearch()
  const closeChatSearch = () => aiPanelChatSearchRuntime.closeSearch()
  const clearChatSearch = () => aiPanelChatSearchRuntime.clearSearch()
  const findNextChatMatch = () => aiPanelChatSearchRuntime.findNextMatch()
  const findPreviousChatMatch = () => aiPanelChatSearchRuntime.findPreviousMatch()

  const aiPanelCommandActionRuntime = createAiPanelCommandActionRuntime({
    state: commandActionRuntimeState,
    messages: () => workspace.chatMessages,
    activePanel: () => workspace.activePanel,
    panels: () => workspace.panels,
    chatMode: () => chatMode.value,
    copyText: copyTextToClipboard,
    notify: showChatExportNotice,
    runActiveTerminalCommand: (command, source) => workspace.runActiveTerminalCommand(command, source),
    continueAgentCommandLoop: (input) => workspace.continueAgentCommandLoop(input),
    enableAgentReadOnlyAutoRunForCurrentConversation: () => workspace.enableAgentReadOnlyAutoRunForCurrentConversation(),
    syncCurrentConversationSnapshot: (options) => workspace.syncCurrentConversationSnapshot(options)
  })

  const activeCommandAuditMessage = computed(() => aiPanelCommandActionRuntime.activeCommandAuditMessage())
  const canEditActiveCommandAudit = computed(() => aiPanelCommandActionRuntime.canEditActiveCommandAudit())
  const copyCommandToClipboard = aiPanelCommandActionRuntime.copyCommandToClipboard
  const closeCommandAuditDialog = aiPanelCommandActionRuntime.closeCommandAuditDialog
  const saveCommandAuditDraft = aiPanelCommandActionRuntime.saveCommandAuditDraft
  const copyCommandAuditDraft = aiPanelCommandActionRuntime.copyCommandAuditDraft
  const rejectMessageCommand = aiPanelCommandActionRuntime.rejectMessageCommand
  const runMessageCommand = aiPanelCommandActionRuntime.runMessageCommand

  const openCommandAuditDialog = async (message: CommandSuggestionMessage) => {
    aiPanelCommandActionRuntime.openCommandAuditDialog(message)
    closePopups()
    await nextTick()
    commandAuditTextareaRef.value?.focus()
    commandAuditTextareaRef.value?.select()
  }

  const runCommandAuditDraft = aiPanelCommandActionRuntime.runCommandAuditDraft

  const formatMcpToolArguments = aiPanelMessageActionRuntime.formatMcpToolArguments
  const approveMcpToolCall = aiPanelMessageActionRuntime.approveMcpToolCall
  const rejectMcpToolCall = aiPanelMessageActionRuntime.rejectMcpToolCall
  const approveMcpResourceAccess = aiPanelMessageActionRuntime.approveMcpResourceAccess
  const rejectMcpResourceAccess = aiPanelMessageActionRuntime.rejectMcpResourceAccess
  const toggleMessageFavorite = aiPanelMessageActionRuntime.toggleMessageFavorite
  const setMessageFeedback = aiPanelMessageActionRuntime.setMessageFeedback
  const retryAssistantMessage = aiPanelMessageActionRuntime.retryAssistantMessage
  const summarizeMessageToKnowledge = aiPanelMessageActionRuntime.summarizeMessageToKnowledge
  const summarizeMessageToSkill = aiPanelMessageActionRuntime.summarizeMessageToSkill

  const exportCurrentChat = () => aiPanelHistoryRuntime.exportCurrentChat()
  const openHistoryMenu = () => aiPanelHistoryRuntime.openHistoryMenu()
  const closeHistoryMenu = () => aiPanelHistoryRuntime.closeHistoryMenu()
  const toggleHistoryMenu = () => aiPanelHistoryRuntime.toggleHistoryMenu()
  const toggleMoreActionsMenu = () => aiPanelHistoryRuntime.toggleMoreActionsMenu()
  const clearHistorySearch = () => void aiPanelHistoryRuntime.clearHistorySearch()
  const createNewAiConversation = () => aiPanelHistoryRuntime.createNewConversation()
  const restoreConversationById = (id: string, successMessage = t('ai.chatRestored'), failureMessage = t('ai.chatRestoreFailed')) =>
    aiPanelHistoryRuntime.restoreConversationById(id, successMessage, failureMessage)
  const restoreConversationFromTab = (id: string) => aiPanelHistoryRuntime.restoreConversationFromTab(id)
  const closeConversationTab = (id: string) => aiPanelHistoryRuntime.closeConversationTab(id)
  const restoreHistoryConversation = (id: string) => aiPanelHistoryRuntime.restoreHistoryConversation(id)
  const editHistoryTitle = (id: string) => aiPanelHistoryRuntime.editHistoryTitle(id)
  const cancelHistoryTitleEdit = () => aiPanelHistoryRuntime.cancelHistoryTitleEdit()
  const saveHistoryTitle = (id: string) => aiPanelHistoryRuntime.saveHistoryTitle(id)
  const deleteHistoryConversation = (id: string) => aiPanelHistoryRuntime.deleteHistoryConversation(id)
  const toggleHistoryFavorite = (id: string) => aiPanelHistoryRuntime.toggleHistoryFavorite(id)
  const loadMoreHistoryConversations = () => aiPanelHistoryRuntime.loadMoreHistoryConversations(hasMoreHistoryConversations.value)

  type AiCommandOption = AiCommandCatalogOption

  const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
    editEditableRef.value = el instanceof HTMLElement ? el : null
  }

  const aiContextCategories = computed<AiContextCategoryView[]>(() =>
    cloneAiPanelContextCategories(workspace.aiContextCatalog.categories, (kind) => aiContextCategoryIcons[kind] || Search)
  )
  const selectedContextCategory = computed(() => selectedAiPanelContextCategory(aiContextCategories.value, contextLevel.value))
  const docsContextOptions = computed<AiContextOption[]>(() =>
    sortedAiPanelDocsContextOptions(selectedContextCategory.value?.options || [], docsCurrentRelDir.value)
  )
  const commandOptions = computed<AiCommandOption[]>(() => cloneAiPanelCommandOptions(workspace.aiCommandOptions))
  const displayedOpenedHosts = computed(() =>
    filteredAiPanelOpenedHosts(workspace.aiContextCatalog.openedHosts, contextQuery.value, chatMode.value)
  )
  const visibleContextCategories = computed(() => visibleAiPanelContextCategories(aiContextCategories.value, chatMode.value))
  const filteredContextOptions = computed(() =>
    filteredAiPanelContextOptions({
      level: contextLevel.value,
      selectedCategoryOptions: selectedContextCategory.value?.options,
      docsOptions: docsContextOptions.value,
      skillOptions: workspace.aiSkillContextOptions,
      query: contextQuery.value
    })
  )
  const visibleHostContextOptions = computed(() => visibleAiPanelHostContextOptions(filteredContextOptions.value))
  const hostContextsForPopup = computed(() =>
    contextTarget.value === 'edit' ? editHostContexts.value : workspace.selectedContexts.filter((context) => context.kind === 'hosts')
  )
  const allVisibleHostContextsSelected = computed(() => allVisibleAiPanelHostsSelected(visibleHostContextOptions.value, hostContextsForPopup.value))
  const filteredCommands = computed(() => filteredAiPanelCommands(commandOptions.value, commandQuery.value))
  const selectedCommand = computed(() => selectedAiPanelCommand(commandOptions.value, workspace.selectedCommandId))
  const composerIsEmpty = computed(() =>
    isAiPanelComposerEmpty({
      draft: draft.value,
      selectedContextCount: workspace.selectedContexts.length,
      images: imageInputParts.value,
      files: fileInputParts.value,
      selectedCommand: selectedCommand.value
    })
  )

  const measureUiTextWidthPx = (text: string) => {
    if (!text) return 0
    if (typeof document === 'undefined') return text.length * 7
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return text.length * 7
    context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
    return context.measureText(text).width
  }

  const aiPanelModelRuntime = createAiPanelModelRuntime({
    state: modelRuntimeState,
    chatModeOptions: () => aiChatModeOptions,
    availableModels: () => workspace.aiModelOptions,
    lockedModels: () => workspace.lockedAiModelOptions,
    settingsModelCount: () => workspace.settingModelOptions.length,
    selectedModelName: () => workspace.config.modelName,
    selectModel: (modelId) => workspace.selectAiModel(modelId),
    closeContextPopup: () => closeContextPopup(),
    closeCommandPopup: () => closeCommandPopup(),
    closePopups: () => closePopups(),
    openModelSettings: () => {
      workspace.setActiveModule('settings')
      workspace.setActiveSettingsSection('models')
    },
    openModelLogin: async () => {
      await workspace.openUserLogin()
    },
    focusModelSearchInput: () => modelSearchInputRef.value?.focus(),
    afterDomUpdate: () => nextTick(),
    measureText: measureUiTextWidthPx,
    lockedModelTooltip: (tier) => `模型已锁定，升级 ${tier} 后可用`
  })

  const currentChatMode = computed(() => aiPanelModelRuntime.currentChatMode())
  const selectedModelLabel = computed(() => aiPanelModelRuntime.selectedModelLabel())
  const filteredModelOptions = computed(() => aiPanelModelRuntime.filteredModelOptions())
  const filteredLockedModelOptions = computed(() => aiPanelModelRuntime.filteredLockedModelOptions())
  const showNoAvailableModelPrompt = computed(() => aiPanelModelRuntime.showNoAvailableModelPrompt())
  const modeDropdownWidthPx = computed(() => aiPanelModelRuntime.modeDropdownWidthPx())
  const modelDropdownWidthPx = computed(() => aiPanelModelRuntime.modelDropdownWidthPx())
  const displayModelName = displayAiPanelModelName
  const isThinkingModelName = isThinkingAiPanelModelName
  const lockedModelTooltip = aiPanelModelRuntime.lockedModelTooltip
  const selectedCommandRef = computed(() => {
    return selectedAiPanelCommandRef(selectedCommand.value, workspace.selectedCommandId, workspace.selectedCommandRef)
  })

  const contextUsage = computed(() => {
    return workspace.aiContextUsage || { used: 0, contextWindow: 0, percent: 0 }
  })

  const contextUsageColor = computed(() => {
    const percent = contextUsage.value.percent
    if (percent >= 90) return '#ef4444'
    if (percent >= 70) return '#f59e0b'
    return '#3b82f6'
  })

  const contextUsageTrackColor = computed(() => 'rgba(128, 128, 128, 0.2)')

  const contextUsageTooltip = computed(() => {
    const { used, contextWindow, percent } = contextUsage.value
    const formatK = (value: number) => {
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
      return `${value}`
    }
    return `${percent}% - ${formatK(used)} / ${formatK(contextWindow)} context used`
  })

  const commandIconMarkup =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path></svg>'

  const iconMarkupByContextKind: Record<AiContextKind, string> = {
    hosts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>',
    docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>',
    images: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20"></path></svg>',
    skills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z"></path><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"></path></svg>',
    chats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>'
  }

  const iconMarkupByChipType: Record<AiChipContentPart['chipType'], string> = {
    doc: iconMarkupByContextKind.docs,
    chat: iconMarkupByContextKind.chats,
    command: commandIconMarkup,
    skill: iconMarkupByContextKind.skills
  }

  const imagePartFromContext = aiImagePartFromContext
  const chipPartFromContext = aiChipPartFromContext

  const removeEditHostContext = (id: string) => {
    editHostContexts.value = editHostContexts.value.filter((context) => context.id !== id)
  }

  const openEditContextPopup = () => {
    openContextPopupForTarget('edit')
  }

  const editableRenderOptions = computed<AiPanelEditableRenderOptions>(() => ({
    iconMarkupByContextKind,
    commandIconMarkup
  }))

  const getChipLabel = aiPanelChipLabel

  const createChipElement = (
    part: AiChipContentPart,
    options: { removableContextId?: string; removableCommand?: boolean; removablePart?: boolean } = {}
  ) => createAiPanelChipElement(part, editableRenderOptions.value, options)

  const insertImageIntoEditableCursor = (editable: HTMLElement | null, part: AiImageContentPart, onInserted: () => void) =>
    insertAiPanelImageIntoEditableCursor(editable, part, onInserted)

  const insertImageAtEditableCursor = (part: AiImageContentPart) => {
    return insertImageIntoEditableCursor(editableRef.value, part, () => {
      imageInputParts.value = [...imageInputParts.value, part]
      handleEditableInput()
    })
  }

  const insertImageAtEditCursor = (part: AiImageContentPart) => {
    return insertImageIntoEditableCursor(editEditableRef.value, part, () => {
      editImageInputParts.value = [...editImageInputParts.value, part]
      handleEditEditableInput()
    })
  }

  const insertContextAtEditCursor = (context: AiContextOption) => {
    const imagePart = imagePartFromContext(context)
    if (imagePart) {
      return insertImageAtEditCursor(imagePart)
    }

    const chipPart = chipPartFromContext(context)
    if (!chipPart) return false
    restoreEditSelection()
    const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
    return insertChipIntoEditableCursor(editTarget, chipPart, handleEditEditableInput, '@')
  }

  const insertFileChipAtMainCursor = (part: AiDocChipContentPart) => {
    restoreEditableSelection()
    return insertChipIntoEditableCursor(editableRef.value, part, () => {
      fileInputParts.value = [...fileInputParts.value, part]
      handleEditableInput()
    }, '@')
  }

  const insertFileChipAtEditCursor = (part: AiDocChipContentPart) => {
    restoreEditSelection()
    const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
    return insertChipIntoEditableCursor(editTarget, part, handleEditEditableInput, '@')
  }

  const clipboardHasImage = (event: ClipboardEvent) => clipboardHasImageItems(event.clipboardData?.items)

  const insertPlainTextIntoEditableCursor = (editable: HTMLElement | null, text: string, onInserted: () => void) =>
    insertAiPanelPlainTextIntoEditableCursor(editable, text, onInserted)

  const insertPlainTextAtEditCursor = (text: string) => {
    insertPlainTextIntoEditableCursor(editEditableRef.value, text, handleEditEditableInput)
  }

  const removeTokenBeforeRange = removeAiPanelTokenBeforeRange

  const removeTokenFromEditableCursor = removeAiPanelTokenFromEditableCursor

  const insertChipIntoEditableCursor = (editable: HTMLElement | null, part: AiChipContentPart, onInserted: () => void, triggerToken = '/') =>
    insertAiPanelChipIntoEditableCursor(editable, part, editableRenderOptions.value, onInserted, triggerToken)

  const saveEditSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editEditableRef.value) return
    const range = selection.getRangeAt(0)
    if (!editEditableRef.value.contains(range.startContainer)) return
    editSavedRange.value = range.cloneRange()
  }

  const restoreEditSelection = () => {
    const selection = window.getSelection()
    if (!selection || !editSavedRange.value) return
    selection.removeAllRanges()
    selection.addRange(editSavedRange.value)
  }

  const getActiveEditableRange = (editable: HTMLElement | null, fallbackRange?: Range | null): Range | null => {
    const selection = window.getSelection()
    if (!editable) return null
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0)
      if (editable.contains(range.startContainer)) return range
    }
    if (fallbackRange && editable.contains(fallbackRange.startContainer)) return fallbackRange
    return null
  }

  const getCharBeforeCaret = (editable: HTMLElement | null, fallbackRange?: Range | null): string | null => {
    const range = getActiveEditableRange(editable, fallbackRange)
    if (!range) return null
    const container = range.startContainer
    const offset = range.startOffset
    if (container.nodeType === Node.TEXT_NODE) {
      const text = (container as Text).data
      if (offset <= 0 || offset > text.length) return null
      return text[offset - 1] ?? null
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      const previousNode = (container as Element).childNodes[offset - 1]
      if (!previousNode) return null
      if (previousNode.nodeType === Node.TEXT_NODE) {
        const text = (previousNode as Text).data
        return text.length > 0 ? text[text.length - 1] : null
      }
      const text = (previousNode as HTMLElement).textContent || ''
      return text.length > 0 ? text[text.length - 1] : null
    }
    return null
  }

  const shouldTriggerCommandPopupForSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
    const range = getActiveEditableRange(editable, fallbackRange)
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return false
    const textNode = range.startContainer as Text
    const text = textNode.data
    const offset = range.startOffset
    if (offset <= 0 || offset > text.length || text[offset - 1] !== '/') return false
    const beforeChar = offset - 2 >= 0 ? text[offset - 2] : null
    const afterChar = offset < text.length ? text[offset] : null
    const isBoundaryOrWhitespace = (char: string | null) => char === null || /\s/.test(char)
    return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
  }

  const shouldTriggerCommandPopupForPendingSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
    const range = getActiveEditableRange(editable, fallbackRange)
    if (!range) return false
    const isBoundaryOrWhitespace = (char: string | null) => char === null || /\s/.test(char)

    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const text = (range.startContainer as Text).data
      const offset = range.startOffset
      const beforeChar = offset - 1 >= 0 ? text[offset - 1] : null
      const afterChar = offset < text.length ? text[offset] : null
      return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
    }

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const element = range.startContainer as Element
      const previousNode = element.childNodes[range.startOffset - 1]
      const nextNode = element.childNodes[range.startOffset]
      const previousText = previousNode?.textContent || ''
      const nextText = nextNode?.textContent || ''
      const beforeChar = previousText ? previousText[previousText.length - 1] : null
      const afterChar = nextText ? nextText[0] : null
      return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
    }

    return false
  }

  const shouldTriggerCommandPopupFromEditableText = () => {
    const text = editablePlainText()
    return /(?:^|\s)\/$/.test(text)
  }

  const openCommandPopupForTarget = (target: 'main' | 'edit') => aiPanelPopupInteractionRuntime.openCommandPopupForTarget(target)

  function openContextPopupForTarget(target: 'main' | 'edit', level: 'main' | AiContextKind = 'main') {
    aiPanelPopupInteractionRuntime.openContextPopupForTarget(target, level)
  }

  const renderPartsIntoEditable = (editable: HTMLElement, parts: AiContentPart[]) =>
    renderAiPanelPartsIntoEditable(editable, parts, editableRenderOptions.value)

  const renderEditableFromState = () => {
    const editable = editableRef.value
    if (!editable) return
    syncingFromEditable.value = true
    const active = document.activeElement === editable
    renderAiPanelMainEditableFromState(
      editable,
      {
        draft: draft.value,
        images: imageInputParts.value,
        files: fileInputParts.value,
        command: selectedCommandRef.value
      },
      editableRenderOptions.value
    )
    if (active && !contextPopupOpen.value && !commandPopupOpen.value && !modelMenuOpen.value) {
      moveEditableCaretToEnd()
    }
    void nextTick(() => {
      syncingFromEditable.value = false
    })
  }

  const setDraft = (value: string) => {
    draft.value = value
    void nextTick(() => {
      renderEditableFromState()
    })
  }

  const editablePlainText = () => {
    return aiPanelEditablePlainText(editableRef.value)
  }

  const contextById = (id: string) => workspace.selectedContexts.find((item) => item.id === id) || null

  const extractEditableContentParts = () => {
    return extractAiPanelContentPartsFromEditable(editableRef.value, { contextById })
  }

  const extractContentPartsFromEditable = (editable: HTMLElement | null) => {
    return extractAiPanelContentPartsFromEditable(editable, { contextById })
  }

  const editableTextFromElement = (editable: HTMLElement | null) => {
    return aiPanelEditablePlainText(editable)
  }

  const renderEditEditableFromParts = (parts: AiContentPart[]) => {
    const editable = editEditableRef.value
    if (!editable) return
    renderPartsIntoEditable(editable, parts)
    const nextState = syncAiPanelEditStateFromParts(parts, editableTextFromElement(editable))
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    requestAnimationFrame(() => {
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      editable.focus()
    })
  }

  const startMessageEdit = async (message: { id: string; role: string; text: string; contentParts?: AiContentPart[]; hosts?: AiContextOption[] }) => {
    const edit = startAiPanelMessageEdit(message)
    if (!edit) return
    editingMessageId.value = edit.state.editingMessageId
    editDraft.value = edit.state.editDraft
    editImageInputParts.value = edit.state.editImageInputParts
    editFileInputParts.value = edit.state.editFileInputParts
    editHostContexts.value = edit.state.editHostContexts
    closePopups()
    await nextTick()
    renderEditEditableFromParts(edit.parts)
  }

  const cancelMessageEdit = () => {
    const nextState = cancelAiPanelMessageEdit()
    editingMessageId.value = nextState.editingMessageId
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    editHostContexts.value = nextState.editHostContexts
    editSavedRange.value = null
  }

  const handleEditEditableInput = () => {
    const nextState = syncAiPanelEditStateFromParts(
      extractContentPartsFromEditable(editEditableRef.value),
      editableTextFromElement(editEditableRef.value)
    )
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    saveEditSelection()
  }

  const handleEditEditableClick = (event: MouseEvent) => {
    const removed = removeAiPanelEditPartFromClickTarget(event.target as HTMLElement)
    if (removed) {
      handleEditEditableInput()
      return
    }
    saveEditSelection()
  }

  const handleEditEditablePaste = (event: ClipboardEvent) => {
    if (clipboardHasImage(event)) {
      event.preventDefault()
      void insertPastedImageIntoEdit()
      return
    }

    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') || ''
    insertPlainTextAtEditCursor(text)
  }

  const confirmMessageEdit = async () => {
    const contentParts = extractContentPartsFromEditable(editEditableRef.value)
    const confirmation = prepareAiPanelMessageEditConfirmation(
      {
        editingMessageId: editingMessageId.value,
        editHostContexts: editHostContexts.value
      },
      contentParts
    )
    if (!confirmation) return
    const sent = await workspace.resendUserMessageFromParts(confirmation.messageId, confirmation.contentParts, confirmation.hostContexts)
    if (sent) cancelMessageEdit()
  }

  const handleEditEditableKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handleEditEditableKeydown(event, popupEditableKeydownInput())
  }

  const saveEditableSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editableRef.value) return
    const range = selection.getRangeAt(0)
    if (!editableRef.value.contains(range.startContainer)) return
    savedRange.value = range.cloneRange()
  }

  const moveEditableCaretToEnd = () => {
    const editable = editableRef.value
    if (!editable) return
    editable.focus()
    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    saveEditableSelection()
  }

  const showInputPlaceholderNotice = (message: string) => {
    inputPlaceholderNotice.value = message
    if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
    inputPlaceholderNoticeTimer = window.setTimeout(() => {
      inputPlaceholderNotice.value = ''
      inputPlaceholderNoticeTimer = undefined
    }, 2400)
  }

  const ensureAttachmentConversationId = async () => {
    if (workspace.selectedConversationId.trim()) return workspace.selectedConversationId.trim()
    const created = await workspace.createConversation()
    return created?.id || ''
  }

  const aiPanelAttachmentRuntime = createAiPanelAttachmentRuntime({
    streaming: () => streaming.value,
    editingMessageId: () => editingMessageId.value,
    ensureConversationId: ensureAttachmentConversationId,
    insertImageAtMainCursor: insertImageAtEditableCursor,
    insertImageAtEditCursor,
    insertFileChipAtMainCursor,
    insertFileChipAtEditCursor,
    notify: showInputPlaceholderNotice
  })

  const {
    insertImageFilePaths,
    insertPastedImage,
    insertPastedImageIntoEdit,
    openImagePicker,
    handleFileUpload
  } = aiPanelAttachmentRuntime

  const aiPanelComposerRuntime = createAiPanelComposerRuntime({
    editable: () => editableRef.value,
    draft: () => draft.value,
    selectedCommandId: () => workspace.selectedCommandId,
    streaming: () => streaming.value,
    noModelPrompt: () => showNoAvailableModelPrompt.value,
    chatMode: () => chatMode.value,
    agentMode: () => props.agentMode,
    clipboardHasImage,
    extractContentParts: extractEditableContentParts,
    cancelStreaming: () => workspace.cancelStreamingAiChatResponse(),
    sendChat: (text, contentParts, mode) => workspace.sendChat(text, contentParts, undefined, { mode }),
    clearSelectedCommand: () => workspace.selectCommandPreset(null),
    removeContext: (id) => workspace.removeContext(id),
    setDraftFromEditable: (value) => {
      draft.value = value
    },
    resetDraft: setDraft,
    setImageInputParts: (parts) => {
      imageInputParts.value = parts
    },
    setFileInputParts: (parts) => {
      fileInputParts.value = parts
    },
    saveSelection: saveEditableSelection,
    setSyncingFromEditable: (value) => {
      syncingFromEditable.value = value
    },
    afterInputSync: () => nextTick(),
    insertPastedImage,
    scheduleCaretToEnd: () => requestAnimationFrame(moveEditableCaretToEnd),
    closePopups: () => closePopups(),
    notify: showInputPlaceholderNotice
  })

  const handleEditableInput = () => aiPanelComposerRuntime.handleInput()
  const insertPlainTextAtEditableCursor = (text: string) => aiPanelComposerRuntime.insertPlainTextAtCursor(text)
  const handleSend = async () => {
    await aiPanelComposerRuntime.send()
  }

  const appendVoiceTranscriptionToInput = (text: string) => {
    restoreEditableSelection()
    insertPlainTextAtEditableCursor(text)
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const aiPanelVoiceRuntime = createAiPanelVoiceRuntime({
    streaming: () => streaming.value,
    draft: () => draft.value,
    closePopups: () => closePopups(),
    restoreSelection: () => restoreEditableSelection(),
    insertTranscription: appendVoiceTranscriptionToInput,
    afterInsert: () => nextTick(),
    sendAfterTranscription: () => handleSend(),
    notify: showInputPlaceholderNotice
  })

  const { voiceRecording, voiceTranscribing, voiceButtonTitle, toggleVoiceInput } = aiPanelVoiceRuntime

  const canAcceptAiPanelDrop = (event: DragEvent) => canAcceptAiPanelRuntimeDrop(aiPanelMode.value, event.dataTransfer)

  const handleDragEnter = (event: DragEvent) => {
    if (canAcceptAiPanelDrop(event)) {
      dropActive.value = true
    }
  }

  const handleDragOver = (event: DragEvent) => {
    if (!canAcceptAiPanelDrop(event)) return
    dropActive.value = true
    if (event.dataTransfer) event.dataTransfer.dropEffect = aiPanelDropEffect(aiPanelMode.value)
  }

  const handleClassicDrop = async (event: DragEvent) => {
    const plan = planAiPanelDrop('classic', event.dataTransfer)
    if (plan.kind !== 'classic-knowledge') return
    await workspace.addKnowledgeFilesToChat([plan.relPath])
    if (!draft.value.trim()) setDraft(plan.draftText)
    requestAnimationFrame(moveEditableCaretToEnd)
    closePopups()
  }

  const handleCodexDrop = async (event: DragEvent) => {
    const plan = planAiPanelDrop('codex', event.dataTransfer)
    if (plan.kind === 'codex-terminal') {
      const panel = workspace.panels.find((item) => item.id === plan.panelId)
      if (panel?.sessionId) await bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'drop-terminal-tab' })
      return
    }
    if (plan.kind === 'codex-host') await bindHostContextToCodex(plan.context)
  }

  const handleDragLeave = (event: DragEvent) => {
    const target = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    if (!target || !related || !target.contains(related)) {
      dropActive.value = false
    }
  }

  const handleDrop = async (event: DragEvent) => {
    dropActive.value = false
    if (aiPanelMode.value === 'codex') {
      await handleCodexDrop(event)
      return
    }
    await handleClassicDrop(event)
  }

  const closePopups = (options: { restoreCommandFocus?: boolean; restoreContextFocus?: boolean } = {}) => {
    aiPanelPopupInteractionRuntime.closePopups(options)
  }

  const toggleContextPopup = () => aiPanelPopupInteractionRuntime.toggleContextPopup()

  const toggleModeMenu = () => {
    aiPanelModelRuntime.toggleModeMenu()
  }

  const toggleModelMenu = () => void aiPanelModelRuntime.toggleModelMenu()

  const selectChatMode = (mode: AiChatMode) => aiPanelModelRuntime.selectChatMode(mode)

  const selectModel = (modelId: string) => aiPanelModelRuntime.selectModel(modelId)

  const openModelSettings = () => aiPanelModelRuntime.openModelSettings()

  const openModelLogin = () => void aiPanelModelRuntime.openModelLogin()

  const handleModelKeydown = (event: KeyboardEvent) => void aiPanelModelRuntime.handleModelKeydown(event)

  const resetDocsContextNavigation = () => aiPanelPopupInteractionRuntime.resetDocsContextNavigation()
  const enterDocsDir = (context: AiContextOption) => aiPanelPopupInteractionRuntime.enterDocsDir(context)
  const goBackContextPopup = () => aiPanelPopupInteractionRuntime.goBackContextPopup()
  const returnContextPopupToMain = () => aiPanelPopupInteractionRuntime.returnContextPopupToMain()
  const closeContextPopup = (options: { restoreFocus?: boolean } = {}) => aiPanelPopupInteractionRuntime.closeContextPopup(options)

  const moveEditCaretToEnd = () => {
    const editable = editEditableRef.value
    if (!editable) return
    editable.focus()
    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    saveEditSelection()
  }

  const restoreEditableSelection = () => {
    const editable = editableRef.value
    const selection = window.getSelection()
    if (!editable || !selection) return false
    editable.focus()
    if (savedRange.value && editable.contains(savedRange.value.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(savedRange.value.cloneRange())
      return true
    }
    moveEditableCaretToEnd()
    return true
  }

  const restoreEditInputSelection = () => {
    const editable = editEditableRef.value
    const selection = window.getSelection()
    if (!editable || !selection) return false
    editable.focus()
    if (editSavedRange.value && editable.contains(editSavedRange.value.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(editSavedRange.value.cloneRange())
      return true
    }
    moveEditCaretToEnd()
    return true
  }

  function focusInputForTarget(target: 'main' | 'edit') {
    requestAnimationFrame(() => {
      if (target === 'edit') {
        restoreEditInputSelection()
        return
      }
      restoreEditableSelection()
    })
  }

  const aiPanelPopupInteractionRuntime = createAiPanelPopupInteractionRuntime({
    state: popupInteractionState,
    saveSelection: (target) => {
      if (target === 'edit') {
        saveEditSelection()
        return
      }
      saveEditableSelection()
    },
    focusInputForTarget,
    focusContextSearchInput: () => contextSearchInputRef.value?.focus(),
    focusCommandSearchInput: () => commandSearchInputRef.value?.focus(),
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    refreshAiCommandCatalog: () => workspace.refreshAiCommandCatalog(),
    afterDomUpdate: () => nextTick(),
    defer: (callback) => window.setTimeout(callback, 0),
    closeModeMenu: () => aiPanelModelRuntime.closeModeMenu(),
    closeModelMenu: () => aiPanelModelRuntime.closeModelMenu(),
    closeCodexTargetPicker,
    closeMoreActionsMenu: () => {
      moreActionsMenuOpen.value = false
    },
    closePanelModeMenu: () => {
      panelModeMenuOpen.value = false
    },
    closeHistoryMenu,
    openChatSearch,
    closeChatSearch
  })

  const closeCommandPopup = (options: { restoreFocus?: boolean } = {}) => aiPanelPopupInteractionRuntime.closeCommandPopup(options)
  const openContextCategory = (category: AiContextKind) => aiPanelPopupInteractionRuntime.openContextCategory(category)

  const isContextSelected = (context: AiContextOption) => workspace.selectedContexts.some((item) => item.id === context.id)

  const buildSelectedHostContextsFromVisible = (currentHosts: AiContextOption[]) =>
    selectedAiPanelVisibleHostContexts(currentHosts, visibleHostContextOptions.value, maxHostContexts)

  const selectAllVisibleHostContexts = () => {
    const nextHosts = buildSelectedHostContextsFromVisible(hostContextsForPopup.value)
    if (contextTarget.value === 'edit') {
      editHostContexts.value = nextHosts
      return
    }
    workspace.selectedContexts = [...workspace.selectedContexts.filter((context) => context.kind !== 'hosts'), ...nextHosts]
    renderEditableFromState()
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const clearHostContexts = () => {
    if (contextTarget.value === 'edit') {
      editHostContexts.value = []
      return
    }
    workspace.selectedContexts = clearAiPanelHostContexts(workspace.selectedContexts)
    renderEditableFromState()
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const isEditHostContextSelected = (context: AiContextOption) =>
    context.kind === 'hosts' && editHostContexts.value.some((item) => item.id === context.id)

  const isContextSelectedForPopup = (context: AiContextOption) =>
    contextTarget.value === 'edit' ? isEditHostContextSelected(context) : isContextSelected(context)

  const applyHostContextToEdit = (context: AiContextOption) => {
    removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, '@', handleEditEditableInput)
    const plan = planAiPanelContextApply({
      target: 'edit',
      context,
      mainContexts: workspace.selectedContexts,
      editHostContexts: editHostContexts.value,
      maxHostContexts
    })
    if (plan.kind === 'edit-host') editHostContexts.value = plan.nextHosts
    closeContextPopup({ restoreFocus: true })
  }

  const applyContext = (context: AiContextOption) => {
    const plan = planAiPanelContextApply({
      target: contextTarget.value,
      context,
      mainContexts: workspace.selectedContexts,
      editHostContexts: editHostContexts.value,
      maxHostContexts
    })
    if (plan.kind === 'enter-docs-dir') {
      enterDocsDir(context)
      return
    }

    if (plan.kind === 'edit-host') {
      removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, '@', handleEditEditableInput)
      editHostContexts.value = plan.nextHosts
      closeContextPopup({ restoreFocus: true })
      return
    }
    if (plan.kind === 'edit-insert') {
      insertContextAtEditCursor(plan.context)
      closeContextPopup({ restoreFocus: true })
      return
    }

    if (plan.kind === 'main-host') {
      removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
      workspace.selectedContexts = plan.nextContexts
      renderEditableFromState()
    } else if (plan.kind === 'main-insert') {
      removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
      workspace.selectedContexts = plan.nextContexts
      closeContextPopup({ restoreFocus: true })
      renderEditableFromState()
    }
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const applyCommand = (preset: AiCommandOption) => {
    const editCommandTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
    const plan = planAiPanelCommandApply({
      target: commandTarget.value,
      editingMessageId: editingMessageId.value,
      hasEditTarget: Boolean(editCommandTarget),
      command: preset,
      draft: draft.value
    })
    if (plan.kind === 'edit-command') {
      restoreEditSelection()
      insertChipIntoEditableCursor(
        editCommandTarget,
        {
          type: 'chip',
          chipType: 'command',
          ref: {
            command: plan.command.command,
            label: plan.command.label,
            path: plan.command.path
          }
        },
        handleEditEditableInput
      )
      closeCommandPopup({ restoreFocus: true })
      return
    }

    workspace.selectCommandPreset(plan.id, plan.commandRef)
    closeCommandPopup()
    setDraft(plan.nextDraft)
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const popupEditableKeydownInput = () => ({
    displayedOpenedHosts: displayedOpenedHosts.value,
    visibleContextCategories: visibleContextCategories.value,
    filteredContextOptions: filteredContextOptions.value,
    filteredCommands: filteredCommands.value,
    applyContext,
    applyCommand,
    handleSend,
    confirmMessageEdit,
    cancelMessageEdit,
    shouldTriggerCommandPopupForPendingSlash: (target: 'main' | 'edit') =>
      target === 'edit'
        ? shouldTriggerCommandPopupForPendingSlash(editEditableRef.value, editSavedRange.value)
        : shouldTriggerCommandPopupForPendingSlash(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupForSlash: (target: 'main' | 'edit') =>
      target === 'edit'
        ? shouldTriggerCommandPopupForSlash(editEditableRef.value, editSavedRange.value)
        : shouldTriggerCommandPopupForSlash(editableRef.value, savedRange.value),
    getCharBeforeCaret: (target: 'main' | 'edit') =>
      target === 'edit' ? getCharBeforeCaret(editEditableRef.value, editSavedRange.value) : getCharBeforeCaret(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupFromEditableText
  })

  const handleEditableKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handleMainEditableKeydown(event, popupEditableKeydownInput())
  }

  const handleContextKeydown = (event: KeyboardEvent) => aiPanelPopupInteractionRuntime.handleContextKeydown(event, popupEditableKeydownInput())

  const handlePanelKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handlePanelKeydown(event, {
      aiPanelMode: aiPanelMode.value,
      chatSearchOpen: chatSearchOpen.value
    })
  }

  const handleCommandKeydown = (event: KeyboardEvent) => aiPanelPopupInteractionRuntime.handleCommandKeydown(event, popupEditableKeydownInput())

  const openContextPopup = (level: 'main' | AiContextKind = 'main') => {
    openContextPopupForTarget('main', level)
  }

  watch(contextQuery, () => {
    aiPanelPopupInteractionRuntime.handleContextQueryChanged()
  })

  watch(chatSearchTerm, () => {
    aiPanelChatSearchRuntime.handleSearchTermChanged()
  })

  watch([historySearchTerm, historyFavoritesOnly], () => {
    aiPanelHistoryRuntime.resetHistoryFilters()
  })

  watch(
    [() => workspace.selectedConversationId, () => workspace.conversations.map((conversation) => conversation.id).join('|')],
    ([selectedConversationId]) => {
      pruneConversationTabs()
      ensureConversationTab(selectedConversationId)
    },
    { immediate: true }
  )

  watch(
    () =>
      workspace.chatMessages
        .map((message) =>
          [
            message.id,
            message.text,
            message.state || '',
            message.ask || '',
            message.say || '',
            message.action || '',
            message.executedCommand || '',
            message.commandExecutionStatus || '',
            message.commandExecutionMessage || '',
            message.contentParts?.length || 0
          ].join(':')
        )
        .join('|'),
    async () => {
      await aiPanelChatSearchRuntime.syncSearchForMessages()
    },
    { immediate: true }
  )

  watch(
    () => {
      const conversation = activeCodexConversation.value
      const target = conversation ? currentBoundCodexTarget(conversation) || conversation.boundTarget : null
      return target ? `${conversation?.id || ''}:${codexTargetSignature(target)}` : ''
    },
    () => {
      if (aiPanelMode.value !== 'codex') return
      void syncCodexTargetContext()
    }
  )

  watch(
    terminalSettingsSignature,
    () => {
      codexConversations.value.forEach((conversation) => applyCodexTerminalSettings(conversation))
    }
  )

  watch(
    () => workspace.aiAttentionFocusRequest.sequence,
    () => {
      const item = workspace.aiAttentionFocusRequest.item
      if (!item) return
      void focusAiAttentionItem(item)
    }
  )

  watch(
    () => workspace.onboardingAiRequest.sequence,
    async (sequence) => {
      const onboardingRequest = workspace.onboardingAiRequest
      if (sequence === 0 && onboardingRequest.action === 'none') return
      if (onboardingRequest.action === 'open-mode') {
        aiPanelModelRuntime.openModeOnboarding()
        return
      }
      if (onboardingRequest.action === 'open-model') {
        await aiPanelModelRuntime.openModelOnboarding()
        return
      }
      if (onboardingRequest.action === 'open-context-main') {
        openContextPopup('main')
        return
      }
      if (onboardingRequest.action === 'open-context-hosts') {
        openContextPopup('hosts')
        return
      }
      if (onboardingRequest.action === 'prepare-send') {
        aiPanelModelRuntime.prepareSendOnboarding()
        closePopups()
        if (!draft.value.trim()) {
          setDraft('查看本地主机状态')
        }
        return
      }
      closePopups()
    },
    { immediate: true }
  )

  watch(
    [
      () => workspace.selectedContexts.map((context) => `${context.id}:${context.label}:${context.data || ''}`).join('|'),
      () => workspace.selectedCommandId,
      () => `${workspace.selectedCommandRef?.command || ''}:${workspace.selectedCommandRef?.label || ''}:${workspace.selectedCommandRef?.path || ''}`,
      () => fileInputParts.value.map((part) => `${part.ref.absPath}:${part.ref.name || ''}`).join('|')
    ],
    () => {
      if (syncingFromEditable.value) return
      void nextTick(renderEditableFromState)
    },
    { immediate: true }
  )

  onMounted(() => {
    if (aiPanelMode.value === 'classic') void loadClassicChatData()
    if (aiPanelMode.value === 'codex') void startCodexSession()
  })

  onBeforeUnmount(() => {
    codexConversations.value.forEach((conversation) => {
      workspace.removeAiAttentionItem(codexAttentionId(conversation))
      void stopCodexSession(conversation)
      aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    })
    disposeCodexSubscriptions()
    if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
    aiPanelChatSearchRuntime.dispose()
    aiPanelHistoryRuntime.clearNoticeTimer()
    if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
    aiPanelVoiceRuntime.dispose()
  })

  return {
    activeCodexBoundTarget,
    activeCodexConversation,
    activeCodexConversationId,
    activeCommandAuditMessage,
    agentMode,
    aiChatModeOptions,
    aiPanelComposerRuntime,
    aiPanelMode,
    allVisibleHostContextsSelected,
    applyCommand,
    applyContext,
    approveMcpResourceAccess,
    approveMcpToolCall,
    bindCodexTarget,
    bindHostContextToCodex,
    BookOpen,
    Bot,
    Brain,
    cancelHistoryTitleEdit,
    cancelMessageEdit,
    canEditActiveCommandAudit,
    chatExportNotice,
    chatMode,
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    Check,
    CheckCircle,
    CheckSquare,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleHelp,
    clearChatSearch,
    clearHistorySearch,
    clearHostContexts,
    closeChatSearch,
    closeCodexConversation,
    closeCodexTargetPicker,
    closeCommandAuditDialog,
    closeConversationTab,
    closeHistoryMenu,
    closePopups,
    Code2,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    commandAuditDialog,
    commandAuditTextareaRef,
    commandHostForMessage,
    commandHostTooltipForMessage,
    commandKeyboardIndex,
    commandLineCountForMessage,
    commandLineCountForText,
    commandOutputLineCount,
    commandPopupOpen,
    commandQuery,
    commandSearchInputRef,
    commandTarget,
    commandTextForMessage,
    composerIsEmpty,
    confirmMessageEdit,
    contextKeyboardIndex,
    contextLevel,
    contextPopupOpen,
    contextQuery,
    contextSearchInputRef,
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    conversationTabTooltip,
    Copy,
    copyCodexSelectionFromContextMenu,
    copyCommandAuditDraft,
    copyCommandToClipboard,
    copyMessageToClipboard,
    copyRenderedTextToClipboard,
    createNewAiConversation,
    createNewCodexConversation,
    currentAiPanelModeLabel,
    currentChatMode,
    currentPanelTarget,
    deleteHistoryConversation,
    displayConversationTitle,
    displayedOpenedHosts,
    displayModelName,
    Download,
    dropActive,
    editableRef,
    editDraft,
    editFileInputParts,
    editHistoryTitle,
    editHostContexts,
    editImageInputParts,
    editingHistoryId,
    editingHistoryTitle,
    editingMessageId,
    Ellipsis,
    exportCurrentChat,
    FileText,
    filteredCodexHostTargets,
    filteredCommands,
    filteredContextOptions,
    filteredLockedModelOptions,
    filteredModelOptions,
    findNextChatMatch,
    findPreviousChatMatch,
    Focus,
    focusCodexTerminal,
    FolderGit2,
    formatHistoryTime,
    formatLineCount,
    formatMcpToolArguments,
    getChipLabel,
    groupedVisibleHistory,
    handleCommandKeydown,
    handleContextKeydown,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleEditableKeydown,
    handleEditEditableClick,
    handleEditEditableInput,
    handleEditEditableKeydown,
    handleEditEditablePaste,
    handleFileUpload,
    handleModelKeydown,
    handlePanelKeydown,
    handleSend,
    hasMoreHistoryConversations,
    History,
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    hostContextsForPopup,
    iconMarkupByChipType,
    Image,
    inputPlaceholderNotice,
    isCommandSuggestionMessage,
    isCommandTerminalActionDisabled,
    isContextSelectedForPopup,
    isReadOnlyCommandMessage,
    isThinkingModelName,
    Link2,
    LoaderCircle,
    loadMoreHistoryConversations,
    locateCodexBoundTarget,
    lockedModelTooltip,
    LockKeyhole,
    Maximize2,
    Mic,
    MinusSquare,
    modelDropdownWidthPx,
    modelMenuOpen,
    modelQuery,
    modelSearchInputRef,
    modeDropdownWidthPx,
    modeMenuOpen,
    Monitor,
    moreActionsMenuOpen,
    normalizedCommandOutputText,
    openChatSearch,
    openCommandAuditDialog,
    openContextCategory,
    openEditContextPopup,
    openImagePicker,
    openModelLogin,
    openModelSettings,
    panelModeMenuOpen,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    rejectMcpResourceAccess,
    rejectMcpToolCall,
    rejectMessageCommand,
    removeEditHostContext,
    renderedMarkdownParts,
    restartCodexSession,
    restoreConversationFromTab,
    restoreHistoryConversation,
    retryAssistantMessage,
    returnContextPopupToMain,
    runCommandAuditDraft,
    runMessageCommand,
    saveCommandAuditDraft,
    saveEditableSelection,
    saveHistoryTitle,
    Search,
    selectAiPanelMode,
    selectAllVisibleHostContexts,
    selectChatMode,
    selectCodexConversation,
    selectedCommandRef,
    selectedModelLabel,
    selectModel,
    Send,
    Server,
    setCodexTerminalHostRef,
    setEditEditableRef,
    setMessageFeedback,
    showNoAvailableModelPrompt,
    Sparkles,
    Square,
    Star,
    streaming,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    t,
    ThumbsDown,
    ThumbsUp,
    toggleAiPanelModeMenu,
    toggleCodexTargetPicker,
    toggleContextPopup,
    toggleHistoryFavorite,
    toggleHistoryMenu,
    toggleMessageFavorite,
    toggleModelMenu,
    toggleModeMenu,
    toggleMoreActionsMenu,
    toggleVoiceInput,
    Trash2,
    unbindCodexTarget,
    Upload,
    visibleContextCategories,
    visibleConversationTabs,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing,
    workspace,
    X,
    Zap,
  }
}
