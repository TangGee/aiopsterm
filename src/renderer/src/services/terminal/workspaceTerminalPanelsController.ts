import { type Ref } from 'vue'
import type { I18nKey } from '@/i18n/messages'
import { terminalClient } from '@/services/terminal/terminalClient'
import {
  isLocalTerminalSessionInfo,
  isSshTerminalSessionInfo,
  isTerminalExitEvent,
  isTerminalLifecycleEvent
} from '@/services/terminal/terminalBackendGuards'
import { applyKeywordHighlight } from '@/services/settings/keywordHighlightRuntime'
import { getKnowledgeParent, isKnowledgeImagePath } from '@/services/knowledge/knowledgeRuntime'
import {
  applyLocalTerminalSessionToPanel,
  applySshTerminalSessionToPanel,
  applyTerminalExitToPanel,
  applyTerminalLifecycleToPanel,
  appendTerminalInputToPanelInCollection,
  appendTerminalOutputToPanelInCollection,
  attachTerminalPanelToSplit,
  canForkSshTerminalPanel,
  closeTerminalPanelInCollection,
  createEmptyTerminalPanel,
  createForkSshTerminalPanelInCollection,
  createTerminalPanelInCollection,
  defaultTerminalPanelTitle,
  detachTerminalPanelFromSplit,
  discardPendingTerminalPanelInCollection,
  ensureTerminalPanelOutputSegments,
  findTerminalPanelByIdOrSession,
  findTerminalPanelBySessionOrId,
  hasTerminalPanelSplitState,
  isTerminalWorkspacePanel,
  renameTerminalPanelInCollection,
  registerTerminalSshSession,
  replaceTerminalOutputInPanelCollection,
  resetTerminalPanelCollectionToDefault,
  setTerminalPanelAutoTitleInCollection,
  setTerminalPanelProgressInCollection,
  trimTerminalPanelOutputHistory,
  type PanelDirection,
  type TerminalLaunchAsset,
  type TerminalOutputScope,
  type TerminalPanel,
  type TerminalSessionAsset
} from '@/services/terminal/terminalPanelRuntime'
import { isTerminalWorkspaceModule, type ModuleKey } from '@/config/navigation'
import type { ExtensionSettings, KeywordHighlightSettings, TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { TerminalProgress } from '@/services/terminal/terminalOscRuntime'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { TerminalExitEvent, TerminalLifecycleEvent, TerminalSessionInfo } from '@shared/contracts/terminalSessions'
import type { AiAgentSessionSource, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

type WorkspaceTerminalPanelsControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
  managedAiSessions: Ref<ManagedAiSessionRecord[]>
  terminalSettings: Ref<TerminalSettings>
  extensionSettings: Ref<ExtensionSettings>
  keywordHighlightSettings: Ref<KeywordHighlightSettings>
  kbSelectedKeys: Ref<string[]>
}

type WorkspaceTerminalPanelsControllerDeps = {
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey) => string
  createRendererLocalId: (prefix: 'panel') => string
  findKnowledgeNode: (relPath: string) => KnowledgeNode | null
  recordMacroTerminalInput: (panelId: string, data: string) => void
  touchManagedAiTerminalActivity: (panel: Pick<TerminalPanel, 'id' | 'sessionId'>, at?: number) => void
  applyManagedAiTerminalLifecycle: (panel: Pick<TerminalPanel, 'id'> | null, event: TerminalLifecycleEvent) => void
  applyManagedAiTerminalExit: (panel: Pick<TerminalPanel, 'id'> | null, event: TerminalExitEvent) => void
  applyManagedAiTerminalPanelClosed: (closedPanels: Array<Pick<TerminalPanel, 'id' | 'sessionId'>>) => void
}

export const createInitialWorkspaceTerminalPanels = () => [
  createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)
]

export const createWorkspaceTerminalPanelsController = (
  state: WorkspaceTerminalPanelsControllerState,
  deps: WorkspaceTerminalPanelsControllerDeps
) => {
  const {
    mode,
    activeModule,
    activePanelId,
    panels,
    managedAiSessions,
    terminalSettings,
    extensionSettings,
    keywordHighlightSettings,
    kbSelectedKeys
  } = state
  const {
    setTopNotice,
    i18nText,
    createRendererLocalId,
    findKnowledgeNode,
    recordMacroTerminalInput,
    touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit,
    applyManagedAiTerminalPanelClosed
  } = deps

  const createPanel = (split?: PanelDirection) => {
    const panel = createTerminalPanelInCollection(panels.value, {
      id: createRendererLocalId('panel'),
      activePanelId: activePanelId.value,
      split,
      splitOrder: split ? Date.now() + panels.value.length : undefined
    })
    activePanelId.value = panel.id
    return panel
  }

  const activateTerminalPanel = (panelIdOrSessionId: string) => {
    const target = panels.value.find((panel) => panel.id === panelIdOrSessionId || panel.sessionId === panelIdOrSessionId)
    if (!target || !isTerminalWorkspacePanel(target)) return null
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    return target
  }

  const hasSplitState = (panelId: string) => hasTerminalPanelSplitState(panels.value, panelId)

  const unsplitPanel = (panelId = activePanelId.value) => {
    const changed = detachTerminalPanelFromSplit(panels.value, panelId)
    if (!changed) return false
    activePanelId.value = panelId
    return true
  }

  const attachPanelToSplit = (panelId: string, targetPanelId: string, direction: PanelDirection = 'right') => {
    const changed = attachTerminalPanelToSplit(panels.value, panelId, targetPanelId, direction, Date.now() + panels.value.length)
    if (!changed) return false
    activePanelId.value = panelId
    return true
  }

  const closedPanelDescriptors = (items: TerminalPanel[]) =>
    items.map((panel) => ({ id: panel.id, ...(panel.sessionId ? { sessionId: panel.sessionId } : {}) }))

  const removeClosedPanel = (panel: Pick<TerminalPanel, 'id' | 'sessionId'>, terminalStatus: 'none' | 'killed' | 'missing') => {
    const stillOpen = panels.value.some((item) => item.id === panel.id)
    if (stillOpen) activePanelId.value = closeTerminalPanelInCollection(panels.value, panel.id, activePanelId.value)
    if (panel.sessionId && terminalStatus !== 'none') applyManagedAiTerminalPanelClosed([panel])
    return {
      closed: stillOpen,
      panelId: panel.id,
      ...(panel.sessionId ? { terminalSessionId: panel.sessionId } : {}),
      terminalStatus
    }
  }

  const closePanel = (id = activePanelId.value) => {
    const descriptor = closedPanelDescriptors(
      panels.value.filter((panel) => panel.id === id || (panels.value.length === 1 && isTerminalWorkspacePanel(panel)))
    )[0]
    if (!descriptor) return Promise.resolve({ closed: false, panelId: id, terminalStatus: 'none' as const })
    if (!descriptor.sessionId) return Promise.resolve(removeClosedPanel(descriptor, 'none'))

    const killTerminal = terminalClient.killTerminal()
    if (!killTerminal) {
      setTopNotice(i18nText('aiSessions.notice.terminalCloseUnavailable'))
      return Promise.resolve({ closed: false, panelId: descriptor.id, terminalSessionId: descriptor.sessionId, terminalStatus: 'failed' as const })
    }
    const sessionId = descriptor.sessionId
    return killTerminal(sessionId)
      .then((result) => {
        if (result?.ok && result.data?.id === sessionId) return removeClosedPanel(descriptor, 'killed')
        if (!result?.ok && result?.errorCode === 'TERMINAL_SESSION_NOT_FOUND') return removeClosedPanel(descriptor, 'missing')
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.terminalCloseFailed'))
        return { closed: false, panelId: descriptor.id, terminalSessionId: sessionId, terminalStatus: 'failed' as const }
      })
      .catch((error) => {
        setTopNotice(error instanceof Error && error.message.trim() ? error.message : i18nText('aiSessions.notice.terminalCloseFailed'))
        return { closed: false, panelId: descriptor.id, terminalSessionId: sessionId, terminalStatus: 'failed' as const }
      })
  }

  const discardPendingTerminalPanel = (id: string, preferredActiveId?: string) => {
    const result = discardPendingTerminalPanelInCollection(panels.value, id, activePanelId.value, preferredActiveId)
    activePanelId.value = result.activePanelId
    return result.discarded
  }

  const closeOthers = () => {
    const closing = closedPanelDescriptors(panels.value.filter((panel) => panel.id !== activePanelId.value))
    return Promise.all(closing.map((panel) => closePanel(panel.id)))
  }

  const closeAllPanels = () => {
    const closing = closedPanelDescriptors(panels.value)
    if (!closing.length) {
      activePanelId.value = resetTerminalPanelCollectionToDefault(panels.value)
      return Promise.resolve([])
    }
    return Promise.all(closing.map((panel) => closePanel(panel.id)))
  }

  const closePanels = (closeMode: 'current' | 'others' | 'all', id = activePanelId.value) => {
    if (closeMode === 'all') {
      return closeAllPanels()
    }
    if (closeMode === 'others') {
      activePanelId.value = id
      return closeOthers()
    }
    return closePanel(id)
  }

  const renamePanel = (id: string, title: string, source: TerminalPanel['titleSource'] = 'user') => {
    renameTerminalPanelInCollection(panels.value, id, title, source)
  }

  const setPanelAutoTitle = (id: string, title: string, options: { panelOnlyIfMultiple?: boolean } = {}) =>
    setTerminalPanelAutoTitleInCollection(panels.value, id, title, options)

  const setPanelProgress = (id: string, progress: TerminalProgress | null) =>
    setTerminalPanelProgressInCollection(panels.value, id, progress)

  const canForkSshPanel = (panelId: string) => canForkSshTerminalPanel(panels.value.find((item) => item.id === panelId))

  const forkSshPanel = (panelId: string) => {
    const forkPanel = createForkSshTerminalPanelInCollection(panels.value, panelId, createRendererLocalId('panel'))
    if (!forkPanel) return null
    activePanelId.value = forkPanel.id
    return forkPanel
  }

  const registerSshSession = (panelId: string, asset: TerminalLaunchAsset) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel) return null
    return registerTerminalSshSession(panel, asset)
  }

  const applyTerminalLifecycle = (event: TerminalLifecycleEvent) => {
    if (!isTerminalLifecycleEvent(event)) return null
    const panel = findTerminalPanelBySessionOrId(panels.value, event.id)
    if (!panel) {
      applyManagedAiTerminalLifecycle(null, event)
      return null
    }
    const applied = applyTerminalLifecycleToPanel(panel, event)
    if (!applied) return null
    applyManagedAiTerminalLifecycle(panel, event)
    return panel
  }

  const applyTerminalExit = (event: TerminalExitEvent) => {
    if (!isTerminalExitEvent(event)) return null
    const panel = findTerminalPanelBySessionOrId(panels.value, event.id)
    if (!panel) {
      applyManagedAiTerminalExit(null, event)
      return null
    }
    const applied = applyTerminalExitToPanel(panel, event)
    if (!applied) return null
    applyManagedAiTerminalExit(panel, event)
    return panel
  }

  const applySshTerminalSession = (
    panelId: string,
    terminalSession?: TerminalSessionInfo | null,
    asset?: TerminalSessionAsset
  ) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel || !isSshTerminalSessionInfo(terminalSession)) return null
    const session = applySshTerminalSessionToPanel(panel, terminalSession, asset)
    if (terminalSession.lifecycle) applyTerminalLifecycle(terminalSession.lifecycle)
    return session
  }

  const applyLocalTerminalSession = (panelId: string, terminalSession?: TerminalSessionInfo | null) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel || !isLocalTerminalSessionInfo(terminalSession)) return null
    applyLocalTerminalSessionToPanel(panel, terminalSession)
    if (terminalSession.lifecycle) applyTerminalLifecycle(terminalSession.lifecycle)
    return panel
  }

  const openTerminalForAiHostContext = async (host: AiContextOption, options: { cwd?: string } = {}) => {
    const previousActivePanelId = activePanelId.value
    const panel = createPanel()
    const panelId = panel.id
    const label = host.assetName || host.detail || host.label || 'Terminal'
    renamePanel(panelId, label)
    replaceTerminalOutput(panelId, '')
    const discardPendingPanel = () => discardPendingTerminalPanel(panelId, previousActivePanelId)
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      discardPendingPanel()
      setTopNotice('终端启动服务不可用')
      return null
    }
    if (host.isLocalShell || host.id === 'opened-local') {
      try {
        const session = await createTerminal({
          kind: 'local',
          panelId,
          workspaceId: 'workspace',
          title: label,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          cols: 100,
          rows: 30,
          terminalType: terminalSettings.value.terminalType
        })
        const connected = applyLocalTerminalSession(panelId, session)
        if (!connected) {
          discardPendingPanel()
          setTopNotice('本地终端启动失败')
          return null
        }
        renamePanel(panelId, label)
        activeModule.value = 'workspace'
        activePanelId.value = panelId
        return connected
      } catch (error) {
        discardPendingPanel()
        setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
        return null
      }
    }
    const asset = {
      id: host.id,
      name: host.assetName || host.detail || host.label,
      title: host.assetName || host.detail || host.label,
      host: host.host || host.label,
      port: host.port,
      username: host.username
    }
    registerSshSession(panelId, asset)
    try {
      const session = await createTerminal({
        kind: 'ssh',
        assetId: host.id,
        title: label,
        cols: 100,
        rows: 30,
        terminalType: terminalSettings.value.terminalType
      })
      const connected = applySshTerminalSession(panelId, session, asset)
      if (!connected) {
        discardPendingPanel()
        setTopNotice('SSH 终端启动失败')
        return null
      }
      activeModule.value = 'workspace'
      activePanelId.value = panelId
      const connectedPanel = panels.value.find((item) => item.id === panelId) || null
      if (connectedPanel?.sessionId && options.cwd && connectedPanel.cwd !== options.cwd) {
        const writeTerminal = terminalClient.writeTerminal()
        const quotedCwd = `'${options.cwd.replaceAll("'", "'\\''")}'`
        const changed = writeTerminal ? await writeTerminal(connectedPanel.sessionId, `cd -- ${quotedCwd}\r`) : null
        if (changed?.ok) connectedPanel.cwd = options.cwd
      }
      return connectedPanel
    } catch (error) {
      discardPendingPanel()
      setTopNotice(error instanceof Error ? error.message : 'SSH 终端启动失败')
      return null
    }
  }

  const openLocalTerminalPanel = async (options: { title?: string; cwd?: string; preserveActiveModule?: boolean } = {}) => {
    const previousActivePanelId = activePanelId.value
    const panel = createPanel()
    const panelId = panel.id
    const label = options.title?.trim() || 'Local terminal'
    renamePanel(panelId, label)
    replaceTerminalOutput(panelId, '')
    const discardPendingPanel = () => discardPendingTerminalPanel(panelId, previousActivePanelId)
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      discardPendingPanel()
      setTopNotice('终端启动服务不可用')
      return null
    }
    try {
      const session = await createTerminal({
        kind: 'local',
        panelId,
        workspaceId: 'workspace',
        title: label,
        ...(options.cwd?.trim() ? { cwd: options.cwd.trim() } : {}),
        cols: 100,
        rows: 30,
        terminalType: terminalSettings.value.terminalType
      })
      const connected = applyLocalTerminalSession(panelId, session)
      if (!connected) {
        discardPendingPanel()
        setTopNotice('本地终端启动失败')
        return null
      }
      renamePanel(panelId, label, 'auto')
      if (!options.preserveActiveModule) activeModule.value = 'workspace'
      activePanelId.value = panelId
      return connected
    } catch (error) {
      discardPendingPanel()
      setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
      return null
    }
  }

  const knowledgePanelId = (relPath: string) => `kb:${relPath}`
  const managedAiSessionPanelId = (source: AiAgentSessionSource, sessionId: string) => `ai-session:${source}:${encodeURIComponent(sessionId)}`
  let knowledgeJumpTokenSeed = 0

  const revealManagedAiSessionContentPanel = () => {
    mode.value = 'terminal'
    if (!isTerminalWorkspaceModule(activeModule.value)) activeModule.value = 'workspace'
  }

  const createKnowledgeJumpState = (range?: { startLine?: number; endLine?: number }) => {
    if (!range?.startLine) return {}
    knowledgeJumpTokenSeed += 1
    return {
      startLine: range.startLine,
      ...(range.endLine ? { endLine: range.endLine } : {}),
      jumpToken: knowledgeJumpTokenSeed
    }
  }

  const openKnowledgeFile = (relPath: string, range?: { startLine?: number; endLine?: number }) => {
    const node = findKnowledgeNode(relPath)
    if (!node || node.type !== 'file') return null
    const existing = panels.value.find((panel) => panel.kind === 'knowledge' && panel.knowledge?.relPath === relPath)
    if (existing) {
      existing.knowledge = {
        relPath,
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
      }
      activePanelId.value = existing.id
      kbSelectedKeys.value = [relPath]
      return existing
    }
    const panel: TerminalPanel = {
      id: knowledgePanelId(relPath),
      title: node.title || relPath.split('/').pop() || 'KnowledgeCenter',
      cwd: getKnowledgeParent(relPath) || '@knowledgebase',
      kind: 'knowledge',
      status: 'ready',
      output: '',
      outputSegments: [],
      knowledge: {
        relPath,
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
      }
    }
    panels.value.push(panel)
    activePanelId.value = panel.id
    kbSelectedKeys.value = [relPath]
    return panel
  }

  const openManagedAiSessionContent = (source: AiAgentSessionSource, sessionId: string) => {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) return null
    const existing = panels.value.find(
      (panel) =>
        panel.kind === 'managed-ai-session' &&
        panel.managedAiSession?.source === source &&
        panel.managedAiSession.sessionId === normalizedSessionId
    )
    if (existing) {
      revealManagedAiSessionContentPanel()
      activePanelId.value = existing.id
      return existing
    }
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === normalizedSessionId)
    const title = session?.title?.trim() || `${source} ${normalizedSessionId.slice(0, 8)}`
    const panel: TerminalPanel = {
      id: managedAiSessionPanelId(source, normalizedSessionId),
      title,
      cwd: session?.cwd || session?.canonicalCwd || '@ai-sessions',
      kind: 'managed-ai-session',
      status: 'ready',
      output: '',
      outputSegments: [],
      managedAiSession: {
        source,
        sessionId: normalizedSessionId
      }
    }
    panels.value.push(panel)
    revealManagedAiSessionContentPanel()
    activePanelId.value = panel.id
    return panel
  }

  const syncKnowledgePanelsAfterRename = (oldRelPath: string, newRelPath: string) => {
    panels.value.forEach((panel) => {
      if (panel.kind !== 'knowledge' || !panel.knowledge?.relPath) return
      const relPath = panel.knowledge.relPath
      if (relPath !== oldRelPath && !relPath.startsWith(`${oldRelPath}/`)) return
      const nextRelPath = relPath === oldRelPath ? newRelPath : `${newRelPath}${relPath.slice(oldRelPath.length)}`
      const oldPanelId = panel.id
      panel.id = knowledgePanelId(nextRelPath)
      panel.title = nextRelPath.split('/').pop() || nextRelPath
      panel.cwd = getKnowledgeParent(nextRelPath) || '@knowledgebase'
      panel.knowledge = {
        relPath: nextRelPath,
        isImage: isKnowledgeImagePath(nextRelPath)
      }
      if (activePanelId.value === oldPanelId) {
        activePanelId.value = panel.id
      }
    })
  }

  const closeKnowledgePanelsForRemoved = (relPaths: string[]) => {
    const shouldClose = (panel: TerminalPanel) =>
      panel.kind === 'knowledge' &&
      Boolean(panel.knowledge?.relPath) &&
      relPaths.some((relPath) => panel.knowledge!.relPath === relPath || panel.knowledge!.relPath.startsWith(`${relPath}/`))
    if (!panels.value.some(shouldClose)) return
    panels.value = panels.value.filter((panel) => !shouldClose(panel))
    if (!panels.value.length) {
      closeAllPanels()
      return
    }
    if (!panels.value.some((panel) => panel.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
  }

  const appendTerminalOutput = (id: string, data: string) => {
    const panel = appendTerminalOutputToPanelInCollection(panels.value, id, data)
    if (!panel) return
    trimTerminalPanelOutputHistory(panel, Math.max(200, (terminalSettings.value.scrollBack || 1000) + 200))
    touchManagedAiTerminalActivity(panel)
  }

  const appendTerminalInput = (id: string, data: string) => {
    const panel = appendTerminalInputToPanelInCollection(panels.value, id, data)
    if (!panel) return
    recordMacroTerminalInput(panel.id, data)
  }

  const replaceTerminalOutput = (id: string, data: string, scope: TerminalOutputScope = 'output') => {
    replaceTerminalOutputInPanelCollection(panels.value, id, data, scope)
  }

  const getHighlightedTerminalOutput = (id: string) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, id)
    if (!panel) return ''
    if (!extensionSettings.value.highlightStatus) return panel.output
    const segments = ensureTerminalPanelOutputSegments(panel)
    return segments.map((segment) => applyKeywordHighlight(keywordHighlightSettings.value, segment.text, segment.scope)).join('')
  }

  return {
    createPanel,
    activateTerminalPanel,
    openTerminalForAiHostContext,
    openLocalTerminalPanel,
    hasSplitState,
    unsplitPanel,
    attachPanelToSplit,
    closePanel,
    discardPendingTerminalPanel,
    closeOthers,
    closeAllPanels,
    closePanels,
    renamePanel,
    setPanelAutoTitle,
    setPanelProgress,
    canForkSshPanel,
    forkSshPanel,
    registerSshSession,
    applySshTerminalSession,
    applyLocalTerminalSession,
    openKnowledgeFile,
    openManagedAiSessionContent,
    syncKnowledgePanelsAfterRename,
    closeKnowledgePanelsForRemoved,
    appendTerminalOutput,
    applyTerminalLifecycle,
    applyTerminalExit,
    appendTerminalInput,
    replaceTerminalOutput,
    getHighlightedTerminalOutput
  }
}
