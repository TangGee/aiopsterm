<template>
  <header
    class="top-bar"
    :class="{ 'platform-macos': isMac }"
    data-onboarding-id="top-layout-controls"
    data-ui-focus-chrome
  >
    <div class="top-left">
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
      <div
        ref="languageMenuRoot"
        class="top-language"
      >
        <button
          class="icon-button"
          :title="t('settings.general.language')"
          :aria-label="t('settings.general.language')"
          aria-haspopup="menu"
          :aria-expanded="languageMenuOpen"
          data-testid="top-language-button"
          @click="languageMenuOpen = !languageMenuOpen"
        >
          <Globe2 />
        </button>
        <div
          v-if="languageMenuOpen"
          class="top-language-menu"
          role="menu"
          data-testid="top-language-menu"
        >
          <button
            v-for="option in settingsLanguageOptions"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="workspace.config.language === option.value"
            @click="selectLanguage(option.value)"
          >
            <Check v-if="workspace.config.language === option.value" />
            <span v-else class="top-language-check-placeholder"></span>
            <span>{{ option.labelKey ? t(option.labelKey) : option.label }}</span>
          </button>
        </div>
      </div>
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
          @pointerdown="preserveContentFocusOnPointerDown"
          @click="minimizeWindow"
        >
          <Minus />
        </button>
        <button
          class="window-control-button"
          :title="isMaximized ? t('top.windowRestore') : t('top.windowMaximize')"
          @pointerdown="preserveContentFocusOnPointerDown"
          @click="toggleMaximize"
        >
          <CopyMinus v-if="isMaximized" />
          <Square v-else />
        </button>
        <button
          class="window-control-button close"
          :title="t('top.windowClose')"
          @pointerdown="preserveContentFocusOnPointerDown"
          @click="closeWindow"
        >
          <X />
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CopyMinus,
  Download,
  Globe2,
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
import { preserveContentFocusOnPointerDown } from '@/services/app/uiFocusCoordinator'
import { settingsLanguageOptions } from '@/config/settings'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const platform = ref('')
const isMaximized = ref(false)
const languageMenuOpen = ref(false)
const languageMenuRoot = ref<HTMLElement | null>(null)
let stopMaximized: (() => void) | undefined
let stopUnmaximized: (() => void) | undefined

const isMac = computed(() => platform.value.includes('darwin'))
const isLeftCollapsed = computed(() => (workspace.mode === 'agents' ? !workspace.agentsLeftOpen : !workspace.leftPanelOpen))
const isRightCollapsed = computed(() => !workspace.rightPanelOpen)
const rightToggleDisabled = computed(() =>
  workspace.mode === 'terminal' && (workspace.activeModule === 'database' || workspace.activeModule === 'user')
)
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
const aiAttentionBadgeKeys = computed(() => workspace.pendingAiAttentionItems.map((item) => item.id))
const aiAttentionVisibleCount = computed(() => aiAttentionBadgeKeys.value.length)
const aiAttentionBadge = computed(() => (aiAttentionVisibleCount.value > 99 ? '99+' : String(aiAttentionVisibleCount.value)))
const aiAttentionTitle = computed(() => {
  const item = workspace.currentAiAttentionItem
  if (!item) return t('top.aiAttentionOpen')
  return t('top.aiAttentionPending', {
    count: String(aiAttentionVisibleCount.value),
    title: item.title
  })
})

watch(
  () => ({ count: aiAttentionVisibleCount.value, activeKeys: aiAttentionBadgeKeys.value }),
  ({ count, activeKeys }) => {
    const syncBadgeState = windowControlsClient.setBadgeState()
    if (syncBadgeState) {
      void syncBadgeState({ count, activeKeys })
      return
    }
    void windowControlsClient.setBadgeCount()?.(count)
  },
  { immediate: true }
)

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

const selectLanguage = async (language: string) => {
  await workspace.updateLanguage(language)
  languageMenuOpen.value = false
}

const closeLanguageMenuFromDocument = (event: MouseEvent) => {
  if (!languageMenuRoot.value?.contains(event.target as Node)) languageMenuOpen.value = false
}

onMounted(async () => {
  document.addEventListener('mousedown', closeLanguageMenuFromDocument)
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
  document.removeEventListener('mousedown', closeLanguageMenuFromDocument)
  stopMaximized?.()
  stopUnmaximized?.()
})
</script>
