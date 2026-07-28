<template>
  <header class="ai-header">
    <div
      class="ai-panel-mode-menu"
      data-testid="ai-panel-mode-menu"
      @click.stop
    >
      <button
        type="button"
        class="ai-panel-mode-trigger"
        :title="`${t('ai.panelMode')}: ${currentAiPanelModeLabel}`"
        :aria-label="`${t('ai.panelMode')}: ${currentAiPanelModeLabel}`"
        data-testid="ai-panel-mode-open"
        @click.stop="toggleAiPanelModeMenu"
      >
        <Code2 v-if="aiPanelMode === 'codex'" />
        <Bot v-else />
      </button>
      <div
        v-if="panelModeMenuOpen"
        class="ai-panel-mode-dropdown"
        data-testid="ai-panel-mode-dropdown"
      >
        <button
          type="button"
          :class="{ active: aiPanelMode === 'codex' }"
          data-testid="ai-mode-codex"
          @click.stop="selectAiPanelMode('codex')"
        >
          <Code2 />
          <span>{{ t('ai.codexCliMode') }}</span>
        </button>
        <button
          type="button"
          :class="{ active: aiPanelMode === 'classic' }"
          data-testid="ai-mode-classic"
          @click.stop="selectAiPanelMode('classic')"
        >
          <Bot />
          <span>{{ t('ai.classicChatMode') }}</span>
        </button>
      </div>
    </div>

    <nav
      v-if="aiPanelMode === 'classic' && visibleConversationTabs.length"
      class="ai-conversation-tabs"
      role="tablist"
      :aria-label="t('ai.conversationTabs')"
      data-testid="ai-conversation-tabs"
    >
      <div
        v-for="conversation in visibleConversationTabs"
        :key="conversation.id"
        class="ai-conversation-tab"
        :class="{ active: workspace.selectedConversationId === conversation.id, favorite: conversation.favorite }"
        role="tab"
        tabindex="0"
        :aria-selected="workspace.selectedConversationId === conversation.id"
        :title="conversationTabTooltip(conversation)"
        data-testid="ai-conversation-tab"
        :data-conversation-id="conversation.id"
        @click.stop="restoreConversationFromTab(conversation.id)"
        @keydown.enter.prevent="restoreConversationFromTab(conversation.id)"
        @keydown.space.prevent="restoreConversationFromTab(conversation.id)"
        @keydown.delete.prevent="closeConversationTab(conversation.id)"
        @keydown.backspace.prevent="closeConversationTab(conversation.id)"
      >
        <Star
          v-if="conversation.favorite"
          class="ai-conversation-tab-favorite"
        />
        <span class="ai-conversation-tab-title">{{ displayConversationTitle(conversation) }}</span>
        <button
          type="button"
          class="ai-conversation-tab-close"
          :title="`${t('ai.closeTab')}: ${displayConversationTitle(conversation)}`"
          :aria-label="`${t('ai.closeTab')}: ${displayConversationTitle(conversation)}`"
          @click.stop="closeConversationTab(conversation.id)"
        >
          <X />
        </button>
      </div>
    </nav>
    <nav
      v-else-if="aiPanelMode === 'codex' && codexConversations.length"
      class="ai-conversation-tabs ai-codex-tabs"
      role="tablist"
      :aria-label="t('ai.conversationTabs')"
      data-testid="ai-codex-tabs"
    >
      <div
        v-for="conversation in codexConversations"
        :key="conversation.id"
        :ref="(element) => registerCodexTabRef(conversation.id, element)"
        class="ai-conversation-tab"
        :class="{ active: activeCodexConversationId === conversation.id }"
        role="tab"
        tabindex="0"
        :aria-selected="activeCodexConversationId === conversation.id"
        :title="codexConversationTitle(conversation)"
        data-testid="ai-codex-tab"
        :data-codex-conversation-id="conversation.id"
        @click.stop="selectCodexConversation(conversation.id)"
        @keydown.enter.prevent="selectCodexConversation(conversation.id)"
        @keydown.space.prevent="selectCodexConversation(conversation.id)"
        @keydown.delete.prevent="closeCodexConversation(conversation.id)"
        @keydown.backspace.prevent="closeCodexConversation(conversation.id)"
      >
        <Code2 class="ai-conversation-tab-favorite" />
        <span class="ai-conversation-tab-title">{{ codexConversationTitle(conversation) }}</span>
        <button
          type="button"
          class="ai-conversation-tab-close"
          :title="`${t('ai.closeTab')}: ${codexConversationTitle(conversation)}`"
          :aria-label="`${t('ai.closeTab')}: ${codexConversationTitle(conversation)}`"
          @click.stop="closeCodexConversation(conversation.id)"
        >
          <X />
        </button>
      </div>
    </nav>

    <div class="ai-header-actions">
      <button
        v-if="aiPanelMode === 'classic'"
        type="button"
        class="ai-header-icon-button"
        :title="t('ai.newChat')"
        data-testid="ai-new-chat"
        @click.stop="createNewAiConversation()"
      >
        <Plus />
      </button>
      <button
        v-else
        type="button"
        class="ai-header-icon-button"
        :title="t('ai.newChat')"
        data-testid="ai-codex-new"
        @click.stop="createNewCodexConversation()"
      >
        <Plus />
      </button>
      <button
        v-if="projectFilesAvailable"
        type="button"
        class="ai-header-icon-button"
        :class="{ active: projectFilesActive }"
        :title="t('module.files')"
        :aria-label="t('module.files')"
        :aria-pressed="projectFilesActive"
        data-testid="ai-project-files-toggle"
        @click.stop="$emit('toggleProjectFiles')"
      >
        <FolderTree />
      </button>
      <div
        class="ai-history-menu-wrap"
        @click.stop
      >
        <button
          ref="moreActionsTriggerRef"
          type="button"
          class="ai-header-icon-button"
          :class="{ active: moreActionsMenuOpen }"
          :title="t('ai.moreActions')"
          data-testid="ai-more-actions-open"
          @click.stop="toggleHeaderMoreActionsMenu"
        >
          <Ellipsis />
        </button>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="moreActionsMenuOpen"
        ref="moreActionsMenuRef"
        class="ai-more-actions-menu ai-more-actions-menu-floating"
        :class="{ ready: moreActionsMenuPosition.ready }"
        :style="{
          left: `${moreActionsMenuPosition.left}px`,
          top: `${moreActionsMenuPosition.top}px`
        }"
        data-testid="ai-more-actions-menu"
        @click.stop
      >
          <template v-if="aiPanelMode === 'classic'">
            <button
              type="button"
              data-testid="ai-chat-search-open"
              @click.stop="openChatSearch"
            >
              <Search />
              <span>{{ t('ai.searchChat') }}</span>
            </button>
            <button
              type="button"
              data-testid="ai-chat-export"
              @click.stop="exportCurrentChat"
            >
              <Download />
              <span>{{ t('ai.exportChat') }}</span>
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              :class="{ active: aiPanelWorkspaceLinkMode === 'follow-workspace' }"
              data-testid="ai-codex-workspace-link"
              @click.stop="toggleCodexWorkspaceLinkFromMenu"
            >
              <Link v-if="aiPanelWorkspaceLinkMode === 'follow-workspace'" />
              <Unlink v-else />
              <span>{{ aiPanelWorkspaceLinkMode === 'follow-workspace' ? t('ai.codexWorkspaceLinkOn') : t('ai.codexWorkspaceLinkOff') }}</span>
            </button>
            <button
              type="button"
              data-testid="ai-codex-restart"
              @click.stop="restartCodexFromMenu"
            >
              <RefreshCw />
              <span>{{ t('ai.codexRestart') }}</span>
            </button>
          </template>
      </div>
    </Teleport>
  </header>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  Bot,
  Code2,
  Download,
  Ellipsis,
  FolderTree,
  Link,
  Plus,
  RefreshCw,
  Search,
  Star,
  Unlink,
  X
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

defineProps<{
  projectFilesAvailable?: boolean
  projectFilesActive?: boolean
}>()
defineEmits<{
  toggleProjectFiles: []
}>()

const {
  activeCodexConversationId,
  aiPanelWorkspaceLinkMode,
  aiPanelMode,
  closeCodexConversation,
  closeConversationTab,
  closePopups,
  codexConversations,
  codexConversationTitle,
  conversationTabTooltip,
  createNewAiConversation,
  createNewCodexConversation,
  currentAiPanelModeLabel,
  displayConversationTitle,
  exportCurrentChat,
  moreActionsMenuOpen,
  openChatSearch,
  panelModeMenuOpen,
  restartCodexSession,
  restoreConversationFromTab,
  selectAiPanelMode,
  selectCodexConversation,
  t,
  toggleAiPanelModeMenu,
  toggleAiPanelWorkspaceLinkMode,
  toggleMoreActionsMenu,
  visibleConversationTabs,
  workspace
} = useAiPanelRuntimeContext()

const codexTabRefs = new Map<string, HTMLElement>()
const moreActionsTriggerRef = ref<HTMLElement | null>(null)
const moreActionsMenuRef = ref<HTMLElement | null>(null)
const moreActionsMenuPosition = reactive({
  left: 0,
  top: 0,
  ready: false
})
const menuViewportPadding = 8
const menuGap = 6

const updateMoreActionsMenuPosition = () => {
  const trigger = moreActionsTriggerRef.value
  const menu = moreActionsMenuRef.value
  if (!trigger || !menu) return
  const triggerRect = trigger.getBoundingClientRect()
  const menuRect = menu.getBoundingClientRect()
  const maxMenuWidth = Math.max(0, window.innerWidth - menuViewportPadding * 2)
  const menuWidth = Math.min(menuRect.width || menu.offsetWidth || 132, maxMenuWidth)
  const menuHeight = menuRect.height || menu.offsetHeight
  const maxLeft = Math.max(menuViewportPadding, window.innerWidth - menuWidth - menuViewportPadding)
  const left = Math.min(
    Math.max(triggerRect.right - menuWidth, menuViewportPadding),
    maxLeft
  )
  const belowTop = triggerRect.bottom + menuGap
  const aboveTop = triggerRect.top - menuHeight - menuGap
  const preferredTop = belowTop + menuHeight <= window.innerHeight || aboveTop < menuViewportPadding
    ? belowTop
    : aboveTop
  const maxTop = Math.max(menuViewportPadding, window.innerHeight - menuHeight - menuViewportPadding)
  moreActionsMenuPosition.left = Math.min(Math.max(left, menuViewportPadding), maxLeft)
  moreActionsMenuPosition.top = Math.min(Math.max(preferredTop, menuViewportPadding), maxTop)
  moreActionsMenuPosition.ready = true
}

const onMoreActionsOutsidePointerDown = (event: PointerEvent) => {
  const target = event.target
  if (!(target instanceof Node)) return
  if (moreActionsTriggerRef.value?.contains(target) || moreActionsMenuRef.value?.contains(target)) return
  toggleMoreActionsMenu()
}

const addMoreActionsMenuListeners = () => {
  window.addEventListener('resize', updateMoreActionsMenuPosition)
  window.addEventListener('scroll', updateMoreActionsMenuPosition, true)
  document.addEventListener('pointerdown', onMoreActionsOutsidePointerDown)
}

const removeMoreActionsMenuListeners = () => {
  window.removeEventListener('resize', updateMoreActionsMenuPosition)
  window.removeEventListener('scroll', updateMoreActionsMenuPosition, true)
  document.removeEventListener('pointerdown', onMoreActionsOutsidePointerDown)
}

const registerCodexTabRef = (conversationId: string, element: Element | ComponentPublicInstance | null) => {
  if (element instanceof HTMLElement) codexTabRefs.set(conversationId, element)
  else codexTabRefs.delete(conversationId)
}

watch(
  () => [aiPanelMode.value, activeCodexConversationId.value] as const,
  ([mode, conversationId]) => {
    if (mode !== 'codex' || !conversationId) return
    void nextTick(() => {
      codexTabRefs.get(conversationId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    })
  },
  { flush: 'post' }
)

watch(
  moreActionsMenuOpen,
  (open) => {
    removeMoreActionsMenuListeners()
    moreActionsMenuPosition.ready = false
    if (!open) return
    void nextTick(() => {
      if (!moreActionsMenuOpen.value) return
      updateMoreActionsMenuPosition()
      addMoreActionsMenuListeners()
    })
  },
  { flush: 'post' }
)

onBeforeUnmount(removeMoreActionsMenuListeners)

const toggleHeaderMoreActionsMenu = () => {
  if (moreActionsMenuOpen.value) {
    toggleMoreActionsMenu()
    return
  }
  closePopups()
  toggleMoreActionsMenu()
}

const toggleCodexWorkspaceLinkFromMenu = () => {
  toggleAiPanelWorkspaceLinkMode()
  toggleMoreActionsMenu()
}

const restartCodexFromMenu = () => {
  toggleMoreActionsMenu()
  void restartCodexSession()
}
</script>
