<template>
  <div class="app-shell">
    <TopBar />
    <main
      class="app-body"
      :class="[
        `mode-${workspace.mode}`,
        `module-${workspace.activeModule}`,
        { 'has-left-pane': hasLeftPane, 'has-right-pane': hasRightPane }
      ]"
    >
      <template v-if="workspace.mode === 'agents'">
        <div
          v-if="showAgentsLeftPane"
          class="layout-pane layout-pane-left agents-sidebar-pane"
          :style="{ width: `${displayAgentsLeftWidth}px` }"
          data-layout-pane="agents-left"
        >
          <AgentsSidebar />
        </div>
        <button
          v-if="showAgentsLeftPane"
          class="layout-resizer layout-resizer-left"
          :class="{ dragging: draggingSide === 'agents-left' }"
          data-layout-resizer="agents-left"
          title="调整会话侧栏宽度"
          aria-label="调整会话侧栏宽度"
          @mousedown="startResize('agents-left', $event)"
        ></button>
        <section class="agents-stage">
          <AiPanel agent-mode />
        </section>
      </template>

      <template v-else>
        <SideRail />
        <div
          v-if="showTerminalLeftPane"
          class="layout-pane layout-pane-left module-panel-pane"
          :style="{ width: `${displayLeftPanelWidth}px` }"
          data-onboarding-id="left-function-panel"
          data-layout-pane="terminal-left"
        >
          <ModulePanel />
        </div>
        <button
          v-if="showTerminalLeftPane"
          class="layout-resizer layout-resizer-left"
          :class="{ dragging: draggingSide === 'left' }"
          data-layout-resizer="terminal-left"
          title="调整左侧面板宽度"
          aria-label="调整左侧面板宽度"
          @mousedown="startResize('left', $event)"
        ></button>
        <FilesWorkspace v-if="workspace.activeModule === 'files'" />
        <ExtensionsWorkspace v-else-if="workspace.activeModule === 'extensions'" />
        <KubernetesWorkspace v-else-if="workspace.activeModule === 'kubernetes'" />
        <SettingsWorkspace v-else-if="workspace.activeModule === 'settings'" />
        <UserPanel v-else-if="workspace.activeModule === 'user'" />
        <TerminalWorkspace v-else-if="workspace.activeModule !== 'database'" />
        <DatabaseWorkspace v-else />
        <div
          v-if="showTerminalRightPane"
          class="layout-pane layout-pane-right ai-panel-pane"
          :style="{ width: `${displayRightPanelWidth}px` }"
          data-onboarding-id="right-ai-sidebar"
          data-layout-pane="terminal-right"
        >
          <button
            class="layout-resizer layout-resizer-right"
            :class="{ dragging: draggingSide === 'right' }"
            data-layout-resizer="terminal-right"
            title="调整 AI 侧栏宽度"
            aria-label="调整 AI 侧栏宽度"
            @mousedown="startResize('right', $event)"
          ></button>
          <AiPanel />
        </div>
        <OnboardingSpotlight />
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import TopBar from '@/components/TopBar.vue'
import SideRail from '@/components/SideRail.vue'
import ModulePanel from '@/components/ModulePanel.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import AiPanel from '@/components/AiPanel.vue'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import UserPanel from '@/components/panels/UserPanel.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import { layoutWidthLimits, useWorkspaceStore } from '@/stores/workspace'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'

const workspace = useWorkspaceStore()
type ResizeSide = 'left' | 'right' | 'agents-left'

const draggingSide = ref<ResizeSide | null>(null)
const draftLeftPanelWidth = ref<number | null>(null)
const draftRightPanelWidth = ref<number | null>(null)
const draftAgentsLeftWidth = ref<number | null>(null)
let resizeStartX = 0
let resizeStartWidth = 0
let resizeQuickClosed = false
let stopDeepLink: (() => void) | undefined

const showAgentsLeftPane = computed(() => workspace.mode === 'agents' && workspace.agentsLeftOpen)
const showTerminalLeftPane = computed(
  () => workspace.mode === 'terminal' && workspace.isLeftVisible && !['settings', 'database', 'user'].includes(workspace.activeModule)
)
const showTerminalRightPane = computed(
  () => workspace.mode === 'terminal' && workspace.isRightVisible && workspace.activeModule !== 'database' && workspace.activeModule !== 'user'
)
const hasLeftPane = computed(() => showAgentsLeftPane.value || showTerminalLeftPane.value)
const hasRightPane = computed(() => showTerminalRightPane.value)
const displayLeftPanelWidth = computed(() => draftLeftPanelWidth.value ?? workspace.leftPanelWidth)
const displayRightPanelWidth = computed(() => draftRightPanelWidth.value ?? workspace.rightPanelWidth)
const displayAgentsLeftWidth = computed(() => draftAgentsLeftWidth.value ?? workspace.agentsLeftWidth)

const clampLayoutWidth = (width: number) => Math.min(layoutWidthLimits.max, Math.max(layoutWidthLimits.min, Math.round(width)))

const setDraftWidth = (side: ResizeSide, width: number | null) => {
  if (side === 'left') draftLeftPanelWidth.value = width
  if (side === 'right') draftRightPanelWidth.value = width
  if (side === 'agents-left') draftAgentsLeftWidth.value = width
}

const getCurrentWidth = (side: ResizeSide) => {
  if (side === 'left') return workspace.leftPanelWidth
  if (side === 'right') return workspace.rightPanelWidth
  return workspace.agentsLeftWidth
}

const persistResize = async (side: ResizeSide, width: number) => {
  if (side === 'right') return workspace.resizeRightPanel(width)
  return workspace.resizeLeftPanel(width)
}

const quickClose = async (side: ResizeSide) => {
  if (side === 'right') return workspace.quickCloseRightPanel()
  return workspace.quickCloseLeftPanel()
}

const applyDeepLinkPayload = (payload: unknown) => {
  if (!isAiopstermDeepLinkPayload(payload)) {
    workspace.handleDeepLink(payload)
    return false
  }
  return workspace.handleDeepLink(payload)
}

const consumePendingDeepLinks = async () => {
  const consumeDeepLinks = window.aiops?.consumeDeepLinks
  if (typeof consumeDeepLinks !== 'function') return
  try {
    const payloads = await consumeDeepLinks()
    if (!Array.isArray(payloads)) {
      applyDeepLinkPayload(payloads)
      return
    }
    payloads.forEach((payload) => applyDeepLinkPayload(payload))
  } catch {
    applyDeepLinkPayload(null)
  }
}

const endResize = async () => {
  const side = draggingSide.value
  if (!side) return
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', endResize)
  draggingSide.value = null
  document.body.classList.remove('layout-resizing')
  const width = side === 'left' ? draftLeftPanelWidth.value : side === 'right' ? draftRightPanelWidth.value : draftAgentsLeftWidth.value
  setDraftWidth(side, null)
  if (resizeQuickClosed) {
    resizeQuickClosed = false
    return
  }
  if (typeof width === 'number') {
    void persistResize(side, width)
  }
}

const handleResizeMove = (event: MouseEvent) => {
  const side = draggingSide.value
  if (!side) return
  if (side === 'right') {
    const distanceFromRight = window.innerWidth - event.clientX
    if (distanceFromRight < layoutWidthLimits.quickCloseThreshold) {
      resizeQuickClosed = true
      setDraftWidth(side, null)
      void quickClose(side)
      void endResize()
      return
    }
    setDraftWidth(side, clampLayoutWidth(resizeStartWidth - (event.clientX - resizeStartX)))
    return
  }
  if (event.clientX < layoutWidthLimits.quickCloseThreshold) {
    resizeQuickClosed = true
    setDraftWidth(side, null)
    void quickClose(side)
    void endResize()
    return
  }
  setDraftWidth(side, clampLayoutWidth(resizeStartWidth + (event.clientX - resizeStartX)))
}

const startResize = (side: ResizeSide, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  draggingSide.value = side
  resizeStartX = event.clientX
  resizeStartWidth = getCurrentWidth(side)
  resizeQuickClosed = false
  setDraftWidth(side, resizeStartWidth)
  document.body.classList.add('layout-resizing')
  window.addEventListener('mousemove', handleResizeMove)
  window.addEventListener('mouseup', endResize)
}

onMounted(() => {
  workspace.installShortcutRuntime()
  workspace.hydrateConfig()
  stopDeepLink = window.aiops?.onDeepLink?.((payload) => {
    applyDeepLinkPayload(payload)
  })
  void consumePendingDeepLinks()
})

onUnmounted(() => {
  stopDeepLink?.()
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', endResize)
  document.body.classList.remove('layout-resizing')
  workspace.uninstallShortcutRuntime()
})
</script>
