<template>
  <header
    class="top-bar"
    data-onboarding-id="top-layout-controls"
  >
    <div class="top-left">
      <button
        class="icon-button mode-toggle mode-button"
        :class="`mode-button-${workspace.mode}`"
        :title="modeToggleTitle"
        @click="workspace.toggleMode"
      >
        <Code2 v-if="workspace.mode === 'terminal'" />
        <Bot v-else />
      </button>
      <div class="brand-mark">ai</div>
      <span class="brand-name">aiopsterm</span>
      <button
        class="icon-button ai-attention-button"
        :class="{ unread: aiAttentionVisibleCount > 0 }"
        :title="aiAttentionTitle"
        :aria-label="aiAttentionTitle"
        data-testid="ai-attention-bell"
        @click="workspace.jumpToNextAiAttention"
      >
        <Bell />
        <span
          v-if="aiAttentionVisibleCount > 0"
          class="ai-attention-badge"
          data-testid="ai-attention-count"
        >
          {{ aiAttentionBadge }}
        </span>
      </button>
    </div>
    <div class="top-actions">
      <button
        class="top-update-badge"
        :class="`state-${workspace.topUpdateState}`"
        :title="updateTitle"
        @click="workspace.handleTopUpdateClick"
      >
        <LoaderCircle v-if="workspace.topUpdateState === 'checking'" />
        <Download v-else-if="workspace.topUpdateState === 'available'" />
        <CheckCircle2 v-else />
        <span>{{ updateLabel }}</span>
        <ChevronRight v-if="workspace.topUpdateState === 'available'" />
      </button>
      <button
        class="icon-button layout-toggle"
        :class="{ collapsed: isLeftCollapsed }"
        :title="leftToggleTitle"
        @click="workspace.toggleLeft"
      >
        <PanelLeftOpen v-if="isLeftCollapsed" />
        <PanelLeftClose v-else />
      </button>
      <button
        v-if="workspace.mode === 'terminal'"
        class="icon-button layout-toggle right-ai-toggle"
        data-onboarding-id="right-ai-toggle"
        :class="{ collapsed: isRightCollapsed }"
        :disabled="rightToggleDisabled"
        :title="rightToggleTitle"
        @click="workspace.toggleRight"
      >
        <PanelRightOpen v-if="isRightCollapsed" />
        <PanelRightClose v-else />
      </button>
      <span
        v-if="workspace.topNotice"
        class="top-notice"
      >
        {{ workspace.topNotice }}
      </span>
      <div class="window-title">AI Operations Terminal</div>
      <div
        v-if="!isMac"
        class="window-controls"
      >
        <button
          class="window-control-button"
          :title="t('top.windowMinimize')"
          @click="minimizeWindow"
        >
          <Minus />
        </button>
        <button
          class="window-control-button"
          :title="isMaximized ? t('top.windowRestore') : t('top.windowMaximize')"
          @click="toggleMaximize"
        >
          <CopyMinus v-if="isMaximized" />
          <Square v-else />
        </button>
        <button
          class="window-control-button close"
          :title="t('top.windowClose')"
          @click="closeWindow"
        >
          <X />
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  Code2,
  CopyMinus,
  Download,
  LoaderCircle,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  X
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n'
import { windowControlsClient } from '@/services/app/windowControlsClient'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const platform = ref('')
const isMaximized = ref(false)
let stopMaximized: (() => void) | undefined
let stopUnmaximized: (() => void) | undefined

const isMac = computed(() => platform.value.includes('darwin'))
const isLeftCollapsed = computed(() => (workspace.mode === 'agents' ? !workspace.agentsLeftOpen : !workspace.leftPanelOpen))
const isRightCollapsed = computed(() => !workspace.rightPanelOpen)
const rightToggleDisabled = computed(() => workspace.activeModule === 'database' || workspace.activeModule === 'user')
const modeToggleTitle = computed(() => (workspace.mode === 'terminal' ? t('top.modeToAgents') : t('top.modeToTerminal')))
const leftToggleTitle = computed(() =>
  workspace.mode === 'agents'
    ? isLeftCollapsed.value
      ? t('top.expandSessions')
      : t('top.collapseSessions')
    : isLeftCollapsed.value
      ? t('top.expandLeft')
      : t('top.collapseLeft')
)
const rightToggleTitle = computed(() => {
  if (rightToggleDisabled.value) return t('top.aiUnavailable')
  return isRightCollapsed.value ? t('top.expandAi') : t('top.collapseAi')
})
const updateLabel = computed(() => {
  if (workspace.topUpdateState === 'checking') return t('top.updateChecking')
  if (workspace.topUpdateState === 'available') return t('top.updateAvailable')
  if (workspace.topUpdateState === 'install-requested') return t('top.updateInstallRequested')
  return t('top.updateLocal')
})
const updateTitle = computed(() => {
  if (workspace.topUpdateState === 'available') return t('top.updateAvailable')
  if (workspace.topUpdateState === 'install-requested') return t('top.updateInstallRequested')
  return t('top.updateChecking')
})
const aiSessionAttentionCount = computed(() => workspace.managedAiNeedsInputSessions.length)
const aiAttentionVisibleCount = computed(() => aiSessionAttentionCount.value || workspace.aiAttentionUnreadCount)
const aiAttentionBadge = computed(() => (aiAttentionVisibleCount.value > 99 ? '99+' : String(aiAttentionVisibleCount.value)))
const aiAttentionTitle = computed(() => {
  const session = workspace.selectedManagedAiSession?.state === 'needsInput'
    ? workspace.selectedManagedAiSession
    : workspace.managedAiNeedsInputSessions[0]
  if (session) {
    return t('top.aiSessionAttentionPending', {
      count: String(aiSessionAttentionCount.value),
      title: session.title
    })
  }
  const item = workspace.currentAiAttentionItem
  if (!item) return t('top.aiAttentionOpen')
  return t('top.aiAttentionPending', {
    count: String(workspace.aiAttentionUnreadCount),
    title: item.title
  })
})

const minimizeWindow = () => {
  windowControlsClient.minimizeWindow()?.()
}

const toggleMaximize = async () => {
  if (isMaximized.value) {
    await windowControlsClient.unmaximizeWindow()?.()
    isMaximized.value = false
  } else {
    await windowControlsClient.maximizeWindow()?.()
    isMaximized.value = true
  }
}

const closeWindow = () => {
  windowControlsClient.closeWindow()?.()
}

onMounted(async () => {
  platform.value = (await windowControlsClient.platform()?.()) || ''
  isMaximized.value = (await windowControlsClient.isMaximized()?.()) || false
  stopMaximized = windowControlsClient.onMaximized()?.(() => {
    isMaximized.value = true
  })
  stopUnmaximized = windowControlsClient.onUnmaximized()?.(() => {
    isMaximized.value = false
  })
  workspace.checkTopUpdate()
})

onUnmounted(() => {
  stopMaximized?.()
  stopUnmaximized?.()
})
</script>
