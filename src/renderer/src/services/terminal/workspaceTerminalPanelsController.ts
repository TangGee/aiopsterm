import { type Ref } from 'vue'
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
  closeOtherTerminalPanelsInCollection,
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
  renameTerminalPanelInCollection,
  registerTerminalSshSession,
  replaceTerminalOutputInPanelCollection,
  resetTerminalPanelCollectionToDefault,
  setTerminalPanelAutoTitleInCollection,
  trimTerminalPanelOutputHistory,
  type PanelDirection,
  type TerminalLaunchAsset,
  type TerminalOutputScope,
  type TerminalPanel,
  type TerminalSessionAsset
} from '@/services/terminal/terminalPanelRuntime'
import type { ModuleKey } from '@/config/navigation'
import type { ExtensionSettings, KeywordHighlightSettings, TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { TerminalExitEvent, TerminalLifecycleEvent, TerminalSessionInfo } from '@shared/contracts/terminalSessions'

type WorkspaceTerminalPanelsControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
  terminalSettings: Ref<TerminalSettings>
  extensionSettings: Ref<ExtensionSettings>
  keywordHighlightSettings: Ref<KeywordHighlightSettings>
  kbSelectedKeys: Ref<string[]>
}

type WorkspaceTerminalPanelsControllerDeps = {
  setTopNotice: (message: string) => void
  createRendererLocalId: (prefix: 'panel') => string
  findKnowledgeNode: (relPath: string) => KnowledgeNode | null
  recordMacroTerminalInput: (panelId: string, data: string) => void
  touchManagedAiTerminalActivity: (panel: Pick<TerminalPanel, 'id' | 'sessionId'>, at?: number) => void
  applyManagedAiTerminalLifecycle: (panel: Pick<TerminalPanel, 'id'>, event: TerminalLifecycleEvent) => void
  applyManagedAiTerminalExit: (panel: Pick<TerminalPanel, 'id'>, event: TerminalExitEvent) => void
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
    terminalSettings,
    extensionSettings,
    keywordHighlightSettings,
    kbSelectedKeys
  } = state
  const {
    setTopNotice,
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
    if (!target || target.kind !== 'terminal') return null
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

  const closePanel = (id = activePanelId.value) => {
    const closing = panels.value.filter((panel) => panel.id === id || (panels.value.length === 1 && panel.kind !== 'knowledge'))
    activePanelId.value = closeTerminalPanelInCollection(panels.value, id, activePanelId.value)
    applyManagedAiTerminalPanelClosed(closing)
  }

  const discardPendingTerminalPanel = (id: string, preferredActiveId?: string) => {
    const result = discardPendingTerminalPanelInCollection(panels.value, id, activePanelId.value, preferredActiveId)
    activePanelId.value = result.activePanelId
    return result.discarded
  }

  const closeOthers = () => {
    const closing = panels.value.filter((panel) => panel.id !== activePanelId.value)
    closeOtherTerminalPanelsInCollection(panels.value, activePanelId.value)
    applyManagedAiTerminalPanelClosed(closing)
  }

  const closeAllPanels = () => {
    const closing = [...panels.value]
    activePanelId.value = resetTerminalPanelCollectionToDefault(panels.value)
    applyManagedAiTerminalPanelClosed(closing)
  }

  const closePanels = (closeMode: 'current' | 'others' | 'all', id = activePanelId.value) => {
    if (closeMode === 'all') {
      closeAllPanels()
    } else if (closeMode === 'others') {
      activePanelId.value = id
      closeOthers()
    } else {
      closePanel(id)
    }
  }

  const renamePanel = (id: string, title: string, source: TerminalPanel['titleSource'] = 'user') => {
    renameTerminalPanelInCollection(panels.value, id, title, source)
  }

  const setPanelAutoTitle = (id: string, title: string, options: { panelOnlyIfMultiple?: boolean } = {}) =>
    setTerminalPanelAutoTitleInCollection(panels.value, id, title, options)

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
    if (!panel) return null
    const applied = applyTerminalLifecycleToPanel(panel, event)
    if (!applied) return null
    applyManagedAiTerminalLifecycle(panel, event)
    return panel
  }

  const applyTerminalExit = (event: TerminalExitEvent) => {
    if (!isTerminalExitEvent(event)) return null
    const panel = findTerminalPanelBySessionOrId(panels.value, event.id)
    if (!panel) return null
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

  const openTerminalForAiHostContext = async (host: AiContextOption) => {
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
      return panels.value.find((item) => item.id === panelId) || null
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
  let knowledgeJumpTokenSeed = 0

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
    canForkSshPanel,
    forkSshPanel,
    registerSshSession,
    applySshTerminalSession,
    applyLocalTerminalSession,
    openKnowledgeFile,
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
