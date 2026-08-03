import { computed, ref, watch, type Ref } from 'vue'
import type { ModuleKey } from '@/config/navigation'
import type { UiFocusCause } from '@/services/app/uiFocusCoordinator'
import {
  isWelcomeTerminalPanelPlaceholder,
  type TerminalPanel
} from '@/services/terminal/terminalPanelRuntime'

const maxPanelNavigationEntries = 50

export type WorkspacePanelActivationOptions = {
  cause?: UiFocusCause
  focusPolicy?: 'target-primary' | 'preserve'
  modulePolicy?: 'workspace' | 'preserve'
}

export type WorkspacePanelFocusRequest = {
  sequence: number
  panelId: string
  cause: UiFocusCause
}

type WorkspacePanelNavigationState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
}

const eligiblePanels = (panels: TerminalPanel[]) =>
  panels.filter((panel) => !isWelcomeTerminalPanelPlaceholder(panel))

export const workspacePanelSearchText = (panel: TerminalPanel) => {
  const values = [
    panel.title,
    panel.cwd,
    panel.kind || 'terminal',
    panel.sessionId,
    panel.knowledge?.relPath,
    panel.managedAiSession?.source,
    panel.managedAiSession?.sessionId,
    panel.projectFile?.source,
    panel.projectFile?.sessionId,
    panel.projectFile?.projectRoot,
    panel.projectFile?.relativePath,
    panel.localFile?.filePath,
    panel.sshSession?.assetName,
    panel.sshSession?.host,
    panel.sshSession?.username
  ]
  return values.filter(Boolean).join(' ').toLocaleLowerCase()
}

export const matchesWorkspacePanelQuery = (panel: TerminalPanel, query: string) => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const searchText = workspacePanelSearchText(panel)
  return terms.every((term) => searchText.includes(term))
}

export const createWorkspacePanelNavigationRuntime = (state: WorkspacePanelNavigationState) => {
  const recentPanelsOpen = ref(false)
  const recentPanelsFocusRequest = ref(0)
  const recentPanelsCloseReason = ref<'restore' | 'activate'>('restore')
  const recentPanelIds = ref<string[]>([])
  const panelNavigationHistory = ref<string[]>([])
  const panelNavigationIndex = ref(-1)
  const panelFocusRequest = ref<WorkspacePanelFocusRequest | null>(null)
  let panelFocusRequestSequence = 0
  let historyTraversalPanelId = ''

  const currentEligiblePanels = () => eligiblePanels(state.panels.value)

  const pruneNavigationState = () => {
    const validIds = new Set(currentEligiblePanels().map((panel) => panel.id))
    recentPanelIds.value = recentPanelIds.value.filter((id) => validIds.has(id))

    const currentHistory = panelNavigationHistory.value
    const nextHistory: string[] = []
    let nextIndex = -1
    currentHistory.forEach((id, index) => {
      if (!validIds.has(id)) return
      if (nextHistory.at(-1) !== id) nextHistory.push(id)
      if (index <= panelNavigationIndex.value) nextIndex = nextHistory.length - 1
    })
    panelNavigationHistory.value = nextHistory
    panelNavigationIndex.value = Math.min(nextHistory.length - 1, nextIndex)
  }

  const touchRecentPanel = (panelId: string) => {
    recentPanelIds.value = [
      panelId,
      ...recentPanelIds.value.filter((id) => id !== panelId)
    ].slice(0, maxPanelNavigationEntries)
  }

  const recordPanelActivation = (panelId: string) => {
    touchRecentPanel(panelId)
    if (panelNavigationHistory.value[panelNavigationIndex.value] === panelId) return
    const nextHistory = [
      ...panelNavigationHistory.value.slice(0, panelNavigationIndex.value + 1),
      panelId
    ].slice(-maxPanelNavigationEntries)
    panelNavigationHistory.value = nextHistory
    panelNavigationIndex.value = nextHistory.length - 1
  }

  const recentWorkspacePanels = computed(() => {
    const panels = currentEligiblePanels()
    const panelOrder = new Map(panels.map((panel, index) => [panel.id, index]))
    const recentOrder = new Map(recentPanelIds.value.map((id, index) => [id, index]))
    return [...panels].sort((left, right) => {
      const leftRecent = recentOrder.get(left.id)
      const rightRecent = recentOrder.get(right.id)
      if (leftRecent !== undefined && rightRecent !== undefined) return leftRecent - rightRecent
      if (leftRecent !== undefined) return -1
      if (rightRecent !== undefined) return 1
      return (panelOrder.get(left.id) || 0) - (panelOrder.get(right.id) || 0)
    })
  })

  const requestPanelFocus = (panelId: string, cause: UiFocusCause = 'navigation') => {
    if (!currentEligiblePanels().some((panel) => panel.id === panelId)) return false
    panelFocusRequest.value = {
      sequence: ++panelFocusRequestSequence,
      panelId,
      cause
    }
    return true
  }

  const commitPanelSelection = (panelId: string) => {
    if (!state.panels.value.some((panel) => panel.id === panelId)) return false
    state.activePanelId.value = panelId
    return true
  }

  const selectPanelForLifecycle = (panelId: string) => commitPanelSelection(panelId)
  const restorePanelSelection = (panelId: string) => commitPanelSelection(panelId)
  const adoptFocusedPanel = (panelId: string) => commitPanelSelection(panelId)

  const activatePanelSurface = (panelId: string, options: WorkspacePanelActivationOptions = {}) => {
    const panel = currentEligiblePanels().find((item) => item.id === panelId)
    if (!panel) return false
    state.mode.value = 'terminal'
    if (options.modulePolicy !== 'preserve') state.activeModule.value = 'workspace'
    if (state.activePanelId.value === panelId) {
      touchRecentPanel(panelId)
    } else {
      commitPanelSelection(panelId)
    }
    if (options.focusPolicy !== 'preserve') requestPanelFocus(panelId, options.cause)
    return true
  }

  const openRecentPanels = () => {
    if (!recentPanelsOpen.value) recentPanelsCloseReason.value = 'restore'
    recentPanelsOpen.value = true
    recentPanelsFocusRequest.value += 1
    return true
  }

  const closeRecentPanels = (reason: 'restore' | 'activate' = 'restore') => {
    recentPanelsCloseReason.value = reason
    recentPanelsOpen.value = false
  }

  const activateRecentPanel = (panelId: string, cause: UiFocusCause = 'navigation') => {
    const activated = activatePanelSurface(panelId, { cause })
    if (activated) closeRecentPanels('activate')
    return activated
  }

  const navigatePanelHistory = (offset: -1 | 1) => {
    pruneNavigationState()
    const targetIndex = panelNavigationIndex.value + offset
    if (targetIndex < 0 || targetIndex >= panelNavigationHistory.value.length) return false
    const targetPanelId = panelNavigationHistory.value[targetIndex]
    historyTraversalPanelId = targetPanelId
    panelNavigationIndex.value = targetIndex
    closeRecentPanels('activate')
    if (activatePanelSurface(targetPanelId, { cause: 'keyboard' })) return true
    historyTraversalPanelId = ''
    return false
  }

  const navigatePanelBack = () => navigatePanelHistory(-1)
  const navigatePanelForward = () => navigatePanelHistory(1)

  const canNavigatePanelBack = computed(() => panelNavigationIndex.value > 0)
  const canNavigatePanelForward = computed(
    () => panelNavigationIndex.value >= 0 && panelNavigationIndex.value < panelNavigationHistory.value.length - 1
  )

  watch(
    [
      state.activePanelId,
      () => currentEligiblePanels().map((panel) => panel.id).join('|')
    ],
    () => {
      pruneNavigationState()
      const activePanelId = state.activePanelId.value
      if (!currentEligiblePanels().some((panel) => panel.id === activePanelId)) return
      if (historyTraversalPanelId === activePanelId) {
        historyTraversalPanelId = ''
        touchRecentPanel(activePanelId)
        return
      }
      historyTraversalPanelId = ''
      recordPanelActivation(activePanelId)
    },
    { immediate: true, flush: 'sync' }
  )

  return {
    recentPanelsOpen,
    recentPanelsFocusRequest,
    recentPanelsCloseReason,
    recentPanelIds,
    recentWorkspacePanels,
    panelNavigationHistory,
    panelNavigationIndex,
    panelFocusRequest,
    canNavigatePanelBack,
    canNavigatePanelForward,
    openRecentPanels,
    closeRecentPanels,
    requestPanelFocus,
    selectPanelForLifecycle,
    restorePanelSelection,
    adoptFocusedPanel,
    activatePanelSurface,
    activateRecentPanel,
    navigatePanelBack,
    navigatePanelForward
  }
}
