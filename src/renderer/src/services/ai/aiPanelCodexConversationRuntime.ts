import { computed, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
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
import { productSessionClient } from '@/services/ai/productSessionClient'
import type { I18nKey } from '@/i18n'
import type { AiAttentionInput, AiAttentionItem, TerminalPanel } from '@/stores/workspace'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalSurfaceMode } from '@/services/terminal/terminalThemeRuntime'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import type { ProductSessionRecord, ProductSessionTarget } from '@shared/contracts/productSessions'
import { isProjectCwdWithinRoot } from '@shared/productSessionPathRuntime'

export type AiPanelCodexConversation = AiPanelCodexConversationRuntimeState & AiPanelCodexTerminalConversation

type AiPanelCodexConversationRuntimeInput = {
  agentMode: () => boolean
  activePanelId: () => string
  activePanel: () => TerminalPanel | undefined | null
  panels: () => TerminalPanel[]
  terminalSettings: () => TerminalSettings
  themeId?: () => string
  terminalSurfaceMode?: () => TerminalSurfaceMode
  aiContextCatalog: () => AiContextCatalog
  loadClassicChatData: () => Promise<void>
  closePopups: () => void
  showNotice: (message: string) => void
  setTopNotice: (message: string) => void
  refreshAiContextCatalog: () => Promise<unknown>
  openTerminalForAiHostContext: (host: AiContextOption, options?: { cwd?: string }) => Promise<TerminalPanel | null | undefined>
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
  const codexSessionStateSaveFailed = () => t('ai.codexSessionStateSaveFailed')
  const codexSessionStateLoadFailed = () => t('ai.codexSessionStateLoadFailed')
  const codexRuntimeStopFailed = () => t('ai.codexRuntimeStopFailed')
  const codexSessionRotated = () => t('ai.codexSessionRotated')
  const codexUnboundSessionCreated = () => t('ai.codexUnboundSessionCreated')
  const aiPanelMode = ref<AiPanelMode>(readStoredAiPanelMode())
  const aiPanelWorkspaceLinkMode = ref<AiPanelWorkspaceLinkMode>(readStoredAiPanelWorkspaceLinkMode())
  const panelModeMenuOpen = ref(false)
  const codexTargetPickerOpen = ref(false)
  const codexTargetQuery = ref('')
  const codexConversations = ref<AiPanelCodexConversation[]>([])
  const codexSessionHistory = ref<ProductSessionRecord[]>([])
  const codexHistoryMenuOpen = ref(false)
  const activeCodexConversationId = ref('')
  const codexWorkspaceLinkNotice = ref('')
  let workspaceLinkSyncSource: 'workspace' | 'ai' | null = null
  let codexConversationSequence = 0
  let codexProductSessionsHydrated = false
  let codexProductSessionsHydrating: Promise<boolean> | null = null
  const codexConversationTransitions = new Set<string>()

  const activeCodexConversation = computed(() => codexConversations.value.find((conversation) => conversation.id === activeCodexConversationId.value) || null)
  const activeCodexBoundTarget = computed(() => activeCodexConversation.value?.boundTarget || null)
  const currentAiPanelModeLabel = computed(() => (aiPanelMode.value === 'codex' ? t('ai.codexCliMode') : t('ai.classicChatMode')))
  const terminalSettingsSignature = () =>
    `${options.themeId?.() || 'dark'}|${options.terminalSurfaceMode?.() || 'base'}|${codexTerminalSettingsSignature(options.terminalSettings())}`

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

  const createCodexConversationRecord = (
    target?: CodexSessionTargetContext | null,
    product?: Pick<ProductSessionRecord, 'id' | 'title' | 'projectRoot' | 'nativeBinding'>
  ): AiPanelCodexConversation => {
    const conversation = reactive(createCodexConversationRuntimeRecord<AiPanelCodexConversation>(product?.id || nextCodexConversationId(), target, {
      host: null,
      terminal: null,
      threadedTerminal: false,
      fit: null,
      resizeObserver: null,
      ...(product?.projectRoot ? { projectRoot: product.projectRoot } : {}),
      ...(product?.nativeBinding?.engine === 'codex'
        ? { nativeThreadId: product.nativeBinding.nativeSessionId, launchMode: 'resume' as const }
        : {})
    })) as AiPanelCodexConversation
    conversation.title = product?.title || t('ai.codexCliMode')
    return conversation
  }

  const productTargetFromCodexTarget = (target: CodexSessionTargetContext): ProductSessionTarget => {
    return {
      kind: target.kind || 'unknown',
      ...(target.panelId ? { panelId: target.panelId } : {}),
      ...(target.sessionId ? { terminalSessionId: target.sessionId } : {}),
      ...(target.assetId ? { assetId: target.assetId } : {}),
      ...(target.connectionId ? { connectionId: target.connectionId } : {}),
      ...(target.label ? { label: target.label } : {}),
      ...(target.host ? { host: target.host } : {}),
      ...(target.port ? { port: target.port } : {}),
      ...(target.username ? { username: target.username } : {}),
      ...(target.assetName ? { assetName: target.assetName } : {})
    }
  }

  const storedCodexTargetForProductSession = (session: ProductSessionRecord): CodexSessionTargetContext | null => {
    const stored = session.target
    if (!stored) return null
    return {
      kind: stored.kind,
      panelId: stored.panelId,
      sessionId: stored.terminalSessionId,
      label: stored.label,
      host: stored.host,
      port: stored.port,
      username: stored.username,
      assetId: stored.assetId,
      connectionId: stored.connectionId,
      assetName: stored.assetName,
      cwd: session.lastKnownCwd || session.projectRoot
    }
  }

  const productTargetMatchesLiveTarget = (stored: ProductSessionTarget, target: CodexSessionTargetContext) => {
    if (stored.kind !== target.kind) return false
    if (stored.kind === 'local') {
      if (stored.panelId && target.panelId === stored.panelId) return true
      return Boolean(stored.terminalSessionId && target.sessionId === stored.terminalSessionId)
    }
    const stableFields = [
      ['assetId', stored.assetId, target.assetId],
      ['connectionId', stored.connectionId, target.connectionId],
      ['host', stored.host, target.host],
      ['port', stored.port, target.port],
      ['username', stored.username, target.username]
    ] as const
    const definedStableFields = stableFields.filter(([, expected]) => expected !== undefined && expected !== '')
    if (definedStableFields.length) return definedStableFields.every(([, expected, actual]) => expected === actual)
    if (stored.panelId && target.panelId === stored.panelId) return true
    return Boolean(stored.terminalSessionId && target.sessionId === stored.terminalSessionId)
  }

  const liveCodexTargetForProductSession = (session: ProductSessionRecord): CodexSessionTargetContext | null => {
    const stored = session.target
    if (!stored || !session.projectRoot) return null
    const eligiblePanels = options.panels().filter((candidate) => {
      if (
        !candidate.sessionId ||
        candidate.status === 'closed' ||
        candidate.status === 'error' ||
        !isTerminalWorkspacePanel(candidate)
      ) return false
      const target = codexTargetContextFromPanel(candidate)
      return Boolean(target.cwd && isProjectCwdWithinRoot(session.projectRoot!, target.cwd))
    })
    const exactPanel = eligiblePanels.find((candidate) =>
      productTargetMatchesLiveTarget(stored, codexTargetContextFromPanel(candidate))
    )
    if (exactPanel) return codexTargetContextFromPanel(exactPanel)
    if (stored.kind === 'local') {
      const localPanels = eligiblePanels.filter((candidate) => codexTargetContextFromPanel(candidate).kind === 'local')
      if (localPanels.length === 1) return codexTargetContextFromPanel(localPanels[0])
    }
    return null
  }

  const reconnectCodexTargetForProductSession = async (session: ProductSessionRecord) => {
    const live = liveCodexTargetForProductSession(session)
    if (live) return live
    const stored = session.target
    if (!stored) return null
    const id = stored.assetId || stored.connectionId || (stored.kind === 'local' ? 'opened-local' : '')
    if (!id) return null
    const desiredCwd = session.lastKnownCwd || session.projectRoot
    const panel = await options.openTerminalForAiHostContext({
      id,
      kind: 'hosts',
      label: stored.label || stored.assetName || stored.host || (stored.kind === 'local' ? 'Local shell' : id),
      detail: stored.label,
      host: stored.host,
      port: stored.port,
      username: stored.username,
      assetName: stored.assetName,
      isLocalShell: stored.kind === 'local'
    }, desiredCwd ? { cwd: desiredCwd } : undefined)
    if (!panel?.sessionId || panel.status === 'closed' || panel.status === 'error') return null
    const target = codexTargetContextFromPanel(panel)
    if (stored.kind !== 'local' && !productTargetMatchesLiveTarget(stored, target)) return null
    if (session.projectRoot && (!target.cwd || !isProjectCwdWithinRoot(session.projectRoot, target.cwd))) return null
    return target
  }

  const rememberCodexProductSession = (session: ProductSessionRecord) => {
    codexSessionHistory.value = [
      session,
      ...codexSessionHistory.value.filter((candidate) => candidate.id !== session.id)
    ].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  }

  const persistCodexProductSession = async (conversation: AiPanelCodexConversation) => {
    const getSession = productSessionClient.get()
    const createSession = productSessionClient.create()
    const updateSession = productSessionClient.update()
    if (!getSession || !createSession || !updateSession) return false
    const target = conversation.boundTarget
    const projectRoot = conversation.projectRoot || target?.cwd
    try {
      const result = await getSession(conversation.id)
      const existing = result?.ok ? result.data?.session : null
      const context = {
        isOpen: true,
        ...(projectRoot ? { projectRoot } : {}),
        ...(target?.cwd ? { lastKnownCwd: target.cwd } : {})
      }
      if (existing) {
        const updated = await updateSession({
          id: conversation.id,
          ...context,
          target: target ? productTargetFromCodexTarget(target) : null
        })
        if (!updated?.ok || !updated.data?.session) {
          log('warn', 'renderer.product-session.codex-persist-failed', {
            productSessionId: conversation.id,
            message: updated?.errorMessage || 'Product session update failed.'
          })
          return false
        }
        rememberCodexProductSession(updated.data.session)
      } else {
        const created = await createSession({
          id: conversation.id,
          surface: 'codex',
          title: codexConversationTitle(conversation),
          ...context,
          ...(target ? { target: productTargetFromCodexTarget(target) } : {})
        })
        if (!created?.ok || !created.data?.session) {
          log('warn', 'renderer.product-session.codex-persist-failed', {
            productSessionId: conversation.id,
            message: created?.errorMessage || 'Product session create failed.'
          })
          return false
        }
        rememberCodexProductSession(created.data.session)
      }
      return true
    } catch (error) {
      log('warn', 'renderer.product-session.codex-persist-failed', {
        productSessionId: conversation.id,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const hydrateCodexProductSessions = async () => {
    if (codexProductSessionsHydrated) return true
    if (codexProductSessionsHydrating) return codexProductSessionsHydrating
    codexProductSessionsHydrating = (async () => {
      const listSessions = productSessionClient.list()
      if (!listSessions) {
        options.setTopNotice(codexSessionStateLoadFailed())
        log('warn', 'renderer.product-session.codex-hydrate-failed', { errorCode: 'PRODUCT_SESSION_BRIDGE_MISSING' })
        return false
      }
      try {
        const result = await listSessions({ surface: 'codex', limit: 40 })
        if (!result?.ok || !Array.isArray(result.data?.sessions)) {
          options.setTopNotice(result?.errorMessage || codexSessionStateLoadFailed())
          log('warn', 'renderer.product-session.codex-hydrate-failed', {
            errorCode: result?.errorCode || 'PRODUCT_SESSION_LIST_RESULT_INVALID'
          })
          return false
        }
        codexSessionHistory.value = [...result.data.sessions]
        // Main clears every open flag before creating the renderer on a cold start.
        const openSessions = result.data.sessions.filter((session) => session.isOpen)
        codexConversations.value = openSessions.map((session) => {
          const target = liveCodexTargetForProductSession(session) || storedCodexTargetForProductSession(session)
          return createCodexConversationRecord(target, session)
        })
        activeCodexConversationId.value = codexConversations.value[0]?.id || ''
        codexProductSessionsHydrated = true
        return true
      } catch (error) {
        options.setTopNotice(codexSessionStateLoadFailed())
        log('warn', 'renderer.product-session.codex-hydrate-failed', {
          message: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    })().finally(() => {
      codexProductSessionsHydrating = null
    })
    return codexProductSessionsHydrating
  }

  const ensureActiveCodexConversation = (target?: CodexSessionTargetContext | null) => {
    let conversation = activeCodexConversation.value
    if (conversation) return conversation
    conversation = createCodexConversationRecord(target || null)
    codexConversations.value = [...codexConversations.value, conversation]
    activeCodexConversationId.value = conversation.id
    return conversation
  }

  const codexConversationHasNativeRuntime = (conversation: AiPanelCodexConversation) =>
    Boolean(conversation.nativeThreadId || conversation.sessionId)

  const codexStableTargetChanged = (
    conversation: AiPanelCodexConversation,
    target: CodexSessionTargetContext
  ) => {
    const previous = conversation.boundTarget
    if (!previous) return false
    const targetChanged = previous.kind !== target.kind ||
      (previous.assetId || '') !== (target.assetId || '') ||
      (previous.connectionId || '') !== (target.connectionId || '') ||
      (previous.host || '') !== (target.host || '') ||
      (previous.port || 0) !== (target.port || 0) ||
      (previous.username || '') !== (target.username || '')
    const root = conversation.projectRoot || previous.cwd || ''
    const nextCwd = target.cwd || ''
    const projectChanged = Boolean(root && nextCwd && !isProjectCwdWithinRoot(root, nextCwd))
    return targetChanged || projectChanged
  }

  const candidateBoundCodexTarget = (conversation = activeCodexConversation.value) =>
    currentBoundCodexRuntimeTarget(conversation, options.panels())

  const currentBoundCodexTarget = (conversation = activeCodexConversation.value) => {
    const candidate = candidateBoundCodexTarget(conversation)
    if (!conversation || !candidate) return null
    if (!codexConversationHasNativeRuntime(conversation)) return candidate
    if (codexStableTargetChanged(conversation, candidate)) return null
    if (!conversation.projectRoot || !candidate.cwd || !isProjectCwdWithinRoot(conversation.projectRoot, candidate.cwd)) return null
    return candidate
  }

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
    if (!panel?.sessionId || !isTerminalWorkspacePanel(panel)) return false
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
    terminalSurfaceMode: options.terminalSurfaceMode,
    currentBoundTarget: (conversation) => currentBoundCodexTarget(conversation),
    isConversationVisible: (conversation) => aiPanelMode.value === 'codex' && activeCodexConversationId.value === conversation.id,
    syncAttentionState: syncCodexAttentionState,
    labels: {
      error: () => t('ai.codexError'),
      bridgeMissing: () => t('ai.codexBridgeMissing'),
      startFailed: () => t('ai.codexStartFailed'),
      exitNonZero: () => t('ai.codexExitNonZero'),
      unsavedSessionRecovered: () => t('ai.codexUnsavedSessionRecovered'),
      threadedUnavailable: () => t('ai.codexThreadedUnavailable'),
      copyEmpty: () => '请先选择 Codex 终端内容',
      copySuccess: () => 'Codex 终端内容已复制',
      copyFailure: () => 'Codex 终端复制失败'
    },
    notify: options.setTopNotice,
    afterDomUpdate: options.afterDomUpdate,
    log
  })

  const removeDeletedCodexProductSession = async (id: string) => {
    codexSessionHistory.value = codexSessionHistory.value.filter((session) => session.id !== id)
    const closeResult = closeCodexConversationRecord(codexConversations.value, activeCodexConversationId.value, id)
    if (closeResult.status === 'missing') return
    options.removeAiAttentionItem(codexAttentionId(closeResult.conversation))
    aiPanelCodexTerminalRuntime.disposeConversation(closeResult.conversation)
    codexConversations.value = closeResult.nextConversations
    activeCodexConversationId.value = closeResult.nextActiveId
    if (closeResult.status !== 'closed-active' || !closeResult.nextConversation) return
    await options.afterDomUpdate()
    aiPanelCodexTerminalRuntime.ensureTerminal(closeResult.nextConversation)
    aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    await aiPanelCodexTerminalRuntime.syncActiveBridgeTarget()
    aiPanelCodexTerminalRuntime.fitTerminal({ force: true, conversation: closeResult.nextConversation })
    aiPanelCodexTerminalRuntime.syncConversationOutput(closeResult.nextConversation)
  }

  const onProductSessionChanged = productSessionClient.onChanged()
  const stopProductSessionChanged = onProductSessionChanged?.((event) => {
    if (event.type === 'deleted') {
      void removeDeletedCodexProductSession(event.id)
      return
    }
    if (event.session.surface === 'codex') rememberCodexProductSession(event.session)
  })

  const reportCodexTransitionFailure = (
    conversation: AiPanelCodexConversation,
    event: string,
    message: string,
    fields: Record<string, unknown> = {}
  ) => {
    conversation.status = 'error'
    conversation.error = message
    syncCodexAttentionState(conversation)
    options.setTopNotice(message)
    log('warn', event, {
      productSessionId: conversation.id,
      sessionId: conversation.sessionId || undefined,
      ...fields,
      message
    })
  }

  const rememberCodexProductSessionOpenState = async (conversation: AiPanelCodexConversation, isOpen: boolean) => {
    const getSession = productSessionClient.get()
    if (getSession) {
      try {
        const result = await getSession(conversation.id)
        if (result?.ok && result.data?.session) {
          rememberCodexProductSession({ ...result.data.session, isOpen })
          return
        }
      } catch (error) {
        log('warn', 'renderer.product-session.codex-refresh-failed', {
          productSessionId: conversation.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const stored = codexSessionHistory.value.find((session) => session.id === conversation.id)
    if (stored) rememberCodexProductSession({ ...stored, isOpen, updatedAt: Date.now() })
  }

  const closeAndStopCodexConversation = async (conversation: AiPanelCodexConversation, reason: string) => {
    if (codexConversationTransitions.has(conversation.id)) return false
    codexConversationTransitions.add(conversation.id)
    try {
      const closeProductSession = productSessionClient.close()
      if (!closeProductSession) {
        reportCodexTransitionFailure(
          conversation,
          'renderer.product-session.codex-close-failed',
          codexSessionStateSaveFailed(),
          { reason, errorCode: 'PRODUCT_SESSION_BRIDGE_MISSING' }
        )
        return false
      }

      let closeResult: Awaited<ReturnType<typeof closeProductSession>>
      try {
        closeResult = await closeProductSession(conversation.id)
      } catch (error) {
        reportCodexTransitionFailure(
          conversation,
          'renderer.product-session.codex-close-failed',
          error instanceof Error ? error.message : String(error),
          { reason, errorCode: 'PRODUCT_SESSION_CLOSE_FAILED' }
        )
        return false
      }
      if (!closeResult?.ok || closeResult.data?.id !== conversation.id) {
        reportCodexTransitionFailure(
          conversation,
          'renderer.product-session.codex-close-failed',
          closeResult?.errorMessage || codexSessionStateSaveFailed(),
          {
            reason,
            errorCode: closeResult?.errorCode || 'PRODUCT_SESSION_CLOSE_RESULT_INVALID',
            returnedProductSessionId: closeResult?.data?.id
          }
        )
        return false
      }

      const stopResult = await aiPanelCodexTerminalRuntime.stopSession(conversation)
      if (!stopResult.ok) {
        const updateProductSession = productSessionClient.update()
        let rollbackOk = false
        let rollbackError = ''
        if (updateProductSession) {
          try {
            const rollbackResult = await updateProductSession({ id: conversation.id, isOpen: true })
            const rollbackSession = rollbackResult?.data?.session
            rollbackOk = Boolean(
              rollbackResult?.ok &&
              rollbackSession?.id === conversation.id &&
              rollbackSession.isOpen
            )
            rollbackError = rollbackResult?.errorMessage || ''
            if (rollbackOk && rollbackSession) rememberCodexProductSession(rollbackSession)
            else if (!rollbackError) rollbackError = 'Product session rollback returned an invalid result.'
          } catch (error) {
            rollbackError = error instanceof Error ? error.message : String(error)
          }
        } else {
          rollbackError = 'Product session update bridge is unavailable.'
        }
        reportCodexTransitionFailure(
          conversation,
          'renderer.codex-session.close-kill-failed',
          stopResult.errorMessage || codexRuntimeStopFailed(),
          {
            reason,
            errorCode: stopResult.errorCode,
            rollbackOk,
            ...(rollbackError ? { rollbackError } : {})
          }
        )
        return false
      }

      await rememberCodexProductSessionOpenState(conversation, false)
      return true
    } finally {
      codexConversationTransitions.delete(conversation.id)
    }
  }

  const replaceCodexConversation = async (
    conversation: AiPanelCodexConversation,
    target: CodexSessionTargetContext | null,
    reason: string
  ) => {
    if (!(await closeAndStopCodexConversation(conversation, reason))) return null
    const replacement = createCodexConversationRecord(target)
    replacement.projectRoot = target?.cwd
    const index = codexConversations.value.findIndex((candidate) => candidate.id === conversation.id)
    const nextConversations = [...codexConversations.value]
    if (index >= 0) nextConversations.splice(index, 1, replacement)
    else nextConversations.push(replacement)
    options.removeAiAttentionItem(codexAttentionId(conversation))
    aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    codexConversations.value = nextConversations
    activeCodexConversationId.value = replacement.id
    if (!(await persistCodexProductSession(replacement))) {
      reportCodexTransitionFailure(
        replacement,
        'renderer.product-session.codex-persist-failed',
        codexSessionStateSaveFailed()
      )
      await options.afterDomUpdate()
      aiPanelCodexTerminalRuntime.ensureTerminal(replacement)
      aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
      return null
    }
    await options.afterDomUpdate()
    aiPanelCodexTerminalRuntime.ensureTerminal(replacement)
    aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    log('info', 'renderer.product-session.codex-rotated', {
      reason,
      previousProductSessionId: conversation.id,
      productSessionId: replacement.id,
      targetSessionId: target?.sessionId,
      projectRoot: replacement.projectRoot
    })
    return replacement
  }

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
    if (!currentBoundCodexTarget(conversation)) return
    return aiPanelCodexTerminalRuntime.startSession(conversation)
  }

  const bindCodexTarget = async (target: CodexSessionTargetContext | null, bindOptions: { reason?: string; start?: boolean } = {}) => {
    let conversation = ensureActiveCodexConversation(target)
    if (!target?.sessionId || target.kind === 'unknown') {
      conversation.error = t('ai.codexTargetMissing')
      return false
    }
    closeCodexTargetPicker()
    let previous: CodexSessionTargetContext | null = null
    if (codexConversationHasNativeRuntime(conversation) && codexStableTargetChanged(conversation, target)) {
      const replacement = await replaceCodexConversation(conversation, target, bindOptions.reason || 'target-changed')
      if (!replacement) return false
      conversation = replacement
      options.showNotice(codexSessionRotated())
    } else {
      previous = applyCodexTargetBinding(conversation, target, { fallbackLabel: t('ai.codexCliMode') })
      conversation.projectRoot ||= target.cwd
      if (!(await persistCodexProductSession(conversation))) {
        if (previous) applyCodexTargetBinding(conversation, previous, { fallbackLabel: t('ai.codexCliMode') })
        else applyCodexTargetUnbinding(conversation, t('ai.codexCliMode'))
        reportCodexTransitionFailure(
          conversation,
          'renderer.product-session.codex-persist-failed',
          codexSessionStateSaveFailed()
        )
        return false
      }
    }
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
    if (!conversation) return false
    if (codexConversationHasNativeRuntime(conversation)) {
      const replacement = await replaceCodexConversation(conversation, null, 'target-unbound')
      if (!replacement) return false
      closeCodexTargetPicker()
      options.showNotice(codexUnboundSessionCreated())
      return true
    }
    applyCodexTargetUnbinding(conversation, t('ai.codexCliMode'))
    closeCodexTargetPicker()
    await aiPanelCodexTerminalRuntime.clearSessionTarget(conversation, 'unbound')
    await persistCodexProductSession(conversation)
    return true
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
    closeCodexTargetPicker()
    const panel = await options.openTerminalForAiHostContext(host)
    if (!panel?.sessionId) {
      ensureActiveCodexConversation().error = t('ai.codexTargetOpenFailed')
      return false
    }
    return bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'host-picker' })
  }

  const restartCodexSession = async () => {
    const conversation = ensureActiveCodexConversation()
    const stopResult = await aiPanelCodexTerminalRuntime.stopSession(conversation)
    if (!stopResult.ok) {
      reportCodexTransitionFailure(
        conversation,
        'renderer.codex-session.restart-kill-failed',
        stopResult.errorMessage || codexRuntimeStopFailed(),
        { errorCode: stopResult.errorCode }
      )
      return false
    }
    resetCodexConversationForRestart(conversation)
    syncCodexAttentionState(conversation)
    aiPanelCodexTerminalRuntime.clearConversationOutput(conversation)
    await startCodexSession(conversation)
    return true
  }

  const createNewCodexConversation = async () => {
    if (codexProductSessionsHydrating) await codexProductSessionsHydrating
    else if (!codexProductSessionsHydrated && !codexConversations.value.length) await hydrateCodexProductSessions()
    const previousSyncSource = workspaceLinkSyncSource
    workspaceLinkSyncSource = 'ai'
    try {
      const conversation = createCodexConversationRecord(null)
      codexConversations.value = [...codexConversations.value, conversation]
      activeCodexConversationId.value = conversation.id
      closeCodexTargetPicker()
      await options.afterDomUpdate()
      aiPanelCodexTerminalRuntime.ensureTerminal(conversation)
      aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    } finally {
      workspaceLinkSyncSource = previousSyncSource
    }
  }

  const restoreCodexProductSession = async (id: string) => {
    codexHistoryMenuOpen.value = false
    const openConversation = codexConversations.value.find((conversation) => conversation.id === id)
    if (openConversation) {
      await selectCodexConversation(id)
      return true
    }
    let productSession = codexSessionHistory.value.find((session) => session.id === id)
    if (!productSession) {
      const getProductSession = productSessionClient.get()
      if (!getProductSession) return false
      try {
        const result = await getProductSession(id)
        const session = result?.data?.session
        if (!result?.ok || !session || session.id !== id || session.surface !== 'codex') return false
        rememberCodexProductSession(session)
        productSession = session
      } catch {
        return false
      }
    }
    const storedTarget = storedCodexTargetForProductSession(productSession)
    const target = await reconnectCodexTargetForProductSession(productSession)
    const conversation = createCodexConversationRecord(target, productSession)
    if (!target && storedTarget) {
      conversation.boundTarget = storedTarget
      conversation.status = 'error'
      conversation.error = t('ai.codexTargetOpenFailed')
    }
    codexConversations.value = [...codexConversations.value, conversation]
    activeCodexConversationId.value = conversation.id
    const persisted = await persistCodexProductSession(conversation)
    await options.afterDomUpdate()
    aiPanelCodexTerminalRuntime.ensureTerminal(conversation)
    aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    if (!persisted) {
      reportCodexTransitionFailure(
        conversation,
        'renderer.product-session.codex-restore-persist-failed',
        codexSessionStateSaveFailed()
      )
      return false
    }
    activateWorkspacePanelForCodexConversation(conversation)
    if (currentBoundCodexTarget(conversation)) {
      await startCodexSession(conversation)
      if (conversation.status === 'error') options.setTopNotice(conversation.error)
    } else if (conversation.error) {
      options.setTopNotice(conversation.error)
    }
    return true
  }

  const toggleCodexHistoryMenu = () => {
    const open = !codexHistoryMenuOpen.value
    if (open) options.closePopups()
    codexHistoryMenuOpen.value = open
  }

  const closeCodexHistoryMenu = () => {
    codexHistoryMenuOpen.value = false
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
    aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    await aiPanelCodexTerminalRuntime.syncActiveBridgeTarget()
    aiPanelCodexTerminalRuntime.fitTerminal({ force: true, conversation })
    aiPanelCodexTerminalRuntime.syncConversationOutput(conversation)
    aiPanelCodexTerminalRuntime.focusActiveTerminal()
    if (!conversation.sessionId && currentBoundCodexTarget(conversation)) await startCodexSession(conversation)
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
    if (closeResult.status === 'missing') return false
    const conversation = closeResult.conversation
    const persisted = codexSessionHistory.value.some((session) => session.id === conversation.id)
    if ((persisted || codexConversationHasNativeRuntime(conversation)) && !(await closeAndStopCodexConversation(conversation, 'tab-close'))) {
      return false
    }
    options.removeAiAttentionItem(codexAttentionId(conversation))
    aiPanelCodexTerminalRuntime.disposeConversation(conversation)
    codexConversations.value = closeResult.nextConversations
    activeCodexConversationId.value = closeResult.nextActiveId
    if (closeResult.status === 'closed-active' && closeResult.nextConversation) {
      const nextConversation = closeResult.nextConversation
      activeCodexConversationId.value = closeResult.nextActiveId
      await options.afterDomUpdate()
      aiPanelCodexTerminalRuntime.ensureTerminal(nextConversation)
      aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
      await aiPanelCodexTerminalRuntime.syncActiveBridgeTarget()
      aiPanelCodexTerminalRuntime.fitTerminal({ force: true, conversation: nextConversation })
      aiPanelCodexTerminalRuntime.syncConversationOutput(nextConversation)
    }
    options.showNotice(t('ai.tabClosed'))
    return true
  }

  async function selectAiPanelMode(mode: AiPanelMode) {
    if (aiPanelMode.value === mode) {
      if (mode === 'codex') {
        if (!(await hydrateCodexProductSessions())) return false
        if (activeCodexConversation.value) void startCodexSession(activeCodexConversation.value)
      }
      panelModeMenuOpen.value = false
      return true
    }
    aiPanelMode.value = mode
    codexHistoryMenuOpen.value = false
    storeAiPanelMode(mode)
    options.closePopups()
    if (mode === 'classic') {
      aiPanelCodexTerminalRuntime.syncConversationSurfaces()
      await options.loadClassicChatData()
      return true
    }
    if (!(await hydrateCodexProductSessions())) return false
    aiPanelCodexTerminalRuntime.syncConversationSurfaces({ forceActiveGeometry: true })
    if (activeCodexConversation.value) void startCodexSession(activeCodexConversation.value)
    return true
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
    if (!conversation) return ''
    const candidate = candidateBoundCodexTarget(conversation)
    const target = candidate || conversation.boundTarget
    const panel = conversation.boundTarget
      ? options.panels().find((item) => item.id === conversation.boundTarget?.panelId || item.sessionId === conversation.boundTarget?.sessionId)
      : null
    return target
      ? `${conversation.id}:${candidate ? 'live' : 'stale'}:${panel?.status || 'missing'}:${codexTargetSignature(target)}`
      : `${conversation.id}:unbound`
  })

  const syncActiveCodexTargetContext = async () => {
    if (aiPanelMode.value !== 'codex') return
    const conversation = activeCodexConversation.value
    const candidate = candidateBoundCodexTarget(conversation)
    if (conversation && candidate && codexConversationHasNativeRuntime(conversation) && codexStableTargetChanged(conversation, candidate)) {
      const replacement = await replaceCodexConversation(conversation, candidate, 'live-target-changed')
      if (replacement) {
        options.showNotice(codexSessionRotated())
        await startCodexSession(replacement)
      }
      return
    }
    const currentTarget = currentBoundCodexTarget(conversation)
    if (conversation && currentTarget && codexConversationHasNativeRuntime(conversation)) {
      conversation.boundTarget = { ...currentTarget }
      await persistCodexProductSession(conversation)
    }
    await aiPanelCodexTerminalRuntime.syncTargetContext()
  }

  const applyCodexTerminalSettingsToAll = () => {
    codexConversations.value.forEach((conversation) => aiPanelCodexTerminalRuntime.applyTerminalSettings(conversation))
  }

  const startInitialMode = () => {
    if (aiPanelMode.value === 'classic') void options.loadClassicChatData()
    if (aiPanelMode.value === 'codex') {
      void hydrateCodexProductSessions().then((hydrated) => {
        if (hydrated && activeCodexConversation.value) return startCodexSession(activeCodexConversation.value)
      })
    }
  }

  const dispose = () => {
    stopProductSessionChanged?.()
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
    closeCodexHistoryMenu,
    closeCodexTargetPicker,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexHistoryMenuOpen,
    codexSessionHistory,
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
    restoreCodexProductSession,
    selectAiPanelMode,
    selectCodexConversation,
    setCodexTerminalHostRef,
    startInitialMode,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    toggleAiPanelModeMenu,
    toggleAiPanelWorkspaceLinkMode,
    toggleCodexTargetPicker,
    toggleCodexHistoryMenu,
    unbindCodexTarget
  }
}
