<template>
  <aside
    class="ai-panel"
    :class="{ 'agent-mode': agentMode }"
    tabindex="-1"
    @click="closePopups()"
    @keydown="handlePanelKeydown"
  >
    <header class="ai-header">
      <div>
        <p class="eyebrow">AI Agent</p>
        <h2>{{ agentMode ? 'Agents 工作台' : '智能助手' }}</h2>
      </div>
      <span class="mock-badge">{{ workspace.config.modelProvider }}</span>
    </header>

    <div class="chat-scroll">
      <article
        v-for="message in workspace.chatMessages"
        :key="message.id"
        class="message"
        :class="message.role"
      >
        <span class="message-role">{{ message.role }}</span>
        <div
          v-if="editingMessageId === message.id"
          class="user-message-edit-container"
          @click.stop
        >
          <div class="message-edit-context-row">
            <button
              type="button"
              class="context-trigger-tag"
              title="添加上下文"
              @click.stop="openEditContextPopup"
            >
              {{ editHostContexts.length ? '@' : '@ 添加上下文' }}
            </button>
            <span
              v-for="context in editHostContexts"
              :key="context.id"
              class="context-tag"
            >
              {{ context.label }}
              <button
                type="button"
                title="移除上下文"
                @click.stop="removeEditHostContext(context.id)"
              >
                <X />
              </button>
            </span>
          </div>
          <div
            :ref="setEditEditableRef"
            class="chat-editable message-editable"
            :class="{ 'is-empty': !editDraft.trim() && !editImageInputParts.length && !editHostContexts.length }"
            data-placeholder="编辑消息"
            contenteditable="true"
            spellcheck="false"
            role="textbox"
            @input="handleEditEditableInput"
            @keydown="handleEditEditableKeydown"
            @paste="handleEditEditablePaste"
            @click="handleEditEditableClick"
          ></div>
          <div class="message-edit-actions">
            <button
              type="button"
              @click.stop="cancelMessageEdit"
            >
              取消
            </button>
            <button
              type="button"
              class="primary"
              @click.stop="confirmMessageEdit"
            >
              发送
            </button>
          </div>
        </div>
        <div
          v-else-if="message.role === 'user' && message.contentParts?.length"
          class="message-parts"
          title="编辑并重新发送"
          @click="startMessageEdit(message)"
        >
          <template
            v-for="(part, index) in message.contentParts"
            :key="`${part.type}-${index}`"
          >
            <span
              v-if="part.type === 'text'"
              class="message-text-part"
            >
              {{ part.text }}
            </span>
            <span
              v-else-if="part.type === 'image'"
              class="message-image-part"
            >
              <img
                :src="`data:${part.mediaType};base64,${part.data}`"
                :alt="part.name || 'uploaded image'"
              />
            </span>
            <span
              v-else
              class="mention-chip"
              :class="`mention-chip-${part.chipType}`"
            >
              <span
                v-if="part.chipType !== 'command'"
                class="mention-icon"
                v-html="iconMarkupByChipType[part.chipType]"
              ></span>
              <span class="mention-label">{{ getChipLabel(part) }}</span>
            </span>
          </template>
        </div>
        <p
          v-else
          :title="message.role === 'user' ? '编辑并重新发送' : undefined"
          @click="message.role === 'user' ? startMessageEdit(message) : undefined"
        >
          {{ message.text }}
        </p>
        <em v-if="message.state === 'streaming'">streaming</em>
        <div
          v-if="message.role === 'assistant'"
          class="message-actions"
        >
          <button
            :class="{ active: message.favorite }"
            title="收藏"
            @click="workspace.toggleMessageFavorite(message.id)"
          >
            <Star />
          </button>
          <button
            :class="{ active: message.feedback === 'up' }"
            title="有帮助"
            @click="workspace.setMessageFeedback(message.id, 'up')"
          >
            <ThumbsUp />
          </button>
          <button
            :class="{ active: message.feedback === 'down' }"
            title="无帮助"
            @click="workspace.setMessageFeedback(message.id, 'down')"
          >
            <ThumbsDown />
          </button>
          <button
            title="重试"
            @click="workspace.retryLastAssistantMessage()"
          >
            <RefreshCw />
          </button>
        </div>
      </article>
    </div>

    <section
      class="todo-inline-display"
      :class="{ 'has-focused': focusedTodo }"
    >
      <button
        class="todo-inline-header"
        @click.stop="todoExpanded = !todoExpanded"
      >
        <span class="todo-header-left">
          <span class="todo-title">
            <ListTodo class="todo-icon" />
            <strong class="todo-title-text">任务进度</strong>
            <span
              v-if="focusedTodo"
              class="focus-chain-badge"
            >
              <Zap />
              <span>Focus Chain</span>
            </span>
          </span>
          <span
            class="todo-progress-ratio"
            data-testid="todo-progress-ratio"
          >
            <span class="ratio-completed">{{ workspace.todoProgress.completed }}</span>
            <span class="ratio-separator">/</span>
            <span class="ratio-total">{{ workspace.todoProgress.total }}</span>
          </span>
        </span>
        <span class="todo-header-right">
          <span
            v-if="contextUsage.percent > 0"
            class="context-usage-indicator"
            :class="todoContextUsageLevel"
            data-testid="todo-context-usage-indicator"
          >
            <span class="context-bar-container">
              <span
                class="context-bar-fill"
                :style="{ width: `${contextUsage.percent}%` }"
              ></span>
            </span>
            <span class="context-text">{{ contextUsage.percent }}%</span>
          </span>
          <span class="todo-progress-indicator">
            <span class="progress-bar-container">
              <span
                class="progress-bar-fill"
                :style="{ width: `${workspace.todoProgress.percent}%` }"
              ></span>
            </span>
            <em class="progress-text">{{ workspace.todoProgress.percent }}%</em>
          </span>
          <span class="todo-controls">
            <ChevronUp
              v-if="todoExpanded"
              class="expand-icon"
            />
            <ChevronDown
              v-else
              class="expand-icon"
            />
          </span>
        </span>
      </button>
      <div
        v-if="todoExpanded && focusedTodo"
        class="focus-chain-highlight"
      >
        <span class="focused-task-inline">
          <Zap class="focused-icon" />
          <span class="focused-label">当前焦点</span>
          <strong class="focused-task-title">{{ focusedTodo.content }}</strong>
          <span
            v-if="focusedTodo.description"
            class="focused-task-desc"
          >
            {{ focusedTodo.description }}
          </span>
        </span>
      </div>
      <div
        v-if="todoExpanded"
        class="todo-compact-list"
      >
        <div class="todo-items single-list">
          <div
            v-for="(todo, index) in visibleTodos"
            :key="todo.id"
            class="todo-item"
            :class="[
              todo.status === 'in_progress' ? 'in-progress' : todo.status,
              {
                'has-description': !!todo.description,
                'is-focused': isTodoFocused(todo)
              }
            ]"
          >
            <div class="todo-content">
              <div class="todo-left">
                <span class="todo-index">{{ index + 1 }}.</span>
                <component
                  :is="todoStatusIcon(todo)"
                  class="status-icon under-index"
                  :class="{ 'focused-icon': isTodoFocused(todo), spinning: todo.status === 'in_progress' }"
                />
              </div>
              <div class="todo-text-container">
                <span class="todo-text">
                  {{ todo.content }}
                  <span
                    v-if="isTodoFocused(todo)"
                    class="todo-focus-badge"
                  >
                    <Zap />
                  </span>
                </span>
                <div
                  v-if="todo.description"
                  class="todo-description"
                >
                  {{ todo.description }}
                </div>
              </div>
            </div>
            <div
              v-if="todoShowSubtasks && todo.subtasks?.length"
              class="subtasks"
            >
              <div
                v-for="subtask in todo.subtasks"
                :key="subtask.id"
                class="subtask-item"
              >
                <Minus />
                <div class="subtask-text-container">
                  <span>{{ subtask.content }}</span>
                  <div
                    v-if="subtask.description"
                    class="subtask-description"
                  >
                    {{ subtask.description }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="model-strip">
      <span>{{ workspace.config.modelName }}</span>
      <em>{{ workspace.config.modelEndpoint || '本地 mock，无远端调用' }}</em>
    </div>

    <form
      class="chat-input"
      :class="{ 'drop-active': dropActive }"
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
          title="添加上下文"
          @click.stop="toggleContextPopup"
        >
          {{ workspace.selectedContexts.length ? '@' : '@ 添加上下文' }}
        </button>
        <span
          v-for="context in workspace.selectedContexts"
          :key="context.id"
          class="context-tag"
        >
          {{ context.label }}
          <button
            type="button"
            title="移除上下文"
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
          处理中
        </span>
      </div>

      <div class="input-controls-row">
        <div class="ai-control-menu-wrap">
          <button
            type="button"
            class="ai-control-select"
            :style="{ width: `${modeSelectWidthPx}px` }"
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
        <div class="ai-control-menu-wrap">
          <button
            type="button"
            class="ai-control-select model-select-control"
            :style="{ width: `${modelSelectWidthPx}px` }"
            data-testid="ai-model-select"
            data-onboarding-id="ai-model-select"
            @click.stop="toggleModelMenu"
          >
            <span class="model-select-label">
              <Brain
                v-if="isThinkingModelName(workspace.config.modelName)"
                class="thinking-icon"
              />
              <span>{{ displayModelName(workspace.config.modelName) }}</span>
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
                placeholder="搜索模型"
                autocomplete="off"
                @keydown="handleModelKeydown"
              />
            </header>
            <div class="select-list">
              <button
                v-for="model in filteredModelOptions"
                :key="model.id"
                type="button"
                :data-onboarding-id="model.id === aiModelOptions[0]?.id ? 'ai-model-option' : undefined"
                :class="{ selected: workspace.config.modelName === model.id }"
                @click="selectModel(model.id)"
              >
                <Brain
                  v-if="isThinkingModelName(model.label)"
                  class="thinking-icon"
                />
                <Bot v-else />
                <span>{{ displayModelName(model.label) }}</span>
                <em>{{ model.detail }}</em>
                <Check v-if="workspace.config.modelName === model.id" />
              </button>
              <button
                v-for="model in filteredLockedModelOptions"
                :key="`locked-${model.id}`"
                type="button"
                class="locked-model-option"
                :title="lockedModelTooltip(model.tier)"
                disabled
              >
                <LockKeyhole class="locked-model-icon" />
                <span>{{ model.label }}</span>
                <em>{{ model.detail }}</em>
                <strong>{{ model.tier }}</strong>
              </button>
              <small v-if="filteredModelOptions.length === 0 && filteredLockedModelOptions.length === 0">
                没有匹配的模型
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
        </div>
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
            title="返回"
            @click="returnContextPopupToMain"
          >
            <ChevronLeft />
          </button>
          <input
            v-model="contextQuery"
            ref="contextSearchInputRef"
            type="search"
            :placeholder="contextLevel === 'main' ? '搜索上下文' : '搜索条目'"
            autocomplete="off"
            @keydown="handleContextKeydown"
          />
        </header>
        <div
          v-if="contextLevel === 'main'"
          class="select-list"
        >
          <button
            v-for="(host, index) in displayedOpenedHosts"
            :key="host.id"
            type="button"
            :data-onboarding-id="host.id === 'opened-local' ? 'ai-localhost-option' : undefined"
            :class="{ selected: isContextSelectedForPopup(host), 'keyboard-selected': contextKeyboardIndex === index }"
            @mouseover="contextKeyboardIndex = index"
            @click="applyContext(host)"
          >
            <Server />
            <span>{{ host.label }}</span>
            <em>{{ host.detail }}</em>
            <Check v-if="isContextSelectedForPopup(host)" />
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
            :data-onboarding-id="option.id === 'opened-local' || option.label === '127.0.0.1' ? 'ai-localhost-option' : undefined"
            :class="{ selected: isContextSelectedForPopup(option), 'keyboard-selected': contextKeyboardIndex === index }"
            @mouseover="contextKeyboardIndex = index"
            @click="applyContext(option)"
          >
            <FolderGit2 v-if="option.kind === 'docs' && option.contextType === 'dir'" />
            <FileText v-else-if="option.kind === 'docs'" />
            <span>{{ option.label }}</span>
            <em>{{ option.detail }}</em>
            <ChevronRight v-if="option.kind === 'docs' && option.contextType === 'dir'" />
            <Check v-else-if="isContextSelectedForPopup(option)" />
          </button>
          <small v-if="filteredContextOptions.length === 0">没有匹配的上下文</small>
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
            <span>{{ allVisibleHostContextsSelected ? '取消全选' : '全选' }}</span>
          </button>
          <button
            v-if="hostContextsForPopup.length > 0"
            type="button"
            class="batch-action-btn"
            @click.stop="clearHostContexts"
          >
            <span>清空选择</span>
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
            placeholder="搜索命令"
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
          <small v-if="filteredCommands.length === 0">没有匹配的命令</small>
        </div>
      </div>

      <button
        type="button"
        title="上传图片"
        :disabled="streaming"
        @click.stop="openImagePicker"
      >
        <Image />
      </button>
      <input
        ref="imageInputRef"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        @change="handleImageSelected"
      />
      <div
        ref="editableRef"
        class="chat-editable"
        :class="{ 'is-empty': !draft.trim() && !workspace.selectedContexts.length && !selectedCommand }"
        data-placeholder="描述你的运维目标"
        data-testid="ai-message-input"
        data-onboarding-id="ai-input-editable"
        contenteditable="true"
        spellcheck="false"
        role="textbox"
        @click="handleEditableClick"
        @input="handleEditableInput"
        @keydown="handleEditableKeydown"
        @keyup="saveEditableSelection"
        @mouseup="saveEditableSelection"
        @paste="handleEditablePaste"
      ></div>
      <button
        type="button"
        class="file-placeholder-button"
        data-testid="ai-file-upload-button"
        title="上传文件暂未启用"
        :disabled="streaming"
        @click.stop="showFileUploadPlaceholder"
      >
        <Upload />
      </button>
      <button
        type="button"
        class="voice-placeholder-button"
        data-testid="ai-voice-button"
        title="语音输入暂未启用"
        :disabled="streaming"
        @click.stop="showVoicePlaceholder"
      >
        <Mic />
      </button>
      <button
        type="submit"
        data-onboarding-id="ai-send-button"
      >
        <Square v-if="streaming" />
        <Send v-else />
      </button>
      <span
        v-if="inputPlaceholderNotice"
        class="input-placeholder-notice"
      >
        {{ inputPlaceholderNotice }}
      </span>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  Bot,
  Brain,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  LoaderCircle,
  FileText,
  FolderGit2,
  Image,
  ListTodo,
  LockKeyhole,
  Mic,
  MinusSquare,
  Minus,
  RefreshCw,
  Send,
  Server,
  Sparkles,
  Square,
  Star,
  History,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import {
  aiChatModeOptions,
  aiContextCategories,
  aiModelOptions,
  lockedAiModelOptions,
  aiOpenedHosts,
  type AiChatMode,
  type AiContextKind,
  type AiContextOption,
  type KnowledgeNode
} from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  AiChatChipContentPart,
  AiChipContentPart,
  AiCommandChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  AiSkillChipContentPart,
  AiSupportedImageType
} from '@/stores/workspace'
import type { TodoItem } from '@/stores/workspace'

defineProps<{ agentMode?: boolean }>()

const workspace = useWorkspaceStore()
const draft = ref('')
const imageInputParts = ref<AiImageContentPart[]>([])
const editableRef = ref<HTMLElement | null>(null)
const editEditableRef = ref<HTMLElement | null>(null)
const editingMessageId = ref<string | null>(null)
const editDraft = ref('')
const editImageInputParts = ref<AiImageContentPart[]>([])
const editHostContexts = ref<AiContextOption[]>([])
const imageInputRef = ref<HTMLInputElement | null>(null)
const modelSearchInputRef = ref<HTMLInputElement | null>(null)
const contextSearchInputRef = ref<HTMLInputElement | null>(null)
const commandSearchInputRef = ref<HTMLInputElement | null>(null)
const savedRange = ref<Range | null>(null)
const editSavedRange = ref<Range | null>(null)
const contextPopupOpen = ref(false)
const commandPopupOpen = ref(false)
const contextTarget = ref<'main' | 'edit'>('main')
const commandTarget = ref<'main' | 'edit'>('main')
const contextLevel = ref<'main' | AiContextKind>('main')
const contextQuery = ref('')
const commandQuery = ref('')
const contextKeyboardIndex = ref(-1)
const commandKeyboardIndex = ref(-1)
const docsCurrentRelDir = ref('')
const docsDirStack = ref<string[]>([])
const todoExpanded = ref(true)
const chatMode = ref<AiChatMode>('agent')
const modeMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const modelQuery = ref('')
const dropActive = ref(false)
const syncingFromEditable = ref(false)
const inputPlaceholderNotice = ref('')
let inputPlaceholderNoticeTimer: number | undefined
const supportedImageTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const imagePartMediaTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const maxImageBytes = 10 * 1024 * 1024
const maxHostContexts = 5
const todoMaxItems = 20
const todoShowSubtasks = true
const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))
const focusedTodo = computed(() => workspace.todoItems.find((todo) => todo.isFocused || todo.status === 'in_progress') || null)
const currentChatMode = computed(() => aiChatModeOptions.find((option) => option.id === chatMode.value) || aiChatModeOptions[0])
const focusedTodoId = computed(() => focusedTodo.value?.id || null)
const visibleTodos = computed(() => workspace.todoItems.slice(0, todoMaxItems))

const isTodoFocused = (todo: TodoItem) => {
  if (focusedTodoId.value) return todo.id === focusedTodoId.value
  if (todo.isFocused) return true
  return todo.status === 'in_progress'
}
const todoStatusIcon = (todo: TodoItem) => {
  if (todo.status === 'in_progress') return LoaderCircle
  if (todo.status === 'completed') return Check
  return Square
}

const closeModelMenu = () => {
  modelMenuOpen.value = false
  modelQuery.value = ''
}

type AiCommandOption = {
  id: string
  label: string
  name: string
  path: string
  command: string
}

const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
  editEditableRef.value = el instanceof HTMLElement ? el : null
}

const selectedContextCategory = computed(() => aiContextCategories.find((category) => category.id === contextLevel.value))
const docsCurrentNodes = computed(() => {
  if (!docsCurrentRelDir.value) return workspace.knowledgeTree
  const currentNode = workspace.findKnowledgeNode(docsCurrentRelDir.value)
  return currentNode?.type === 'dir' ? currentNode.children || [] : []
})
const docsContextOptions = computed<AiContextOption[]>(() =>
  docsCurrentNodes.value.map((node) => ({
    id: `${node.type === 'dir' ? 'kb-dir' : 'kb-doc'}:${node.relPath}`,
    kind: 'docs',
    label: node.title,
    detail: node.type === 'dir' ? 'dir' : node.relPath,
    relPath: node.relPath,
    contextType: node.type
  }))
)
const removeFileExtension = (filename: string) => {
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? filename : filename.slice(0, lastDot)
}
const commandOptions = computed<AiCommandOption[]>(() => {
  const commandDir = workspace.findKnowledgeNode('commands')
  const commandFiles = commandDir?.type === 'dir' ? commandDir.children || [] : []
  return commandFiles
    .filter((node) => node.type === 'file')
    .map((node) => {
      const name = removeFileExtension(node.title)
      return {
        id: node.relPath,
        label: `/${name}`,
        name,
        path: node.relPath,
        command: `/${name}`
      }
    })
})
const displayedOpenedHosts = computed(() => {
  if (chatMode.value !== 'agent') return []
  const keyword = contextQuery.value.trim().toLowerCase()
  return aiOpenedHosts
    .filter((host) => !keyword || `${host.label} ${host.detail || ''}`.toLowerCase().includes(keyword))
    .slice(0, 4)
})
const visibleContextCategories = computed(() => aiContextCategories.filter((category) => category.id !== 'hosts' || chatMode.value === 'agent'))
const filteredContextOptions = computed(() => {
  const options =
    contextLevel.value === 'docs'
      ? docsContextOptions.value
      : contextLevel.value === 'skills'
        ? workspace.aiSkillContextOptions
        : selectedContextCategory.value?.options || []
  const keyword = contextQuery.value.trim().toLowerCase()
  if (!keyword) return options
  return options.filter((option) => `${option.label} ${option.detail || ''}`.toLowerCase().includes(keyword))
})
const visibleHostContextOptions = computed(() => filteredContextOptions.value.filter((option) => option.kind === 'hosts'))
const hostContextsForPopup = computed(() =>
  contextTarget.value === 'edit' ? editHostContexts.value : workspace.selectedContexts.filter((context) => context.kind === 'hosts')
)
const allVisibleHostContextsSelected = computed(() => {
  const hosts = visibleHostContextOptions.value
  return hosts.length > 0 && hosts.every((host) => hostContextsForPopup.value.some((context) => context.id === host.id))
})
const filteredCommands = computed(() => {
  const keyword = commandQuery.value.trim().toLowerCase()
  if (!keyword) return commandOptions.value
  return commandOptions.value.filter((preset) => preset.name.toLowerCase().includes(keyword))
})
const selectedCommand = computed(() => commandOptions.value.find((preset) => preset.id === workspace.selectedCommandId))
const SELECT_CHROME_PX = 48
const THINKING_ICON_SELECT_EXTRA_PX = 22
const DROPDOWN_ROW_CHROME_PX = 52
const LOCK_ROW_ICON_EXTRA_PX = 22
const VIP_TAG_ROW_EXTRA_PX = 36

const displayModelName = (modelName: string) => modelName.replace(/-Thinking$/, '')
const isThinkingModelName = (modelName: string) => modelName.endsWith('-Thinking')
const lockedModelTooltip = (tier: string) => `模型已锁定，升级 ${tier} 后可用`
const matchesModelQuery = (model: { id: string; label: string; detail?: string; tier?: string }) => {
  const keyword = modelQuery.value.trim().toLowerCase()
  if (!keyword) return true
  return `${model.id} ${model.label} ${displayModelName(model.label)} ${model.detail || ''} ${model.tier || ''}`.toLowerCase().includes(keyword)
}
const filteredModelOptions = computed(() => aiModelOptions.filter(matchesModelQuery))
const filteredLockedModelOptions = computed(() => lockedAiModelOptions.filter(matchesModelQuery))

const measureUiTextWidthPx = (text: string) => {
  if (!text) return 0
  if (typeof document === 'undefined') return text.length * 7
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return text.length * 7
  context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
  return context.measureText(text).width
}

const modeSelectWidthPx = computed(() => {
  const width = Math.ceil(measureUiTextWidthPx(currentChatMode.value.label)) + SELECT_CHROME_PX
  return Math.min(Math.max(width, 72), 160)
})

const modeDropdownWidthPx = computed(() => {
  const maxWidth = aiChatModeOptions.reduce((max, option) => {
    const width = Math.ceil(measureUiTextWidthPx(option.label)) + DROPDOWN_ROW_CHROME_PX
    return Math.max(max, width)
  }, 0)
  return Math.min(Math.max(maxWidth, 96), 400)
})

const modelSelectWidthPx = computed(() => {
  const option = aiModelOptions.find((model) => model.id === workspace.config.modelName)
  const raw = option?.label || workspace.config.modelName
  const thinkingExtra = isThinkingModelName(raw) ? THINKING_ICON_SELECT_EXTRA_PX : 0
  const width = Math.ceil(measureUiTextWidthPx(displayModelName(raw))) + SELECT_CHROME_PX + thinkingExtra
  return Math.min(Math.max(width, 88), 360)
})

const modelDropdownWidthPx = computed(() => {
  const availableMaxWidth = aiModelOptions.reduce((max, model) => {
    const thinkingExtra = isThinkingModelName(model.label) ? THINKING_ICON_SELECT_EXTRA_PX : 0
    const width = Math.ceil(measureUiTextWidthPx(displayModelName(model.label))) + DROPDOWN_ROW_CHROME_PX + thinkingExtra
    return Math.max(max, width)
  }, 0)
  const lockedMaxWidth = lockedAiModelOptions.reduce((max, model) => {
    const width = Math.ceil(measureUiTextWidthPx(model.label)) + DROPDOWN_ROW_CHROME_PX + LOCK_ROW_ICON_EXTRA_PX + VIP_TAG_ROW_EXTRA_PX
    return Math.max(max, width)
  }, 0)
  const maxWidth = Math.max(availableMaxWidth, lockedMaxWidth)
  return Math.min(Math.max(maxWidth, 120), 720)
})
const selectedCommandRef = computed(() => {
  if (workspace.selectedCommandRef) return workspace.selectedCommandRef
  if (selectedCommand.value) {
    return {
      command: selectedCommand.value.command,
      label: selectedCommand.value.label,
      path: selectedCommand.value.path
    }
  }
  if (workspace.selectedCommandId) {
    return {
      command: workspace.selectedCommandId,
      label: workspace.selectedCommandId
    }
  }
  return null
})

const estimateTextTokens = (value: string | undefined | null) => {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return 0
  const cjkCount = text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  return Math.ceil(cjkCount * 0.75 + (text.length - cjkCount) / 4)
}

const estimateImageTokens = (part: { data?: string }) => 85 + Math.ceil((part.data?.length || 0) / 2048)

const estimateChipTokens = (part: AiChipContentPart) => {
  if (part.chipType === 'doc') return estimateTextTokens(`${part.ref.name || ''} ${part.ref.relPath || part.ref.absPath}`)
  if (part.chipType === 'chat') return estimateTextTokens(`${part.ref.taskId} ${part.ref.title || ''}`)
  if (part.chipType === 'command') return estimateTextTokens(`${part.ref.command} ${part.ref.label || ''} ${part.ref.path || ''}`)
  return estimateTextTokens(`${part.ref.skillName} ${part.ref.description || ''}`)
}

const estimateContentPartTokens = (part: AiContentPart) => {
  if (part.type === 'text') return estimateTextTokens(part.text)
  if (part.type === 'image') return estimateImageTokens(part)
  return estimateChipTokens(part)
}

const estimateContextTokens = (context: AiContextOption) => {
  const metadataTokens = estimateTextTokens(`${context.kind} ${context.label} ${context.detail || ''} ${context.relPath || ''}`)
  return context.kind === 'images' && context.data ? metadataTokens + estimateImageTokens({ data: context.data }) : metadataTokens
}

const estimateMessageTokens = (message: { role: string; text: string; contentParts?: AiContentPart[]; hosts?: AiContextOption[] }) => {
  if (message.role === 'user' && message.contentParts?.length) {
    return (
      message.contentParts.reduce((sum, part) => sum + estimateContentPartTokens(part), 0) +
      (message.hosts || []).reduce((sum, context) => sum + estimateContextTokens(context), 0)
    )
  }
  return estimateTextTokens(message.text)
}

const resolveLocalContextWindow = (modelName: string) => {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('mini') || normalized.includes('small')) return 64000
  if (normalized.includes('long')) return 200000
  return 128000
}

const contextUsage = computed(() => {
  const contextWindow = resolveLocalContextWindow(workspace.config.modelName)
  const historyTokens = workspace.chatMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  const draftTokens = estimateTextTokens(draft.value)
  const selectedContextTokens = workspace.selectedContexts.reduce((sum, context) => sum + estimateContextTokens(context), 0)
  const selectedImageTokens = imageInputParts.value.reduce((sum, part) => sum + estimateImageTokens(part), 0)
  const selectedCommandTokens = selectedCommandRef.value
    ? estimateTextTokens(`${selectedCommandRef.value.command} ${selectedCommandRef.value.label || ''} ${selectedCommandRef.value.path || ''}`)
    : 0
  const used = historyTokens + draftTokens + selectedContextTokens + selectedImageTokens + selectedCommandTokens
  return {
    used,
    contextWindow,
    percent: Math.min(100, Math.round((used / contextWindow) * 100))
  }
})

const contextUsageColor = computed(() => {
  const percent = contextUsage.value.percent
  if (percent >= 90) return '#ef4444'
  if (percent >= 70) return '#f59e0b'
  return '#3b82f6'
})

const todoContextUsageLevel = computed(() => {
  const percent = contextUsage.value.percent
  if (percent >= 90) return 'maximum'
  if (percent >= 70) return 'critical'
  if (percent >= 50) return 'warning'
  return 'normal'
})

const contextUsageTrackColor = computed(() => 'rgba(128, 128, 128, 0.2)')

const contextUsageTooltip = computed(() => {
  const { used, contextWindow, percent } = contextUsage.value
  const formatK = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
    return `${value}`
  }
  return `${percent}% - ${formatK(used)} / ${formatK(contextWindow)} context used`
})

const commandIconMarkup =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path></svg>'

const iconMarkupByContextKind: Record<AiContextKind, string> = {
  hosts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>',
  docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>',
  images: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20"></path></svg>',
  skills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z"></path><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"></path></svg>',
  chats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>'
}

const iconMarkupByChipType: Record<AiChipContentPart['chipType'], string> = {
  doc: iconMarkupByContextKind.docs,
  chat: iconMarkupByContextKind.chats,
  command: commandIconMarkup,
  skill: iconMarkupByContextKind.skills
}

const createIconElement = (kind: AiContextKind | 'command') => {
  const span = document.createElement('span')
  span.className = 'mention-icon'
  span.innerHTML = kind === 'command' ? commandIconMarkup : iconMarkupByContextKind[kind]
  return span
}

const mediaTypeFromContext = (context: AiContextOption): AiSupportedImageType =>
  imagePartMediaTypes.includes(context.mediaType as AiSupportedImageType) ? (context.mediaType as AiSupportedImageType) : 'image/png'

const getChipLabel = (part: AiChipContentPart) => {
  if (part.chipType === 'doc') return part.ref.name || part.ref.absPath
  if (part.chipType === 'command') return part.ref.label || part.ref.command
  if (part.chipType === 'skill') return part.ref.skillName
  return part.ref.title || part.ref.taskId
}

const chipPartFromContext = (context: AiContextOption): AiChipContentPart | null => {
  if (context.kind === 'docs') {
    const absPath = context.relPath || context.detail || context.label
    return {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath,
        relPath: context.relPath,
        name: context.label,
        type: 'file'
      }
    }
  }
  if (context.kind === 'chats') {
    return {
      type: 'chip',
      chipType: 'chat',
      ref: {
        taskId: context.id.replace(/^chat:/, ''),
        title: context.label
      }
    }
  }
  if (context.kind === 'skills') {
    return {
      type: 'chip',
      chipType: 'skill',
      ref: {
        skillName: context.label,
        description: context.detail
      }
    }
  }
  return null
}

const imagePartFromContext = (context: AiContextOption): AiImageContentPart | null => {
  if (context.kind !== 'images' || !context.data) return null
  return {
    type: 'image',
    mediaType: mediaTypeFromContext(context),
    data: context.data,
    name: context.label
  }
}

const cloneContextOption = (context: AiContextOption): AiContextOption => ({ ...context })

const hostContextFromOption = (context: AiContextOption): AiContextOption | null =>
  context.kind === 'hosts' ? cloneContextOption(context) : null

const isLocalhostContext = (context: AiContextOption) => context.label === '127.0.0.1' || context.id === 'opened-local'

const toggleHostContextInList = (contexts: AiContextOption[], context: AiContextOption) => {
  const host = hostContextFromOption(context)
  if (!host) return contexts
  if (contexts.some((item) => item.id === host.id)) {
    return contexts.filter((item) => item.id !== host.id)
  }
  let nextContexts = [...contexts]
  if (!isLocalhostContext(host)) {
    nextContexts = nextContexts.filter((item) => !isLocalhostContext(item))
  }
  if (nextContexts.filter((item) => item.kind === 'hosts').length >= maxHostContexts) {
    return nextContexts
  }
  return [...nextContexts, host]
}

const removeEditHostContext = (id: string) => {
  editHostContexts.value = editHostContexts.value.filter((context) => context.id !== id)
}

const openEditContextPopup = () => {
  openContextPopupForTarget('edit')
}

const setChipElementAttributes = (chip: HTMLElement, part: AiChipContentPart) => {
  chip.dataset.chipType = part.chipType
  chip.title = getChipLabel(part)
  if (part.chipType === 'doc') {
    chip.dataset.absPath = part.ref.absPath
    if (part.ref.relPath) chip.dataset.relPath = part.ref.relPath
    if (part.ref.name) chip.dataset.name = part.ref.name
    if (part.ref.type) chip.dataset.docType = part.ref.type
    return
  }
  if (part.chipType === 'chat') {
    chip.dataset.chatId = part.ref.taskId
    if (part.ref.title) chip.dataset.title = part.ref.title
    return
  }
  if (part.chipType === 'command') {
    chip.dataset.command = part.ref.command
    if (part.ref.label) chip.dataset.label = part.ref.label
    if (part.ref.path) chip.dataset.path = part.ref.path
    return
  }
  chip.dataset.skillName = part.ref.skillName
  if (part.ref.description) chip.dataset.description = part.ref.description
}

const createChipElement = (
  part: AiChipContentPart,
  options: { removableContextId?: string; removableCommand?: boolean; removablePart?: boolean } = {}
) => {
  const chip = document.createElement('span')
  chip.className = `mention-chip mention-chip-${part.chipType}`
  chip.contentEditable = 'false'
  setChipElementAttributes(chip, part)

  if (options.removableContextId) chip.dataset.contextId = options.removableContextId
  if (options.removableCommand) chip.dataset.commandChip = 'true'

  if (part.chipType !== 'command') {
    const icon = document.createElement('span')
    icon.className = 'mention-icon'
    icon.innerHTML = iconMarkupByChipType[part.chipType]
    chip.appendChild(icon)
  }

  const label = document.createElement('span')
  label.className = 'mention-label'
  label.textContent = getChipLabel(part)
  chip.appendChild(label)

  if (options.removableContextId || options.removableCommand || options.removablePart) {
    const remove = document.createElement('button')
    remove.type = 'button'
    if (options.removableContextId) {
      remove.dataset.removeContext = 'true'
      remove.dataset.contextId = options.removableContextId
      remove.title = '移除上下文'
    } else if (options.removableCommand) {
      remove.dataset.removeCommand = 'true'
      remove.title = '移除命令'
    } else {
      remove.dataset.removeChip = 'true'
      remove.title = '移除上下文'
    }
    remove.textContent = 'x'
    chip.appendChild(remove)
  }

  return chip
}

const createContextChipElement = (context: AiContextOption) => {
  const chipPart = chipPartFromContext(context)
  if (chipPart) return createChipElement(chipPart, { removableContextId: context.id })

  const chip = document.createElement('span')
  chip.className = `mention-chip mention-chip-${context.kind}`
  chip.contentEditable = 'false'
  chip.dataset.contextId = context.id
  chip.dataset.contextKind = context.kind
  chip.title = context.detail || context.label
  chip.appendChild(createIconElement(context.kind))

  if (context.kind === 'images' && context.data) {
    const image = document.createElement('img')
    image.className = 'mention-image-thumb'
    image.src = `data:${context.mediaType || 'image/png'};base64,${context.data}`
    image.alt = ''
    chip.appendChild(image)
  }

  const label = document.createElement('span')
  label.className = 'mention-label'
  label.textContent = context.label
  chip.appendChild(label)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.dataset.removeContext = 'true'
  remove.dataset.contextId = context.id
  remove.title = '移除上下文'
  remove.textContent = 'x'
  chip.appendChild(remove)

  return chip
}

const createCommandChipElement = () => {
  if (!selectedCommandRef.value) return null
  return createChipElement(
    {
      type: 'chip',
      chipType: 'command',
      ref: {
        command: selectedCommandRef.value.command,
        label: selectedCommandRef.value.label,
        path: selectedCommandRef.value.path
      }
    },
    { removableCommand: true }
  )
}

const createImageElement = (part: AiImageContentPart) => {
  const wrapper = document.createElement('span')
  wrapper.className = 'image-preview-wrapper'
  wrapper.contentEditable = 'false'
  wrapper.dataset.imageType = 'true'
  wrapper.dataset.mediaType = part.mediaType
  wrapper.dataset.imageData = part.data
  if (part.name) wrapper.dataset.name = part.name

  const image = document.createElement('img')
  image.className = 'image-preview-thumbnail'
  image.src = `data:${part.mediaType};base64,${part.data}`
  image.alt = part.name || 'uploaded image'
  wrapper.appendChild(image)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'image-remove'
  remove.dataset.removeImage = 'true'
  remove.title = '移除图片'
  remove.textContent = 'x'
  wrapper.appendChild(remove)

  return wrapper
}

const insertImageIntoEditableCursor = (editable: HTMLElement | null, part: AiImageContentPart, onInserted: () => void) => {
  if (!editable) return
  editable.focus()

  const appendImageAtEnd = () => {
    const imageElement = createImageElement(part)
    editable.appendChild(imageElement)
    editable.appendChild(document.createTextNode(' '))
    onInserted()
  }

  const selection = window.getSelection()
  if (!selection) {
    appendImageAtEnd()
    return
  }
  let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) {
    const endRange = document.createRange()
    endRange.selectNodeContents(editable)
    endRange.collapse(false)
    selection.removeAllRanges()
    selection.addRange(endRange)
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  }
  if (!range) {
    appendImageAtEnd()
    return
  }

  const imageElement = createImageElement(part)
  range.deleteContents()
  range.insertNode(imageElement)
  const spacer = document.createTextNode(' ')
  imageElement.after(spacer)

  const nextRange = document.createRange()
  nextRange.setStart(spacer, 1)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)

  onInserted()
}

const insertImageAtEditableCursor = (part: AiImageContentPart) => {
  insertImageIntoEditableCursor(editableRef.value, part, () => {
    imageInputParts.value = [...imageInputParts.value, part]
    handleEditableInput()
  })
}

const insertImageAtEditCursor = (part: AiImageContentPart) => {
  insertImageIntoEditableCursor(editEditableRef.value, part, () => {
    editImageInputParts.value = [...editImageInputParts.value, part]
    handleEditEditableInput()
  })
}

const insertContextAtEditCursor = (context: AiContextOption) => {
  const imagePart = imagePartFromContext(context)
  if (imagePart) {
    insertImageAtEditCursor(imagePart)
    return true
  }

  const chipPart = chipPartFromContext(context)
  if (!chipPart) return false
  restoreEditSelection()
  const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
  insertChipIntoEditableCursor(editTarget, chipPart, handleEditEditableInput, '@')
  return true
}

const insertImageFilesIntoEdit = async (files: File[]) => {
  for (const file of files) {
    const part = await processImageFile(file)
    if (part) insertImageAtEditCursor(part)
  }
}

const getImageFilesFromClipboard = (event: ClipboardEvent) =>
  Array.from(event.clipboardData?.items || [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

const insertPlainTextIntoEditableCursor = (editable: HTMLElement | null, text: string, onInserted: () => void) => {
  if (!editable || !text) return
  const selection = window.getSelection()
  if (!selection) return
  let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) {
    editable.appendChild(document.createTextNode(text))
    onInserted()
    return
  }
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range = document.createRange()
  range.setStart(textNode, text.length)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  onInserted()
}

const insertPlainTextAtEditCursor = (text: string) => {
  insertPlainTextIntoEditableCursor(editEditableRef.value, text, handleEditEditableInput)
}

const removeTokenBeforeRange = (range: Range, token: string) => {
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return
  const textNode = range.startContainer as Text
  const offset = range.startOffset
  if (offset > 0 && textNode.data[offset - 1] === token) {
    textNode.data = textNode.data.slice(0, offset - 1) + textNode.data.slice(offset)
    range.setStart(textNode, offset - 1)
    range.collapse(true)
  }
}

const removeTokenFromEditableCursor = (
  editable: HTMLElement | null,
  rangeRef: { value: Range | null },
  token: string,
  onRemoved: () => void
) => {
  if (!editable) return
  const selection = window.getSelection()
  if (!selection) return
  if (rangeRef.value) {
    selection.removeAllRanges()
    selection.addRange(rangeRef.value.cloneRange())
  }
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) return
  removeTokenBeforeRange(range, token)
  selection.removeAllRanges()
  selection.addRange(range)
  onRemoved()
}

const insertChipIntoEditableCursor = (editable: HTMLElement | null, part: AiChipContentPart, onInserted: () => void, triggerToken = '/') => {
  if (!editable) return
  editable.focus()

  const insertAtEnd = () => {
    if (editable.lastChild) editable.appendChild(document.createTextNode(' '))
    const chip = createChipElement(part, { removablePart: true })
    editable.appendChild(chip)
    editable.appendChild(document.createTextNode(' '))
    onInserted()
  }

  const selection = window.getSelection()
  if (!selection) {
    insertAtEnd()
    return
  }
  let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) {
    const endRange = document.createRange()
    endRange.selectNodeContents(editable)
    endRange.collapse(false)
    selection.removeAllRanges()
    selection.addRange(endRange)
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  }
  if (!range) {
    insertAtEnd()
    return
  }

  removeTokenBeforeRange(range, triggerToken)
  const chip = createChipElement(part, { removablePart: true })
  range.deleteContents()
  range.insertNode(chip)
  const spacer = document.createTextNode(' ')
  chip.after(spacer)

  const nextRange = document.createRange()
  nextRange.setStart(spacer, 1)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  onInserted()
}

const saveEditSelection = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editEditableRef.value) return
  const range = selection.getRangeAt(0)
  if (!editEditableRef.value.contains(range.startContainer)) return
  editSavedRange.value = range.cloneRange()
}

const restoreEditSelection = () => {
  const selection = window.getSelection()
  if (!selection || !editSavedRange.value) return
  selection.removeAllRanges()
  selection.addRange(editSavedRange.value)
}

const getActiveEditableRange = (editable: HTMLElement | null, fallbackRange?: Range | null): Range | null => {
  const selection = window.getSelection()
  if (!editable) return null
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0)
    if (editable.contains(range.startContainer)) return range
  }
  if (fallbackRange && editable.contains(fallbackRange.startContainer)) return fallbackRange
  return null
}

const getCharBeforeCaret = (editable: HTMLElement | null, fallbackRange?: Range | null): string | null => {
  const range = getActiveEditableRange(editable, fallbackRange)
  if (!range) return null
  const container = range.startContainer
  const offset = range.startOffset
  if (container.nodeType === Node.TEXT_NODE) {
    const text = (container as Text).data
    if (offset <= 0 || offset > text.length) return null
    return text[offset - 1] ?? null
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const previousNode = (container as Element).childNodes[offset - 1]
    if (!previousNode) return null
    if (previousNode.nodeType === Node.TEXT_NODE) {
      const text = (previousNode as Text).data
      return text.length > 0 ? text[text.length - 1] : null
    }
    const text = (previousNode as HTMLElement).textContent || ''
    return text.length > 0 ? text[text.length - 1] : null
  }
  return null
}

const shouldTriggerCommandPopupForSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
  const range = getActiveEditableRange(editable, fallbackRange)
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return false
  const textNode = range.startContainer as Text
  const text = textNode.data
  const offset = range.startOffset
  if (offset <= 0 || offset > text.length || text[offset - 1] !== '/') return false
  const beforeChar = offset - 2 >= 0 ? text[offset - 2] : null
  const afterChar = offset < text.length ? text[offset] : null
  const isBoundaryOrWhitespace = (char: string | null) => char === null || /\s/.test(char)
  return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
}

const shouldTriggerCommandPopupForPendingSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
  const range = getActiveEditableRange(editable, fallbackRange)
  if (!range) return false
  const isBoundaryOrWhitespace = (char: string | null) => char === null || /\s/.test(char)

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = (range.startContainer as Text).data
    const offset = range.startOffset
    const beforeChar = offset - 1 >= 0 ? text[offset - 1] : null
    const afterChar = offset < text.length ? text[offset] : null
    return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as Element
    const previousNode = element.childNodes[range.startOffset - 1]
    const nextNode = element.childNodes[range.startOffset]
    const previousText = previousNode?.textContent || ''
    const nextText = nextNode?.textContent || ''
    const beforeChar = previousText ? previousText[previousText.length - 1] : null
    const afterChar = nextText ? nextText[0] : null
    return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
  }

  return false
}

const openCommandPopupForTarget = (target: 'main' | 'edit') => {
  if (target === 'edit') {
    saveEditSelection()
  } else {
    saveEditableSelection()
  }
  commandTarget.value = target
  commandPopupOpen.value = true
  closeContextPopup()
  modeMenuOpen.value = false
  closeModelMenu()
  commandQuery.value = ''
  commandKeyboardIndex.value = -1
  void nextTick(() => commandSearchInputRef.value?.focus())
}

function openContextPopupForTarget(target: 'main' | 'edit', level: 'main' | AiContextKind = 'main') {
  if (target === 'edit') {
    saveEditSelection()
  } else {
    saveEditableSelection()
  }
  contextTarget.value = target
  contextPopupOpen.value = true
  closeCommandPopup()
  modeMenuOpen.value = false
  closeModelMenu()
  contextLevel.value = level
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  if (level === 'docs') resetDocsContextNavigation()
  void nextTick(() => contextSearchInputRef.value?.focus())
}

const renderPartsIntoEditable = (editable: HTMLElement, parts: AiContentPart[]) => {
  editable.replaceChildren()
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      editable.appendChild(document.createTextNode(part.text))
    } else if (part.type === 'image') {
      if (index > 0) editable.appendChild(document.createTextNode(' '))
      editable.appendChild(createImageElement(part))
      editable.appendChild(document.createTextNode(' '))
    } else {
      if (index > 0) editable.appendChild(document.createTextNode(' '))
      editable.appendChild(createChipElement(part, { removablePart: true }))
      editable.appendChild(document.createTextNode(' '))
    }
  })
}

const renderEditableFromState = () => {
  const editable = editableRef.value
  if (!editable) return
  syncingFromEditable.value = true
  const active = document.activeElement === editable
  editable.replaceChildren()
  workspace.selectedContexts.forEach((context) => {
    editable.appendChild(createContextChipElement(context))
    editable.appendChild(document.createTextNode(' '))
  })
  if (draft.value) {
    editable.appendChild(document.createTextNode(draft.value))
  }
  imageInputParts.value.forEach((part) => {
    editable.appendChild(document.createTextNode(' '))
    editable.appendChild(createImageElement(part))
    editable.appendChild(document.createTextNode(' '))
  })
  if (selectedCommandRef.value) {
    editable.appendChild(document.createTextNode(' '))
    const commandChip = createCommandChipElement()
    if (commandChip) editable.appendChild(commandChip)
    editable.appendChild(document.createTextNode(' '))
  }
  if (active) {
    moveEditableCaretToEnd()
  }
  void nextTick(() => {
    syncingFromEditable.value = false
  })
}

const setDraft = (value: string) => {
  draft.value = value
  void nextTick(() => {
    renderEditableFromState()
  })
}

const extractEditableTextFromNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  if (element.classList.contains('mention-chip')) return ''
  if (element.dataset.imageType) return ''
  if (element.tagName === 'BR') return '\n'
  return Array.from(element.childNodes).map(extractEditableTextFromNode).join('')
}

const editablePlainText = () => {
  const editable = editableRef.value
  if (!editable) return ''
  return Array.from(editable.childNodes).map(extractEditableTextFromNode).join('').replace(/\u00a0/g, ' ').trim()
}

const contentPartFromContextChip = (chip: HTMLElement): AiContentPart | null => {
  const contextId = chip.dataset.contextId
  const context = workspace.selectedContexts.find((item) => item.id === contextId)
  if (!context) return null
  return imagePartFromContext(context) || chipPartFromContext(context)
}

const chipPartFromChipElement = (chip: HTMLElement): AiChipContentPart | null => {
  if (chip.dataset.chipType === 'doc') {
    const part: AiDocChipContentPart = {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath: chip.dataset.absPath || '',
        relPath: chip.dataset.relPath || undefined,
        name: chip.dataset.name || undefined,
        type: (chip.dataset.docType as 'file' | 'dir' | undefined) || undefined
      }
    }
    return part
  }
  if (chip.dataset.chipType === 'chat') {
    const part: AiChatChipContentPart = {
      type: 'chip',
      chipType: 'chat',
      ref: {
        taskId: chip.dataset.chatId || '',
        title: chip.dataset.title || undefined
      }
    }
    return part
  }
  if (chip.dataset.chipType === 'command') {
    const part: AiCommandChipContentPart = {
      type: 'chip',
      chipType: 'command',
      ref: {
        command: chip.dataset.command || '',
        label: chip.dataset.label || undefined,
        path: chip.dataset.path || undefined
      }
    }
    return part
  }
  if (chip.dataset.chipType === 'skill') {
    const part: AiSkillChipContentPart = {
      type: 'chip',
      chipType: 'skill',
      ref: {
        skillName: chip.dataset.skillName || '',
        description: chip.dataset.description || undefined
      }
    }
    return part
  }
  return null
}

const extractContentPartsFromNode = (node: Node): AiContentPart[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return text ? [{ type: 'text', text }] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []
  const element = node as HTMLElement
  if (element.classList.contains('mention-chip')) {
    if (element.dataset.contextId) {
      const part = contentPartFromContextChip(element)
      return part ? [part] : []
    }
    if (element.dataset.chipType) {
      const part = chipPartFromChipElement(element)
      return part ? [part] : []
    }
    return []
  }
  if (element.dataset.imageType) {
    const mediaType = element.dataset.mediaType
    const data = element.dataset.imageData
    if (!mediaType || !data || !imagePartMediaTypes.includes(mediaType as AiSupportedImageType)) return []
    return [{ type: 'image', mediaType: mediaType as AiSupportedImageType, data, name: element.dataset.name }]
  }
  if (element.tagName === 'BR') return [{ type: 'text', text: '\n' }]
  return Array.from(element.childNodes).flatMap(extractContentPartsFromNode)
}

const mergeAdjacentTextParts = (parts: AiContentPart[]) => {
  return parts.reduce<AiContentPart[]>((acc, part) => {
    const previous = acc.at(-1)
    if (part.type === 'text' && previous?.type === 'text') {
      previous.text += part.text
      return acc
    }
    acc.push(part)
    return acc
  }, [])
}

const extractEditableContentParts = () => {
  const editable = editableRef.value
  if (!editable) return []
  return mergeAdjacentTextParts(Array.from(editable.childNodes).flatMap(extractContentPartsFromNode)).filter(
    (part) => part.type !== 'text' || part.text.trim()
  )
}

const extractContentPartsFromEditable = (editable: HTMLElement | null) => {
  if (!editable) return []
  return mergeAdjacentTextParts(Array.from(editable.childNodes).flatMap(extractContentPartsFromNode)).filter(
    (part) => part.type !== 'text' || part.text.trim()
  )
}

const fallbackPartsForMessage = (message: { text: string; contentParts?: AiContentPart[] }) =>
  message.contentParts?.length ? message.contentParts.map((part) => ({ ...part })) : [{ type: 'text' as const, text: message.text }]

const editableTextFromElement = (editable: HTMLElement | null) => {
  if (!editable) return ''
  return Array.from(editable.childNodes).map(extractEditableTextFromNode).join('').replace(/\u00a0/g, ' ').trim()
}

const renderEditEditableFromParts = (parts: AiContentPart[]) => {
  const editable = editEditableRef.value
  if (!editable) return
  renderPartsIntoEditable(editable, parts)
  editDraft.value = editableTextFromElement(editable)
  editImageInputParts.value = parts.filter((part): part is AiImageContentPart => part.type === 'image')
  requestAnimationFrame(() => {
    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    editable.focus()
  })
}

const startMessageEdit = async (message: { id: string; role: string; text: string; contentParts?: AiContentPart[]; hosts?: AiContextOption[] }) => {
  if (message.role !== 'user') return
  editingMessageId.value = message.id
  editHostContexts.value = message.hosts?.map(cloneContextOption) || []
  closePopups()
  await nextTick()
  renderEditEditableFromParts(fallbackPartsForMessage(message))
}

const cancelMessageEdit = () => {
  editingMessageId.value = null
  editDraft.value = ''
  editImageInputParts.value = []
  editHostContexts.value = []
  editSavedRange.value = null
}

const handleEditEditableInput = () => {
  editDraft.value = editableTextFromElement(editEditableRef.value)
  editImageInputParts.value = extractContentPartsFromEditable(editEditableRef.value).filter(
    (part): part is AiImageContentPart => part.type === 'image'
  )
  saveEditSelection()
}

const handleEditEditableClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.dataset.removeImage || target.closest('[data-remove-image]')) {
    const wrapper = target.closest('.image-preview-wrapper')
    wrapper?.remove()
    handleEditEditableInput()
    return
  }
  if (target.dataset.removeChip || target.closest('[data-remove-chip]')) {
    const chip = target.closest('.mention-chip')
    chip?.remove()
    handleEditEditableInput()
  }
  saveEditSelection()
}

const handleEditEditablePaste = (event: ClipboardEvent) => {
  const imageFiles = getImageFilesFromClipboard(event)
  if (imageFiles.length > 0) {
    event.preventDefault()
    void insertImageFilesIntoEdit(imageFiles)
    return
  }

  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') || ''
  insertPlainTextAtEditCursor(text)
}

const confirmMessageEdit = () => {
  if (!editingMessageId.value) return
  const contentParts = extractContentPartsFromEditable(editEditableRef.value)
  const hasSendableContent = contentParts.some((part) => part.type !== 'text' || part.text.trim())
  if (!hasSendableContent) return
  const sent = workspace.resendUserMessageFromParts(editingMessageId.value, contentParts, editHostContexts.value.map(cloneContextOption))
  if (sent) cancelMessageEdit()
}

const handleEditEditableKeydown = (event: KeyboardEvent) => {
  if (event.key === '@' && !event.isComposing) {
    window.setTimeout(() => {
      openContextPopupForTarget('edit')
    }, 0)
    return
  }

  if (event.key === '/' && !event.isComposing) {
    const shouldOpenAfterKey = shouldTriggerCommandPopupForPendingSlash(editEditableRef.value, editSavedRange.value)
    window.setTimeout(() => {
      saveEditSelection()
      if (!shouldOpenAfterKey && getCharBeforeCaret(editEditableRef.value, editSavedRange.value) !== '/') return
      if (!shouldOpenAfterKey && !shouldTriggerCommandPopupForSlash(editEditableRef.value, editSavedRange.value)) return
      openCommandPopupForTarget('edit')
    }, 0)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    if (contextPopupOpen.value && contextTarget.value === 'edit') {
      if (contextLevel.value !== 'main') {
        goBackContextPopup()
      } else {
        closeContextPopup({ restoreFocus: true })
      }
      return
    }
    if (commandPopupOpen.value && commandTarget.value === 'edit') {
      closeCommandPopup({ restoreFocus: true })
      return
    }
    cancelMessageEdit()
    return
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (contextPopupOpen.value && contextTarget.value === 'edit') {
      if (contextLevel.value === 'main') {
        if (contextKeyboardIndex.value >= 0 && contextKeyboardIndex.value < displayedOpenedHosts.value.length) {
          applyContext(displayedOpenedHosts.value[contextKeyboardIndex.value])
        } else if (contextKeyboardIndex.value >= displayedOpenedHosts.value.length) {
          const category = visibleContextCategories.value[contextKeyboardIndex.value - displayedOpenedHosts.value.length]
          if (category) openContextCategory(category.id)
        }
      } else {
        const option = filteredContextOptions.value[contextKeyboardIndex.value]
        if (option) applyContext(option)
      }
      return
    }
    if (commandPopupOpen.value && commandTarget.value === 'edit') {
      const preset = filteredCommands.value[commandKeyboardIndex.value]
      if (preset) applyCommand(preset)
      return
    }
    confirmMessageEdit()
  }
}

const syncStorePartsFromEditable = () => {
  const editable = editableRef.value
  if (!editable) return
  const contextIds = new Set(
    Array.from(editable.querySelectorAll<HTMLElement>('.mention-chip[data-context-id]'))
      .map((chip) => chip.dataset.contextId || '')
      .filter(Boolean)
  )
  const commandPresent = Boolean(editable.querySelector('.mention-chip[data-command-chip]'))
  const domImages = Array.from(editable.querySelectorAll<HTMLElement>('.image-preview-wrapper[data-image-type]'))
    .map((element): AiImageContentPart | null => {
      const mediaType = element.dataset.mediaType
      const data = element.dataset.imageData
      if (!mediaType || !data || !imagePartMediaTypes.includes(mediaType as AiSupportedImageType)) return null
      const part: AiImageContentPart = { type: 'image', mediaType: mediaType as AiSupportedImageType, data }
      if (element.dataset.name) part.name = element.dataset.name
      return part
    })
    .filter((part): part is AiImageContentPart => part !== null)

  if (contextIds.size !== workspace.selectedContexts.length || workspace.selectedContexts.some((context) => !contextIds.has(context.id))) {
    workspace.selectedContexts = workspace.selectedContexts.filter((context) => contextIds.has(context.id))
  }
  if (!commandPresent && workspace.selectedCommandId) {
    workspace.selectCommandPreset(null)
  }
  imageInputParts.value = domImages
}

const saveEditableSelection = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editableRef.value) return
  const range = selection.getRangeAt(0)
  if (!editableRef.value.contains(range.startContainer)) return
  savedRange.value = range.cloneRange()
}

const moveEditableCaretToEnd = () => {
  const editable = editableRef.value
  if (!editable) return
  editable.focus()
  const range = document.createRange()
  range.selectNodeContents(editable)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  saveEditableSelection()
}

const handleEditableInput = () => {
  syncingFromEditable.value = true
  syncStorePartsFromEditable()
  draft.value = editablePlainText()
  saveEditableSelection()
  void nextTick(() => {
    syncingFromEditable.value = false
  })
}

const handleEditableClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  const removeContextButton = target.closest('[data-remove-context]') as HTMLElement | null
  const removeContextId = removeContextButton?.dataset.contextId
  if (removeContextId) {
    workspace.removeContext(removeContextId)
    requestAnimationFrame(moveEditableCaretToEnd)
    return
  }
  if (target.dataset.removeCommand || target.closest('[data-remove-command]')) {
    workspace.selectCommandPreset(null)
    requestAnimationFrame(moveEditableCaretToEnd)
    return
  }
  if (target.dataset.removeImage || target.closest('[data-remove-image]')) {
    const wrapper = target.closest('.image-preview-wrapper')
    wrapper?.remove()
    handleEditableInput()
    requestAnimationFrame(moveEditableCaretToEnd)
    return
  }
  saveEditableSelection()
}

const insertPlainTextAtEditableCursor = (text: string) => {
  const editable = editableRef.value
  if (!editable) return
  editable.focus()

  const selection = window.getSelection()
  if (!selection) return
  let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) {
    moveEditableCaretToEnd()
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  }
  if (!range) return

  const normalizedText = text.replace(/\r\n/g, '\n')
  const fragment = document.createDocumentFragment()
  normalizedText.split('\n').forEach((line, index, lines) => {
    fragment.appendChild(document.createTextNode(line))
    if (index < lines.length - 1) {
      fragment.appendChild(document.createElement('br'))
    }
  })
  const marker = document.createTextNode('')
  fragment.appendChild(marker)

  range.deleteContents()
  range.insertNode(fragment)

  const nextRange = document.createRange()
  nextRange.setStart(marker, 0)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  marker.remove()

  handleEditableInput()
}

const handleEditablePaste = (event: ClipboardEvent) => {
  const imageFiles = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  if (imageFiles.length > 0) {
    event.preventDefault()
    void insertImageFiles(imageFiles)
    return
  }

  event.preventDefault()
  insertPlainTextAtEditableCursor(event.clipboardData?.getData('text/plain') || '')
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const processImageFile = async (file: File): Promise<AiImageContentPart | null> => {
  if (!supportedImageTypes.includes(file.type as AiSupportedImageType)) {
    workspace.chatMessages.push({
      id: `image-upload-${Date.now()}`,
      role: 'system',
      text: `不支持的图片类型：${file.type || file.name}`
    })
    return null
  }
  if (file.size > maxImageBytes) {
    workspace.chatMessages.push({
      id: `image-upload-${Date.now()}`,
      role: 'system',
      text: `图片超过 10 MiB：${file.name}`
    })
    return null
  }
  const data = await fileToBase64(file)
  return { type: 'image', mediaType: file.type as AiSupportedImageType, data, name: file.name }
}

const insertImageFiles = async (files: File[]) => {
  if (streaming.value) return
  for (const file of files) {
    const part = await processImageFile(file)
    if (part) insertImageAtEditableCursor(part)
  }
}

const openImagePicker = () => {
  if (streaming.value) return
  imageInputRef.value?.click()
}

const showInputPlaceholderNotice = (message: string) => {
  inputPlaceholderNotice.value = message
  if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
  inputPlaceholderNoticeTimer = window.setTimeout(() => {
    inputPlaceholderNotice.value = ''
    inputPlaceholderNoticeTimer = undefined
  }, 2400)
}

const showFileUploadPlaceholder = () => {
  if (streaming.value) return
  showInputPlaceholderNotice('文件上传为本地占位，暂未启用附件暂存。')
}

const showVoicePlaceholder = () => {
  if (streaming.value) return
  showInputPlaceholderNotice('语音输入为本地占位，暂未启用录音识别。')
}

const handleImageSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  await insertImageFiles(files)
  input.value = ''
}

type AiopstermDragPayload = {
  contextType?: string
  relPath?: string
  name?: string
}

const parseAiopstermDragPayload = (dataTransfer: DataTransfer | null): AiopstermDragPayload | null => {
  if (!dataTransfer) return null
  const direct = dataTransfer.getData('application/x-aiopsterm-context')
  if (direct) {
    try {
      return JSON.parse(direct) as AiopstermDragPayload
    } catch {
      return null
    }
  }
  const html = dataTransfer.getData('text/html')
  if (!html) return null
  const match = html.match(/data-aiopsterm-context="([^"]+)"/)
  if (!match) return null
  try {
    return JSON.parse(decodeURIComponent(match[1])) as AiopstermDragPayload
  } catch {
    return null
  }
}

const isKnowledgeDragPayload = (payload: AiopstermDragPayload | null) =>
  Boolean(payload?.relPath && (payload.contextType === 'doc' || payload.contextType === 'image'))

const handleDragEnter = (event: DragEvent) => {
  if (isKnowledgeDragPayload(parseAiopstermDragPayload(event.dataTransfer))) {
    dropActive.value = true
  }
}

const handleDragOver = (event: DragEvent) => {
  const payload = parseAiopstermDragPayload(event.dataTransfer)
  if (!isKnowledgeDragPayload(payload)) return
  dropActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const handleDragLeave = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (!target || !related || !target.contains(related)) {
    dropActive.value = false
  }
}

const handleDrop = async (event: DragEvent) => {
  const payload = parseAiopstermDragPayload(event.dataTransfer)
  dropActive.value = false
  if (!isKnowledgeDragPayload(payload) || !payload?.relPath) return
  await workspace.addKnowledgeFilesToChat([payload.relPath])
  if (!draft.value.trim()) setDraft(`引用知识库：${payload.name || payload.relPath}`)
  requestAnimationFrame(moveEditableCaretToEnd)
  closePopups()
}

const closePopups = (options: { restoreCommandFocus?: boolean; restoreContextFocus?: boolean } = {}) => {
  closeContextPopup({ restoreFocus: options.restoreContextFocus })
  closeCommandPopup({ restoreFocus: options.restoreCommandFocus })
  modeMenuOpen.value = false
  closeModelMenu()
}

const handleSend = () => {
  if (streaming.value) {
    const message = [...workspace.chatMessages].reverse().find((item) => item.state === 'streaming')
    if (message) {
      message.state = 'done'
      message.text = `${message.text}\n\n已停止生成。`
    }
    return
  }
  const contentParts = extractEditableContentParts()
  workspace.sendChat(draft.value, contentParts)
  imageInputParts.value = []
  setDraft('')
  closePopups()
}

const toggleContextPopup = () => {
  if (contextPopupOpen.value) {
    closeContextPopup({ restoreFocus: true })
    return
  }
  openContextPopupForTarget('main')
}

const toggleModeMenu = () => {
  modeMenuOpen.value = !modeMenuOpen.value
  closeModelMenu()
  closeContextPopup()
  closeCommandPopup()
}

const toggleModelMenu = () => {
  if (modelMenuOpen.value) {
    closeModelMenu()
    return
  }
  modelQuery.value = ''
  modelMenuOpen.value = true
  modeMenuOpen.value = false
  closeContextPopup()
  closeCommandPopup()
  void nextTick(() => modelSearchInputRef.value?.focus())
}

const selectChatMode = (mode: AiChatMode) => {
  chatMode.value = mode
  modeMenuOpen.value = false
}

const selectModel = (modelId: string) => {
  workspace.saveConfig({ modelName: modelId })
  closeModelMenu()
}

const handleModelKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeModelMenu()
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  const model = filteredModelOptions.value[0]
  if (model) selectModel(model.id)
}

const resetDocsContextNavigation = () => {
  docsCurrentRelDir.value = ''
  docsDirStack.value = []
}

const focusContextSearchInput = () => {
  void nextTick(() => {
    if (contextPopupOpen.value) contextSearchInputRef.value?.focus()
  })
}

const enterDocsDir = (context: AiContextOption) => {
  if (context.kind !== 'docs' || context.contextType !== 'dir' || !context.relPath) return
  docsDirStack.value = [...docsDirStack.value, docsCurrentRelDir.value]
  docsCurrentRelDir.value = context.relPath
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  focusContextSearchInput()
}

const goBackDocsDir = () => {
  if (docsDirStack.value.length === 0) return false
  docsCurrentRelDir.value = docsDirStack.value.at(-1) || ''
  docsDirStack.value = docsDirStack.value.slice(0, -1)
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  focusContextSearchInput()
  return true
}

const returnContextPopupToMain = () => {
  contextLevel.value = 'main'
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  resetDocsContextNavigation()
  focusContextSearchInput()
}

const goBackContextPopup = () => {
  if (contextLevel.value === 'docs' && goBackDocsDir()) return
  returnContextPopupToMain()
}

const closeContextPopup = (options: { restoreFocus?: boolean } = {}) => {
  const previousTarget = contextTarget.value
  const wasOpen = contextPopupOpen.value
  contextPopupOpen.value = false
  contextTarget.value = 'main'
  returnContextPopupToMain()
  if (wasOpen && options.restoreFocus) {
    focusInputForTarget(previousTarget)
  }
}

const moveEditCaretToEnd = () => {
  const editable = editEditableRef.value
  if (!editable) return
  editable.focus()
  const range = document.createRange()
  range.selectNodeContents(editable)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  saveEditSelection()
}

const restoreEditableSelection = () => {
  const editable = editableRef.value
  const selection = window.getSelection()
  if (!editable || !selection) return false
  editable.focus()
  if (savedRange.value && editable.contains(savedRange.value.startContainer)) {
    selection.removeAllRanges()
    selection.addRange(savedRange.value.cloneRange())
    return true
  }
  moveEditableCaretToEnd()
  return true
}

const restoreEditInputSelection = () => {
  const editable = editEditableRef.value
  const selection = window.getSelection()
  if (!editable || !selection) return false
  editable.focus()
  if (editSavedRange.value && editable.contains(editSavedRange.value.startContainer)) {
    selection.removeAllRanges()
    selection.addRange(editSavedRange.value.cloneRange())
    return true
  }
  moveEditCaretToEnd()
  return true
}

function focusInputForTarget(target: 'main' | 'edit') {
  requestAnimationFrame(() => {
    if (target === 'edit') {
      restoreEditInputSelection()
      return
    }
    restoreEditableSelection()
  })
}

const closeCommandPopup = (options: { restoreFocus?: boolean } = {}) => {
  const previousTarget = commandTarget.value
  const wasOpen = commandPopupOpen.value
  commandPopupOpen.value = false
  commandTarget.value = 'main'
  commandQuery.value = ''
  commandKeyboardIndex.value = -1
  if (wasOpen && options.restoreFocus) {
    focusInputForTarget(previousTarget)
  }
}

const openContextCategory = (category: AiContextKind) => {
  contextLevel.value = category
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  if (category === 'docs') resetDocsContextNavigation()
  focusContextSearchInput()
}

const isContextSelected = (context: AiContextOption) => workspace.selectedContexts.some((item) => item.id === context.id)

const addMainContextFromPopup = (context: AiContextOption) => {
  if (!isContextSelected(context)) {
    workspace.selectedContexts = [...workspace.selectedContexts, cloneContextOption(context)]
  }
}

const buildSelectedHostContextsFromVisible = (currentHosts: AiContextOption[]) => {
  const selectable = visibleHostContextOptions.value
  const hasRemoteHost = selectable.some((context) => !isLocalhostContext(context))
  let nextHosts = currentHosts.map(cloneContextOption)
  if (hasRemoteHost) {
    nextHosts = nextHosts.filter((context) => !isLocalhostContext(context))
  }

  for (const context of selectable) {
    if (hasRemoteHost && isLocalhostContext(context)) continue
    if (nextHosts.some((item) => item.id === context.id)) continue
    if (nextHosts.length >= maxHostContexts) break
    nextHosts = [...nextHosts, cloneContextOption(context)]
  }

  return nextHosts.slice(0, maxHostContexts)
}

const selectAllVisibleHostContexts = () => {
  const nextHosts = buildSelectedHostContextsFromVisible(hostContextsForPopup.value)
  if (contextTarget.value === 'edit') {
    editHostContexts.value = nextHosts
    return
  }
  workspace.selectedContexts = [...workspace.selectedContexts.filter((context) => context.kind !== 'hosts'), ...nextHosts]
  renderEditableFromState()
  requestAnimationFrame(moveEditableCaretToEnd)
}

const clearHostContexts = () => {
  if (contextTarget.value === 'edit') {
    editHostContexts.value = []
    return
  }
  workspace.selectedContexts = workspace.selectedContexts.filter((context) => context.kind !== 'hosts')
  renderEditableFromState()
  requestAnimationFrame(moveEditableCaretToEnd)
}

const isEditHostContextSelected = (context: AiContextOption) =>
  context.kind === 'hosts' && editHostContexts.value.some((item) => item.id === context.id)

const isContextSelectedForPopup = (context: AiContextOption) =>
  contextTarget.value === 'edit' ? isEditHostContextSelected(context) : isContextSelected(context)

const applyHostContextToEdit = (context: AiContextOption) => {
  removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, '@', handleEditEditableInput)
  editHostContexts.value = toggleHostContextInList(editHostContexts.value, context)
  closeContextPopup({ restoreFocus: true })
}

const applyContext = (context: AiContextOption) => {
  if (context.kind === 'docs' && context.contextType === 'dir') {
    enterDocsDir(context)
    return
  }

  if (contextTarget.value === 'edit') {
    if (context.kind === 'hosts') {
      applyHostContextToEdit(context)
      return
    }
    insertContextAtEditCursor(context)
    closeContextPopup({ restoreFocus: true })
    return
  }

  if (context.kind === 'hosts') {
    removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
    workspace.selectedContexts = toggleHostContextInList(workspace.selectedContexts, context)
    renderEditableFromState()
  } else {
    removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
    addMainContextFromPopup(context)
    closeContextPopup({ restoreFocus: true })
    renderEditableFromState()
  }
  requestAnimationFrame(moveEditableCaretToEnd)
}

const applyCommand = (preset: AiCommandOption) => {
  const editCommandTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
  if (commandTarget.value === 'edit' || (editingMessageId.value && editCommandTarget)) {
    restoreEditSelection()
    insertChipIntoEditableCursor(
      editCommandTarget,
      {
        type: 'chip',
        chipType: 'command',
        ref: {
          command: preset.command,
          label: preset.label,
          path: preset.path
        }
      },
      handleEditEditableInput
    )
    closeCommandPopup({ restoreFocus: true })
    return
  }

  workspace.selectCommandPreset(preset.id, {
    command: preset.command,
    label: preset.label,
    path: preset.path
  })
  closeCommandPopup()
  setDraft(draft.value.replace(/\/$/, ''))
  requestAnimationFrame(moveEditableCaretToEnd)
}

const handleEditableKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    handleSend()
    return
  }

  if (event.key === '@' && !event.isComposing) {
    window.setTimeout(() => {
      openContextPopupForTarget('main')
    }, 0)
  } else if (event.key === '/' && !event.isComposing) {
    const shouldOpenAfterKey = shouldTriggerCommandPopupForPendingSlash(editableRef.value, savedRange.value)
    window.setTimeout(() => {
      saveEditableSelection()
      if (!shouldOpenAfterKey && getCharBeforeCaret(editableRef.value, savedRange.value) !== '/') return
      if (!shouldOpenAfterKey && !shouldTriggerCommandPopupForSlash(editableRef.value, savedRange.value)) return
      openCommandPopupForTarget('main')
    }, 0)
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSend()
  } else if (event.key === 'Escape' && contextPopupOpen.value && contextTarget.value === 'main') {
    event.preventDefault()
    event.stopPropagation()
    if (contextLevel.value !== 'main') {
      goBackContextPopup()
    } else {
      closeContextPopup({ restoreFocus: true })
    }
  } else if (event.key === 'Escape' && commandPopupOpen.value && commandTarget.value === 'main') {
    event.preventDefault()
    event.stopPropagation()
    closeCommandPopup({ restoreFocus: true })
  }
}

const handleContextKeydown = (event: KeyboardEvent) => {
  const listLength =
    contextLevel.value === 'main' ? displayedOpenedHosts.value.length + visibleContextCategories.value.length : filteredContextOptions.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (contextLevel.value === 'main') {
      const maxIndex = Math.max(0, listLength - 1)
      contextKeyboardIndex.value = Math.min(contextKeyboardIndex.value + 1, maxIndex)
      return
    }
    if (listLength === 0) return
    contextKeyboardIndex.value =
      contextKeyboardIndex.value === -1 ? 0 : Math.min(contextKeyboardIndex.value + 1, listLength - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (contextLevel.value === 'main') {
      contextKeyboardIndex.value = Math.max(contextKeyboardIndex.value - 1, 0)
      return
    }
    if (listLength === 0) return
    contextKeyboardIndex.value =
      contextKeyboardIndex.value === -1 ? listLength - 1 : Math.max(contextKeyboardIndex.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (contextLevel.value === 'main') {
      if (contextKeyboardIndex.value >= 0 && contextKeyboardIndex.value < displayedOpenedHosts.value.length) {
        applyContext(displayedOpenedHosts.value[contextKeyboardIndex.value])
      } else if (contextKeyboardIndex.value >= displayedOpenedHosts.value.length) {
        const category = visibleContextCategories.value[contextKeyboardIndex.value - displayedOpenedHosts.value.length]
        if (category) openContextCategory(category.id)
      }
    } else {
      const option = filteredContextOptions.value[contextKeyboardIndex.value]
      if (option) applyContext(option)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (contextLevel.value !== 'main') {
      goBackContextPopup()
      return
    }
    closeContextPopup({ restoreFocus: true })
  } else if (event.key === 'Backspace' && contextQuery.value === '' && contextLevel.value !== 'main') {
    event.preventDefault()
    goBackContextPopup()
  }
}

const handlePanelKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (contextPopupOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    if (contextLevel.value !== 'main') {
      goBackContextPopup()
    } else {
      closeContextPopup({ restoreFocus: true })
    }
    return
  }
  if (commandPopupOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeCommandPopup({ restoreFocus: true })
  }
}

const handleCommandKeydown = (event: KeyboardEvent) => {
  const list = filteredCommands.value
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (list.length === 0) return
    commandKeyboardIndex.value =
      commandKeyboardIndex.value === -1 ? 0 : Math.min(commandKeyboardIndex.value + 1, list.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (list.length === 0) return
    commandKeyboardIndex.value =
      commandKeyboardIndex.value === -1 ? list.length - 1 : Math.max(commandKeyboardIndex.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const preset = list[commandKeyboardIndex.value]
    if (preset) applyCommand(preset)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeCommandPopup({ restoreFocus: true })
  }
}

const openContextPopup = (level: 'main' | AiContextKind = 'main') => {
  openContextPopupForTarget('main', level)
}

watch(contextQuery, () => {
  contextKeyboardIndex.value = -1
})

watch(
  () => workspace.onboardingAiRequest.sequence,
  async (sequence) => {
    const onboardingRequest = workspace.onboardingAiRequest
    if (sequence === 0 && onboardingRequest.action === 'none') return
    if (onboardingRequest.action === 'open-mode') {
      chatMode.value = 'cmd'
      modeMenuOpen.value = true
      closeModelMenu()
      closeContextPopup()
      closeCommandPopup()
      return
    }
    if (onboardingRequest.action === 'open-model') {
      modelQuery.value = ''
      modelMenuOpen.value = true
      modeMenuOpen.value = false
      closeContextPopup()
      closeCommandPopup()
      await nextTick()
      modelSearchInputRef.value?.focus()
      return
    }
    if (onboardingRequest.action === 'open-context-main') {
      openContextPopup('main')
      return
    }
    if (onboardingRequest.action === 'open-context-hosts') {
      openContextPopup('hosts')
      return
    }
    if (onboardingRequest.action === 'prepare-send') {
      chatMode.value = 'agent'
      closePopups()
      if (!draft.value.trim()) {
        setDraft('查看本地主机状态')
      }
      return
    }
    closePopups()
  },
  { immediate: true }
)

watch(
  [
    () => workspace.selectedContexts.map((context) => `${context.id}:${context.label}:${context.data || ''}`).join('|'),
    () => workspace.selectedCommandId,
    () => `${workspace.selectedCommandRef?.command || ''}:${workspace.selectedCommandRef?.label || ''}:${workspace.selectedCommandRef?.path || ''}`
  ],
  () => {
    if (syncingFromEditable.value) return
    void nextTick(renderEditableFromState)
  },
  { immediate: true }
)

</script>
