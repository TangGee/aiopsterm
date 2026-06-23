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
      :class="{ bound: Boolean(activeCodexBoundTarget), missing: !activeCodexBoundTarget }"
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
    <div class="ai-codex-status">
      <span
        class="ai-codex-status-dot"
        :class="activeCodexConversation?.status || 'idle'"
      ></span>
      <span>{{ codexStatusLabel }}</span>
    </div>
    <div class="ai-codex-xterm-stack">
      <div
        v-for="conversation in codexConversations"
        :key="conversation.id"
        :ref="(element) => setCodexTerminalHostRef(conversation.id, element)"
        v-show="activeCodexConversationId === conversation.id"
        class="xterm-host ai-codex-xterm"
        :class="{ 'is-idle': conversation.status === 'idle' && !conversation.sessionId }"
        data-testid="ai-codex-xterm"
        @contextmenu.prevent.stop="copyCodexSelectionFromContextMenu"
      ></div>
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
  copyCodexSelectionFromContextMenu,
  currentPanelTarget,
  dropActive,
  filteredCodexHostTargets,
  focusCodexTerminal,
  locateCodexBoundTarget,
  setCodexTerminalHostRef,
  t,
  toggleCodexTargetPicker,
  unbindCodexTarget
} = useAiPanelRuntimeContext()
</script>
