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
          title="最小化窗口"
          @click="minimizeWindow"
        >
          <Minus />
        </button>
        <button
          class="window-control-button"
          :title="isMaximized ? '还原窗口' : '最大化窗口'"
          @click="toggleMaximize"
        >
          <CopyMinus v-if="isMaximized" />
          <Square v-else />
        </button>
        <button
          class="window-control-button close"
          title="退出应用"
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

const workspace = useWorkspaceStore()
const platform = ref('')
const isMaximized = ref(false)
let stopMaximized: (() => void) | undefined
let stopUnmaximized: (() => void) | undefined

const isMac = computed(() => platform.value.includes('darwin'))
const isLeftCollapsed = computed(() => (workspace.mode === 'agents' ? !workspace.agentsLeftOpen : !workspace.leftPanelOpen))
const isRightCollapsed = computed(() => !workspace.rightPanelOpen)
const rightToggleDisabled = computed(() => workspace.activeModule === 'database' || workspace.activeModule === 'user')
const modeToggleTitle = computed(() => (workspace.mode === 'terminal' ? '切换到 Agents 模式' : '切换到终端模式'))
const leftToggleTitle = computed(() => (workspace.mode === 'agents' ? (isLeftCollapsed.value ? '展开会话侧栏' : '收起会话侧栏') : isLeftCollapsed.value ? '展开左侧面板' : '收起左侧面板'))
const rightToggleTitle = computed(() => {
  if (rightToggleDisabled.value) return '当前模块不显示 AI 面板'
  return isRightCollapsed.value ? '展开 AI 面板' : '收起 AI 面板'
})
const updateLabel = computed(() => {
  if (workspace.topUpdateState === 'checking') return 'Checking'
  if (workspace.topUpdateState === 'available') return '点击更新'
  return '本地版本'
})
const updateTitle = computed(() => (workspace.topUpdateState === 'available' ? '安装可用更新' : '检查更新'))

const minimizeWindow = () => {
  window.aiops?.minimizeWindow()
}

const toggleMaximize = async () => {
  if (isMaximized.value) {
    await window.aiops?.unmaximizeWindow()
    isMaximized.value = false
  } else {
    await window.aiops?.maximizeWindow()
    isMaximized.value = true
  }
}

const closeWindow = () => {
  window.aiops?.closeWindow()
}

onMounted(async () => {
  platform.value = (await window.aiops?.platform()) || ''
  isMaximized.value = (await window.aiops?.isMaximized()) || false
  stopMaximized = window.aiops?.onMaximized(() => {
    isMaximized.value = true
  })
  stopUnmaximized = window.aiops?.onUnmaximized(() => {
    isMaximized.value = false
  })
  workspace.checkTopUpdate()
})

onUnmounted(() => {
  stopMaximized?.()
  stopUnmaximized?.()
})
</script>
