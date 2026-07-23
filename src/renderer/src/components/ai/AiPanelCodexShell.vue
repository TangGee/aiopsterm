<template>
  <div
    v-show="aiPanelMode === 'codex'"
    class="ai-codex-shell"
    :class="{ 'drop-active': dropActive }"
    data-testid="ai-codex-shell"
    @click.stop="focusCodexTerminal"
  >
    <div
      class="ai-codex-target-bar"
      :class="{ bound: Boolean(activeCodexBoundTarget), missing: !activeCodexBoundTarget, 'picker-open': codexTargetPickerOpen }"
      data-testid="ai-codex-target-bar"
      @click.stop
    >
      <template v-if="activeCodexBoundTarget">
        <div class="ai-codex-target-main">
          <Server />
          <div>
            <strong>{{ codexBoundTargetLabel }}</strong>
            <span>{{ codexBoundTargetDetail }}</span>
          </div>
        </div>
        <div class="ai-codex-target-actions">
          <button
            type="button"
            :title="t('ai.codexTargetLocate')"
            data-testid="ai-codex-target-locate"
            @click.stop="locateCodexBoundTarget"
          >
            <Focus />
          </button>
          <button
            type="button"
            :title="t('ai.codexTargetChange')"
            data-testid="ai-codex-target-change"
            @click.stop="toggleCodexTargetPicker"
          >
            <Search />
          </button>
          <button
            type="button"
            :title="t('ai.codexTargetUnbind')"
            data-testid="ai-codex-target-unbind"
            @click.stop="unbindCodexTarget"
          >
            <X />
          </button>
        </div>
      </template>
      <template v-else>
        <div class="ai-codex-target-main">
          <Server />
          <div>
            <strong>{{ t('ai.codexTargetUnbound') }}</strong>
            <span>{{ t('ai.codexTargetDropHint') }}</span>
          </div>
        </div>
        <button
          type="button"
          class="ai-codex-bind-button"
          data-testid="ai-codex-bind-open"
          @click.stop="toggleCodexTargetPicker"
        >
          <Link2 />
          <span>{{ t('ai.codexTargetBind') }}</span>
        </button>
      </template>
      <div
        v-if="codexTargetPickerOpen"
        class="ai-codex-target-picker"
        data-testid="ai-codex-target-picker"
        @click.stop
      >
        <label>
          <Search />
          <input
            v-model="codexTargetQuery"
            type="search"
            :placeholder="t('ai.codexTargetSearch')"
            data-testid="ai-codex-target-search"
            @keydown.esc.prevent="closeCodexTargetPicker"
          />
        </label>
        <div class="ai-codex-target-list">
          <button
            v-if="currentPanelTarget"
            type="button"
            data-testid="ai-codex-bind-current"
            @click.stop="bindCodexTarget(currentPanelTarget, { reason: 'bind-current' })"
          >
            <Monitor />
            <span>{{ t('ai.codexTargetUseCurrent') }}</span>
            <em>{{ currentPanelTarget.label }}</em>
          </button>
          <button
            v-for="host in filteredCodexHostTargets"
            :key="host.id"
            type="button"
            data-testid="ai-codex-bind-host"
            @click.stop="bindHostContextToCodex(host)"
          >
            <Server />
            <span>{{ host.assetName || host.detail || host.label }}</span>
            <em>{{ host.host || host.label }}</em>
          </button>
          <div
            v-if="!currentPanelTarget && !filteredCodexHostTargets.length"
            class="ai-codex-target-empty"
          >
            {{ t('ai.noMatchingContext') }}
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="codexWorkspaceLinkNotice"
      class="ai-codex-link-notice"
      data-testid="ai-codex-link-notice"
    >
      {{ codexWorkspaceLinkNotice }}
    </div>
    <div class="ai-codex-status">
      <span
        class="ai-codex-status-dot"
        :class="activeCodexConversation?.status || 'idle'"
      ></span>
      <span>{{ codexStatusLabel }}</span>
    </div>
    <div
      class="ai-codex-xterm-stack"
      :class="{
        'is-idle': activeCodexConversation?.status === 'idle' && !activeCodexConversation?.sessionId,
        'is-empty': !activeCodexConversation?.sessionId && activeCodexConversation?.status !== 'ready'
      }"
    >
      <div
        v-for="conversation in codexConversations"
        :key="conversation.id"
        :ref="(element) => setCodexTerminalHostRef(conversation.id, element)"
        v-show="activeCodexConversationId === conversation.id"
        class="xterm-host ai-codex-xterm"
        :class="{
          'threaded-terminal-host': conversation.threadedTerminal,
          'is-idle': conversation.status === 'idle' && !conversation.sessionId,
          'is-empty': !conversation.sessionId && conversation.status !== 'ready'
        }"
        data-testid="ai-codex-xterm"
        data-terminal-surface="codex"
        @contextmenu.prevent.stop="openCodexTerminalMenu"
      ></div>
    </div>
    <div
      v-if="codexTerminalMenu.visible"
      class="terminal-context-menu"
      :style="{ left: `${codexTerminalMenu.x}px`, top: `${codexTerminalMenu.y}px` }"
      data-testid="ai-codex-terminal-menu"
      @click.stop
    >
      <button
        type="button"
        data-testid="ai-codex-terminal-copy"
        @click="copyFromCodexTerminalMenu"
      >
        <span>{{ t('terminal.context.copy') }}</span><kbd>Ctrl+Shift+C</kbd>
      </button>
      <button
        type="button"
        data-testid="ai-codex-terminal-paste"
        @click="pasteFromCodexTerminalMenu"
      >
        <span>{{ t('terminal.context.paste') }}</span><kbd>Ctrl+Shift+V</kbd>
      </button>
    </div>
    <div
      v-if="activeCodexConversation?.error"
      class="ai-codex-error"
      data-testid="ai-codex-error"
    >
      {{ activeCodexConversation.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Focus,
  Link2,
  Monitor,
  Search,
  Server,
  X
} from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

const {
  activeCodexBoundTarget,
  activeCodexConversation,
  activeCodexConversationId,
  aiPanelMode,
  bindCodexTarget,
  bindHostContextToCodex,
  closeCodexTargetPicker,
  codexBoundTargetDetail,
  codexBoundTargetLabel,
  codexConversations,
  codexStatusLabel,
  codexTargetPickerOpen,
  codexTargetQuery,
  codexWorkspaceLinkNotice,
  copyCodexSelectionFromContextMenu,
  currentPanelTarget,
  dropActive,
  filteredCodexHostTargets,
  focusCodexTerminal,
  locateCodexBoundTarget,
  pasteCodexClipboardFromContextMenu,
  setCodexTerminalHostRef,
  t,
  toggleCodexTargetPicker,
  unbindCodexTarget
} = useAiPanelRuntimeContext()

const codexTerminalMenu = reactive({ visible: false, x: 0, y: 0 })

const closeCodexTerminalMenu = () => {
  codexTerminalMenu.visible = false
}

const openCodexTerminalMenu = (event: MouseEvent) => {
  const eventTarget = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : event.target instanceof HTMLElement
      ? event.target
      : null
  const shell = eventTarget?.closest<HTMLElement>('.ai-codex-shell')
  const bounds = shell?.getBoundingClientRect()
  const relativeX = event.clientX - (bounds?.left || 0)
  const relativeY = event.clientY - (bounds?.top || 0)
  codexTerminalMenu.x = Math.max(0, Math.min(relativeX, Math.max(0, (bounds?.width || window.innerWidth) - 214)))
  codexTerminalMenu.y = Math.max(0, Math.min(relativeY, Math.max(0, (bounds?.height || window.innerHeight) - 76)))
  codexTerminalMenu.visible = true
}

const copyFromCodexTerminalMenu = () => {
  copyCodexSelectionFromContextMenu()
  closeCodexTerminalMenu()
}

const pasteFromCodexTerminalMenu = () => {
  pasteCodexClipboardFromContextMenu()
  closeCodexTerminalMenu()
}

onMounted(() => document.addEventListener('click', closeCodexTerminalMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeCodexTerminalMenu))
</script>
