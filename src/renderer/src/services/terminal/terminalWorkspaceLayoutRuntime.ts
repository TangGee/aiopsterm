import { computed, ref } from 'vue'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type SplitLayoutRect = { x: number; y: number; width: number; height: number }

type TerminalWorkspaceLayoutEffects = {
  focusActivePanel: () => void
  refitAfterLayoutChange: () => void
}

type TerminalWorkspaceLayoutRuntimeInput = {
  workspace: WorkspaceStore
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  effects: TerminalWorkspaceLayoutEffects
}

const terminalTabDragType = 'application/x-aiopsterm-terminal-tab'

const splitPercent = (value: number) => `${Number(value.toFixed(5))}%`

const splitPaneStyle = (rect: SplitLayoutRect) => ({
  left: `calc(${splitPercent(rect.x)} + 4px)`,
  top: `calc(${splitPercent(rect.y)} + 4px)`,
  width: `calc(${splitPercent(rect.width)} - 8px)`,
  height: `calc(${splitPercent(rect.height)} - 8px)`
})

const buildSplitLayoutRects = (panels: TerminalPanel[]) => {
  const rects = new Map<string, SplitLayoutRect>()
  if (!panels.length) return rects
  const panelIds = new Set(panels.map((panel) => panel.id))
  const rootPanel = panels.find((panel) => !panel.split || !panel.splitSourceId || !panelIds.has(panel.splitSourceId)) || panels[0]
  rects.set(rootPanel.id, { x: 0, y: 0, width: 100, height: 100 })

  const panelIndex = new Map(panels.map((panel, index) => [panel.id, index]))
  const splitPanels = panels
    .filter((panel) => panel.split && panel.splitSourceId && panelIds.has(panel.splitSourceId))
    .sort((left, right) => (left.splitOrder ?? panelIndex.get(left.id) ?? 0) - (right.splitOrder ?? panelIndex.get(right.id) ?? 0))

  splitPanels.forEach((panel) => {
    if (!panel.splitSourceId) return
    const sourceRect = rects.get(panel.splitSourceId)
    if (!sourceRect) return
    const original = { ...sourceRect }
    if (panel.split === 'right') {
      const leftWidth = original.width / 2
      sourceRect.width = leftWidth
      rects.set(panel.id, {
        x: original.x + leftWidth,
        y: original.y,
        width: original.width - leftWidth,
        height: original.height
      })
      return
    }
    const topHeight = original.height / 2
    sourceRect.height = topHeight
    rects.set(panel.id, {
      x: original.x,
      y: original.y + topHeight,
      width: original.width,
      height: original.height - topHeight
    })
  })

  panels.forEach((panel) => {
    if (!rects.has(panel.id)) rects.set(panel.id, { x: 0, y: 0, width: 100, height: 100 })
  })
  return rects
}

export const createTerminalWorkspaceLayoutRuntime = ({ workspace, isWelcomePlaceholderPanel, effects }: TerminalWorkspaceLayoutRuntimeInput) => {
  const draggedTerminalPanelId = ref('')
  const tabDragOverPanelId = ref('')
  const paneDragOverPanelId = ref('')
  const tabBarDragOver = ref(false)

  const visibleTerminalTabPanels = computed(() => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel)))
  const connectedTerminalPanels = computed(() => visibleTerminalTabPanels.value.filter((panel) => panel.kind !== 'knowledge'))
  const activeTerminalPanel = computed(() => workspace.panels.find((panel) => panel.id === workspace.activePanelId) || visibleTerminalTabPanels.value[0] || workspace.panels[0])
  const visibleTerminalPanels = computed(() => {
    const active = activeTerminalPanel.value
    if (!active) return []
    if (active.splitGroupId) {
      const groupPanels = workspace.panels.filter((panel) => panel.splitGroupId === active.splitGroupId)
      return groupPanels.length ? groupPanels : [active]
    }
    if (active.split && active.splitSourceId) {
      const source = workspace.panels.find((panel) => panel.id === active.splitSourceId)
      return source && source.id !== active.id ? [source, active] : [active]
    }
    const splitPanels = workspace.panels.filter((panel) => panel.split && panel.splitSourceId === active.id)
    return splitPanels.length ? [active, ...splitPanels] : [active]
  })
  const isSplitView = computed(() => visibleTerminalPanels.value.length > 1)
  const splitLayoutItems = computed(() => {
    if (!isSplitView.value) return visibleTerminalPanels.value.map((panel) => ({ panel, style: {} }))
    const rects = buildSplitLayoutRects(visibleTerminalPanels.value)
    return visibleTerminalPanels.value.map((panel) => ({
      panel,
      style: splitPaneStyle(rects.get(panel.id) || { x: 0, y: 0, width: 100, height: 100 })
    }))
  })
  const terminalGridClasses = computed(() => {
    if (!isSplitView.value) return {}
    const splitDirections = visibleTerminalPanels.value.filter((panel) => panel.split).map((panel) => panel.split)
    const lastDirection = splitDirections.at(-1)
    return {
      split: true,
      'split-tree': true,
      'split-right': splitDirections.includes('right'),
      'split-below': lastDirection === 'below' && !splitDirections.includes('right')
    }
  })
  const showTerminalDashboard = computed(() => {
    const panel = visibleTerminalPanels.value[0]
    return (
      visibleTerminalPanels.value.length === 1 &&
      panel?.kind !== 'knowledge' &&
      !panel.sessionId &&
      !panel.output &&
      panel.status === 'ready'
    )
  })

  const getDraggedTerminalPanelId = (event: DragEvent) => {
    const transferredId = event.dataTransfer?.getData(terminalTabDragType)
    return transferredId || draggedTerminalPanelId.value
  }

  const clearTerminalTabDragState = () => {
    draggedTerminalPanelId.value = ''
    tabDragOverPanelId.value = ''
    paneDragOverPanelId.value = ''
    tabBarDragOver.value = false
  }

  const handleTabDragStart = (event: DragEvent, panel: TerminalPanel) => {
    if (!event.dataTransfer) return
    draggedTerminalPanelId.value = panel.id
    event.dataTransfer.setData(terminalTabDragType, panel.id)
    if (panel.kind === 'terminal') {
      event.dataTransfer.setData('text/plain', panel.title)
      event.dataTransfer.effectAllowed = 'move'
      return
    }
    if (panel.kind !== 'knowledge' || !panel.knowledge?.relPath) return
    const payload = {
      contextType: panel.knowledge.isImage ? 'image' : 'doc',
      relPath: panel.knowledge.relPath,
      name: panel.title || panel.knowledge.relPath.split('/').pop() || 'KnowledgeCenter'
    }
    const serialized = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-aiopsterm-context', serialized)
    event.dataTransfer.setData('text/html', `<span data-aiopsterm-context="${encodeURIComponent(serialized)}"></span>`)
    event.dataTransfer.setData('text/plain', panel.knowledge.relPath)
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleTabDragEnd = () => {
    clearTerminalTabDragState()
  }

  const handleTabDragEnter = (event: DragEvent, panel: TerminalPanel) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (!draggedId || draggedId === panel.id) return
    tabDragOverPanelId.value = panel.id
    tabBarDragOver.value = false
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  const handleTabDragOver = (event: DragEvent, panel: TerminalPanel) => {
    handleTabDragEnter(event, panel)
  }

  const handleTabDragLeave = (panelId: string) => {
    if (tabDragOverPanelId.value === panelId) tabDragOverPanelId.value = ''
  }

  const attachDraggedPanelToSplit = (draggedId: string, targetPanelId: string) => {
    workspace.attachPanelToSplit(draggedId, targetPanelId, 'right')
    clearTerminalTabDragState()
    effects.refitAfterLayoutChange()
    effects.focusActivePanel()
  }

  const handleTabDrop = (event: DragEvent, targetPanel: TerminalPanel) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (!draggedId || draggedId === targetPanel.id) {
      clearTerminalTabDragState()
      return
    }
    attachDraggedPanelToSplit(draggedId, targetPanel.id)
  }

  const handleTabBarDragOver = (event: DragEvent) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (!draggedId) return
    tabBarDragOver.value = true
    tabDragOverPanelId.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  const handleTabBarDragLeave = (event: DragEvent) => {
    const target = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    if (!target || !related || !target.contains(related)) tabBarDragOver.value = false
  }

  const handleTabBarDrop = (event: DragEvent) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (draggedId) workspace.unsplitPanel(draggedId)
    clearTerminalTabDragState()
    effects.refitAfterLayoutChange()
    effects.focusActivePanel()
  }

  const handlePaneDragEnter = (event: DragEvent, panel: TerminalPanel) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (!draggedId || draggedId === panel.id) return
    paneDragOverPanelId.value = panel.id
    tabBarDragOver.value = false
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  const handlePaneDragOver = (event: DragEvent, panel: TerminalPanel) => {
    handlePaneDragEnter(event, panel)
  }

  const handlePaneDragLeave = (panelId: string) => {
    if (paneDragOverPanelId.value === panelId) paneDragOverPanelId.value = ''
  }

  const handlePaneDrop = (event: DragEvent, targetPanel: TerminalPanel) => {
    const draggedId = getDraggedTerminalPanelId(event)
    if (!draggedId || draggedId === targetPanel.id) {
      clearTerminalTabDragState()
      return
    }
    attachDraggedPanelToSplit(draggedId, targetPanel.id)
  }

  return {
    activeTerminalPanel,
    connectedTerminalPanels,
    handlePaneDragEnter,
    handlePaneDragLeave,
    handlePaneDragOver,
    handlePaneDrop,
    handleTabBarDragLeave,
    handleTabBarDragOver,
    handleTabBarDrop,
    handleTabDragEnd,
    handleTabDragEnter,
    handleTabDragLeave,
    handleTabDragOver,
    handleTabDragStart,
    handleTabDrop,
    paneDragOverPanelId,
    showTerminalDashboard,
    splitLayoutItems,
    tabBarDragOver,
    tabDragOverPanelId,
    terminalGridClasses,
    visibleTerminalPanels,
    visibleTerminalTabPanels
  }
}
