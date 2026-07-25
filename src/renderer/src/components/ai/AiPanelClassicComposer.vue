<template>
  <form
    v-if="aiPanelMode === 'classic' && !showNoAvailableModelPrompt"
    class="chat-input"
    :class="{
      'drop-active': dropActive,
      'popup-open': contextPopupOpen || commandPopupOpen || modeMenuOpen || modelMenuOpen
    }"
    data-onboarding-id="ai-input"
    @submit.prevent="handleSend"
    @click.stop
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <div class="input-context-row">
      <button
        type="button"
        class="context-trigger-tag"
        data-onboarding-id="ai-context-trigger"
        :title="t('ai.addContext')"
        @click.stop="toggleContextPopup"
      >
        {{ workspace.selectedContexts.length ? '@' : t('ai.addContext') }}
      </button>
      <span
        v-for="context in workspace.selectedContexts"
        :key="context.id"
        class="context-tag"
        :data-context-id="context.id"
        :class="{ 'is-unavailable': context.unavailable }"
        :title="context.unavailable
          ? t('ai.contextUnavailable')
          : context.kind === 'hosts'
            ? t('ai.hostContextHint', { host: context.detail || context.host || context.label })
            : undefined"
      >
        {{ context.label }}
        <button
          type="button"
          :title="t('ai.removeContext')"
          @click.stop="workspace.removeContext(context.id)"
        >
          <X />
        </button>
      </span>
      <span
        v-if="selectedCommandRef"
        class="context-tag command-context-tag"
      >
        {{ selectedCommandRef.label || selectedCommandRef.command }}
        <button
          type="button"
          title="移除命令"
          @click.stop="workspace.selectCommandPreset(null)"
        >
          <X />
        </button>
      </span>
      <span
        v-if="streaming"
        class="processing-indicator"
      >
        <span></span>
        {{ classicClineActivity === 'waiting-approval' ? t('ai.waitingApproval') : t('ai.processing') }}
      </span>
    </div>

    <div
      v-if="contextPopupOpen"
      class="select-popup context-select-popup"
      @click.stop
    >
      <header>
        <button
          v-if="contextLevel !== 'main'"
          type="button"
          :title="t('ai.back')"
          @click="returnContextPopupToMain"
        >
          <ChevronLeft />
        </button>
        <input
          v-model="contextQuery"
          ref="contextSearchInputRef"
          type="search"
          :placeholder="contextLevel === 'main' ? t('ai.searchContext') : t('ai.searchItems')"
          autocomplete="off"
          @keydown="handleContextKeydown"
        />
      </header>
      <div
        v-if="contextLevel === 'main'"
        class="select-list"
      >
        <small
          v-if="displayedOpenedHosts.length"
          class="context-section-label"
        >
          {{ t('ai.openedHosts') }}
        </small>
        <button
          v-for="(host, index) in displayedOpenedHosts"
          :key="host.id"
          type="button"
          class="context-option-row"
          :data-onboarding-id="host.id === 'opened-local' ? 'ai-localhost-option' : undefined"
          :class="{ selected: isContextSelectedForPopup(host), 'keyboard-selected': contextKeyboardIndex === index }"
          @mouseover="contextKeyboardIndex = index"
          @click="applyContext(host)"
        >
          <Server />
          <span>{{ host.label }}</span>
          <span class="context-option-tail">
            <em>{{ host.detail }}</em>
            <Check v-if="isContextSelectedForPopup(host)" />
          </span>
        </button>
        <i v-if="displayedOpenedHosts.length"></i>
        <button
          v-for="(category, index) in visibleContextCategories"
          :key="category.id"
          type="button"
          :data-onboarding-id="category.id === 'hosts' ? 'ai-context-hosts-menu' : undefined"
          :class="{ 'keyboard-selected': contextKeyboardIndex === displayedOpenedHosts.length + index }"
          @mouseover="contextKeyboardIndex = displayedOpenedHosts.length + index"
          @click="openContextCategory(category.id)"
        >
          <component :is="category.icon" />
          <span>{{ category.label }}</span>
          <ChevronRight />
        </button>
      </div>
      <div
        v-else
        class="select-list"
        :class="{ 'has-footer': contextLevel === 'hosts' && chatMode === 'agent' }"
      >
        <button
          v-for="(option, index) in filteredContextOptions"
          :key="option.id"
          type="button"
          class="context-option-row"
          :data-onboarding-id="option.id === 'opened-local' || option.label === '127.0.0.1' ? 'ai-localhost-option' : undefined"
          :class="{ selected: isContextSelectedForPopup(option), 'keyboard-selected': contextKeyboardIndex === index }"
          @mouseover="contextKeyboardIndex = index"
          @click="applyContext(option)"
        >
          <FolderGit2 v-if="option.kind === 'docs' && option.contextType === 'dir'" />
          <FileText v-else-if="option.kind === 'docs'" />
          <component
            :is="selectedContextCategory?.icon"
            v-else
          />
          <span>{{ option.label }}</span>
          <span class="context-option-tail">
            <em>{{ option.detail }}</em>
            <ChevronRight v-if="option.kind === 'docs' && option.contextType === 'dir'" />
            <Check v-else-if="isContextSelectedForPopup(option)" />
          </span>
        </button>
        <small v-if="filteredContextOptions.length === 0">{{ t('ai.noMatchingContext') }}</small>
      </div>
      <footer
        v-if="contextLevel === 'hosts' && chatMode === 'agent'"
        class="host-batch-footer"
      >
        <button
          type="button"
          class="batch-action-btn"
          @click.stop="allVisibleHostContextsSelected ? clearHostContexts() : selectAllVisibleHostContexts()"
        >
          <CheckSquare v-if="allVisibleHostContextsSelected" />
          <MinusSquare v-else />
          <span>{{ allVisibleHostContextsSelected ? t('ai.deselectAll') : t('ai.selectAll') }}</span>
        </button>
        <button
          v-if="hostContextsForPopup.length > 0"
          type="button"
          class="batch-action-btn"
          @click.stop="clearHostContexts"
        >
          <span>{{ t('ai.clearSelection') }}</span>
        </button>
      </footer>
    </div>

    <div
      v-if="commandPopupOpen"
      class="select-popup command-select-popup"
      @click.stop
    >
      <header>
        <input
          v-model="commandQuery"
          ref="commandSearchInputRef"
          type="search"
          :placeholder="t('ai.searchCommand')"
          autocomplete="off"
          @keydown="handleCommandKeydown"
        />
      </header>
      <div class="select-list">
        <button
          v-for="(preset, index) in filteredCommands"
          :key="preset.id"
          type="button"
          :class="{ selected: commandTarget === 'main' && workspace.selectedCommandId === preset.id, 'keyboard-selected': commandKeyboardIndex === index }"
          @mouseover="commandKeyboardIndex = index"
          @click="applyCommand(preset)"
        >
          <Code2 />
          <span>{{ preset.name }}</span>
        </button>
        <small v-if="filteredCommands.length === 0">{{ t('ai.noMatchingCommands') }}</small>
      </div>
    </div>

    <div
      ref="editableRef"
      class="chat-editable"
      :class="{ 'is-empty': composerIsEmpty }"
      :data-placeholder="t('ai.inputPlaceholder')"
      data-testid="ai-message-input"
      data-onboarding-id="ai-input-editable"
      contenteditable="true"
      spellcheck="false"
      role="textbox"
      @click="aiPanelComposerRuntime.handleClick"
      @input="aiPanelComposerRuntime.handleInput"
      @keydown="handleEditableKeydown"
      @keyup="saveEditableSelection"
      @mouseup="saveEditableSelection"
      @paste="aiPanelComposerRuntime.handlePaste"
    ></div>

    <div class="input-controls-row">
      <div class="ai-control-menu-wrap">
        <button
          type="button"
          class="ai-control-select"
          data-onboarding-id="ai-mode-select"
          @click.stop="toggleModeMenu"
        >
          <span>{{ currentChatMode.label }}</span>
          <ChevronDown />
        </button>
        <div
          v-if="modeMenuOpen"
          class="select-popup ai-mode-popup"
          :style="{ width: `${modeDropdownWidthPx}px`, minWidth: `${modeDropdownWidthPx}px` }"
          @click.stop
        >
          <div class="select-list">
            <button
              v-for="option in aiChatModeOptions"
              :key="option.id"
              type="button"
              :data-onboarding-id="option.id === 'agent' ? 'ai-mode-agent-option' : undefined"
              :class="{ selected: chatMode === option.id }"
              @click="selectChatMode(option.id)"
            >
              <span>{{ option.label }}</span>
              <Check v-if="chatMode === option.id" />
            </button>
          </div>
        </div>
      </div>
      <div class="ai-control-menu-wrap model-control-wrap">
        <button
          type="button"
          class="ai-control-select model-select-control"
          data-testid="ai-model-select"
          data-onboarding-id="ai-model-select"
          @click.stop="toggleModelMenu"
        >
          <span class="model-select-label">
            <Brain
              v-if="isThinkingModelName(workspace.config.modelName)"
              class="thinking-icon"
            />
            <span>{{ selectedModelLabel }}</span>
          </span>
          <ChevronDown />
        </button>
        <div
          v-if="modelMenuOpen"
          class="select-popup ai-model-popup"
          :style="{ width: `${modelDropdownWidthPx}px`, minWidth: `${modelDropdownWidthPx}px` }"
          @click.stop
        >
          <header>
            <input
              v-model="modelQuery"
              ref="modelSearchInputRef"
              type="search"
              :placeholder="t('ai.searchModel')"
              autocomplete="off"
              @keydown="handleModelKeydown"
            />
          </header>
          <div class="select-list">
            <button
              v-for="model in filteredModelOptions"
              :key="model.id"
              type="button"
              :data-onboarding-id="model.id === workspace.aiModelOptions[0]?.id ? 'ai-model-option' : undefined"
              :class="{ selected: workspace.config.modelName === model.id }"
              @click="selectModel(model.id)"
            >
              <Brain
                v-if="isThinkingModelName(model.id)"
                class="thinking-icon"
              />
              <Bot v-else />
              <span>{{ displayModelName(model) }}</span>
              <em>{{ model.detail }}</em>
              <Check v-if="workspace.config.modelName === model.id" />
            </button>
            <button
              v-for="model in filteredLockedModelOptions"
              :key="`locked-${model.id}`"
              type="button"
              class="locked-model-option"
              :title="lockedModelTooltip(model.tier || 'VIP')"
              disabled
            >
              <LockKeyhole class="locked-model-icon" />
              <span>{{ model.label }}</span>
              <em>{{ model.detail }}</em>
              <strong>{{ model.tier }}</strong>
            </button>
            <small v-if="filteredModelOptions.length === 0 && filteredLockedModelOptions.length === 0">
              {{ t('ai.noMatchingModels') }}
            </small>
          </div>
        </div>
      </div>
      <div class="input-action-buttons-container">
        <div
          v-if="contextUsage.contextWindow > 0"
          class="context-usage-ring"
          data-testid="ai-context-usage-ring"
          :title="contextUsageTooltip"
          :aria-label="contextUsageTooltip"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 22 22"
          >
            <circle
              cx="11"
              cy="11"
              r="9"
              fill="none"
              :stroke="contextUsageTrackColor"
              stroke-width="2.5"
            />
            <circle
              class="context-usage-progress"
              cx="11"
              cy="11"
              r="9"
              fill="none"
              :stroke="contextUsageColor"
              stroke-width="2.5"
              stroke-linecap="round"
              :stroke-dasharray="`${contextUsage.percent * 0.5655} 56.55`"
              transform="rotate(-90 11 11)"
            />
          </svg>
        </div>
        <button
          type="button"
          title="上传图片"
          :disabled="streaming"
          @click.stop="openImagePicker"
        >
          <Image />
        </button>
        <button
          type="button"
          class="file-upload-button"
          data-testid="ai-file-upload-button"
          title="上传文件"
          :disabled="streaming"
          @click.stop="handleFileUpload"
        >
          <Upload />
        </button>
        <button
          type="button"
          class="voice-input-button"
          :class="{ recording: voiceRecording, transcribing: voiceTranscribing }"
          data-testid="ai-voice-button"
          :title="voiceButtonTitle"
          :aria-pressed="voiceRecording ? 'true' : 'false'"
          :disabled="streaming || voiceTranscribing"
          @click.stop="toggleVoiceInput"
        >
          <span
            v-if="voiceRecording"
            class="voice-recording-animation"
            aria-hidden="true"
          >
            <span class="voice-recording-pulse"></span>
          </span>
          <LoaderCircle v-else-if="voiceTranscribing" />
          <Mic v-else />
        </button>
        <button
          type="submit"
          data-onboarding-id="ai-send-button"
        >
          <Square v-if="streaming" />
          <Send v-else />
        </button>
      </div>
    </div>
    <span
      v-if="inputPlaceholderNotice"
      class="input-placeholder-notice"
    >
      {{ inputPlaceholderNotice }}
    </span>
  </form>
</template>

<script setup lang="ts">
import {
  Bot,
  Brain,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  FolderGit2,
  Image,
  LoaderCircle,
  LockKeyhole,
  Mic,
  MinusSquare,
  Send,
  Server,
  Square,
  Upload,
  X
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

const {
  aiChatModeOptions,
  aiPanelComposerRuntime,
  aiPanelMode,
  allVisibleHostContextsSelected,
  applyCommand,
  applyContext,
  chatMode,
  clearHostContexts,
  commandKeyboardIndex,
  commandPopupOpen,
  commandQuery,
  commandSearchInputRef,
  commandTarget,
  classicClineActivity,
  composerIsEmpty,
  contextKeyboardIndex,
  contextLevel,
  contextPopupOpen,
  contextQuery,
  contextSearchInputRef,
  contextUsage,
  contextUsageColor,
  contextUsageTooltip,
  contextUsageTrackColor,
  currentChatMode,
  displayedOpenedHosts,
  displayModelName,
  dropActive,
  editableRef,
  filteredCommands,
  filteredContextOptions,
  filteredLockedModelOptions,
  filteredModelOptions,
  handleCommandKeydown,
  handleContextKeydown,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleEditableKeydown,
  handleFileUpload,
  handleModelKeydown,
  handleSend,
  hostContextsForPopup,
  inputPlaceholderNotice,
  isContextSelectedForPopup,
  isThinkingModelName,
  lockedModelTooltip,
  modelDropdownWidthPx,
  modelMenuOpen,
  modelQuery,
  modelSearchInputRef,
  modeDropdownWidthPx,
  modeMenuOpen,
  openContextCategory,
  openImagePicker,
  returnContextPopupToMain,
  saveEditableSelection,
  selectAllVisibleHostContexts,
  selectChatMode,
  selectedCommandRef,
  selectedContextCategory,
  selectedModelLabel,
  selectModel,
  showNoAvailableModelPrompt,
  streaming,
  t,
  toggleContextPopup,
  toggleModelMenu,
  toggleModeMenu,
  toggleVoiceInput,
  visibleContextCategories,
  voiceButtonTitle,
  voiceRecording,
  voiceTranscribing,
  workspace
} = useAiPanelRuntimeContext()
</script>
