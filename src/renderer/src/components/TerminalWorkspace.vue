<template>
  <section class="terminal-workspace">
    <div
      class="terminal-tabs"
      data-onboarding-id="main-workspace-tabs"
      :class="{ 'drag-restore': tabBarDragOver }"
      @dragover.prevent="handleTabBarDragOver"
      @dragleave="handleTabBarDragLeave"
      @drop.prevent="handleTabBarDrop"
    >
      <div
        v-for="panel in visibleTerminalTabPanels"
        :key="panel.id"
        class="terminal-tab"
        :class="{ active: panel.id === workspace.activePanelId, 'drag-over': tabDragOverPanelId === panel.id, 'ai-attention': panelNeedsAiAttention(panel), 'control-flash': controlFlashingPanelIds.includes(panel.id) }"
        role="button"
        tabindex="0"
        :title="terminalTabTooltip(panel)"
        :draggable="panel.kind === 'terminal' || panel.kind === 'knowledge'"
        @click="workspace.activePanelId = panel.id"
        @keydown.enter.prevent="workspace.activePanelId = panel.id"
        @keydown.space.prevent="workspace.activePanelId = panel.id"
        @contextmenu.prevent="openMenu($event, panel.id)"
        @dragstart="handleTabDragStart($event, panel)"
        @dragenter.prevent.stop="handleTabDragEnter($event, panel)"
        @dragover.prevent.stop="handleTabDragOver($event, panel)"
        @dragleave="handleTabDragLeave(panel.id)"
        @drop.prevent.stop="handleTabDrop($event, panel)"
        @dragend="handleTabDragEnd"
      >
        <span
          v-if="renamingId !== panel.id"
          class="terminal-tab-label"
          @dblclick.stop="startRename(panel.id, panel.title)"
        >
          <strong class="terminal-tab-title">{{ panel.title }}</strong>
          <small
            v-if="terminalTabMeta(panel)"
            class="terminal-tab-meta"
          >{{ terminalTabMeta(panel) }}</small>
        </span>
        <input
          v-else
          v-model="renameText"
          @blur="finishRename"
          @keydown.enter="finishRename"
          @keydown.esc="renamingId = ''"
        />
        <span
          v-if="terminalTabKindBadge(panel)"
          class="terminal-tab-kind"
        >{{ terminalTabKindBadge(panel) }}</span>
        <span
          v-else-if="panel.status === 'connecting' || panel.status === 'error' || panel.status === 'closed'"
          class="terminal-tab-state"
          :class="panel.status"
          :title="terminalStatusLabel(panel)"
          aria-hidden="true"
        ></span>
        <button
          v-if="workspace.terminalSettings.showCloseButton"
          class="terminal-tab-close"
          title="关闭"
          @click.stop="closeTab(panel.id)"
          @mousedown.stop
          @dragstart.stop.prevent
        >
          <X />
        </button>
      </div>
    </div>

    <div
      v-if="menu.visible"
      class="tab-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button @click="closeSelected">关闭</button>
      <button @click="closeOtherTabsFromMenu">关闭其他</button>
      <button @click="closeAllTabsFromMenu">关闭全部</button>
      <button @click="renameSelected">重命名</button>
      <button @click="cloneSelected">克隆</button>
      <button
        v-if="isTerminalMenuPanel"
        @click="toggleTabConnectionFromMenu"
      >
        {{ connectionActionLabel(panelById(menu.panelId)) }}
      </button>
      <button
        v-if="isTerminalMenuPanel"
        @click="openCommandDialogFromTabMenu"
      >
        AI 命令
      </button>
      <button
        v-if="canForkSelected"
        @click="forkSelected"
      >
        Fork SSH Channel
      </button>
      <button @click="splitSelected('right')">向右拆分</button>
      <button @click="splitSelected('below')">向下拆分</button>
      <button
        v-if="workspace.hasSplitState(menu.panelId)"
        @click="unsplitSelected"
      >
        取消拆分
      </button>
    </div>

    <div
      v-if="termMenu.visible"
      class="terminal-context-menu"
      :style="{ left: `${termMenu.x}px`, top: `${termMenu.y}px` }"
      @click.stop
    >
      <button @click="copySelection(termMenu.panelId)"><span>复制</span><kbd>Ctrl+C</kbd></button>
      <button @click="pasteClipboard(termMenu.panelId)"><span>粘贴</span><kbd>Ctrl+V</kbd></button>
      <button @click="openSearchOverlay(termMenu.panelId)"><span>搜索</span><kbd>Ctrl+F</kbd></button>
      <i />
      <button @click="togglePanelConnection(termMenu.panelId)">{{ connectionActionLabel(panelById(termMenu.panelId)) }}<kbd>{{ connectionActionShortcut(panelById(termMenu.panelId)) }}</kbd></button>
      <i />
      <button @click="openCommandDialogFromTermMenu"><span>AI 命令</span><kbd>Ctrl+K</kbd></button>
      <button @click="openCommandLineFromMenu"><span>输入命令</span><kbd>Enter</kbd></button>
      <button @click="createTerminalFromMenu"><span>新建终端</span><kbd>Ctrl+N</kbd></button>
      <button @click="closeTerminalFromMenu"><span>关闭终端</span><kbd>Ctrl+W</kbd></button>
      <button @click="clearTerminal(termMenu.panelId)"><span>清屏</span><kbd>Ctrl+L</kbd></button>
      <i />
      <button @click="splitFromTermMenu('right')">向右拆分</button>
      <button @click="splitFromTermMenu('below')">向下拆分</button>
      <button
        v-if="workspace.hasSplitState(termMenu.panelId)"
        @click="unsplitFromTermMenu"
      >
        取消拆分
      </button>
      <i />
      <button @click="toggleGlobalInput">{{ globalInputVisible ? '关闭全局执行' : '全局执行' }}</button>
      <i />
      <button @click="openFileManagerFromMenu"><span>文件管理</span><kbd>Ctrl+M</kbd></button>
      <i />
      <button @click="increaseFontFromMenu"><span>字体放大</span><kbd>Ctrl+=</kbd></button>
      <button @click="decreaseFontFromMenu"><span>字体缩小</span><kbd>Ctrl+-</kbd></button>
    </div>

    <div
      v-if="globalInputVisible"
      class="terminal-global-command"
    >
      <span><RadioTower /> Broadcast to {{ connectedTerminalPanels.length }} windows</span>
      <input
        v-model="globalCommand"
        placeholder="Execute command to all windows"
        @keydown.enter="sendGlobalCommand"
      />
      <button
        title="关闭"
        @click="globalInputVisible = false"
      >
        <X />
      </button>
    </div>

    <div
      v-if="activeTerminalContextBar"
      class="terminal-context-bar"
    >
      <div class="terminal-context-bar-main">
        <strong>{{ activeTerminalContextBar.title }}</strong>
        <span>{{ activeTerminalContextBar.kindLabel }}</span>
        <span>{{ activeTerminalContextBar.statusLabel }}</span>
      </div>
      <div class="terminal-context-bar-meta">
        <span
          v-if="activeTerminalContextBar.target"
          :title="activeTerminalContextBar.target"
        >{{ activeTerminalContextBar.target }}</span>
        <span
          v-if="activeTerminalContextBar.path"
          :title="activeTerminalContextBar.path"
        >{{ activeTerminalContextBar.path }}</span>
        <button
          v-if="activeTerminalContextBar.pendingAiCount"
          class="terminal-context-attention"
          :title="t('terminal.context.locatePendingAi')"
          @click="workspace.jumpToNextAiAttention"
        >
          {{ activeTerminalContextBar.pendingAiCount }} AI
        </button>
        <button
          :title="t('terminal.context.openAiSessions')"
          @click="openAiSessionsFromContextBar"
        >
          {{ t('terminal.context.aiSessions') }}
        </button>
        <button
          :title="t('terminal.context.refreshAiSessions')"
          @click="refreshAiSessionsFromContextBar"
        >
          {{ t('terminal.context.refresh') }}
        </button>
        <button
          v-if="activeTerminalContextBar.focusable"
          :title="t('terminal.context.focusTerminal')"
          @click="focusActiveTerminalFromContextBar"
        >
          {{ t('terminal.context.focus') }}
        </button>
        <button
          :title="t('terminal.context.copyContext')"
          @click="copyActiveTerminalContext"
        >
          {{ t('terminal.context.copyContextButton') }}
        </button>
      </div>
    </div>

    <div
      v-if="workspace.terminalSecurityPrompt"
      class="terminal-security-prompt"
    >
      <div>
        <strong>Security confirmation</strong>
        <span>{{ workspace.terminalSecurityPrompt.command }}</span>
        <small>{{ workspace.terminalSecurityPrompt.result.reason }} · {{ workspace.terminalSecurityPrompt.result.severity || 'unknown' }}</small>
      </div>
      <button
        class="settings-button primary"
        @click="approveSecurityPrompt"
      >
        Approve
      </button>
      <button
        class="settings-button"
        @click="cancelSecurityPrompt"
      >
        Cancel
      </button>
    </div>

    <div
      v-if="zmodemProgress.visible"
      class="terminal-zmodem-progress"
      :class="[zmodemProgress.type, zmodemProgress.status]"
    >
      <div>
        <strong>{{ zmodemProgress.type === 'upload' ? 'ZMODEM Upload' : 'ZMODEM Download' }}</strong>
        <span>{{ zmodemProgress.fileName || 'transfer' }}</span>
        <small>{{ zmodemProgress.message }} · {{ formatZmodemBytes(zmodemProgress.transferred) }} / {{ formatZmodemBytes(zmodemProgress.total) }}</small>
      </div>
      <progress
        :value="zmodemPercent"
        max="100"
      ></progress>
      <button
        title="取消传输"
        :disabled="zmodemProgress.status !== 'running'"
        @click="cancelZmodemTransfer"
      >
        <X />
      </button>
    </div>

    <div
      ref="terminalGrid"
      class="terminal-grid"
      :class="terminalGridClasses"
    >
      <div
        v-if="showTerminalDashboard"
        class="terminal-dashboard"
      >
        <div class="terminal-dashboard-icon"><Terminal /></div>
        <div class="terminal-dashboard-shortcuts">
          <span>与AI对话 <kbd>Ctrl</kbd><kbd>L</kbd></span>
          <span>资产列表 <kbd>Ctrl</kbd><kbd>B</kbd></span>
          <span>打开设置 <kbd>Ctrl</kbd><kbd>,</kbd></span>
          <span>内联命令生成 <kbd>Ctrl</kbd><kbd>K</kbd></span>
          <span>切换布局 (Terminal/Agents) <kbd>Ctrl</kbd><kbd>E</kbd></span>
        </div>
      </div>
      <template v-else>
      <div
        v-for="{ panel, style } in splitLayoutItems"
        :key="panel.id"
        class="terminal-pane"
        :class="{ active: panel.id === workspace.activePanelId, below: panel.split === 'below', 'knowledge-pane': panel.kind === 'knowledge', 'drag-over': paneDragOverPanelId === panel.id, 'ai-attention': panelNeedsAiAttention(panel), 'control-flash': controlFlashingPanelIds.includes(panel.id) }"
        :style="style"
        @click="activatePanel(panel.id)"
        @dragenter.prevent="handlePaneDragEnter($event, panel)"
        @dragover.prevent="handlePaneDragOver($event, panel)"
        @dragleave="handlePaneDragLeave(panel.id)"
        @drop.prevent.stop="handlePaneDrop($event, panel)"
      >
        <KnowledgeCenterEditor
          v-if="panel.kind === 'knowledge' && panel.knowledge"
          :rel-path="panel.knowledge.relPath"
          :is-image="panel.knowledge.isImage"
          :start-line="panel.knowledge.startLine"
          :end-line="panel.knowledge.endLine"
          :jump-token="panel.knowledge.jumpToken"
        />
        <template v-else>
        <div
          v-if="searchOverlayPanelId === panel.id"
          class="terminal-search-overlay"
        >
          <div>
            <Search />
            <input
              ref="searchOverlayInput"
              v-model="search"
              placeholder="搜索终端输出"
              @keydown.enter.prevent="findNext"
              @keydown.esc.prevent="closeSearchOverlay"
            />
            <span v-if="search && searchMatchCount > 0">{{ searchMatchIndex }}/{{ searchMatchCount }}</span>
            <button
              v-if="search"
              title="清空"
              @click="clearSearchFromButton"
            >
              <X />
            </button>
          </div>
          <button
            title="上一个"
            :disabled="searchMatchCount === 0"
            @click="findPrevious"
          >
            <ChevronUp />
          </button>
          <button
            title="下一个"
            :disabled="searchMatchCount === 0"
            @click="findNext"
          >
            <ChevronDown />
          </button>
          <i />
          <button
            title="关闭"
            @click="closeSearchOverlay"
          >
            <X />
          </button>
        </div>
        <div
          v-if="commandDialog.visible && commandDialog.panelId === panel.id"
          ref="commandDialogRef"
          class="terminal-command-dialog"
          :class="{ loading: commandDialog.loading }"
          :style="commandDialogStyle(panel.id)"
          tabindex="-1"
          @keydown.esc.stop.prevent="closeCommandDialog"
        >
          <div class="command-dialog-card">
            <button
              class="command-dialog-close"
              title="关闭"
              @click="closeCommandDialog"
            >
              <X />
            </button>
            <textarea
              ref="commandDialogInput"
              v-model="commandDialog.instruction"
              rows="1"
              placeholder="描述要生成的命令"
              :disabled="commandDialog.loading"
              @input="resizeCommandDialogInput"
              @keydown.enter.prevent="submitCommandDialog"
            ></textarea>
            <footer>
              <span :class="{ visible: commandDialog.loading }">
                <LoaderCircle />
                生成中
              </span>
              <div>
                <select
                  v-model="commandDialog.modelName"
                  :disabled="commandDialog.loading || !workspace.terminalCommandModelOptions.length"
                >
                  <option
                    v-for="model in workspace.terminalCommandModelOptions"
                    :key="model"
                    :value="model"
                  >
                    {{ model }}
                  </option>
                </select>
                <small><kbd>Enter</kbd> 提交 · <kbd>Esc</kbd> 关闭</small>
              </div>
            </footer>
            <p v-if="commandDialog.error">{{ commandDialog.error }}</p>
            <div
              v-if="commandDialog.generatedCommand"
              class="generated-command-row"
            >
              <code>{{ commandDialog.generatedCommand }}</code>
              <button @click="applyGeneratedCommand(panel.id)">插入</button>
            </div>
          </div>
        </div>
        <div
          v-if="commandLinePanelId === panel.id"
          class="command-line floating"
          :style="commandLineStyle(panel.id)"
        >
          <span>$</span>
          <input
            ref="commandLineInput"
            v-model="command"
            placeholder="输入命令，Enter 发送"
            @focus="workspace.activePanelId = panel.id"
            @input="updateSuggestions(panel.id)"
            @keydown.right.prevent="enterSuggestionSelection"
            @keydown.down.prevent="moveSuggestion(1)"
            @keydown.up.prevent="moveSuggestion(-1)"
            @keydown.esc.prevent="closeCommandLine"
            @keydown.enter.prevent="sendCommand(panel)"
          />
        </div>
        <div class="pane-title">
          <span>{{ panel.title }}</span>
          <small>{{ panel.cwd }}</small>
        </div>
        <div
          :ref="(element) => setTerminalElement(panel.id, element)"
          class="xterm-host"
          @contextmenu.prevent="handleTerminalContextMenu(panel.id, $event)"
          @mousedown="handleTerminalMouseDown(panel.id, $event)"
          @mouseup="handleTerminalMouseUp(panel.id, $event)"
          @wheel="handleTerminalWheel(panel.id, $event)"
        ></div>
        <pre
          :data-testid="`terminal-output-${panel.id}`"
          class="terminal-output-mirror"
          aria-hidden="true"
        >{{ panel.output }}</pre>
        <button
          v-if="aiButtonPanelId === panel.id"
          class="terminal-chat-ai-button"
          :style="{ top: `${aiButtonPosition.top}px`, right: `${aiButtonPosition.right}px` }"
          @mousedown.prevent
          @click="chatSelectionToAi(panel.id)"
        >
          <span>Chat to AI</span>
          <kbd>Ctrl L</kbd>
        </button>
        <div
          v-if="suggestionPanel.panelId === panel.id && (suggestionItems.length || aiSuggestLoading)"
          class="terminal-suggestions"
          :class="{ 'selection-mode': suggestionSelectionMode }"
          :style="{ left: `${suggestionPosition.left}px`, top: `${suggestionPosition.top}px` }"
        >
          <div class="suggestion-list">
            <div
              v-if="aiSuggestLoading"
              class="suggestion-item ai ai-loading-item"
            >
              <Sparkles class="ai-loading-icon" />
              <span>AI Thinking</span>
              <span class="ai-loading-dots" aria-hidden="true">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </span>
            </div>
            <button
              v-for="(suggestion, index) in suggestionItems"
              :key="suggestion.command"
              class="suggestion-item"
              :class="{ active: index === activeSuggestion }"
              @mousedown.prevent="applySuggestion(suggestion.command)"
            >
              <Clock v-if="suggestion.source === 'history'" />
              <ListTree v-else-if="suggestion.source === 'base'" />
              <Sparkles v-else />
              <span>{{ suggestion.command }}</span>
              <small>{{ suggestion.explanation }}</small>
            </button>
          </div>
          <span
            v-if="suggestionSelectionMode && activeSuggestion >= 0"
            class="terminal-suggestion-arrow"
            :style="{ top: `${(activeSuggestion + (aiSuggestLoading ? 1 : 0)) * 30 + 3}px` }"
            title="Press Enter to complete command"
            aria-hidden="true"
          ></span>
          <div class="keyboard-hints">
            <span><kbd>esc</kbd> 关闭</span>
            <span v-if="!suggestionSelectionMode"><kbd>→</kbd> 选择</span>
            <span v-if="suggestionSelectionMode"><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span v-if="suggestionSelectionMode && activeSuggestion >= 0"><kbd>↵</kbd> 确认</span>
            <span
              v-if="!suggestionSelectionMode && !aiSuggestLoading && !hasAiSuggestion"
              class="ai-trigger"
              @mouseenter="triggerAiSuggestion"
            ><Sparkles /> AI</span>
            <span
              v-if="!suggestionSelectionMode && aiSuggestLoading"
              class="ai-trigger ai-trigger-loading"
            >
              <Sparkles class="ai-loading-icon" />
              <span class="ai-loading-dots" aria-hidden="true">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </span>
            </span>
          </div>
        </div>
        </template>
      </div>
      </template>
    </div>

    <TransferProgress v-if="workspace.activeModule === 'workspace'" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { ChevronDown, ChevronUp, Clock, ListTree, LoaderCircle, RadioTower, Search, Sparkles, Terminal, X } from 'lucide-vue-next'
import TransferProgress from '@/components/files/TransferProgress.vue'
import KnowledgeCenterEditor from '@/components/KnowledgeCenterEditor.vue'
import type { SettingSectionKey } from '@/config/settings'
import { useWorkspaceStore, type TerminalPanel, type TerminalSettings } from '@/stores/workspace'
import { copyTextToClipboard, mirrorTextToClipboardQuietly, readTextFromClipboard } from '@/services/clipboardRuntime'
import { createTerminalZmodemRuntime, type TerminalZmodemProgress } from '@/services/zmodemRuntime'
import { useI18n } from '@/i18n'
import type {
  ControlAiAttentionSummary,
  ControlAgentTeamLaunchMember,
  ControlAgentTeamLaunchResult,
  ControlAgentTeamLaunchSource,
  ControlManagedAiSessionSummary,
  ControlRequest,
  ControlResponse,
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlSessionPanelSnapshot,
  ControlSessionRestoreResult,
  ControlSessionSnapshot,
  ControlSplitGroupSummary,
  ControlWorkspaceRemoteSummary,
  ControlSurfaceTelemetrySummary,
  ControlSurfaceResumeBindingSummary,
  ControlSurfaceSummary,
  ControlTerminalSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceSnapshot,
  RuntimeLogLevel,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext,
  TerminalDataEvent,
  TerminalKillResult,
  TerminalSessionInfo
} from '@shared/preload'

const workspace = useWorkspaceStore()
const { t } = useI18n()
type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string }
const setXtermTermName = (terminal: XtermTerminal, terminalType: string) => {
  ;(terminal.options as XtermRuntimeOptions).termName = terminalType || 'xterm-256color'
}
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isTerminalKillSuccess = (result: TerminalKillResult | null | undefined, sessionId: string) =>
  result?.ok === true && isRecord(result.data) && result.data.id === sessionId
const search = ref('')
const command = ref('')
const globalCommand = ref('')
const globalInputVisible = ref(false)
const renamingId = ref('')
const renameText = ref('')
const menu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
const termMenu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
const terminalGrid = ref<HTMLElement | null>(null)
const searchOverlayInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
const commandLineInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
const commandDialogInput = ref<HTMLTextAreaElement | HTMLTextAreaElement[] | null>(null)
const commandDialogRef = ref<HTMLElement | HTMLElement[] | null>(null)
const searchOverlayPanelId = ref('')
const searchMatchCount = ref(0)
const searchMatchIndex = ref(0)
const aiButtonPanelId = ref('')
const aiButtonPosition = reactive({ top: 0, right: 26 })
const suggestionPanel = reactive({ panelId: '' })
const suggestionPosition = reactive({ left: 38, top: 0 })
const suggestionSelectionMode = ref(false)
const activeSuggestion = ref(-1)
const aiSuggestLoading = ref(false)
const commandLinePanelId = ref('')
let offData: (() => void) | null = null
let offLifecycle: (() => void) | null = null
let offExit: (() => void) | null = null
let offControlRequest: (() => void) | null = null
let zmodemProgressHideTimer: number | null = null
const closeTerminalMenusFromDocument = () => {
  menu.visible = false
  termMenu.visible = false
}
const defaultTerminalFontSize = () => workspace.terminalSettings.fontSize || 12
const paneFontSizes = reactive<Record<string, number>>({})
const terminalFontSizeForPanel = (panelId: string) => paneFontSizes[panelId] || defaultTerminalFontSize()
const terminalSettingsSignature = () => {
  const settings = workspace.terminalSettings
  return [
    settings.terminalType,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.cursorBlink,
    settings.cursorStyle,
    settings.scrollBack
  ].join('|')
}
const terminalElements = new Map<string, HTMLElement>()
type TerminalView = {
  terminal: XtermTerminal
  fit: FitAddon
  search: SearchAddon
  lastOutput: string
  suppressInputReplyDepth?: number
  lastFitCols?: number
  lastFitRows?: number
  resizeObserver?: ResizeObserver
}

const terminalViews = new Map<string, TerminalView>()
const commandDialog = reactive({
  visible: false,
  panelId: '',
  instruction: '',
  modelName: '',
  generatedCommand: '',
  loading: false,
  error: '',
  top: 0,
  left: 0,
  width: 520
})

type TerminalSuggestion = TerminalCommandSuggestion

const terminalSuggestionSources = new Set<TerminalSuggestion['source']>(['base', 'history', 'ai'])

const controlOk = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const controlFail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const controlText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const controlNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numberValue)))
}

const controlBool = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return fallback
}

type ControlWorkspaceGroupState = Omit<ControlWorkspaceGroupSummary, 'ref' | 'memberCount' | 'active'>
type ControlSurfaceResumeBindingState = ControlSurfaceResumeBindingSummary
type ControlProjectState = {
  surfaceId: string
  projectUrl: string
  activeTab: string
  selectedScheme: string
  selectedConfiguration: string
  selectedTargetId: string
  selectedFile: string
  settingsFilter: string
  updatedAt: number
}
type ControlSurfaceTelemetryState = {
  ttyName?: string
  shellState?: 'prompt' | 'running' | 'unknown'
  lastShellStateAt?: number
  lastTtyAt?: number
  lastPortsKickAt?: number
  lastPortsKickReason?: 'command' | 'refresh'
}
type ControlWorkspaceRemoteState = {
  surfaceId: string
  transport: 'ssh'
  destination: string
  host: string
  port: number
  username: string
  assetName: string
  assetId?: string
  proxyName?: string
  needProxy?: boolean
  foregroundAuthReadyAt?: number
  updatedAt: number
}
type ControlWorkspaceEnvironmentState = {
  env: Record<string, string>
  updatedAt: number
}

const controlWorkspaceGroups = ref<ControlWorkspaceGroupState[]>([])
const controlSurfaceResumeBindings = ref<Record<string, ControlSurfaceResumeBindingState>>({})
const controlProjectStates = ref<Record<string, ControlProjectState>>({})
const controlSurfaceTelemetry = ref<Record<string, ControlSurfaceTelemetryState>>({})
const controlWorkspaceRemote = ref<ControlWorkspaceRemoteState | null>(null)
const controlWorkspaceEnvironment = ref<ControlWorkspaceEnvironmentState>({ env: {}, updatedAt: Date.now() })
const lastActiveControlPanelId = ref('')
const controlFlashingPanelIds = ref<string[]>([])
let controlFlashTimer: number | null = null

const normalizeWorkspaceGroupId = (value: unknown) => {
  const text = controlText(value)
  if (!text) return ''
  const refMatch = text.match(/^workspace_group:(\d+)$/i)
  if (!refMatch) return text
  const index = Number(refMatch[1])
  if (!Number.isFinite(index) || index < 1) return text
  return controlWorkspaceGroups.value[index - 1]?.id || text
}

const workspaceGroupRefForControl = (groupId: string) => {
  const index = controlWorkspaceGroups.value.findIndex((group) => group.id === groupId)
  return index >= 0 ? `workspace_group:${index + 1}` : groupId
}

const panelMatchesControlId = (panel: TerminalPanel, id: string) => panel.id === id || panel.sessionId === id

const panelRefForControl = (panelId: string) => {
  const panels = selectableControlPanels()
  const index = panels.findIndex((panel) => panel.id === panelId)
  return index >= 0 ? `surface:${index + 1}` : panelId
}

const resolveControlPanelId = (value: unknown) => {
  const id = controlText(value)
  if (!id) return ''
  const panel = workspace.panels.find((item) => panelMatchesControlId(item, id))
  return panel?.id || ''
}

const resolveControlSurfacePanel = (params: Record<string, unknown> = {}) => {
  const panelId = controlText(params.panelId || params.surfaceId || params.surface_id || params.tabId || params.tab_id)
  const sessionId = controlText(params.sessionId || params.terminalSessionId || params.terminal_session_id || params.terminalId || params.terminal_id)
  if (panelId || sessionId) {
    return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
  }
  return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
}

const resolveControlSourceSurfacePanel = (params: Record<string, unknown> = {}) => {
  const panelId = controlText(params.surfaceId || params.surface_id || params.tabId || params.tab_id || params.panelId || params.panel_id || params.id || params.target)
  const sessionId = controlText(params.sessionId || params.terminalSessionId || params.terminal_session_id || params.terminalId || params.terminal_id)
  if (panelId || sessionId) {
    return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
  }
  return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
}

const controlPanelIndexFromValue = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return null
  return Math.floor(numberValue)
}

const resolveControlAnchorPanel = (params: Record<string, unknown> = {}, anchor: 'before' | 'after') => {
  const pascal = anchor.charAt(0).toUpperCase() + anchor.slice(1)
  const panelId = controlText(
    params[`${anchor}SurfaceId`] ||
      params[`${anchor}_surface_id`] ||
      params[`${anchor}PanelId`] ||
      params[`${anchor}_panel_id`] ||
      params[`${anchor}PaneId`] ||
      params[`${anchor}_pane_id`] ||
      params[anchor] ||
      params[`target${pascal}SurfaceId`] ||
      params[`target_${anchor}_surface_id`]
  )
  if (!panelId) return null
  return workspace.panels.find((panel) => panelMatchesControlId(panel, panelId) || panel.title === panelId) || null
}

const resolveControlPanePanel = (params: Record<string, unknown> = {}, keyPrefix = '') => {
  const prefixed = (key: string) => (keyPrefix ? `${keyPrefix}${key.charAt(0).toUpperCase()}${key.slice(1)}` : key)
  const snakePrefix = keyPrefix ? `${keyPrefix}_` : ''
  const panelId = controlText(
    params[prefixed('paneId')] ||
      params[prefixed('panelId')] ||
      params[prefixed('surfaceId')] ||
      params[prefixed('pane_id')] ||
      params[prefixed('panel_id')] ||
      params[prefixed('surface_id')] ||
      params[`${snakePrefix}pane_id`] ||
      params[`${snakePrefix}panel_id`] ||
      params[`${snakePrefix}surface_id`]
  )
  const sessionId = controlText(
    params[prefixed('sessionId')] ||
      params[prefixed('terminalSessionId')] ||
      params[prefixed('terminal_session_id')] ||
      params[`${snakePrefix}session_id`] ||
      params[`${snakePrefix}terminal_session_id`]
  )
  if (panelId || sessionId) {
    return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
  }
  return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
}

const resolveWorkspaceGroup = (value: unknown) => {
  const groupId = normalizeWorkspaceGroupId(value)
  return controlWorkspaceGroups.value.find((group) => group.id === groupId || workspaceGroupRefForControl(group.id) === groupId) || null
}

const pruneWorkspaceGroups = () => {
  const panelIds = new Set(workspace.panels.map((panel) => panel.id))
  controlWorkspaceGroups.value = controlWorkspaceGroups.value
    .map((group) => {
      const memberPanelIds = group.memberPanelIds.filter((panelId) => panelIds.has(panelId))
      const anchorPanelId = panelIds.has(group.anchorPanelId) ? group.anchorPanelId : memberPanelIds[0] || ''
      return { ...group, anchorPanelId, memberPanelIds: [...new Set(memberPanelIds)] }
    })
    .filter((group) => group.anchorPanelId && group.memberPanelIds.length)
  controlSurfaceResumeBindings.value = Object.fromEntries(Object.entries(controlSurfaceResumeBindings.value).filter(([panelId]) => panelIds.has(panelId)))
  controlProjectStates.value = Object.fromEntries(Object.entries(controlProjectStates.value).filter(([panelId]) => panelIds.has(panelId)))
  controlSurfaceTelemetry.value = Object.fromEntries(Object.entries(controlSurfaceTelemetry.value).filter(([panelId]) => panelIds.has(panelId)))
  if (controlWorkspaceRemote.value && !panelIds.has(controlWorkspaceRemote.value.surfaceId)) controlWorkspaceRemote.value = null
}

const groupForPanelId = (panelId: string) => {
  pruneWorkspaceGroups()
  return controlWorkspaceGroups.value.find((group) => group.memberPanelIds.includes(panelId)) || null
}

const terminalKindForControl = (panel: TerminalPanel): ControlTerminalSummary['kind'] => {
  if (panel.sshSession) return 'ssh'
  if (panel.sessionId || panel.terminalLifecycle?.kind === 'local') return 'local'
  return 'unknown'
}

const terminalSummaryForControl = (panel: TerminalPanel): ControlTerminalSummary => {
  const view = terminalViews.get(panel.id)
  const lifecycle = panel.terminalLifecycle
  return {
    panelId: panel.id,
    panel_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    terminalId: panel.id,
    terminal_id: panel.id,
    ...(panel.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
    title: panel.title,
    ...(panel.titleSource ? { titleSource: panel.titleSource, title_source: panel.titleSource } : {}),
    kind: terminalKindForControl(panel),
    active: panel.id === workspace.activePanelId,
    connected: Boolean(panel.sessionId),
    status: panel.status,
    cwd: panel.cwd,
    ...(lifecycle?.shell ? { shell: lifecycle.shell } : {}),
    ...(typeof lifecycle?.processId === 'number' ? { processId: lifecycle.processId } : {}),
    ...(typeof lifecycle?.processGroupId === 'number' ? { processGroupId: lifecycle.processGroupId } : {}),
    ...(panel.sshSession?.host ? { host: panel.sshSession.host } : {}),
    ...(panel.sshSession?.port ? { port: panel.sshSession.port } : {}),
    ...(panel.sshSession?.username ? { username: panel.sshSession.username } : {}),
    ...(panel.sshSession?.assetId ? { assetId: panel.sshSession.assetId } : {}),
    ...(panel.sshSession?.assetName ? { assetName: panel.sshSession.assetName } : {}),
    ...(view ? { cols: view.terminal.cols, rows: view.terminal.rows } : {})
  }
}

const surfaceTelemetrySummaryForControl = (state?: ControlSurfaceTelemetryState): ControlSurfaceTelemetrySummary | undefined => {
  if (!state) return undefined
  return {
    ...(state.ttyName ? { ttyName: state.ttyName, tty_name: state.ttyName } : {}),
    ...(state.shellState ? { shellState: state.shellState, shell_state: state.shellState } : {}),
    ...(typeof state.lastShellStateAt === 'number' ? { lastShellStateAt: state.lastShellStateAt, last_shell_state_at: state.lastShellStateAt } : {}),
    ...(typeof state.lastTtyAt === 'number' ? { lastTtyAt: state.lastTtyAt, last_tty_at: state.lastTtyAt } : {}),
    ...(typeof state.lastPortsKickAt === 'number' ? { lastPortsKickAt: state.lastPortsKickAt, last_ports_kick_at: state.lastPortsKickAt } : {}),
    ...(state.lastPortsKickReason ? { lastPortsKickReason: state.lastPortsKickReason, last_ports_kick_reason: state.lastPortsKickReason } : {})
  }
}

const surfaceSummaryForControl = (panel: TerminalPanel): ControlSurfaceSummary => {
  const workspaceGroup = groupForPanelId(panel.id)
  const resumeBinding = controlSurfaceResumeBindings.value[panel.id]
  const telemetry = surfaceTelemetrySummaryForControl(controlSurfaceTelemetry.value[panel.id])
  return {
    panelId: panel.id,
    panel_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    title: panel.title,
    ...(panel.titleSource ? { titleSource: panel.titleSource, title_source: panel.titleSource } : {}),
    surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
    active: panel.id === workspace.activePanelId,
    status: panel.status,
    cwd: panel.cwd,
    ...(panel.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
    ...(panel.kind === 'knowledge' ? {} : { terminalKind: terminalKindForControl(panel), connected: Boolean(panel.sessionId) }),
    ...(panel.split ? { split: panel.split } : {}),
    ...(panel.splitSourceId ? { splitSourceId: panel.splitSourceId } : {}),
    ...(panel.splitGroupId ? { splitGroupId: panel.splitGroupId } : {}),
    ...(typeof panel.splitOrder === 'number' ? { splitOrder: panel.splitOrder } : {}),
    ...(workspaceGroup ? { workspaceGroupId: workspaceGroup.id, workspaceGroupName: workspaceGroup.name } : {}),
    ...(resumeBinding ? { resumeBinding, resume_binding: resumeBinding } : {}),
    ...(telemetry ? { telemetry } : {}),
    ...(panel.knowledge
      ? {
          knowledge: {
            relPath: panel.knowledge.relPath,
            isImage: panel.knowledge.isImage,
            ...(typeof panel.knowledge.startLine === 'number' ? { startLine: panel.knowledge.startLine } : {}),
            ...(typeof panel.knowledge.endLine === 'number' ? { endLine: panel.knowledge.endLine } : {})
          }
        }
      : {})
  }
}

const splitGroupsForControl = (surfaces: ControlSurfaceSummary[]): ControlSplitGroupSummary[] => {
  const groups = new Map<string, ControlSurfaceSummary[]>()
  surfaces.forEach((surface) => {
    const groupId = surface.splitGroupId || (surface.split ? surface.splitSourceId || surface.panelId : '')
    if (!groupId) return
    groups.set(groupId, [...(groups.get(groupId) || []), surface])
  })
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([id, items]) => {
      const directions = new Set(items.map((item) => item.split).filter(Boolean))
      return {
        id,
        panelIds: items.map((item) => item.panelId),
        count: items.length,
        ...(items.some((item) => item.active) ? { activePanelId: items.find((item) => item.active)?.panelId } : {}),
        direction: directions.size === 1 ? ([...directions][0] as 'right' | 'below') : 'mixed'
      }
    })
}

const workspaceGroupSummaryForControl = (group: ControlWorkspaceGroupState): ControlWorkspaceGroupSummary => ({
  id: group.id,
  ref: workspaceGroupRefForControl(group.id),
  name: group.name,
  anchorPanelId: group.anchorPanelId,
  memberPanelIds: [...group.memberPanelIds],
  memberCount: group.memberPanelIds.length,
  collapsed: group.collapsed,
  pinned: group.pinned,
  index: group.index,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
  ...(group.cwd ? { cwd: group.cwd } : {}),
  ...(group.color ? { color: group.color } : {}),
  ...(group.icon ? { icon: group.icon } : {}),
  active: group.memberPanelIds.includes(workspace.activePanelId)
})

const remoteStateForControlPanel = (panel?: TerminalPanel | null) => {
  if (!panel?.sshSession) return 'local'
  if (panel.sessionId && (panel.status === 'running' || panel.status === 'ready' || panel.status === 'connecting')) return 'connected'
  if (panel.status === 'connecting') return 'connecting'
  if (panel.status === 'error') return 'error'
  return 'disconnected'
}

const remoteDisplayTargetForControl = (panel?: TerminalPanel | null, state?: ControlWorkspaceRemoteState | null) => {
  const ssh = panel?.sshSession
  const username = ssh?.username || state?.username
  const host = ssh?.host || state?.host || state?.destination
  const port = ssh?.port || state?.port
  if (!host) return ''
  return `${username ? `${username}@` : ''}${host}${port && port !== 22 ? `:${port}` : ''}`
}

const workspaceRemoteSummaryForControl = (): ControlWorkspaceRemoteSummary | null => {
  pruneWorkspaceGroups()
  const configured = controlWorkspaceRemote.value
  const configuredPanel = configured ? workspace.panels.find((panel) => panel.id === configured.surfaceId) || null : null
  const activePanel = workspace.panels.find((panel) => panel.id === workspace.activePanelId && panel.sshSession) || null
  const firstSshPanel = workspace.panels.find((panel) => panel.sshSession) || null
  const panel = configuredPanel || activePanel || firstSshPanel
  const ssh = panel?.sshSession
  if (!configured && !ssh) {
    return {
      configured: false,
      state: 'local',
      connectionState: 'local',
      connection_state: 'local'
    }
  }
  const state = panel ? remoteStateForControlPanel(panel) : 'configured'
  const displayTarget = remoteDisplayTargetForControl(panel, configured)
  return {
    configured: true,
    state,
    connectionState: state,
    connection_state: state,
    ...(displayTarget ? { displayTarget, display_target: displayTarget, remoteDisplayTarget: displayTarget, remote_display_target: displayTarget } : {}),
    ...(panel ? { surfaceId: panel.id, surface_id: panel.id, panelId: panel.id } : configured ? { surfaceId: configured.surfaceId, surface_id: configured.surfaceId, panelId: configured.surfaceId } : {}),
    ...(panel?.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
    transport: configured?.transport || 'ssh',
    ...(ssh?.host || configured?.host ? { host: ssh?.host || configured?.host, destination: ssh?.host || configured?.destination } : {}),
    ...(ssh?.port || configured?.port ? { port: ssh?.port || configured?.port } : {}),
    ...(ssh?.username || configured?.username ? { username: ssh?.username || configured?.username } : {}),
    ...(ssh?.assetId || configured?.assetId ? { assetId: ssh?.assetId || configured?.assetId } : {}),
    ...(ssh?.assetName || configured?.assetName ? { assetName: ssh?.assetName || configured?.assetName } : {}),
    ...(ssh?.proxyName || configured?.proxyName ? { proxyName: ssh?.proxyName || configured?.proxyName } : {}),
    ...((typeof ssh?.needProxy === 'boolean' || typeof configured?.needProxy === 'boolean') ? { needProxy: Boolean(ssh?.needProxy ?? configured?.needProxy) } : {}),
    ...(typeof configured?.foregroundAuthReadyAt === 'number' ? { foregroundAuthReadyAt: configured.foregroundAuthReadyAt, foreground_auth_ready_at: configured.foregroundAuthReadyAt } : {}),
    ...(typeof configured?.updatedAt === 'number' ? { updatedAt: configured.updatedAt, updated_at: configured.updatedAt } : {})
  }
}

const aiAttentionSummaryForControl = (item: (typeof workspace.pendingAiAttentionItems)[number]): ControlAiAttentionSummary => ({
  id: item.id,
  source: item.source,
  kind: item.kind,
  title: item.title,
  summary: item.summary,
  priority: item.priority,
  createdAt: item.createdAt,
  ...(item.conversationId ? { conversationId: item.conversationId } : {}),
  ...(item.sessionId ? { sessionId: item.sessionId } : {}),
  ...(item.surfaceId ? { surfaceId: item.surfaceId } : {}),
  ...(item.notificationId ? { notificationId: item.notificationId } : {})
})

const managedAiSessionSummaryForControl = (session: (typeof workspace.managedAiSessions)[number]): ControlManagedAiSessionSummary => ({
  id: session.id,
  source: session.source,
  title: session.title,
  summary: session.summary,
  state: session.state,
  lastEvent: session.lastEvent,
  lastActivityAt: session.lastActivityAt,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  needsInput: session.state === 'needsInput',
  requestKind: session.requestKind,
  decisionMode: session.decisionMode,
  ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
  ...(session.panelId ? { panelId: session.panelId } : {}),
  ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
  ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
  ...(session.cwd ? { cwd: session.cwd } : {}),
  ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
  ...(session.toolName ? { toolName: session.toolName } : {}),
  ...(session.launchCommand ? { launchCommand: session.launchCommand } : {}),
  ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
  ...(typeof session.processId === 'number' ? { processId: session.processId } : {}),
  ...(typeof session.parentProcessId === 'number' ? { parentProcessId: session.parentProcessId } : {}),
  ...(typeof session.processGroupId === 'number' ? { processGroupId: session.processGroupId } : {}),
  ...(session.agentLifecycle ? { agentLifecycle: session.agentLifecycle } : {}),
  ...(typeof session.terminalProcessId === 'number' ? { terminalProcessId: session.terminalProcessId } : {}),
  ...(typeof session.terminalActivityAt === 'number' ? { terminalActivityAt: session.terminalActivityAt } : {}),
  ...(session.hibernated ? { hibernated: true } : {}),
  ...(typeof session.hibernatedAt === 'number' ? { hibernatedAt: session.hibernatedAt } : {}),
  ...(session.hibernationReason ? { hibernationReason: session.hibernationReason } : {}),
  ...(session.hibernatedTerminalSessionId ? { hibernatedTerminalSessionId: session.hibernatedTerminalSessionId } : {}),
  eventCount: session.events.length,
  decisionCount: session.decisions.length
})

const workspaceSnapshotForControl = (): ControlWorkspaceSnapshot => {
  pruneWorkspaceGroups()
  const terminals = workspace.panels.filter((panel) => panel.kind !== 'knowledge').map(terminalSummaryForControl)
  const surfaces = workspace.panels.map(surfaceSummaryForControl)
  const splitGroups = splitGroupsForControl(surfaces)
  const workspaceGroups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
  const attentionItems = workspace.pendingAiAttentionItems.map(aiAttentionSummaryForControl)
  const managedAiSessions = workspace.managedAiSessions.map(managedAiSessionSummaryForControl)
  const remote = workspaceRemoteSummaryForControl()
  const environmentSummary = workspaceEnvironmentSummaryForControl()
  return {
    generatedAt: Date.now(),
    mode: workspace.mode,
    activeModule: workspace.activeModule,
    activePanelId: workspace.activePanelId,
    workspaces: [
      {
        id: 'main',
        title: 'Main Workspace',
        autoTitle: null,
        auto_title: null,
        titleSource: 'system',
        title_source: 'system',
        active: true,
        mode: workspace.mode,
        activeModule: workspace.activeModule,
        activePanelId: workspace.activePanelId,
        remoteDisplayTarget: remote?.remoteDisplayTarget || null,
        remote_display_target: remote?.remote_display_target || null,
        remoteConnectionState: remote?.connectionState || 'local',
        remote_connection_state: remote?.connection_state || 'local',
        remote
      }
    ],
    terminals,
    surfaces,
    splitGroups,
    workspaceGroups,
    notifications: workspace.controlNotifications.map((notification) => ({ ...notification })),
    managedAiSessions,
    agentHibernation: { ...workspace.agentHibernationConfig },
    remote,
    workspaceEnvironment: environmentSummary,
    workspace_environment: {
      keys: environmentSummary.keys,
      count: environmentSummary.count,
      updated_at: environmentSummary.updated_at
    },
    attention: {
      unreadCount: workspace.aiAttentionUnreadCount,
      items: attentionItems,
      ...(attentionItems[0] ? { current: attentionItems[0] } : {})
    },
    counts: {
      terminals: terminals.length,
      connectedTerminals: terminals.filter((terminal) => terminal.connected).length,
      surfaces: surfaces.length,
      splitGroups: splitGroups.length,
      workspaceGroups: workspaceGroups.length,
      notifications: workspace.controlNotifications.length,
      unreadNotifications: workspace.controlNotifications.filter((notification) => !notification.read).length,
      managedAiSessions: managedAiSessions.length,
      managedAiNeedsInput: managedAiSessions.filter((session) => session.needsInput).length,
      attentionItems: attentionItems.length
    }
  }
}

const controlSettingsTargetAliases: Record<string, SettingSectionKey> = {
  account: 'billing',
  accounts: 'billing',
  agent: 'ai',
  agents: 'ai',
  ai: 'ai',
  'ai-preferences': 'ai',
  aihooks: 'ai',
  billing: 'billing',
  docs: 'docs',
  documentation: 'docs',
  extensions: 'extensions',
  extension: 'extensions',
  general: 'general',
  hooks: 'ai',
  keyboard: 'shortcuts',
  keybindings: 'shortcuts',
  mcp: 'mcp',
  model: 'models',
  models: 'models',
  privacy: 'privacy',
  rules: 'rules',
  security: 'privacy',
  shortcuts: 'shortcuts',
  skills: 'skills',
  terminal: 'terminal',
  terminals: 'terminal',
  theme: 'general',
  trusted: 'trustedDevices',
  trusteddevices: 'trustedDevices',
  'trusted-devices': 'trustedDevices',
  updates: 'about',
  about: 'about'
}

const resolveControlSettingsSection = (value: unknown): SettingSectionKey | null => {
  const target = controlText(value || 'general')
  if (!target) return 'general'
  const normalized = target.replace(/[_\s]+/g, '-')
  return controlSettingsTargetAliases[normalized.toLowerCase()] || null
}

const normalizeControlKnowledgePath = (value: unknown) => {
  const text = controlText(value)
  if (!text) return ''
  return text.replace(/^kb:/i, '').replace(/^knowledge:\/\//i, '').replace(/^\/+/, '').replace(/\\/g, '/')
}

const findControlKnowledgeNode = async (relPath: string) => {
  let node = relPath ? workspace.findKnowledgeNode(relPath) : null
  if (node) return node
  await workspace.refreshKnowledgeTree()
  node = relPath ? workspace.findKnowledgeNode(relPath) : null
  return node
}

const controlKnowledgeOpenRange = (params: Record<string, unknown>) => {
  const startLine = controlNumber(params.startLine || params.start_line || params.line, 0, 0, 1_000_000)
  const endLine = controlNumber(params.endLine || params.end_line, 0, 0, 1_000_000)
  return startLine > 0
    ? {
        startLine,
        ...(endLine > 0 ? { endLine } : {})
      }
    : undefined
}

const focusControlSurfacePanel = async (panel: TerminalPanel, requestedFocus = true) => {
  workspace.mode = 'terminal'
  workspace.activeModule = 'workspace'
  workspace.activePanelId = panel.id
  await nextTick()
  if (requestedFocus && panel.kind !== 'knowledge') terminalViews.get(panel.id)?.terminal.focus()
}

const controlFileOpenRawPaths = (params: Record<string, unknown>) => {
  if (Array.isArray(params.paths)) return params.paths.map(controlText).filter(Boolean)
  if (Array.isArray(params.path)) return params.path.map(controlText).filter(Boolean)
  const rawPath = controlText(params.path || params.filePath || params.file_path || params.relPath || params.rel_path)
  return rawPath ? [rawPath] : []
}

const openControlKnowledgeFiles = async (params: Record<string, unknown>, method: string) => {
  const rawPaths = controlFileOpenRawPaths(params)
  if (!rawPaths.length) return controlFail('FILE_PATH_REQUIRED', `${method} requires a path.`)
  const openedPanels: TerminalPanel[] = []
  const unsupported: Array<{ path: string; relPath: string; unsupportedReason: string }> = []
  const sourcePanel = resolveControlSourceSurfacePanel(params)
  const previousActivePanelId = workspace.activePanelId
  for (const rawPath of rawPaths) {
    const relPath = normalizeControlKnowledgePath(rawPath)
    const node = await findControlKnowledgeNode(relPath)
    if (!node || node.type !== 'file') {
      const absolute = rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)
      unsupported.push({
        path: rawPath,
        relPath,
        unsupportedReason: absolute
          ? 'aiopsterm does not yet expose arbitrary local files as shared work-panel surfaces; import or create the file in Knowledge first.'
          : 'The requested knowledge file was not found.'
      })
      continue
    }
    const panel = workspace.openKnowledgeFile(relPath, controlKnowledgeOpenRange(params))
    if (panel) openedPanels.push(panel)
  }
  const primary = openedPanels[openedPanels.length - 1] || null
  if (!primary && unsupported.length) {
    const allUnsupported = unsupported.every((item) => rawPaths.includes(item.path))
    return controlOk({
      opened: false,
      unsupported: allUnsupported,
      unsupportedReason: unsupported[0].unsupportedReason,
      path: unsupported[0].path,
      paths: rawPaths,
      relPath: unsupported[0].relPath,
      rel_path: unsupported[0].relPath,
      failures: unsupported,
      method
    })
  }
  if (!primary) return controlFail('KNOWLEDGE_FILE_OPEN_FAILED', 'Knowledge file could not be opened.', { paths: rawPaths })
  if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
    workspace.activePanelId = previousActivePanelId
  } else {
    await focusControlSurfacePanel(primary, false)
  }
  const surfaces = openedPanels.map((panel) => surfaceSummaryForControl(panel))
  return controlOk({
    opened: true,
    path: primary.knowledge?.relPath || primary.cwd,
    paths: openedPanels.map((panel) => panel.knowledge?.relPath || panel.cwd || panel.id),
    relPath: primary.knowledge?.relPath || '',
    rel_path: primary.knowledge?.relPath || '',
    surfaceId: primary.id,
    surface_id: primary.id,
    surfaceRef: panelRefForControl(primary.id),
    surface_ref: panelRefForControl(primary.id),
    panelId: primary.id,
    paneId: primary.id,
    pane_id: primary.id,
    sourceSurfaceId: sourcePanel?.id || null,
    source_surface_id: sourcePanel?.id || null,
    workspaceId: 'main',
    workspace_id: 'main',
    surface: surfaceSummaryForControl(primary),
    surfaces,
    failures: unsupported,
    unsupported: unsupported.length > 0,
    ...(unsupported[0] ? { unsupportedReason: unsupported[0].unsupportedReason } : {}),
    snapshot: workspaceSnapshotForControl()
  })
}

const projectStatePayloadForControl = (state: ControlProjectState, panel?: TerminalPanel | null) => ({
  surface_id: state.surfaceId,
  surfaceId: state.surfaceId,
  project_url: state.projectUrl,
  projectUrl: state.projectUrl,
  active_tab: state.activeTab,
  activeTab: state.activeTab,
  selected_scheme: state.selectedScheme,
  selectedScheme: state.selectedScheme,
  selected_configuration: state.selectedConfiguration,
  selectedConfiguration: state.selectedConfiguration,
  selected_target_id: state.selectedTargetId,
  selectedTargetId: state.selectedTargetId,
  selected_file: state.selectedFile,
  selectedFile: state.selectedFile,
  settings_filter: state.settingsFilter,
  settingsFilter: state.settingsFilter,
  load_state: panel?.kind === 'knowledge' ? 'loaded' : 'unsupported',
  loadState: panel?.kind === 'knowledge' ? 'loaded' : 'unsupported',
  unsupported: true,
  unsupportedReason: 'aiopsterm stores project.open compatibility metadata; Xcode schemes, targets, and build settings do not have a native aiopsterm project panel yet.',
  ...(panel ? { surface: surfaceSummaryForControl(panel) } : {})
})

const resolveControlProjectPanel = (params: Record<string, unknown>) => {
  const surface = resolveControlSourceSurfacePanel(params)
  if (surface && controlProjectStates.value[surface.id]) return surface
  const surfaceId = controlText(params.surfaceId || params.surface_id || params.panelId || params.panel_id)
  if (surfaceId) return workspace.panels.find((panel) => panel.id === surfaceId && controlProjectStates.value[panel.id]) || null
  const active = workspace.panels.find((panel) => panel.id === workspace.activePanelId)
  if (active && controlProjectStates.value[active.id]) return active
  const firstProjectSurfaceId = Object.keys(controlProjectStates.value)[0]
  return firstProjectSurfaceId ? workspace.panels.find((panel) => panel.id === firstProjectSurfaceId) || null : null
}

const handleProjectFileControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'markdown.open' || method === 'file.open') return openControlKnowledgeFiles(params, method)

  if (method === 'project.open') {
    const rawPath = controlText(params.path || params.projectPath || params.project_path)
    if (!rawPath) return controlFail('PROJECT_PATH_REQUIRED', 'project.open requires a path.')
    const existingFile = await findControlKnowledgeNode(normalizeControlKnowledgePath(rawPath))
    const previousActivePanelId = workspace.activePanelId
    let panel: TerminalPanel | null = null
    if (existingFile?.type === 'file') {
      panel = workspace.openKnowledgeFile(existingFile.relPath)
    } else {
      panel = resolveControlSourceSurfacePanel(params)
      if (!panel || panel.kind === 'knowledge') panel = workspace.createPanel()
      const title = rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath || 'Project'
      workspace.renamePanel(panel.id, title)
      panel.cwd = rawPath
    }
    if (!panel) return controlFail('PROJECT_OPEN_FAILED', 'Project surface could not be opened.')
    controlProjectStates.value = {
      ...controlProjectStates.value,
      [panel.id]: {
        surfaceId: panel.id,
        projectUrl: rawPath,
        activeTab: 'files',
        selectedScheme: '',
        selectedConfiguration: '',
        selectedTargetId: '',
        selectedFile: existingFile?.type === 'file' ? existingFile.relPath : '',
        settingsFilter: '',
        updatedAt: Date.now()
      }
    }
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    } else {
      await focusControlSurfacePanel(panel, false)
    }
    return controlOk({
      opened: true,
      path: rawPath,
      window_id: 'main',
      windowId: 'main',
      workspace_id: 'main',
      workspaceId: 'main',
      pane_id: panel.id,
      paneId: panel.id,
      surface_id: panel.id,
      surfaceId: panel.id,
      surface: surfaceSummaryForControl(panel),
      project: projectStatePayloadForControl(controlProjectStates.value[panel.id], panel),
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'project.get_state') {
    const panel = resolveControlProjectPanel(params)
    if (!panel) return controlFail('PROJECT_SURFACE_NOT_FOUND', 'Project surface not found.')
    return controlOk(projectStatePayloadForControl(controlProjectStates.value[panel.id], panel))
  }

  const panel = resolveControlProjectPanel(params)
  if (!panel) return controlFail('PROJECT_SURFACE_NOT_FOUND', 'Project surface not found.')
  const state = { ...controlProjectStates.value[panel.id], updatedAt: Date.now() }
  if (method === 'project.set_tab') {
    const tab = controlText(params.tab) || 'files'
    const validTabs = new Set(['files', 'targets', 'buildSettings', 'schemes'])
    if (!validTabs.has(tab)) return controlFail('PROJECT_TAB_INVALID', 'tab must be one of files|targets|buildSettings|schemes.', { tab })
    state.activeTab = tab
  } else if (method === 'project.set_scheme') {
    state.selectedScheme = controlText(params.name || params.scheme)
  } else if (method === 'project.set_configuration') {
    state.selectedConfiguration = controlText(params.name || params.configuration)
  } else if (method === 'project.set_selected_target') {
    state.selectedTargetId = controlText(params.name || params.target || params.targetId || params.target_id)
  } else if (method === 'project.set_selected_file') {
    state.selectedFile = controlText(params.path || params.file || params.filePath || params.file_path)
  } else if (method === 'project.set_settings_filter') {
    state.settingsFilter = controlText(params.text || params.filter || params.query)
  } else {
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }
  controlProjectStates.value = { ...controlProjectStates.value, [panel.id]: state }
  return controlOk(projectStatePayloadForControl(state, panel))
}

const workspaceSidebarRowsForControl = (snapshot: ControlWorkspaceSnapshot) =>
  snapshot.workspaces.map((item, index) => ({
    id: item.id,
    ref: item.id === 'main' ? 'workspace:1' : item.id,
    index,
    title: item.title,
    description: null,
    selected: item.active,
    pinned: true,
    root_path: null,
    project_root_path: null,
    branch_summary: null,
    remote_display_target: snapshot.remote?.remote_display_target || item.remote_display_target || null,
    remote_connection_state: snapshot.remote?.connection_state || item.remote_connection_state || 'local',
    remote: snapshot.remote || null,
    current_directory: workspace.activePanel.kind === 'terminal' ? workspace.activePanel.cwd : '',
    custom_color: null,
    unread_count: snapshot.attention.unreadCount,
    latest_notification_text: snapshot.attention.items[0]?.summary || snapshot.attention.items[0]?.title || null,
    latest_conversation_message: null,
    latest_submitted_message: null,
    latest_submitted_at: null,
    listening_ports: [],
    pull_request_urls: [],
    panel_directories: snapshot.terminals.map((terminal) => terminal.cwd || '').filter(Boolean),
    git_branches: []
  }))

const sessionPanelSnapshotForControl = (panel: TerminalPanel): ControlSessionPanelSnapshot => {
  const resumeBinding = controlSurfaceResumeBindings.value[panel.id]
  return {
    id: panel.id,
    title: panel.title,
    cwd: panel.cwd,
    kind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
    status: panel.status,
    ...(panel.kind !== 'knowledge' ? { terminalKind: terminalKindForControl(panel) } : {}),
    ...(panel.split ? { split: panel.split } : {}),
    ...(panel.splitSourceId ? { splitSourceId: panel.splitSourceId } : {}),
    ...(panel.splitGroupId ? { splitGroupId: panel.splitGroupId } : {}),
    ...(typeof panel.splitOrder === 'number' ? { splitOrder: panel.splitOrder } : {}),
    ...(panel.sshSession
      ? {
          sshSession: {
            host: panel.sshSession.host,
            port: panel.sshSession.port,
            username: panel.sshSession.username,
            ...(panel.sshSession.assetId ? { assetId: panel.sshSession.assetId } : {}),
            ...(panel.sshSession.assetName ? { assetName: panel.sshSession.assetName } : {}),
            ...(panel.sshSession.assetType ? { assetType: panel.sshSession.assetType } : {}),
            ...(panel.sshSession.organizationId ? { organizationId: panel.sshSession.organizationId } : {}),
            ...(panel.sshSession.jumpHostId ? { jumpHostId: panel.sshSession.jumpHostId } : {}),
            ...(panel.sshSession.authType ? { authType: panel.sshSession.authType } : {}),
            ...(typeof panel.sshSession.needProxy === 'boolean' ? { needProxy: panel.sshSession.needProxy } : {}),
            ...(panel.sshSession.proxyName ? { proxyName: panel.sshSession.proxyName } : {}),
            ...(panel.sshSession.forkFromConnectionId ? { forkFromConnectionId: panel.sshSession.forkFromConnectionId } : {})
          }
        }
      : {}),
    ...(panel.knowledge
      ? {
          knowledge: {
            relPath: panel.knowledge.relPath,
            isImage: panel.knowledge.isImage,
            ...(typeof panel.knowledge.startLine === 'number' ? { startLine: panel.knowledge.startLine } : {}),
            ...(typeof panel.knowledge.endLine === 'number' ? { endLine: panel.knowledge.endLine } : {})
          }
        }
      : {}),
    ...(resumeBinding ? { resumeBinding: { ...resumeBinding } } : {})
  }
}

const exportSessionSnapshotForControl = (params: Record<string, unknown> = {}): ControlSessionSnapshot => {
  pruneWorkspaceGroups()
  const now = Date.now()
  const id = controlText(params.id || params.name) || 'latest'
  const panels = workspace.panels
    .filter((panel) => !isWelcomePlaceholderPanel(panel))
    .map(sessionPanelSnapshotForControl)
  return {
    id,
    name: controlText(params.name) || (id === 'latest' ? 'Latest Session' : id),
    version: 1,
    createdAt: now,
    updatedAt: now,
    activePanelId: panels.some((panel) => panel.id === workspace.activePanelId) ? workspace.activePanelId : panels[0]?.id || 'panel-main',
    mode: workspace.mode,
    activeModule: workspace.activeModule,
    panels: panels.length
      ? panels
      : [
          {
            id: 'panel-main',
            title: 'Terminal',
            cwd: '~',
            kind: 'terminal',
            status: 'ready',
            terminalKind: 'unknown'
          }
        ],
    workspaceGroups: controlWorkspaceGroups.value.map((group, index) => ({ ...group, index })),
    agentHibernation: { ...workspace.agentHibernationConfig },
    source: controlText(params.source) || 'renderer'
  }
}

const normalizeSessionRestoreSnapshot = (value: unknown): ControlSessionSnapshot | null => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels) || !value.panels.length) return null
  const panels = value.panels.filter((panel): panel is ControlSessionPanelSnapshot => {
    if (!isRecord(panel) || !controlText(panel.id) || !controlText(panel.title)) return false
    return panel.kind === 'terminal' || panel.kind === 'knowledge'
  })
  if (!panels.length) return null
  const panelIds = new Set(panels.map((panel) => panel.id))
  const workspaceGroups = (Array.isArray(value.workspaceGroups) ? value.workspaceGroups : [])
    .filter((group): group is ControlWorkspaceGroupState => Boolean(isRecord(group) && controlText(group.id) && controlText(group.name) && Array.isArray(group.memberPanelIds)))
    .map((group, index) => {
      const memberPanelIds = group.memberPanelIds.filter((panelId) => panelIds.has(panelId))
      const anchorPanelId = panelIds.has(group.anchorPanelId) ? group.anchorPanelId : memberPanelIds[0] || ''
      return {
        id: group.id,
        name: group.name,
        anchorPanelId,
        memberPanelIds,
        collapsed: group.collapsed === true,
        pinned: group.pinned === true,
        index,
        createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now(),
        updatedAt: typeof group.updatedAt === 'number' ? group.updatedAt : Date.now(),
        ...(group.cwd ? { cwd: group.cwd } : {}),
        ...(group.color ? { color: group.color } : {}),
        ...(group.icon ? { icon: group.icon } : {})
      }
    })
    .filter((group) => group.anchorPanelId && group.memberPanelIds.length)
  return {
    id: controlText(value.id) || 'latest',
    name: controlText(value.name) || 'Latest Session',
    version: 1,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    activePanelId: panelIds.has(controlText(value.activePanelId)) ? controlText(value.activePanelId) : panels[0].id,
    mode: controlText(value.mode) || 'terminal',
    activeModule: controlText(value.activeModule) || 'workspace',
    panels,
    workspaceGroups,
    ...(isRecord(value.agentHibernation) ? { agentHibernation: value.agentHibernation as ControlSessionSnapshot['agentHibernation'] } : {}),
    ...(controlText(value.source) ? { source: controlText(value.source) } : {})
  }
}

const panelFromSessionSnapshot = (item: ControlSessionPanelSnapshot): TerminalPanel => ({
  id: item.id,
  title: item.title,
  cwd: item.cwd || '~',
  output: '',
  outputSegments: [],
  status: item.kind === 'knowledge' ? 'ready' : item.terminalKind === 'ssh' ? 'closed' : 'ready',
  kind: item.kind,
  ...(item.split ? { split: item.split } : {}),
  ...(item.splitSourceId ? { splitSourceId: item.splitSourceId } : {}),
  ...(item.splitGroupId ? { splitGroupId: item.splitGroupId } : {}),
  ...(typeof item.splitOrder === 'number' ? { splitOrder: item.splitOrder } : {}),
  ...(item.knowledge
    ? {
        knowledge: {
          relPath: item.knowledge.relPath,
          isImage: item.knowledge.isImage,
          ...(typeof item.knowledge.startLine === 'number' ? { startLine: item.knowledge.startLine } : {}),
          ...(typeof item.knowledge.endLine === 'number' ? { endLine: item.knowledge.endLine } : {})
        }
      }
    : {}),
  ...(item.sshSession
    ? {
        sshSession: {
          host: item.sshSession.host,
          port: item.sshSession.port,
          username: item.sshSession.username,
          assetId: item.sshSession.assetId,
          assetName: item.sshSession.assetName || item.title,
          assetType: item.sshSession.assetType,
          organizationId: item.sshSession.organizationId,
          jumpHostId: item.sshSession.jumpHostId,
          authType: item.sshSession.authType,
          needProxy: item.sshSession.needProxy,
          proxyName: item.sshSession.proxyName || '',
          forkFromConnectionId: item.sshSession.forkFromConnectionId
        }
      }
    : {})
})

const closeCurrentTerminalSessionsForRestore = async () => {
  if (typeof window.aiops?.killTerminal !== 'function') return
  const sessionIds = [...new Set(workspace.panels.map((panel) => panel.sessionId).filter((sessionId): sessionId is string => Boolean(sessionId)))]
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      try {
        await window.aiops!.killTerminal(sessionId)
      } catch {
        // Restore replaces the visible panels even if an old session already exited.
      }
    })
  )
}

const restoreLocalSessionPanel = async (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge' || panel.sshSession) return false
  if (typeof window.aiops?.createTerminal !== 'function') return false
  await nextTick()
  const size = terminalViewSize(panel.id)
  const restoredTitle = panel.title
  const session = await window.aiops.createTerminal({
    kind: 'local',
    panelId: panel.id,
    workspaceId: 'workspace',
    title: restoredTitle,
    cwd: panel.cwd && panel.cwd !== '~' ? panel.cwd : undefined,
    cols: size.cols,
    rows: size.rows,
    terminalType: workspace.terminalSettings.terminalType
  })
  const connected = workspace.applyLocalTerminalSession(panel.id, session)
  if (connected) {
    workspace.renamePanel(panel.id, restoredTitle)
    return true
  }
  panel.status = 'error'
  return false
}

const restoreSessionSnapshotForControl = async (params: Record<string, unknown>): Promise<ControlResponse> => {
  const snapshot = normalizeSessionRestoreSnapshot(params.snapshot)
  if (!snapshot) return controlFail('SESSION_SNAPSHOT_INVALID', 'Session restore snapshot is invalid.')
  await closeCurrentTerminalSessionsForRestore()
  const panels = snapshot.panels.map(panelFromSessionSnapshot)
  workspace.panels = panels.length ? panels : [panelFromSessionSnapshot({ id: 'panel-main', title: 'Terminal', cwd: '~', kind: 'terminal', status: 'ready', terminalKind: 'unknown' })]
  workspace.activePanelId = snapshot.activePanelId
  workspace.mode = snapshot.mode === 'agents' ? 'agents' : 'terminal'
  workspace.activeModule = snapshot.activeModule === 'workspace' ? 'workspace' : workspace.activeModule
  controlWorkspaceGroups.value = snapshot.workspaceGroups.map((group, index) => ({ ...group, index }))
  controlSurfaceResumeBindings.value = Object.fromEntries(
    snapshot.panels
      .filter((panel) => panel.resumeBinding?.command)
      .map((panel) => [panel.id, { ...panel.resumeBinding!, autoResume: Boolean(panel.resumeBinding!.autoResume), updatedAt: panel.resumeBinding!.updatedAt || Date.now() }])
  )
  pruneWorkspaceGroups()
  await nextTick()
  let launchedLocalTerminals = 0
  let skippedRemoteTerminals = 0
  for (const panel of workspace.panels) {
    if (panel.kind === 'knowledge') continue
    if (panel.sshSession) {
      skippedRemoteTerminals += 1
      continue
    }
    try {
      if (await restoreLocalSessionPanel(panel)) launchedLocalTerminals += 1
    } catch {
      panel.status = 'error'
    }
  }
  workspace.setTopNotice(`已恢复会话 ${snapshot.name}`)
  const result: ControlSessionRestoreResult = {
    snapshot: workspaceSnapshotForControl(),
    restoredSnapshot: snapshot,
    restoredPanels: snapshot.panels.length,
    restoredWorkspaceGroups: snapshot.workspaceGroups.length,
    restoredResumeBindings: Object.keys(controlSurfaceResumeBindings.value).length,
    launchedLocalTerminals,
    skippedRemoteTerminals
  }
  return controlOk(result as unknown as Record<string, unknown>)
}

const resolveRemoteWorkspacePanelForControl = (params: Record<string, unknown> = {}) => {
  const directPanel = resolveControlSourceSurfacePanel(params)
  if (directPanel && directPanel.kind !== 'knowledge') return directPanel
  const remoteSurfaceId = controlWorkspaceRemote.value?.surfaceId
  if (remoteSurfaceId) {
    const panel = workspace.panels.find((item) => item.id === remoteSurfaceId && item.kind !== 'knowledge')
    if (panel) return panel
  }
  return workspace.panels.find((panel) => panel.id === workspace.activePanelId && panel.kind !== 'knowledge') || workspace.panels.find((panel) => panel.kind !== 'knowledge') || null
}

const hasExplicitRemotePanelTarget = (params: Record<string, unknown> = {}) =>
  Boolean(controlText(params.surfaceId || params.surface_id || params.panelId || params.panel_id || params.paneId || params.pane_id || params.target))

const remoteControlPayload = (extra: Record<string, unknown> = {}) =>
  controlOk({
    window_id: null,
    window_ref: null,
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    remote: workspaceRemoteSummaryForControl(),
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const unsupportedRemoteControlPayload = (method: string, message: string, extra: Record<string, unknown> = {}) =>
  controlOk({
    workspaceId: controlText(extra.workspaceId) || 'main',
    workspace_id: controlText(extra.workspace_id || extra.workspaceId) || 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    method,
    unsupported: true,
    unsupportedReason: message,
    unsupported_reason: message,
    remote: workspaceRemoteSummaryForControl(),
    ...extra
  })

const handleWorkspaceRemoteControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.remote.status') return remoteControlPayload({ status: 'ok' })

  if (method === 'workspace.remote.configure') {
    const destination = controlText(params.destination || params.host || params.hostname || params.remoteHost)
    if (!destination) return controlFail('REMOTE_DESTINATION_REQUIRED', 'workspace.remote.configure requires destination.')
    if (destination.startsWith('-') || /[\u0000-\u001f\u007f]/.test(destination)) return controlFail('REMOTE_DESTINATION_INVALID', 'Invalid remote destination.')
    const port = controlNumber(params.port || params.sshPort || params.ssh_port, 22, 1, 65535)
    const username = controlText(params.username || params.user) || (destination.includes('@') ? destination.split('@')[0] : 'root')
    const host = destination.includes('@') ? destination.split('@').slice(1).join('@') || destination : destination
    const requestedPanel = hasExplicitRemotePanelTarget(params) ? resolveRemoteWorkspacePanelForControl(params) : null
    if (hasExplicitRemotePanelTarget(params) && !requestedPanel) return controlFail('REMOTE_SURFACE_NOT_FOUND', 'Remote target surface was not found.')
    if (requestedPanel?.sessionId && !requestedPanel.sshSession) {
      return controlFail('REMOTE_SURFACE_BUSY', 'Target surface is connected to a local terminal; choose an empty or SSH surface.')
    }
    const panel =
      requestedPanel ||
      (controlWorkspaceRemote.value ? workspace.panels.find((item) => item.id === controlWorkspaceRemote.value?.surfaceId && item.kind !== 'knowledge') || null : null) ||
      workspace.panels.find((item) => item.sshSession && !item.sessionId) ||
      workspace.panels.find((item) => item.kind !== 'knowledge' && !item.sessionId && item.status !== 'running') ||
      workspace.createPanel()
    const assetName = controlText(params.name || params.title || params.assetName || params.asset_name) || destination
    workspace.registerSshSession(panel.id, {
      id: controlText(params.assetId || params.asset_id) || `control-remote:${host}:${port}:${username}`,
      name: assetName,
      title: assetName,
      host,
      port,
      username,
      needProxy: controlBool(params.needProxy ?? params.need_proxy, false),
      proxyName: controlText(params.proxyName || params.proxy_name),
      jumpHostId: controlText(params.jumpHostId || params.jump_host_id)
    })
    workspace.renamePanel(panel.id, assetName)
    controlWorkspaceRemote.value = {
      surfaceId: panel.id,
      transport: 'ssh',
      destination,
      host,
      port,
      username,
      assetId: controlText(params.assetId || params.asset_id) || `control-remote:${host}:${port}:${username}`,
      assetName,
      proxyName: controlText(params.proxyName || params.proxy_name),
      needProxy: controlBool(params.needProxy ?? params.need_proxy, false),
      updatedAt: Date.now()
    }
    const autoConnect = controlBool(params.autoConnect ?? params.auto_connect, false)
    if (autoConnect) await startSshTerminalForPanel(panel)
    await nextTick()
    return remoteControlPayload({
      configured: true,
      autoConnect,
      auto_connect: autoConnect,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel)
    })
  }

  if (method === 'workspace.remote.reconnect') {
    const panel = resolveRemoteWorkspacePanelForControl(params)
    if (!panel?.sshSession) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
    const connected = await startSshTerminalForPanel(panel)
    await nextTick()
    return remoteControlPayload({
      reconnected: connected,
      connected,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel)
    })
  }

  if (method === 'workspace.remote.disconnect') {
    const panel = resolveRemoteWorkspacePanelForControl(params)
    if (!panel?.sshSession) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
    let disconnected = true
    if (panel.sessionId) disconnected = await disconnectTerminalPanel(panel)
    const clear = controlBool(params.clear ?? params.clearConfiguration ?? params.clear_configuration, false)
    if (clear) {
      panel.sshSession = undefined
      controlWorkspaceRemote.value = null
    } else if (controlWorkspaceRemote.value?.surfaceId === panel.id) {
      controlWorkspaceRemote.value = { ...controlWorkspaceRemote.value, updatedAt: Date.now() }
    }
    await nextTick()
    return remoteControlPayload({
      disconnected,
      clear,
      cleared: clear,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel)
    })
  }

  if (method === 'workspace.remote.foreground_auth_ready') {
    const panel = resolveRemoteWorkspacePanelForControl(params)
    if (!panel?.sshSession && !controlWorkspaceRemote.value) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
    const now = Date.now()
    if (controlWorkspaceRemote.value) {
      controlWorkspaceRemote.value = { ...controlWorkspaceRemote.value, foregroundAuthReadyAt: now, updatedAt: now }
    }
    return remoteControlPayload({
      foregroundAuthReady: true,
      foreground_auth_ready: true,
      foregroundAuthReadyAt: now,
      foreground_auth_ready_at: now,
      ...(panel ? { surfaceId: panel.id, surface_id: panel.id, surface: surfaceSummaryForControl(panel) } : {})
    })
  }

  if (method === 'workspace.remote.pty_sessions') {
    const sshPanels = workspace.panels.filter((panel) => panel.sshSession)
    return controlOk({
      all_workspaces: controlBool(params.allWorkspaces ?? params.all_workspaces, false),
      workspace_count: 1,
      sessions: sshPanels.map((panel) => ({
        id: panel.sessionId || panel.id,
        session_id: panel.sessionId || panel.id,
        surface_id: panel.id,
        workspace_id: 'main',
        workspace_ref: 'workspace:1',
        title: panel.title,
        state: remoteStateForControlPanel(panel),
        connected: Boolean(panel.sessionId),
        remote: workspaceRemoteSummaryForControl()
      })),
      errors: [],
      remote: workspaceRemoteSummaryForControl()
    })
  }

  if (method === 'workspace.remote.pty_attach_end') {
    const sessionId = controlText(params.sessionId || params.session_id)
    if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_attach_end requires session_id.')
    const panel = resolveRemoteWorkspacePanelForControl(params)
    return controlOk({
      workspace_id: 'main',
      workspace_ref: 'workspace:1',
      surface_id: panel?.id || controlText(params.surfaceId || params.surface_id),
      surface_ref: panel?.id || controlText(params.surfaceId || params.surface_id),
      session_id: sessionId,
      workspace_found: Boolean(panel),
      cleared_remote_pty_session: false,
      untracked_remote_terminal: !panel,
      remote: workspaceRemoteSummaryForControl()
    })
  }

  if (method === 'workspace.remote.terminal_session_end') {
    const relayPort = controlNumber(params.relayPort || params.relay_port, 0, 0, 65535)
    if (!relayPort) return controlFail('REMOTE_RELAY_PORT_INVALID', 'workspace.remote.terminal_session_end requires relay_port.')
    const panel = resolveRemoteWorkspacePanelForControl(params)
    return controlOk({
      workspace_id: 'main',
      workspace_ref: 'workspace:1',
      surface_id: panel?.id || controlText(params.surfaceId || params.surface_id),
      surface_ref: panel?.id || controlText(params.surfaceId || params.surface_id),
      relay_port: relayPort,
      remote: workspaceRemoteSummaryForControl()
    })
  }

  if (method === 'workspace.remote.pty_bridge') {
    const sessionId = controlText(params.sessionId || params.session_id)
    if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_bridge requires session_id.')
    const attachmentId = controlText(params.attachmentId || params.attachment_id) || `aiopsterm-${Date.now().toString(36)}`
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY bridge daemon sessions; use visible SSH terminal surfaces instead.', {
      session_id: sessionId,
      attachment_id: attachmentId,
      require_existing: controlBool(params.requireExisting ?? params.require_existing, false),
      wait_for_ready: controlBool(params.waitForReady ?? params.wait_for_ready, false),
      command: controlText(params.command),
      bridge_available: false
    })
  }

  if (method === 'workspace.remote.pty_resize') {
    const sessionId = controlText(params.sessionId || params.session_id)
    if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_resize requires session_id.')
    const attachmentId = controlText(params.attachmentId || params.attachment_id)
    if (!attachmentId) return controlFail('REMOTE_PTY_ATTACHMENT_REQUIRED', 'workspace.remote.pty_resize requires attachment_id.')
    const attachmentToken = controlText(params.attachmentToken || params.attachment_token)
    if (!attachmentToken) return controlFail('REMOTE_PTY_ATTACHMENT_TOKEN_REQUIRED', 'workspace.remote.pty_resize requires attachment_token.')
    const cols = controlNumber(params.cols || params.columns, 0, 0, 1000)
    const rows = controlNumber(params.rows, 0, 0, 1000)
    if (!cols || !rows) return controlFail('REMOTE_PTY_SIZE_INVALID', 'workspace.remote.pty_resize requires positive cols and rows.')
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY resize for detached bridge sessions; resize the visible SSH terminal surface instead.', {
      session_id: sessionId,
      attachment_id: attachmentId,
      cols,
      rows,
      resized: false
    })
  }

  if (method.startsWith('workspace.remote.pty_')) {
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY bridge daemon sessions; use visible SSH terminal surfaces instead.', {
      session_id: controlText(params.sessionId || params.session_id),
      attachment_id: controlText(params.attachmentId || params.attachment_id),
      closed: false,
      detached: false
    })
  }

  if (method.startsWith('remote.tmux.')) {
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not implement control_compat remote tmux control-mode mirroring in the control socket.', {
      host: controlText(params.host || params.destination),
      session: controlText(params.session)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const resolveControlTerminalPanel = (params: Record<string, unknown> = {}) => {
  const panelId = controlText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.terminalId || params.terminal_id || params.tabId || params.tab_id)
  const sessionId = controlText(params.sessionId || params.session_id || params.terminalSessionId || params.terminal_session_id)
  if (panelId || sessionId) {
    return workspace.panels.find((panel) => panel.kind !== 'knowledge' && (panel.id === panelId || panel.sessionId === sessionId)) || null
  }
  const active = workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.id === workspace.activePanelId)
  return active || workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.sessionId) || null
}

const terminalMobileTargetPayload = (panel: TerminalPanel, extra: Record<string, unknown> = {}) => {
  const terminal = terminalSummaryForControl(panel)
  return {
    workspace_id: 'main',
    workspaceId: 'main',
    surface_id: panel.id,
    surfaceId: panel.id,
    terminal_id: panel.id,
    terminalId: panel.id,
    ...(panel.sessionId ? { session_id: panel.sessionId, sessionId: panel.sessionId, terminal_session_id: panel.sessionId, terminalSessionId: panel.sessionId } : {}),
    terminal,
    ...extra
  }
}

const terminalBufferText = (view: TerminalView, tailLines: number) => {
  const buffer = view.terminal.buffer.active
  const start = Math.max(0, buffer.length - tailLines)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '')
  }
  return lines.join('\n').replace(/\s+$/g, '')
}

const terminalBracketedPasteText = (text: string) => `\x1b[200~${text}\x1b[201~`

const terminalSubmitKeyData = (value: unknown) => {
  const normalized = controlText(value || 'return').toLowerCase().replace(/[\s_]+/g, '')
  if (!normalized || normalized === 'return' || normalized === 'enter') return '\r'
  if (normalized === 'none') return ''
  if (normalized === 'ctrl+enter' || normalized === 'control+enter' || normalized === 'ctrl-enter' || normalized === 'control-enter') return '\x1b[13;5u'
  return null
}

const handleMobileTerminalInputControlRequest = async (params: Record<string, unknown>) => {
  const text = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : ''
  if (!text) return controlFail('TERMINAL_TEXT_REQUIRED', 'terminal.input requires text.')
  const panel = resolveControlTerminalPanel(params)
  if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  if (!panel.sessionId) return controlFail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId: panel.id, surface_id: panel.id })
  const ok = Boolean(await window.aiops?.writeTerminal(panel.sessionId, text))
  if (!ok) return controlFail('TERMINAL_WRITE_FAILED', 'Terminal input could not be delivered.', { panelId: panel.id, sessionId: panel.sessionId })
  return controlOk(terminalMobileTargetPayload(panel, { queued: false, bytes: new TextEncoder().encode(text).length, textLength: text.length, text_length: text.length }))
}

const handleMobileTerminalPasteControlRequest = async (params: Record<string, unknown>) => {
  const text = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : ''
  if (!text) return controlFail('TERMINAL_TEXT_REQUIRED', 'terminal.paste requires text.')
  const submitKey = terminalSubmitKeyData(params.submit_key || params.submitKey)
  if (submitKey === null) return controlFail('TERMINAL_SUBMIT_KEY_UNSUPPORTED', 'Unsupported submit_key.', { submit_key: controlText(params.submit_key || params.submitKey) })
  const panel = resolveControlTerminalPanel(params)
  if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  if (!panel.sessionId) return controlFail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId: panel.id, surface_id: panel.id })
  const payload = `${terminalBracketedPasteText(text)}${submitKey}`
  const ok = Boolean(await window.aiops?.writeTerminal(panel.sessionId, payload))
  if (!ok) return controlFail('TERMINAL_WRITE_FAILED', 'Terminal paste could not be delivered.', { panelId: panel.id, sessionId: panel.sessionId })
  return controlOk(
    terminalMobileTargetPayload(panel, {
      queued: false,
      submitted: Boolean(submitKey),
      submit_key: controlText(params.submit_key || params.submitKey) || 'return',
      bytes: new TextEncoder().encode(payload).length,
      textLength: text.length,
      text_length: text.length
    })
  )
}

const handleMobileTerminalReplayControlRequest = (params: Record<string, unknown>) => {
  const panel = resolveControlTerminalPanel(params)
  if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  const view = terminalViews.get(panel.id)
  if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, surface_id: panel.id, sessionId: panel.sessionId })
  const tailLines = controlNumber(params.tailLines || params.lines, view.terminal.rows || 30, 1, Math.max(1, workspace.terminalSettings.scrollBack || 1000))
  const text = terminalBufferText(view, tailLines)
  return controlOk(
    terminalMobileTargetPayload(panel, {
      seq: Date.now(),
      columns: Math.max(1, view.terminal.cols || 80),
      rows: Math.max(1, view.terminal.rows || 24),
      text,
      snapshot_format: 'aiopsterm.text',
      snapshot_text: text,
      tailLines,
      tail_lines: tailLines
    })
  )
}

const handleMobileTerminalViewportControlRequest = (params: Record<string, unknown>) => {
  const panel = resolveControlTerminalPanel(params)
  if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  const view = terminalViews.get(panel.id)
  if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, surface_id: panel.id, sessionId: panel.sessionId })
  return controlOk(
    terminalMobileTargetPayload(panel, {
      columns: Math.max(1, view.terminal.cols || 80),
      rows: Math.max(1, view.terminal.rows || 24),
      viewport_columns: controlNumber(params.viewport_columns || params.viewportColumns, view.terminal.cols || 80, 1, 500),
      viewport_rows: controlNumber(params.viewport_rows || params.viewportRows, view.terminal.rows || 24, 1, 500),
      cleared: controlBool(params.clear, false)
    })
  )
}

const workspaceGroupPayload = (group?: ControlWorkspaceGroupState | null) => {
  const groups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
  return {
    groups,
    count: groups.length,
    ...(group ? { group: workspaceGroupSummaryForControl(group) } : {}),
    snapshot: workspaceSnapshotForControl()
  }
}

const paneLayoutPayload = (panel?: TerminalPanel | null, targetPanel?: TerminalPanel | null, extra: Record<string, unknown> = {}) =>
  controlOk({
    ...(panel ? { pane: surfaceSummaryForControl(panel), surface: surfaceSummaryForControl(panel), surfaceId: panel.id, surface_id: panel.id } : {}),
    ...(targetPanel ? { targetPane: surfaceSummaryForControl(targetPanel), targetSurface: surfaceSummaryForControl(targetPanel), targetPaneId: targetPanel.id, target_pane_id: targetPanel.id } : {}),
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const selectedPanePayload = (panel: TerminalPanel, action: string, previousActivePanelId: string) =>
  controlOk({
    workspace: {
      id: 'main',
      title: 'Main Workspace',
      active: true,
      mode: workspace.mode,
      activeModule: workspace.activeModule,
      activePanelId: panel.id
    },
    selectedPane: surfaceSummaryForControl(panel),
    selectedSurface: surfaceSummaryForControl(panel),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    paneId: panel.id,
    pane_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    surfaceRef: panelRefForControl(panel.id),
    surface_ref: panelRefForControl(panel.id),
    activePanelId: panel.id,
    previousActivePanelId,
    action,
    snapshot: workspaceSnapshotForControl()
  })

const surfaceOperationPayload = (panel: TerminalPanel, action: string, extra: Record<string, unknown> = {}) => {
  const surface = surfaceSummaryForControl(panel)
  return controlOk({
    surface,
    pane: surface,
    movedSurface: surface,
    panelId: panel.id,
    paneId: panel.id,
    pane_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    surfaceRef: panelRefForControl(panel.id),
    surface_ref: panelRefForControl(panel.id),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    action,
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })
}

const normalizedSurfaceAction = (value: unknown) => controlText(value).toLowerCase().replace(/[-\s]+/g, '_')

const closeRelativeControlPanels = async (panel: TerminalPanel, mode: 'left' | 'right' | 'others') => {
  const panels = selectableControlPanels()
  const index = panels.findIndex((item) => item.id === panel.id)
  if (index < 0) return { closed: 0, skipped: 0, closedSurfaces: [] as ControlSurfaceSummary[] }
  const targets =
    mode === 'left'
      ? panels.slice(0, index)
      : mode === 'right'
        ? panels.slice(index + 1)
        : panels.filter((item) => item.id !== panel.id)
  const closedSurfaces: ControlSurfaceSummary[] = []
  let skipped = 0
  for (const target of targets) {
    if (workspace.panels.length <= 1) {
      skipped += 1
      continue
    }
    const snapshot = surfaceSummaryForControl(target)
    workspace.closePanel(target.id)
    closedSurfaces.push(snapshot)
  }
  workspace.activePanelId = panel.id
  await nextTick()
  return { closed: closedSurfaces.length, skipped, closedSurfaces }
}

const handleSurfaceActionControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = normalizedSurfaceAction(params.action || params.name || params.command)
  if (!action) return controlFail('SURFACE_ACTION_REQUIRED', `${method} requires action.`)
  const panel = resolveControlSourceSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (action === 'rename') {
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('SURFACE_ACTION_TITLE_REQUIRED', 'surface.action rename requires title.')
    workspace.renamePanel(panel.id, title)
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', { action, title, extras: { title } })
  }
  if (action === 'clear_name' || action === 'clear_title') {
    workspace.renamePanel(panel.id, `Terminal ${workspace.panels.findIndex((item) => item.id === panel.id) + 1}`, 'system')
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', { action, clearedTitle: true, cleared_title: true })
  }
  if (action === 'pin' || action === 'unpin') {
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      pinned: action === 'pin',
      unsupported: true,
      unsupportedReason: 'aiopsterm does not have per-surface pinning; workspace group pinning is managed through workspace.group.pin.'
    })
  }
  if (action === 'mark_read' || action === 'mark_unread' || action === 'mark_as_unread') {
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      read: action === 'mark_read',
      changed: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm surfaces do not currently store per-surface unread state.'
    })
  }
  if (action === 'new_terminal_right' || action === 'new_terminal_to_right' || action === 'new_terminal_tab_to_right') {
    const previousActivePanelId = workspace.activePanelId
    workspace.activePanelId = panel.id
    const created = workspace.createPanel()
    const title = controlText(params.title || params.newTitle || params.new_title)
    if (title) workspace.renamePanel(created.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory) || panel.cwd
    if (cwd) created.cwd = cwd
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      createdSurface: surfaceSummaryForControl(created),
      created_surface: surfaceSummaryForControl(created),
      createdSurfaceId: created.id,
      created_surface_id: created.id,
      extras: { created_surface_id: created.id }
    })
  }
  if (action === 'close_left' || action === 'close_to_left' || action === 'close_right' || action === 'close_to_right' || action === 'close_others' || action === 'close_other_tabs') {
    const mode = action === 'close_left' || action === 'close_to_left' ? 'left' : action === 'close_right' || action === 'close_to_right' ? 'right' : 'others'
    const result = await closeRelativeControlPanels(panel, mode)
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      closed: result.closed,
      skipped: result.skipped,
      skippedPinned: 0,
      skipped_pinned: 0,
      closedSurfaces: result.closedSurfaces,
      closed_surfaces: result.closedSurfaces,
      extras: { closed: result.closed, skipped_pinned: 0 }
    })
  }
  if (action === 'move_to_new_workspace' || action === 'detach_to_workspace' || action === 'detach_to_new_workspace') {
    const changed = workspace.unsplitPanel(panel.id)
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      moved: changed,
      detached: changed,
      unsupported: false
    })
  }
  return controlFail('SURFACE_ACTION_UNKNOWN', `Unknown surface action: ${action}`, { action })
}

const handleWorkspaceActionControlRequest = async (params: Record<string, unknown>) => {
  const panel = resolveControlSelectablePanel(controlTargetValue(params)) || resolveControlSourceSurfacePanel(params)
  const action = normalizedSurfaceAction(params.action || params.name || params.command)
  if (!action) return controlFail('WORKSPACE_ACTION_REQUIRED', 'workspace.action requires action.')
  if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
  const response = await handleSurfaceActionControlRequest('workspace.action', { ...params, surfaceId: panel.id, surface_id: panel.id, panelId: panel.id, panel_id: panel.id, action })
  if (!response.ok) return response
  return controlOk({
    ...(response.data || {}),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    action
  })
}

const movePanelInControlOrder = (panel: TerminalPanel, params: Record<string, unknown>) => {
  const panels = workspace.panels
  const currentIndex = panels.findIndex((item) => item.id === panel.id)
  if (currentIndex < 0) return { changed: false, fromIndex: -1, toIndex: -1 }
  let targetIndex = controlPanelIndexFromValue(params.index)
  const beforePanel = resolveControlAnchorPanel(params, 'before')
  const afterPanel = resolveControlAnchorPanel(params, 'after')
  if (beforePanel) targetIndex = panels.findIndex((item) => item.id === beforePanel.id)
  if (afterPanel) targetIndex = panels.findIndex((item) => item.id === afterPanel.id) + 1
  if (targetIndex === null || !Number.isFinite(targetIndex)) targetIndex = currentIndex
  targetIndex = Math.max(0, Math.min(panels.length - 1, targetIndex))
  const [moved] = panels.splice(currentIndex, 1)
  if (currentIndex < targetIndex) targetIndex -= 1
  panels.splice(Math.max(0, Math.min(panels.length, targetIndex)), 0, moved)
  const toIndex = panels.findIndex((item) => item.id === panel.id)
  return { changed: currentIndex !== toIndex, fromIndex: currentIndex, toIndex }
}

const surfaceHealthForControl = (panel: TerminalPanel, index: number) => {
  const view = terminalViews.get(panel.id)
  return {
    ...surfaceSummaryForControl(panel),
    id: panel.id,
    ref: panelRefForControl(panel.id),
    index: index + 1,
    selected: panel.id === workspace.activePanelId,
    mounted: panel.kind === 'knowledge' ? true : Boolean(view),
    viewReady: panel.kind === 'knowledge' ? true : Boolean(view),
    view_ready: panel.kind === 'knowledge' ? true : Boolean(view),
    inWindow: true,
    in_window: true,
    cols: view?.terminal.cols,
    rows: view?.terminal.rows,
    status: panel.status
  }
}

const triggerControlFlash = (panel: TerminalPanel) => {
  controlFlashingPanelIds.value = [...new Set([...controlFlashingPanelIds.value, panel.id])]
  if (controlFlashTimer) window.clearTimeout(controlFlashTimer)
  controlFlashTimer = window.setTimeout(() => {
    controlFlashingPanelIds.value = controlFlashingPanelIds.value.filter((id) => id !== panel.id)
    controlFlashTimer = null
  }, 900)
}

const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

const resolveControlSelectablePanel = (value: unknown) => {
  const target = controlText(value)
  const panels = selectableControlPanels()
  if (!target || target === 'main' || target === 'workspace' || target === 'workspace:1') {
    return panels.find((panel) => panel.id === workspace.activePanelId) || panels[0] || null
  }
  const indexMatch = target.match(/^(?:window|pane|surface|workspace):(\d+)$/i)
  const numericIndex = indexMatch ? Number(indexMatch[1]) : Number(target)
  if (Number.isInteger(numericIndex) && numericIndex > 0 && numericIndex <= panels.length) return panels[numericIndex - 1]
  return panels.find((panel) => panelMatchesControlId(panel, target) || panel.title === target) || null
}

const focusControlPanel = async (panel: TerminalPanel, action: string) => {
  const previousActivePanelId = workspace.activePanelId
  workspace.activeModule = 'workspace'
  workspace.activePanelId = panel.id
  await nextTick()
  terminalViews.get(panel.id)?.terminal.focus()
  return selectedPanePayload(panel, action, previousActivePanelId)
}

const focusControlPanelByOffset = async (offset: number, action: string) => {
  const panels = selectableControlPanels()
  if (!panels.length) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
  const activeIndex = Math.max(0, panels.findIndex((panel) => panel.id === workspace.activePanelId))
  const nextIndex = (activeIndex + offset + panels.length) % panels.length
  return focusControlPanel(panels[nextIndex], action)
}

const controlTargetValue = (params: Record<string, unknown>) =>
  params.panelId ||
  params.surfaceId ||
  params.paneId ||
  params.workspaceId ||
  params.panel_id ||
  params.surface_id ||
  params.pane_id ||
  params.workspace_id ||
  params.target ||
  params.id

const handlePaneNavigationControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.next') return focusControlPanelByOffset(1, 'next')
  if (method === 'workspace.previous') return focusControlPanelByOffset(-1, 'previous')
  if (method === 'workspace.last' || method === 'pane.last') {
    const target = resolveControlSelectablePanel(lastActiveControlPanelId.value)
    if (target) return focusControlPanel(target, method === 'pane.last' ? 'last-pane' : 'last-window')
    return focusControlPanelByOffset(-1, method === 'pane.last' ? 'last-pane' : 'last-window')
  }
  if (method === 'workspace.select') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    return focusControlPanel(panel, 'select-window')
  }
  if (method === 'pane.focus') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    return focusControlPanel(panel, 'select-pane')
  }
  if (method === 'surface.focus') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    return focusControlPanel(panel, 'surface.focus')
  }
  if (method === 'workspace.find') {
    const query = controlText(params.query || params.q || params.text)
    const includeContent = controlBool(params.content ?? params.includeContent ?? params.include_content, false)
    const queryLower = query.toLowerCase()
    const matches = selectableControlPanels()
      .map((panel, index) => {
        const titleMatch = !queryLower || panel.title.toLowerCase().includes(queryLower)
        const cwdMatch = Boolean(queryLower && panel.cwd.toLowerCase().includes(queryLower))
        const view = terminalViews.get(panel.id)
        const content = includeContent ? `${panel.output || ''}\n${view ? terminalBufferText(view, Math.max(1, view.terminal.rows || 30)) : ''}` : ''
        const contentMatch = Boolean(queryLower && includeContent && content.toLowerCase().includes(queryLower))
        const reason = titleMatch ? 'title' : cwdMatch ? 'cwd' : contentMatch ? 'content' : ''
        if (!reason) return null
        return {
          index: index + 1,
          panelId: panel.id,
          id: panel.id,
          title: panel.title,
          kind: panel.kind,
          surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
          active: panel.id === workspace.activePanelId,
          cwd: panel.cwd,
          reason
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (controlBool(params.select, false) && matches[0]) {
      const panel = workspace.panels.find((item) => item.id === matches[0].panelId)
      if (panel) {
        const selected = await focusControlPanel(panel, 'find-window')
        return controlOk({ ...(selected.data || {}), matches, selected: matches[0], count: matches.length })
      }
    }
    return controlOk({ matches, count: matches.length, query, includeContent })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const managementPanelPayload = (panel: TerminalPanel, action: string, key: 'createdPane' | 'closedPane' | 'renamedPane' = 'createdPane', extra: Record<string, unknown> = {}) =>
  controlOk({
    [key]: surfaceSummaryForControl(panel),
    panelId: panel.id,
    surfaceId: panel.id,
    action,
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const handlePaneManagementControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'pane.list') {
    const panels = selectableControlPanels()
    return controlOk({
      panes: panels.map((panel, index) => ({ ...surfaceSummaryForControl(panel), index: index + 1 })),
      surfaces: panels.map(surfaceSummaryForControl),
      count: panels.length,
      activePanelId: workspace.activePanelId
    })
  }
  if (method === 'pane.surfaces') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const surface = surfaceSummaryForControl(panel)
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      paneId: panel.id,
      pane_id: panel.id,
      panelId: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaces: [{ ...surface, id: panel.id, ref: 'surface:1', index: 1, selected: true }],
      count: 1,
      activePanelId: workspace.activePanelId
    })
  }
  if (method === 'workspace.create') {
    const focus = controlBool(params.focus, true)
    const previousActivePanelId = workspace.activePanelId
    const panel = workspace.createPanel()
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    const workspaceEnv = cleanWorkspaceEnvironmentForControl(params.workspace_env || params.workspaceEnv)
    if (Object.keys(workspaceEnv).length) {
      controlWorkspaceEnvironment.value = { env: workspaceEnv, updatedAt: Date.now() }
    }
    if (!focus && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return managementPanelPayload(panel, 'new-window', 'createdPane', { previousActivePanelId })
  }
  if (method === 'surface.create') {
    const type = controlText(params.type).toLowerCase()
    const url = controlText(params.url)
    if (url || (type && !['terminal', 'local', 'shell'].includes(type))) {
      return controlFail('SURFACE_CREATE_TYPE_UNSUPPORTED', 'surface.create only supports local terminal surfaces.', {
        ...(type ? { type } : {})
      })
    }
    const pane = resolveControlPanePanel(params)
    if (controlText(params.paneId || params.pane_id || params.panelId || params.panel_id || params.surfaceId || params.surface_id) && !pane) {
      return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    }
    const focus = controlBool(params.focus, false)
    const previousActivePanelId = workspace.activePanelId
    if (pane) workspace.activePanelId = pane.id
    const panel = workspace.createPanel()
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    if (!focus && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (focus) terminalViews.get(panel.id)?.terminal.focus()
    return managementPanelPayload(panel, 'surface.create', 'createdPane', {
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      paneId: panel.id,
      pane_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaceRef: panelRefForControl(panel.id),
      surface_ref: panelRefForControl(panel.id),
      surface: surfaceSummaryForControl(panel),
      pane: surfaceSummaryForControl(panel),
      type: type || 'terminal',
      previousActivePanelId,
      ...(pane ? { targetPane: surfaceSummaryForControl(pane), targetPaneId: pane.id, target_pane_id: pane.id } : {})
    })
  }
  if (method === 'surface.split' || method === 'pane.create') {
    if (method === 'pane.create') {
      const type = controlText(params.type).toLowerCase().replace(/[-_\s]/g, '')
      if (type === 'agentsession') {
        return controlFail('PANE_AGENT_SESSION_UNSUPPORTED', 'agent-session is only supported by surface.create.', {
          type: controlText(params.type) || 'agentSession'
        })
      }
    }
    const target = resolveControlPanePanel(params, 'target') || resolveControlPanePanel(params)
    if (!target) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    workspace.activePanelId = target.id
    const panel = workspace.createPanel(normalizePaneLayoutDirection(params.direction || params.split))
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return managementPanelPayload(panel, method === 'pane.create' ? 'pane.create' : 'split-window', 'createdPane', {
      targetPane: surfaceSummaryForControl(target),
      previousActivePanelId,
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      paneId: panel.id,
      pane_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaceRef: panelRefForControl(panel.id),
      surface_ref: panelRefForControl(panel.id),
      surface: surfaceSummaryForControl(panel),
      pane: surfaceSummaryForControl(panel),
      createdSurface: surfaceSummaryForControl(panel),
      created_surface: surfaceSummaryForControl(panel),
      type: controlText(params.type) || 'terminal'
    })
  }
  if (method === 'workspace.rename') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('WORKSPACE_TITLE_REQUIRED', 'Workspace title is required.')
    workspace.renamePanel(panel.id, title)
    await nextTick()
    return managementPanelPayload(panel, 'rename-window', 'renamedPane', { title })
  }
  if (method === 'workspace.close' || method === 'surface.close') {
    const panel = method === 'workspace.close' ? resolveControlSelectablePanel(controlTargetValue(params)) : resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const snapshot = surfaceSummaryForControl(panel)
    workspace.closePanel(panel.id)
    await nextTick()
    return controlOk({
      closedPane: snapshot,
      closedSurface: snapshot,
      panelId: snapshot.panelId,
      surfaceId: snapshot.panelId,
      action: method === 'workspace.close' ? 'kill-window' : 'kill-pane',
      snapshot: workspaceSnapshotForControl()
    })
  }
  if (method === 'workspace.has_session') {
    const target = controlText(controlTargetValue(params))
    const panel = resolveControlSelectablePanel(target)
    return controlOk({
      exists: Boolean(panel),
      target: target || 'main',
      ...(panel ? { panel: surfaceSummaryForControl(panel), workspace: surfaceSummaryForControl(panel) } : {})
    })
  }
  if (method === 'workspace.select_layout') {
    const layout = controlText(params.layout || params.name) || 'default'
    const supported = ['default', 'even-horizontal', 'even-vertical', 'tiled', 'main-vertical', 'main-horizontal'].includes(layout)
    return controlOk({
      layout,
      applied: supported,
      unsupported: !supported,
      ...(supported ? {} : { unsupportedReason: `Unsupported layout: ${layout}` }),
      snapshot: workspaceSnapshotForControl()
    })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const workspaceMetadataPayload = (extra: Record<string, unknown> = {}) =>
  controlOk({
    window_id: null,
    window_ref: null,
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const handleWorkspaceMetadataControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.env') {
    const explicitTarget = controlText(params.workspaceId || params.workspace_id || params.surfaceId || params.surface_id || params.panelId || params.panel_id || params.paneId || params.pane_id || params.terminalId || params.terminal_id)
    if (explicitTarget && explicitTarget !== 'main' && !resolveControlSelectablePanel(explicitTarget)) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const env = { ...controlWorkspaceEnvironment.value.env }
    return workspaceMetadataPayload({
      env,
      count: Object.keys(env).length,
      keys: Object.keys(env).sort()
    })
  }

  if (method === 'workspace.set_auto_title') {
    const enabled = true
    if (controlBool(params.probe, false)) {
      const panel = resolveControlSelectablePanel(controlTargetValue(params))
      return workspaceMetadataPayload({
        enabled,
        summarizer_agent: null,
        workspace_user_owned: panel ? panel.titleSource === 'user' : false,
        panel_user_owned: panel ? panel.titleSource === 'user' : false
      })
    }
    const failure = controlText(params.failure)
    if (failure) {
      return workspaceMetadataPayload({
        enabled,
        recorded: true,
        failure,
        agent: controlText(params.agent)
      })
    }
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('WORKSPACE_TITLE_REQUIRED', 'Workspace title is required.', { enabled })
    const panel =
      resolveControlSelectablePanel(controlTargetValue(params)) ||
      (controlText(params.workspaceId || params.workspace_id) ? workspace.panels.find((item) => item.id === workspace.activePanelId) || null : null)
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.', { enabled })
    const result = workspace.setPanelAutoTitle(panel.id, title, {
      panelOnlyIfMultiple: controlBool(params.panelOnlyIfMultiple ?? params.panel_only_if_multiple, false)
    })
    await nextTick()
    return workspaceMetadataPayload({
      enabled,
      title,
      workspaceApplied: result.applied,
      workspace_applied: result.applied,
      panelApplied: result.applied,
      panel_applied: result.applied,
      workspaceUserOwned: result.userOwned,
      workspace_user_owned: result.userOwned,
      panelUserOwned: result.userOwned,
      panel_user_owned: result.userOwned,
      panelId: panel.id,
      panel_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const normalizePaneLayoutDirection = (value: unknown) => {
  const direction = controlText(value).toLowerCase()
  if (direction === 'below' || direction === 'down' || direction === 'vertical') return 'below'
  return 'right'
}

const normalizeSurfaceShellState = (value: unknown): ControlSurfaceTelemetryState['shellState'] | '' => {
  const state = controlText(value).toLowerCase()
  if (state === 'prompt' || state === 'running' || state === 'unknown') return state
  return ''
}

const normalizePortsKickReason = (value: unknown): NonNullable<ControlSurfaceTelemetryState['lastPortsKickReason']> | '' => {
  const reason = controlText(value || 'command').toLowerCase()
  if (reason === 'command' || reason === 'refresh') return reason
  return ''
}

const handlePaneLayoutControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'pane.resize') {
    const panel = resolveControlPanePanel(params)
    return paneLayoutPayload(panel, null, {
      resized: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm split panes currently use an equal-size layout and do not store per-pane dimensions.',
      direction: controlText(params.direction) || 'right',
      amount: controlNumber(params.amount, 1, 1, 999)
    })
  }

  if (method === 'pane.break') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.unsplitPanel(panel.id)
    if (!controlBool(params.focus, false) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return paneLayoutPayload(panel, null, { changed, broken: changed })
  }

  if (method === 'pane.join') {
    const panel = resolveControlPanePanel(params)
    const targetPanel = resolveControlPanePanel(params, 'target')
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    if (!targetPanel) return controlFail('TARGET_PANE_NOT_FOUND', 'Target pane not found.')
    if (panel.id === targetPanel.id) return controlFail('PANE_TARGET_INVALID', 'Source and target panes must be different.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.attachPanelToSplit(panel.id, targetPanel.id, normalizePaneLayoutDirection(params.direction || params.split))
    if (!controlBool(params.focus, false) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return paneLayoutPayload(panel, targetPanel, { changed, joined: changed })
  }

  if (method === 'pane.swap') {
    const panel = resolveControlPanePanel(params)
    const targetPanel = resolveControlPanePanel(params, 'target')
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    if (!targetPanel) return controlFail('TARGET_PANE_NOT_FOUND', 'Target pane not found.')
    if (panel.id === targetPanel.id) return controlFail('PANE_TARGET_INVALID', 'Source and target panes must be different.')
    const panelIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    const targetIndex = workspace.panels.findIndex((item) => item.id === targetPanel.id)
    if (panelIndex < 0 || targetIndex < 0) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    const sourceSplit = panel.split
    const sourceSplitSourceId = panel.splitSourceId
    const sourceSplitGroupId = panel.splitGroupId
    const sourceSplitOrder = panel.splitOrder
    panel.split = targetPanel.split
    panel.splitSourceId = targetPanel.splitSourceId === panel.id ? targetPanel.id : targetPanel.splitSourceId
    panel.splitGroupId = targetPanel.splitGroupId
    panel.splitOrder = targetPanel.splitOrder
    targetPanel.split = sourceSplit
    targetPanel.splitSourceId = sourceSplitSourceId === targetPanel.id ? panel.id : sourceSplitSourceId
    targetPanel.splitGroupId = sourceSplitGroupId
    targetPanel.splitOrder = sourceSplitOrder
    const movedPanel = workspace.panels[panelIndex]
    workspace.panels[panelIndex] = workspace.panels[targetIndex]
    workspace.panels[targetIndex] = movedPanel
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = targetPanel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    terminalViews.get(workspace.activePanelId)?.terminal.focus()
    return paneLayoutPayload(panel, targetPanel, { changed: true, swapped: true })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const handleSurfaceOperationsControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'surface.action' || method === 'tab.action') return handleSurfaceActionControlRequest(method, params)

  if (method === 'surface.report_tty') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const ttyName = controlText(params.ttyName || params.tty_name || params.tty)
    if (!ttyName) return controlFail('SURFACE_TTY_REQUIRED', 'surface.report_tty requires tty_name.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, ttyName, lastTtyAt: now }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.report_tty', {
      ttyName,
      tty_name: ttyName,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      recorded: true
    })
  }

  if (method === 'surface.report_shell_state') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const shellState = normalizeSurfaceShellState(params.state || params.shellState || params.shell_state || params.activity)
    if (!shellState) return controlFail('SURFACE_SHELL_STATE_INVALID', 'state must be prompt, running, or unknown.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, shellState, lastShellStateAt: now }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.report_shell_state', {
      state: shellState,
      shellState,
      shell_state: shellState,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      published: true
    })
  }

  if (method === 'surface.ports_kick') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const reason = normalizePortsKickReason(params.reason)
    if (!reason) return controlFail('SURFACE_PORTS_KICK_REASON_INVALID', 'reason must be command or refresh.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, lastPortsKickAt: now, lastPortsKickReason: reason }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.ports_kick', {
      reason,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      kicked: true,
      portScanStarted: false,
      port_scan_started: false,
      unsupported: false
    })
  }

  if (method === 'surface.health') {
    const panels = selectableControlPanels()
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      surfaces: panels.map(surfaceHealthForControl),
      count: panels.length,
      activePanelId: workspace.activePanelId
    })
  }

  if (method === 'surface.refresh' || method === 'workspace.equalize_splits') {
    await nextTick()
    scheduleVisibleTerminalFit({ scrollToBottom: false, frames: 4, forceGeometry: true })
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      refreshed: workspace.panels.filter((panel) => panel.kind !== 'knowledge').length,
      equalized: method === 'workspace.equalize_splits',
      action: method,
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'surface.trigger_flash') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    triggerControlFlash(panel)
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    await nextTick()
    terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, 'surface.trigger_flash', { flashed: true })
  }

  if (method === 'surface.reorder' || method === 'surface.move') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const previousActivePanelId = workspace.activePanelId
    const targetPane = method === 'surface.move' ? resolveControlPanePanel(params) : null
    let changed = false
    let fromIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    let toIndex = fromIndex
    if (targetPane && targetPane.id !== panel.id) {
      changed = workspace.attachPanelToSplit(panel.id, targetPane.id, normalizePaneLayoutDirection(params.direction || params.split))
      toIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    } else {
      const moved = movePanelInControlOrder(panel, params)
      changed = moved.changed
      fromIndex = moved.fromIndex
      toIndex = moved.toIndex
    }
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = panel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, method === 'surface.move' ? 'surface.move' : 'surface.reorder', {
      changed,
      moved: changed,
      reordered: changed,
      fromIndex,
      from_index: fromIndex,
      toIndex,
      to_index: toIndex,
      index: toIndex,
      ...(targetPane ? { targetPane: surfaceSummaryForControl(targetPane), targetPaneId: targetPane.id, target_pane_id: targetPane.id } : {})
    })
  }

  if (method === 'surface.split_off') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.unsplitPanel(panel.id)
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = panel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, 'surface.split_off', {
      changed,
      splitOff: changed,
      split_off: changed,
      direction: controlText(params.direction) || 'right'
    })
  }

  if (method === 'workspace.reorder' || method === 'workspace.reorder_many') {
    if (method === 'workspace.reorder_many') {
      const orderInput = Array.isArray(params.workspaceIds)
        ? params.workspaceIds
        : Array.isArray(params.workspace_ids)
          ? params.workspace_ids
          : typeof params.order === 'string'
            ? params.order.split(',')
            : []
      if (!orderInput.length) return controlFail('WORKSPACE_REORDER_ORDER_REQUIRED', 'Workspace reorder requires an order.')
      const desired = orderInput.map(resolveControlPanelId).filter(Boolean)
      if (!desired.length) return controlFail('WORKSPACE_REORDER_ORDER_INVALID', 'Workspace reorder order did not match any surfaces.')
      const current = workspace.panels
      const desiredSet = new Set(desired)
      const known = current.filter((panel) => desiredSet.has(panel.id))
      const missing = desired.filter((id) => !known.some((panel) => panel.id === id))
      if (missing.length) return controlFail('WORKSPACE_REORDER_SURFACE_NOT_FOUND', 'One or more reorder surfaces were not found.', { missing })
      const untouched = current.filter((panel) => !desiredSet.has(panel.id))
      const fromOrder = current.map((panel) => panel.id)
      const dryRun = controlBool(params.dryRun ?? params.dry_run, false)
      if (!dryRun) workspace.panels = [...known.sort((a, b) => desired.indexOf(a.id) - desired.indexOf(b.id)), ...untouched]
      const toOrder = (dryRun ? current : workspace.panels).map((panel) => panel.id)
      return controlOk({
        workspaceId: 'main',
        workspace_id: 'main',
        dryRun,
        dry_run: dryRun,
        changed: fromOrder.join('\u0000') !== toOrder.join('\u0000'),
        order: toOrder,
        snapshot: workspaceSnapshotForControl()
      })
    }
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const dryRun = controlBool(params.dryRun ?? params.dry_run, false)
    const fromIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    let move = { changed: false, fromIndex, toIndex: fromIndex }
    if (!dryRun) move = movePanelInControlOrder(panel, params)
    return controlOk({
      workspaceId: panel.id,
      workspace_id: panel.id,
      workspaceRef: panelRefForControl(panel.id),
      workspace_ref: panelRefForControl(panel.id),
      dryRun,
      dry_run: dryRun,
      fromIndex: move.fromIndex,
      from_index: move.fromIndex,
      toIndex: move.toIndex,
      to_index: move.toIndex,
      index: move.toIndex,
      changed: move.changed,
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'workspace.move_to_window') {
    return controlOk({
      workspaceId: controlText(params.workspaceId || params.workspace_id) || 'main',
      workspace_id: controlText(params.workspaceId || params.workspace_id) || 'main',
      windowId: controlText(params.windowId || params.window_id) || 'main',
      window_id: controlText(params.windowId || params.window_id) || 'main',
      moved: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm currently exposes one shared main work panel in one Electron window; moving workspaces between native windows is not supported.'
    })
  }

  if (method === 'workspace.prompt_submit') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    if (panel.kind === 'knowledge') return controlFail('WORKSPACE_PROMPT_TERMINAL_REQUIRED', 'Prompt submit requires a terminal surface.')
    const message = controlText(params.message || params.prompt || params.text || params.body)
    if (!message) return controlFail('WORKSPACE_PROMPT_REQUIRED', 'Prompt submit requires message text.')
    const shellText = message.endsWith('\n') ? message : `${message}\n`
    const decision = await workspace.runTerminalCommand(panel.id, message, { source: 'agent', inputText: shellText, shellText, writeToShell: true })
    return controlOk({
      workspaceId: panel.id,
      workspace_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      messageRecorded: decision.status === 'allow',
      message_recorded: decision.status === 'allow',
      decision,
      status: decision.status,
      messagePreview: message.slice(0, 120),
      message_preview: message.slice(0, 120)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const createWorkspaceGroupForControl = (params: Record<string, unknown>) => {
  const panelInputs = [
    ...(Array.isArray(params.childPanelIds) ? params.childPanelIds : []),
    ...(Array.isArray(params.child_workspace_ids) ? params.child_workspace_ids : []),
    ...(Array.isArray(params.workspaceIds) ? params.workspaceIds : []),
    ...(typeof params.from === 'string' ? params.from.split(',') : []),
    ...(typeof params.childWorkspaceIds === 'string' ? params.childWorkspaceIds.split(',') : [])
  ]
  const memberPanelIds = [...new Set(panelInputs.map(resolveControlPanelId).filter(Boolean))]
  if (!memberPanelIds.length) {
    const visiblePanelIds = workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel)).map((panel) => panel.id)
    memberPanelIds.push(...(visiblePanelIds.length ? visiblePanelIds : workspace.panels.map((panel) => panel.id)))
  }
  if (!memberPanelIds.length) return controlFail('WORKSPACE_GROUP_NO_MEMBERS', 'Workspace group needs at least one surface.')
  const anchorPanelId = resolveControlPanelId(params.anchorPanelId || params.anchor_workspace_id) || memberPanelIds[0]
  if (!memberPanelIds.includes(anchorPanelId)) memberPanelIds.unshift(anchorPanelId)
  const now = Date.now()
  const group: ControlWorkspaceGroupState = {
    id: `workspace-group-${now}-${Math.random().toString(16).slice(2)}`,
    name: controlText(params.name) || `Group ${controlWorkspaceGroups.value.length + 1}`,
    anchorPanelId,
    memberPanelIds,
    collapsed: false,
    pinned: params.pinned === true || params.is_pinned === true,
    index: controlWorkspaceGroups.value.length,
    createdAt: now,
    updatedAt: now,
    ...(controlText(params.cwd) ? { cwd: controlText(params.cwd) } : {}),
    ...(controlText(params.color || params.hex || params.customColor) ? { color: controlText(params.color || params.hex || params.customColor) } : {}),
    ...(controlText(params.icon || params.symbol || params.iconSymbol) ? { icon: controlText(params.icon || params.symbol || params.iconSymbol) } : {})
  }
  const assigned = new Set(group.memberPanelIds)
  controlWorkspaceGroups.value = [
    ...controlWorkspaceGroups.value
      .map((item) => ({ ...item, memberPanelIds: item.memberPanelIds.filter((panelId) => !assigned.has(panelId)) }))
      .filter((item) => item.memberPanelIds.length),
    group
  ].map((item, index) => ({ ...item, index }))
  return controlOk(workspaceGroupPayload(group))
}

const updateWorkspaceGroupForControl = (params: Record<string, unknown>, update: (group: ControlWorkspaceGroupState) => ControlWorkspaceGroupState | null) => {
  const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
  if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
  const next = update(group)
  if (!next) return controlFail('WORKSPACE_GROUP_UPDATE_REJECTED', 'Workspace group update was rejected.')
  controlWorkspaceGroups.value = controlWorkspaceGroups.value.map((item) => (item.id === group.id ? { ...next, updatedAt: Date.now() } : item))
  return controlOk(workspaceGroupPayload(controlWorkspaceGroups.value.find((item) => item.id === group.id)))
}

const addWorkspaceToGroupForControl = (params: Record<string, unknown>) => {
  const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
  if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group add.')
  return updateWorkspaceGroupForControl(params, (group) => {
    controlWorkspaceGroups.value = controlWorkspaceGroups.value
      .map((item) => (item.id === group.id ? item : { ...item, memberPanelIds: item.memberPanelIds.filter((id) => id !== panelId) }))
      .filter((item) => item.memberPanelIds.length)
    return {
      ...group,
      memberPanelIds: [...new Set([...group.memberPanelIds, panelId])],
      anchorPanelId: group.anchorPanelId || panelId
    }
  })
}

const removeWorkspaceFromGroupForControl = (params: Record<string, unknown>) => {
  const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
  if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group remove.')
  const group = controlWorkspaceGroups.value.find((item) => item.memberPanelIds.includes(panelId))
  if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Surface is not in a workspace group.')
  controlWorkspaceGroups.value = controlWorkspaceGroups.value
    .map((item) => {
      if (item.id !== group.id) return item
      const memberPanelIds = item.memberPanelIds.filter((id) => id !== panelId)
      const anchorPanelId = item.anchorPanelId === panelId ? memberPanelIds[0] || '' : item.anchorPanelId
      return { ...item, anchorPanelId, memberPanelIds, updatedAt: Date.now() }
    })
    .filter((item) => item.anchorPanelId && item.memberPanelIds.length)
    .map((item, index) => ({ ...item, index }))
  return controlOk(workspaceGroupPayload())
}

const closeWorkspaceGroupPanelsForControl = async (panelIds: string[]) => {
  const closedPanelIds: string[] = []
  const killedSessionIds: string[] = []
  for (const panelId of panelIds) {
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (!panel) continue
    if (panel.sessionId && typeof window.aiops?.killTerminal === 'function') {
      const sessionId = panel.sessionId
      try {
        const result = await window.aiops.killTerminal(sessionId)
        if (result?.ok && isTerminalKillSuccess(result, sessionId)) killedSessionIds.push(sessionId)
      } catch {
        // Closing a group is best effort after explicit confirmation; the UI panel is still removed.
      }
    }
    workspace.closePanel(panel.id)
    closedPanelIds.push(panel.id)
  }
  return { closedPanelIds, killedSessionIds }
}

const deleteWorkspaceGroupForControl = async (params: Record<string, unknown>) => {
  const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
  if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
  if (params.confirm !== true && params.force !== true) {
    return controlFail('WORKSPACE_GROUP_DELETE_REQUIRES_CONFIRM', 'Deleting a workspace group closes its surfaces. Pass confirm=true to continue.', {
      group: workspaceGroupSummaryForControl(group)
    })
  }
  const memberPanelIds = [...group.memberPanelIds]
  controlWorkspaceGroups.value = controlWorkspaceGroups.value.filter((item) => item.id !== group.id).map((item, index) => ({ ...item, index }))
  const closed = await closeWorkspaceGroupPanelsForControl(memberPanelIds)
  return controlOk({ deletedPanelIds: memberPanelIds, ...closed, ...workspaceGroupPayload() })
}

const handleWorkspaceGroupControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.group.list') return controlOk(workspaceGroupPayload())
  if (method === 'workspace.group.create') return createWorkspaceGroupForControl(params)
  if (method === 'workspace.group.ungroup') {
    const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
    controlWorkspaceGroups.value = controlWorkspaceGroups.value.filter((item) => item.id !== group.id).map((item, index) => ({ ...item, index }))
    return controlOk(workspaceGroupPayload())
  }
  if (method === 'workspace.group.delete') return deleteWorkspaceGroupForControl(params)
  if (method === 'workspace.group.rename') {
    const name = controlText(params.name)
    if (!name) return controlFail('WORKSPACE_GROUP_NAME_REQUIRED', 'Workspace group name is required.')
    return updateWorkspaceGroupForControl(params, (group) => ({ ...group, name }))
  }
  if (method === 'workspace.group.collapse') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, collapsed: true }))
  if (method === 'workspace.group.expand') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, collapsed: false }))
  if (method === 'workspace.group.pin') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, pinned: true }))
  if (method === 'workspace.group.unpin') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, pinned: false }))
  if (method === 'workspace.group.set_color') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, color: controlText(params.hex || params.color) || undefined }))
  if (method === 'workspace.group.set_icon') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, icon: controlText(params.symbol || params.icon) || undefined }))
  if (method === 'workspace.group.add') return addWorkspaceToGroupForControl(params)
  if (method === 'workspace.group.remove') return removeWorkspaceFromGroupForControl(params)
  if (method === 'workspace.group.set_anchor') {
    const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
    if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group anchor.')
    return updateWorkspaceGroupForControl(params, (group) => ({
      ...group,
      anchorPanelId: panelId,
      memberPanelIds: [...new Set([panelId, ...group.memberPanelIds])]
    }))
  }
  if (method === 'workspace.group.new_workspace') {
    const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
    const panel = workspace.createPanel()
    const memberPanelIds = [...new Set([...group.memberPanelIds, panel.id])]
    controlWorkspaceGroups.value = controlWorkspaceGroups.value.map((item) => (item.id === group.id ? { ...item, memberPanelIds, updatedAt: Date.now() } : item))
    return controlOk({ panel: surfaceSummaryForControl(panel), workspace_ref: panel.id, ...workspaceGroupPayload(controlWorkspaceGroups.value.find((item) => item.id === group.id)) })
  }
  if (method === 'workspace.group.focus') {
    const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
    workspace.activeModule = 'workspace'
    workspace.activePanelId = group.anchorPanelId
    return controlOk(workspaceGroupPayload(group))
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const cleanSurfaceResumeEnvironment = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry.trim() : ''] as const)
    .filter(([key, entry]) => key && entry && !/(token|password|passwd|secret|api[_-]?key|credential|auth|bearer)/i.test(key))
  return entries.length ? Object.fromEntries(entries) : undefined
}

const cleanWorkspaceEnvironmentForControl = (value: unknown) => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry : controlText(entry)] as const)
      .filter(([key, entry]) => key && entry && !key.includes('\0') && !key.includes('=') && !entry.includes('\0'))
  )
}

const workspaceEnvironmentSummaryForControl = () => {
  const keys = Object.keys(controlWorkspaceEnvironment.value.env).sort()
  return {
    keys,
    count: keys.length,
    updatedAt: controlWorkspaceEnvironment.value.updatedAt,
    updated_at: controlWorkspaceEnvironment.value.updatedAt
  }
}

const surfaceResumeBindingPayload = (binding?: ControlSurfaceResumeBindingState | null) => {
  if (!binding) return null
  const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
  return {
    ...binding,
    checkpoint_id: binding.checkpointId || binding.checkpoint_id,
    auto_resume: binding.autoResume,
    approval_policy: binding.approvalPolicy || binding.approval_policy,
    approval_record_id: binding.approvalRecordId || binding.approval_record_id,
    ...(typeof trustedAt === 'number' ? { trustedAt, trusted_at: trustedAt } : {}),
    trust_reason: binding.trustReason || binding.trust_reason,
    updated_at: binding.updatedAt
  }
}

const surfaceResumeFingerprint = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
  [
    controlText(binding.kind) || 'surface-resume',
    controlText(binding.command),
    controlText(binding.cwd || panel.cwd),
    controlText(binding.checkpointId || binding.checkpoint_id),
    controlText(binding.source)
  ].join('\u001f')

const surfaceResumeTrustId = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
  `surface-resume:${panel.id}:${surfaceResumeFingerprint(panel, binding)}`

const isSurfaceResumeTrustedForAuto = (panel: TerminalPanel, binding?: ControlSurfaceResumeBindingState | null) => {
  if (!binding?.command.trim()) return false
  const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
  const approvalRecordId = binding.approvalRecordId || binding.approval_record_id
  return Boolean(
    binding.autoResume === true &&
      (binding.approvalPolicy || binding.approval_policy) === 'auto' &&
      approvalRecordId &&
      typeof trustedAt === 'number' &&
      approvalRecordId === surfaceResumeTrustId(panel, binding)
  )
}

const surfaceResumePayload = (panel: TerminalPanel, cleared = false) => {
  const binding = surfaceResumeBindingPayload(controlSurfaceResumeBindings.value[panel.id])
  return {
    surface: surfaceSummaryForControl(panel),
    terminal: panel.kind === 'knowledge' ? null : terminalSummaryForControl(panel),
    surfaceId: panel.id,
    surface_id: panel.id,
    surface_ref: panel.id,
    workspaceId: 'main',
    workspace_id: 'main',
    workspace_ref: 'main',
    cleared,
    resumeBinding: binding,
    resume_binding: binding,
    trusted: isSurfaceResumeTrustedForAuto(panel, controlSurfaceResumeBindings.value[panel.id]),
    snapshot: workspaceSnapshotForControl()
  }
}

const surfaceResumePreviewItems = (params: Record<string, unknown> = {}) =>
  workspace.panels
    .filter((panel) => panel.kind !== 'knowledge')
    .map((panel) => {
      const binding = controlSurfaceResumeBindings.value[panel.id]
      const trusted = isSurfaceResumeTrustedForAuto(panel, binding)
      const reason = !binding?.command.trim()
        ? 'missing-binding'
        : panel.kind === 'knowledge'
          ? 'not-terminal'
          : !panel.sessionId
            ? 'terminal-not-connected'
            : binding.autoResume !== true
              ? 'manual'
              : !trusted
                ? 'untrusted'
                : 'ready'
      return {
        panel,
        binding,
        trusted,
        reason,
        ready: reason === 'ready'
      }
    })
    .filter((item) => {
      const panelId = controlText(params.panelId || params.surfaceId)
      const sessionId = controlText(params.sessionId || params.terminalSessionId)
      if (panelId && item.panel.id !== panelId) return false
      if (sessionId && item.panel.sessionId !== sessionId) return false
      return item.binding || params.includeAll === true || params.include_all === true
    })

const surfaceResumeAutoPayload = (items = surfaceResumePreviewItems()) => ({
  candidates: items.map((item) => ({
    surface: surfaceSummaryForControl(item.panel),
    terminal: terminalSummaryForControl(item.panel),
    resumeBinding: surfaceResumeBindingPayload(item.binding),
    resume_binding: surfaceResumeBindingPayload(item.binding),
    trusted: item.trusted,
    ready: item.ready,
    reason: item.reason
  })),
  count: items.length,
  readyCount: items.filter((item) => item.ready).length,
  trustedCount: items.filter((item) => item.trusted).length,
  snapshot: workspaceSnapshotForControl()
})

const handleSurfaceResumeControlRequest = async (method: string, params: Record<string, unknown>) => {
  const panel = resolveControlSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (method === 'surface.resume.set') {
    const command = controlText(params.command || params.shell || params.shellCommand)
    if (!command) return controlFail('SURFACE_RESUME_COMMAND_REQUIRED', 'Resume command is required.')
    const now = Date.now()
    const checkpointId = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
    const approvalPolicy = controlText(params.approvalPolicy || params.approval_policy)
    const approvalRecordId = controlText(params.approvalRecordId || params.approval_record_id)
    const environment = cleanSurfaceResumeEnvironment(params.environment)
    const binding: ControlSurfaceResumeBindingState = {
      ...(controlText(params.name) ? { name: controlText(params.name) } : {}),
      ...(controlText(params.kind) ? { kind: controlText(params.kind) } : {}),
      command,
      ...(controlText(params.cwd) || panel.cwd ? { cwd: controlText(params.cwd) || panel.cwd } : {}),
      ...(checkpointId ? { checkpointId, checkpoint_id: checkpointId } : {}),
      ...(controlText(params.source) ? { source: controlText(params.source) } : {}),
      ...(environment ? { environment } : {}),
      autoResume: controlBool(params.autoResume ?? params.auto_resume, false),
      ...(approvalPolicy ? { approvalPolicy, approval_policy: approvalPolicy } : {}),
      ...(approvalRecordId ? { approvalRecordId, approval_record_id: approvalRecordId } : {}),
      ...(typeof params.trustedAt === 'number' ? { trustedAt: params.trustedAt, trusted_at: params.trustedAt } : {}),
      ...(controlText(params.trustReason || params.trust_reason) ? { trustReason: controlText(params.trustReason || params.trust_reason), trust_reason: controlText(params.trustReason || params.trust_reason) } : {}),
      updatedAt: now,
      updated_at: now
    }
    controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: binding }
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.get' || method === 'surface.resume.show') {
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.clear') {
    const existing = controlSurfaceResumeBindings.value[panel.id]
    if (!existing) return controlOk(surfaceResumePayload(panel, false))
    const expectedCheckpoint = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
    const expectedSource = controlText(params.source)
    if (expectedCheckpoint && existing.checkpointId !== expectedCheckpoint && existing.checkpoint_id !== expectedCheckpoint) {
      return controlFail('SURFACE_RESUME_CHECKPOINT_MISMATCH', 'Resume binding checkpoint does not match.', { resumeBinding: surfaceResumeBindingPayload(existing), resume_binding: surfaceResumeBindingPayload(existing) })
    }
    if (expectedSource && existing.source !== expectedSource) {
      return controlFail('SURFACE_RESUME_SOURCE_MISMATCH', 'Resume binding source does not match.', { resumeBinding: surfaceResumeBindingPayload(existing), resume_binding: surfaceResumeBindingPayload(existing) })
    }
    const next = { ...controlSurfaceResumeBindings.value }
    delete next[panel.id]
    controlSurfaceResumeBindings.value = next
    return controlOk(surfaceResumePayload(panel, true))
  }
  if (method === 'surface.resume.trust' || method === 'surface.resume.approve') {
    const existing = controlSurfaceResumeBindings.value[panel.id]
    if (!existing?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
    const policy = controlText(params.policy || params.approvalPolicy || params.approval_policy || 'auto').toLowerCase()
    if (policy !== 'auto' && policy !== 'manual') return controlFail('SURFACE_RESUME_POLICY_INVALID', 'Resume trust policy must be auto or manual.')
    const now = Date.now()
    const trusted: ControlSurfaceResumeBindingState = {
      ...existing,
      autoResume: policy === 'auto',
      auto_resume: policy === 'auto',
      approvalPolicy: policy,
      approval_policy: policy,
      approvalRecordId: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
      approval_record_id: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
      trustedAt: now,
      trusted_at: now,
      trustReason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
      trust_reason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
      updatedAt: now,
      updated_at: now
    }
    controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: trusted }
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.preview' || method === 'surface.resume.autorun.preview') {
    return controlOk(surfaceResumeAutoPayload(surfaceResumePreviewItems(params)))
  }
  if (method === 'surface.resume.autorun' || method === 'surface.resume.run_auto') {
    const items = surfaceResumePreviewItems(params)
    const ready = items.filter((item) => item.ready && item.binding?.command.trim())
    if (!ready.length) return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: 0, decisions: [] })
    const decisions = []
    for (const item of ready) {
      const decision = await workspace.runTerminalCommand(item.panel.id, item.binding!.command, { source: 'agent', writeToShell: true })
      decisions.push({
        panelId: item.panel.id,
        sessionId: item.panel.sessionId,
        status: decision.status,
        decision
      })
    }
    return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: decisions.length, decisions })
  }
  if (method === 'surface.resume.run') {
    if (panel.kind === 'knowledge') return controlFail('SURFACE_RESUME_TERMINAL_REQUIRED', 'Resume command can only run in a terminal surface.')
    const binding = controlSurfaceResumeBindings.value[panel.id]
    if (!binding?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
    const decision = await workspace.runTerminalCommand(panel.id, binding.command, { source: 'agent', writeToShell: true })
    return controlOk({ ...surfaceResumePayload(panel), decision })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const defaultRespawnCommand = 'exec ${SHELL:-/bin/bash} -l'

const handleSurfaceRespawnControlRequest = async (params: Record<string, unknown>) => {
  const panel = resolveControlSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (panel.kind === 'knowledge') return controlFail('SURFACE_RESPAWN_TERMINAL_REQUIRED', 'Respawn command can only run in a terminal surface.')
  const command = controlText(params.command || params.tmux_start_command || params.shell || params.shellCommand) || defaultRespawnCommand
  const decision = await workspace.runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
  return controlOk({
    surface: surfaceSummaryForControl(panel),
    terminal: terminalSummaryForControl(panel),
    surfaceId: panel.id,
    surface_id: panel.id,
    command,
    decision,
    snapshot: workspaceSnapshotForControl()
  })
}

const normalizeAgentTeamSource = (value: unknown): ControlAgentTeamLaunchSource => {
  const source = controlText(value).toLowerCase()
  if (source === 'claude' || source === 'claude-code' || source === 'claude_code') return 'claude-code'
  if (source === 'custom') return 'custom'
  return 'codex'
}

const shellQuoteForControl = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`

const buildAgentTeamCommand = (params: Record<string, unknown>, source: ControlAgentTeamLaunchSource, index: number) => {
  const custom = controlText(params.command || params.shell || params.commandText)
  const cwd = controlText(params.cwd)
  const prompt = controlText(params.prompt || params.message || params.instruction)
  const role = controlText(params.role || params.agentRole)
  const model = controlText(params.model)
  const prefix = cwd ? `cd ${shellQuoteForControl(cwd)} && ` : ''
  if (custom) {
    return custom
      .replace(/\{\{index\}\}/g, String(index))
      .replace(/\{\{cwd\}\}/g, cwd)
      .replace(/\{\{prompt\}\}/g, prompt)
      .replace(/\{\{role\}\}/g, role)
      .replace(/\{\{model\}\}/g, model)
  }
  const promptSuffix = prompt ? ` ${shellQuoteForControl(prompt)}` : ''
  if (source === 'claude-code') {
    const modelArgs = model ? ` --model ${shellQuoteForControl(model)}` : ''
    return `${prefix}claude${modelArgs}${promptSuffix}`
  }
  const modelArgs = model ? ` --model ${shellQuoteForControl(model)}` : ''
  return `${prefix}codex${modelArgs}${promptSuffix}`
}

const createAgentTeamGroup = (params: Record<string, unknown>, panelIds: string[], source: ControlAgentTeamLaunchSource, cwd: string) => {
  const now = Date.now()
  const name = controlText(params.name || params.groupName || params.title) || `${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} Team`
  const group: ControlWorkspaceGroupState = {
    id: `workspace-group-${now}-${Math.random().toString(16).slice(2)}`,
    name,
    anchorPanelId: panelIds[0],
    memberPanelIds: [...new Set(panelIds)],
    collapsed: false,
    pinned: controlBool(params.pinned, true),
    index: controlWorkspaceGroups.value.length,
    createdAt: now,
    updatedAt: now,
    ...(cwd ? { cwd } : {}),
    color: controlText(params.color || params.hex) || '#3b82f6',
    icon: controlText(params.icon || params.symbol) || 'bot'
  }
  const assigned = new Set(group.memberPanelIds)
  controlWorkspaceGroups.value = [
    ...controlWorkspaceGroups.value
      .map((item) => ({ ...item, memberPanelIds: item.memberPanelIds.filter((panelId) => !assigned.has(panelId)) }))
      .filter((item) => item.memberPanelIds.length),
    group
  ].map((item, index) => ({ ...item, index }))
  return group
}

const createLocalAgentTeamTerminal = async (panel: TerminalPanel, title: string, cwd: string) => {
  if (!window.aiops?.createTerminal) {
    throw new Error('本地终端启动服务不可用')
  }
  await nextTick()
  const size = terminalViewSize(panel.id)
  const session = (await window.aiops.createTerminal({
    kind: 'local',
    panelId: panel.id,
    workspaceId: 'workspace',
    title,
    ...(cwd ? { cwd } : {}),
    cols: size.cols,
    rows: size.rows,
    terminalType: workspace.terminalSettings.terminalType
  })) as TerminalSessionInfo
  const connected = workspace.applyLocalTerminalSession(panel.id, session)
  if (!connected) throw new Error('本地终端启动失败')
  workspace.renamePanel(panel.id, title)
  return connected
}

const handleAgentTeamControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method !== 'agent.team.launch') return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  const source = normalizeAgentTeamSource(params.source || params.agent)
  const count = controlNumber(params.count || params.n, 2, 1, 12)
  const cwd = controlText(params.cwd) || (workspace.activePanel.kind === 'terminal' ? workspace.activePanel.cwd : '')
  const focus = controlBool(params.focus, true)
  const members: ControlAgentTeamLaunchMember[] = []
  const panelIds: string[] = []
  const previousActivePanelId = workspace.activePanelId

  for (let index = 1; index <= count; index += 1) {
    const panel = workspace.createPanel()
    const title = `${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} ${index}`
    workspace.renamePanel(panel.id, title)
    panelIds.push(panel.id)
    const command = buildAgentTeamCommand(params, source, index)
    try {
      const connected = await createLocalAgentTeamTerminal(panel, title, cwd)
      const decision = await workspace.runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
      members.push({
        index,
        source,
        command,
        panel: surfaceSummaryForControl(connected),
        terminal: terminalSummaryForControl(connected),
        status: decision.status === 'allow' ? 'launched' : decision.status === 'needs-approval' ? 'needs-approval' : 'failed',
        ...(decision.status !== 'allow' && decision.status !== 'needs-approval' ? { errorMessage: 'Agent team command was not launched.' } : {})
      })
    } catch (error) {
      members.push({
        index,
        source,
        command,
        panel: surfaceSummaryForControl(panel),
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Agent team terminal launch failed.'
      })
    }
  }

  const group = createAgentTeamGroup(params, panelIds, source, cwd)
  workspace.activeModule = 'workspace'
  if (focus && panelIds[0]) workspace.activePanelId = panelIds[0]
  if (!focus && workspace.panels.some((panel) => panel.id === previousActivePanelId)) workspace.activePanelId = previousActivePanelId
  const team: ControlAgentTeamLaunchResult = {
    source,
    ...(cwd ? { cwd } : {}),
    requestedCount: count,
    launchedCount: members.filter((member) => member.status === 'launched').length,
    approvalCount: members.filter((member) => member.status === 'needs-approval').length,
    failedCount: members.filter((member) => member.status === 'failed').length,
    group: workspaceGroupSummaryForControl(group),
    members,
    snapshot: workspaceSnapshotForControl()
  }
  workspace.setTopNotice(`已创建 ${team.launchedCount} 个 ${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} Team 会话`)
  return controlOk({ team, ...workspaceGroupPayload(group) })
}

type AgentHibernationReaperCandidate = {
  session: (typeof workspace.managedAiSessions)[number]
  panel: TerminalPanel
  terminalSessionId: string
  lastActivityAt: number
  fingerprint: string
}

type AgentHibernationPendingConfirmation = {
  fingerprint: string
  sampledAt: number
  dueAt: number
}

const agentHibernationConfirmations = ref<Record<string, AgentHibernationPendingConfirmation>>({})

const agentHibernationCandidateKey = (candidate: AgentHibernationReaperCandidate) => `${candidate.session.source}:${candidate.session.id}`

const agentHibernationFingerprint = (session: (typeof workspace.managedAiSessions)[number], panel: TerminalPanel, terminalSessionId: string) =>
  [
    session.source,
    session.id,
    terminalSessionId,
    session.terminalProcessId || '',
    session.processId || '',
    session.parentProcessId || '',
    session.processGroupId || '',
    session.agentLifecycle || '',
    session.state || '',
    session.terminalActivityAt || '',
    panel.sessionId || '',
    panel.status || ''
  ].join('|')

const agentHibernationActivityAt = (session: (typeof workspace.managedAiSessions)[number], panel: TerminalPanel) => {
  const value = Math.max(
    typeof session.terminalActivityAt === 'number' ? session.terminalActivityAt : 0,
    typeof session.lastActivityAt === 'number' ? session.lastActivityAt : 0,
    typeof session.createdAt === 'number' ? session.createdAt : 0
  )
  return value > 0 ? value : Date.now()
}

const liveRestorableAgentSessions = () => {
  const sessions: AgentHibernationReaperCandidate[] = []
  workspace.managedAiSessions.forEach((session) => {
    if (session.hibernated || !session.resumeCommand?.trim()) return
    const targetId = session.panelId || session.terminalSessionId
    const panel = targetId ? workspace.panels.find((item) => item.id === targetId || item.sessionId === targetId) : null
    if (!panel || panel.kind === 'knowledge' || !panel.sessionId || panel.status === 'closed' || panel.status === 'error') return
    sessions.push({
      session,
      panel,
      terminalSessionId: panel.sessionId,
      lastActivityAt: agentHibernationActivityAt(session, panel),
      fingerprint: agentHibernationFingerprint(session, panel, panel.sessionId)
    })
  })
  return sessions
}

const agentHibernationEligibleCandidates = (now: number) => {
  const config = workspace.agentHibernationConfig
  const liveRestorable = liveRestorableAgentSessions()
  const liveRestorableCount = liveRestorable.length
  const excess = liveRestorableCount - config.maxLiveTerminals
  const visiblePanelIds = new Set(visibleTerminalPanels.value.map((panel) => panel.id))
  if (!config.enabled || excess <= 0) {
    return { liveRestorableCount, excess: Math.max(0, excess), selected: [] as AgentHibernationReaperCandidate[], eligible: [] as AgentHibernationReaperCandidate[] }
  }
  const idleMs = config.idleSeconds * 1000
  const eligible = liveRestorable
    .filter((candidate) => {
      const { session, panel } = candidate
      if (visiblePanelIds.has(panel.id)) return false
      if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') return false
      if (session.state === 'working' || session.agentLifecycle === 'running') return false
      if (session.state === 'ended' || session.agentLifecycle === 'ended') return false
      return now - candidate.lastActivityAt >= idleMs
    })
    .sort((left, right) => {
      if (left.lastActivityAt === right.lastActivityAt) return agentHibernationCandidateKey(left).localeCompare(agentHibernationCandidateKey(right))
      return left.lastActivityAt - right.lastActivityAt
    })
  return { liveRestorableCount, excess, eligible, selected: eligible.slice(0, excess) }
}

const pruneAgentHibernationConfirmations = (selected: AgentHibernationReaperCandidate[]) => {
  const selectedKeys = new Set(selected.map(agentHibernationCandidateKey))
  agentHibernationConfirmations.value = Object.fromEntries(Object.entries(agentHibernationConfirmations.value).filter(([key]) => selectedKeys.has(key)))
}

const agentHibernationReaperPayload = (
  selected: AgentHibernationReaperCandidate[],
  hibernated: ControlManagedAiSessionSummary[],
  pending: AgentHibernationReaperCandidate[],
  skipped: Array<{ sessionId: string; source: string; reason: string }>,
  liveRestorableCount: number,
  eligibleCount: number,
  excess: number
): Record<string, unknown> => ({
  config: { ...workspace.agentHibernationConfig },
  liveRestorableCount,
  eligibleCount,
  excess,
  selectedCount: selected.length,
  pendingCount: pending.length,
  hibernatedCount: hibernated.length,
  candidates: selected.map((candidate) => ({
    session: managedAiSessionSummaryForControl(candidate.session),
    panel: surfaceSummaryForControl(candidate.panel),
    terminalSessionId: candidate.terminalSessionId,
    lastActivityAt: candidate.lastActivityAt,
    idleSeconds: Math.max(0, Math.floor((Date.now() - candidate.lastActivityAt) / 1000))
  })),
  pending: pending.map((candidate) => {
    const confirmation = agentHibernationConfirmations.value[agentHibernationCandidateKey(candidate)]
    return {
      sessionId: candidate.session.id,
      source: candidate.session.source,
      dueAt: confirmation?.dueAt,
      sampledAt: confirmation?.sampledAt
    }
  }),
  hibernated,
  skipped,
  snapshot: workspaceSnapshotForControl()
})

const sweepAgentHibernationReaper = async (params: Record<string, unknown>, previewOnly = false) => {
  await workspace.refreshAgentHibernationConfig()
  const now = Date.now()
  const { liveRestorableCount, excess, eligible, selected } = agentHibernationEligibleCandidates(now)
  pruneAgentHibernationConfirmations(selected)
  const pending: AgentHibernationReaperCandidate[] = []
  const hibernated: ControlManagedAiSessionSummary[] = []
  const skipped: Array<{ sessionId: string; source: string; reason: string }> = []
  if (previewOnly || !workspace.agentHibernationConfig.enabled) {
    return controlOk(agentHibernationReaperPayload(selected, hibernated, pending, skipped, liveRestorableCount, eligible.length, excess))
  }
  const confirmationSeconds = controlBool(params.confirm, true) ? workspace.agentHibernationConfig.confirmationSeconds : 0
  for (const candidate of selected) {
    const key = agentHibernationCandidateKey(candidate)
    if (confirmationSeconds > 0) {
      const confirmation = agentHibernationConfirmations.value[key]
      if (!confirmation || confirmation.fingerprint !== candidate.fingerprint) {
        agentHibernationConfirmations.value = {
          ...agentHibernationConfirmations.value,
          [key]: {
            fingerprint: candidate.fingerprint,
            sampledAt: now,
            dueAt: now + confirmationSeconds * 1000
          }
        }
        pending.push(candidate)
        continue
      }
      if (now < confirmation.dueAt) {
        pending.push(candidate)
        continue
      }
    }
    const ok = await workspace.hibernateManagedAiSession(candidate.session.source, candidate.session.id, controlText(params.reason) || 'auto-reaper')
    if (ok) {
      delete agentHibernationConfirmations.value[key]
      const updatedSession = workspace.managedAiSessions.find((session) => session.source === candidate.session.source && session.id === candidate.session.id) || candidate.session
      hibernated.push(managedAiSessionSummaryForControl(updatedSession))
    } else {
      skipped.push({ sessionId: candidate.session.id, source: candidate.session.source, reason: 'hibernate-failed' })
    }
  }
  return controlOk(agentHibernationReaperPayload(selected, hibernated, pending, skipped, liveRestorableCount, eligible.length, excess))
}

const handleAgentHibernationControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'agent-hibernation.status' || method === 'agent.status') {
    await workspace.refreshAgentHibernationConfig()
    return controlOk({
      config: { ...workspace.agentHibernationConfig },
      sessions: workspace.managedAiSessions.map(managedAiSessionSummaryForControl),
      snapshot: workspaceSnapshotForControl()
    })
  }
  if (method === 'agent-hibernation.on') {
    const changed = await workspace.setAgentHibernationEnabled(true)
    return changed ? controlOk({ config: { ...workspace.agentHibernationConfig } }) : controlFail('AGENT_HIBERNATION_ENABLE_FAILED', 'Agent hibernation could not be enabled.')
  }
  if (method === 'agent-hibernation.off') {
    const changed = await workspace.setAgentHibernationEnabled(false)
    return changed ? controlOk({ config: { ...workspace.agentHibernationConfig } }) : controlFail('AGENT_HIBERNATION_DISABLE_FAILED', 'Agent hibernation could not be disabled.')
  }
  if (method === 'agent-hibernation.preview' || method === 'agent.preview') {
    return sweepAgentHibernationReaper(params, true)
  }
  if (method === 'agent-hibernation.sweep' || method === 'agent.sweep') {
    return sweepAgentHibernationReaper(params)
  }
  const source = controlText(params.source)
  const sessionId = controlText(params.sessionId || params.session_id || params.id)
  if (!sessionId) return controlFail('AGENT_SESSION_ID_REQUIRED', 'Managed AI session id is required.')
  const session = workspace.managedAiSessions.find((item) => item.id === sessionId && (!source || item.source === source))
  if (!session) return controlFail('AGENT_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  if (method === 'agent.hibernate') {
    const ok = await workspace.hibernateManagedAiSession(session.source, session.id, controlText(params.reason) || 'manual')
    return ok ? controlOk({ session: managedAiSessionSummaryForControl(session), snapshot: workspaceSnapshotForControl() }) : controlFail('AGENT_HIBERNATE_FAILED', 'Managed AI session hibernation failed.')
  }
  if (method === 'agent.resume') {
    const ok = await workspace.resumeManagedAiSession(session.source, session.id)
    return ok ? controlOk({ session: managedAiSessionSummaryForControl(session), snapshot: workspaceSnapshotForControl() }) : controlFail('AGENT_RESUME_FAILED', 'Managed AI session resume failed.')
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const handleControlRequest = async (request: ControlRequest): Promise<ControlResponse> => {
  const params = request.params || {}
  if (request.method === 'session.export') return controlOk({ snapshot: exportSessionSnapshotForControl(params) })
  if (request.method === 'session.restore') return restoreSessionSnapshotForControl(params)
  if (request.method === 'settings.open') {
    const requestedTarget = controlText(params.target || params.section || params.page || 'general') || 'general'
    const section = resolveControlSettingsSection(requestedTarget)
    if (!section) return controlFail('SETTINGS_TARGET_INVALID', 'Unknown settings target.', { target: requestedTarget })
    workspace.mode = 'terminal'
    workspace.activeModule = 'settings'
    workspace.leftPanelOpen = true
    workspace.rightPanelOpen = false
    workspace.setActiveSettingsSection(section)
    await nextTick()
    return controlOk({
      opened: true,
      target: section,
      requestedTarget,
      requested_target: requestedTarget,
      activeModule: workspace.activeModule,
      active_module: workspace.activeModule
    })
  }
  if (request.method === 'feedback.open') {
    const opened = await workspace.openSettingsExternalAction('反馈页面')
    return controlOk({
      opened,
      unsupported: !opened,
      ...(opened ? {} : { unsupportedReason: 'Feedback report bridge is unavailable or failed.' })
    })
  }
  if (request.method === 'extension.sidebar.snapshot') {
    const snapshot = workspaceSnapshotForControl()
    return controlOk({
      seq: snapshot.generatedAt,
      sequence: snapshot.generatedAt,
      window_id: controlText(params.windowId || params.window_id) || null,
      window_ref: controlText(params.windowId || params.window_id) || null,
      selected_workspace_id: 'main',
      selected_workspace_ref: 'workspace:1',
      workspaces: workspaceSidebarRowsForControl(snapshot),
      snapshot
    })
  }
  if (
    request.method.startsWith('project.') ||
    request.method === 'markdown.open' ||
    request.method === 'file.open'
  ) {
    return handleProjectFileControlRequest(request.method, params)
  }
  if (request.method === 'workspace.env' || request.method === 'workspace.set_auto_title') return handleWorkspaceMetadataControlRequest(request.method, params)
  if (request.method === 'workspace.action') return handleWorkspaceActionControlRequest(params)
  if (request.method.startsWith('workspace.remote.') || request.method.startsWith('remote.tmux.')) return handleWorkspaceRemoteControlRequest(request.method, params)
  if (request.method.startsWith('workspace.group.')) return handleWorkspaceGroupControlRequest(request.method, params)
  if (request.method.startsWith('surface.resume.')) return handleSurfaceResumeControlRequest(request.method, params)
  if (['workspace.next', 'workspace.previous', 'workspace.last', 'workspace.select', 'workspace.find', 'pane.focus', 'pane.last', 'surface.focus'].includes(request.method)) {
    return handlePaneNavigationControlRequest(request.method, params)
  }
  if (['pane.list', 'pane.surfaces', 'pane.create', 'workspace.create', 'surface.create', 'surface.split', 'workspace.rename', 'workspace.close', 'surface.close', 'workspace.has_session', 'workspace.select_layout'].includes(request.method)) {
    return handlePaneManagementControlRequest(request.method, params)
  }
  if (request.method.startsWith('pane.')) return handlePaneLayoutControlRequest(request.method, params)
  if (
    [
      'surface.move',
      'surface.reorder',
      'surface.action',
      'tab.action',
      'surface.split_off',
      'surface.refresh',
      'surface.health',
      'surface.trigger_flash',
      'surface.report_tty',
      'surface.report_shell_state',
      'surface.ports_kick',
      'workspace.reorder',
      'workspace.reorder_many',
      'workspace.move_to_window',
      'workspace.equalize_splits',
      'workspace.prompt_submit'
    ].includes(request.method)
  ) {
    return handleSurfaceOperationsControlRequest(request.method, params)
  }
  if (request.method === 'surface.respawn' || request.method === 'terminal.respawn') return handleSurfaceRespawnControlRequest(params)
  if (request.method.startsWith('agent.team.')) return handleAgentTeamControlRequest(request.method, params)
  if (request.method.startsWith('agent-hibernation.') || request.method.startsWith('agent.')) return handleAgentHibernationControlRequest(request.method, params)
  if (request.method === 'workspace.snapshot' || request.method === 'tree' || request.method === 'top') {
    return controlOk({ snapshot: workspaceSnapshotForControl() })
  }
  if (request.method === 'workspace.list' || request.method === 'workspace.current') {
    const snapshot = workspaceSnapshotForControl()
    return controlOk({
      workspaces: snapshot.workspaces,
      count: snapshot.workspaces.length,
      activeWorkspaceId: 'main',
      activePanelId: snapshot.activePanelId,
      mode: snapshot.mode,
      activeModule: snapshot.activeModule
    })
  }
  if (request.method === 'surface.list') {
    const snapshot = workspaceSnapshotForControl()
    return controlOk({
      surfaces: snapshot.surfaces,
      terminals: snapshot.terminals,
      splitGroups: snapshot.splitGroups,
      count: snapshot.surfaces.length,
      activePanelId: snapshot.activePanelId
    })
  }
  if (request.method === 'surface.current') {
    const snapshot = workspaceSnapshotForControl()
    const surface = snapshot.surfaces.find((item) => item.panelId === snapshot.activePanelId) || snapshot.surfaces[0] || null
    return controlOk({
      surface,
      activePanelId: snapshot.activePanelId
    })
  }
  if (request.method === 'terminal.list') {
    const terminals = workspace.panels.filter((panel) => panel.kind !== 'knowledge').map(terminalSummaryForControl)
    return controlOk({
      terminals,
      count: terminals.length,
      activePanelId: workspace.activePanelId
    })
  }
  if (request.method === 'mobile.workspace.list') {
    const snapshot = workspaceSnapshotForControl()
    return controlOk({
      workspaces: snapshot.workspaces,
      terminals: snapshot.terminals,
      surfaces: snapshot.surfaces,
      count: snapshot.terminals.length,
      workspace_count: snapshot.workspaces.length,
      activeWorkspaceId: 'main',
      active_workspace_id: 'main',
      activePanelId: snapshot.activePanelId,
      active_panel_id: snapshot.activePanelId
    })
  }
  if (request.method === 'mobile.terminal.input' || request.method === 'terminal.input') return handleMobileTerminalInputControlRequest(params)
  if (request.method === 'mobile.terminal.paste' || request.method === 'terminal.paste') return handleMobileTerminalPasteControlRequest(params)
  if (request.method === 'mobile.terminal.replay' || request.method === 'terminal.replay') return handleMobileTerminalReplayControlRequest(params)
  if (request.method === 'mobile.terminal.viewport' || request.method === 'terminal.viewport') return handleMobileTerminalViewportControlRequest(params)
  if (request.method === 'mobile.terminal.scroll' || request.method === 'terminal.scroll') {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    return controlOk(terminalMobileTargetPayload(panel, { unsupported: true, unsupportedReason: 'aiopsterm does not expose xterm scroll gesture injection through the renderer control socket yet.' }))
  }
  if (request.method === 'mobile.terminal.mouse' || request.method === 'terminal.mouse') {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    return controlOk(terminalMobileTargetPayload(panel, { unsupported: true, unsupportedReason: 'aiopsterm does not expose xterm cell mouse injection through the renderer control socket yet.' }))
  }
  if (request.method === 'terminal.focus') {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    await nextTick()
    terminalViews.get(panel.id)?.terminal.focus()
    return controlOk({ terminal: terminalSummaryForControl(panel) })
  }
  if (request.method === 'terminal.read_screen') {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    const view = terminalViews.get(panel.id)
    if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, sessionId: panel.sessionId })
    const tailLines = controlNumber(params.tailLines || params.lines, view.terminal.rows || 30, 1, Math.max(1, workspace.terminalSettings.scrollBack || 1000))
    return controlOk({
      terminal: terminalSummaryForControl(panel),
      text: terminalBufferText(view, tailLines),
      tailLines
    })
  }
  if (request.method === 'terminal.clear_history') return clearTerminalHistoryForControl(params)
  if (request.method === 'notification.sync') {
    const notifications = Array.isArray(params.notifications) ? (params.notifications as ControlNotificationRecord[]) : []
    workspace.applyControlNotificationSnapshot(notifications)
    return controlOk({ count: notifications.length })
  }
  if (request.method === 'notification.open') {
    const focusRequest = params as ControlNotificationFocusRequest
    if (!focusRequest.notification) return controlFail('NOTIFICATION_PAYLOAD_INVALID', 'Notification focus payload is invalid.')
    const focused = workspace.focusControlNotification(focusRequest)
    return controlOk({ focused })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${request.method}`)
}
const terminalContentPaddingTop = 10
const terminalContentPaddingBottom = 16
const terminalAiButtonHeight = 32
const terminalFloatingGap = 8
const terminalBottomSafePx = 16
const malformedTerminalSuggestionMessage = '终端命令建议服务返回数据无效'
const failedTerminalSuggestionMessage = '终端命令建议加载失败'
const unavailableTerminalSuggestionMessage = '终端命令建议服务不可用'
const suggestionItems = ref<TerminalSuggestion[]>([])
const hasAiSuggestion = computed(() => suggestionItems.value.some((item) => item.source === 'ai'))
const canForkSelected = computed(() => workspace.canForkSshPanel(menu.panelId))
const isTerminalMenuPanel = computed(() => panelById(menu.panelId)?.kind === 'terminal')
const isReconnectablePanel = (panel?: TerminalPanel | null) => !panel?.sessionId || panel.status === 'closed' || panel.status === 'error'
const connectionActionLabel = (panel?: TerminalPanel | null) => {
  if (!panel?.sessionId) {
    if (panel?.sshSession) return panel.status === 'ready' ? '连接 SSH' : '重新连接'
    return panel?.status === 'ready' ? '打开本地 shell' : '重新连接'
  }
  return '断开连接'
}
const connectionActionShortcut = (panel?: TerminalPanel | null) => (panel?.sessionId ? 'Ctrl+D' : 'Enter')
const terminalStatusLabel = (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge') return t('terminal.status.editor')
  if (panel.status === 'connecting') return t('terminal.status.connecting')
  if (panel.status === 'error') return t('terminal.status.error')
  if (panel.status === 'closed') return t('terminal.status.closed')
  return t('terminal.status.connected')
}
const pathBaseName = (value?: string) => {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return ''
  if (normalized === '~' || normalized === '/') return normalized
  return normalized.split('/').filter(Boolean).pop() || normalized
}
const terminalSshTargetLabel = (panel: TerminalPanel) => {
  const ssh = panel.sshSession
  if (!ssh?.host) return ''
  const userHost = `${ssh.username ? `${ssh.username}@` : ''}${ssh.host}`
  return `${userHost}${ssh.port && ssh.port !== 22 ? `:${ssh.port}` : ''}`
}
const terminalTabMeta = (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge') return panel.knowledge?.relPath || panel.cwd || ''
  const sshTarget = terminalSshTargetLabel(panel)
  if (sshTarget) return sshTarget
  return pathBaseName(panel.cwd) || 'local'
}
const terminalTabKindBadge = (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge') return 'editor'
  if (panel.sshSession) return 'ssh'
  return ''
}
const terminalTabTooltip = (panel: TerminalPanel) => {
  const lines = [
    panel.title,
    `${t('terminal.tab.type')}: ${panel.kind === 'knowledge' ? t('terminal.status.editor') : panel.sshSession ? 'SSH' : t('terminal.kind.localTerminal')}`,
    `${t('terminal.tab.status')}: ${terminalStatusLabel(panel)}`
  ]
  const sshTarget = terminalSshTargetLabel(panel)
  if (sshTarget) lines.push(`${t('terminal.tab.host')}: ${sshTarget}`)
  if (panel.cwd) lines.push(`${t('terminal.tab.path')}: ${panel.cwd}`)
  if (panel.knowledge?.relPath) lines.push(`${t('terminal.tab.file')}: ${panel.knowledge.relPath}`)
  if (panel.sessionId) lines.push(`${t('terminal.tab.session')}: ${panel.sessionId}`)
  return lines.filter(Boolean).join('\n')
}
const terminalContextKindLabel = (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge') return t('terminal.kind.editor')
  if (panel.sshSession) return 'SSH'
  return t('terminal.kind.local')
}
const pendingAiSessionsForPanel = (panel: TerminalPanel) =>
  workspace.managedAiSessions.filter(
    (session) => session.state === 'needsInput' && (session.panelId === panel.id || Boolean(panel.sessionId && session.terminalSessionId === panel.sessionId))
  )
const terminalContextText = (panel: TerminalPanel) => {
  const pendingSessions = pendingAiSessionsForPanel(panel)
  return [
    `Title: ${panel.title}`,
    `Type: ${terminalContextKindLabel(panel)}`,
    `Status: ${terminalStatusLabel(panel)}`,
    terminalSshTargetLabel(panel) ? `Host: ${terminalSshTargetLabel(panel)}` : '',
    panel.cwd ? `CWD: ${panel.cwd}` : '',
    panel.knowledge?.relPath ? `File: ${panel.knowledge.relPath}` : '',
    panel.sessionId ? `Terminal Session: ${panel.sessionId}` : '',
    pendingSessions.length ? `Pending AI: ${pendingSessions.map((session) => `${session.source}/${session.title}`).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
const panelNeedsAiAttention = (panel: TerminalPanel) =>
  workspace.managedAiSessionNeedsAttentionForPanel(panel.id) || Boolean(panel.sessionId && workspace.managedAiSessionNeedsAttentionForPanel(panel.sessionId))
const terminalTabDragType = 'application/x-aiopsterm-terminal-tab'
const draggedTerminalPanelId = ref('')
const tabDragOverPanelId = ref('')
const paneDragOverPanelId = ref('')
const tabBarDragOver = ref(false)
let suggestionRequestId = 0
let commandGenerationRequestId = 0

const isWelcomePlaceholderPanel = (panel?: TerminalPanel | null) =>
  Boolean(
    panel &&
      panel.id === 'panel-main' &&
      panel.kind !== 'knowledge' &&
      panel.title === '欢迎' &&
      !panel.sessionId &&
      !panel.output &&
      !panel.outputSegments.length &&
      !panel.sshSession &&
      panel.status === 'ready' &&
      !panel.split &&
      !panel.splitGroupId
  )
const visibleTerminalTabPanels = computed(() => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel)))
const connectedTerminalPanels = computed(() => visibleTerminalTabPanels.value.filter((panel) => panel.kind !== 'knowledge'))
const activeTerminalPanel = computed(() => workspace.panels.find((panel) => panel.id === workspace.activePanelId) || visibleTerminalTabPanels.value[0] || workspace.panels[0])
const activeTerminalContextBar = computed(() => {
  const panel = activeTerminalPanel.value
  if (!panel || isWelcomePlaceholderPanel(panel)) return null
  const pendingAiCount = pendingAiSessionsForPanel(panel).length
  return {
    title: panel.title,
    kindLabel: terminalContextKindLabel(panel),
    statusLabel: terminalStatusLabel(panel),
    target: terminalSshTargetLabel(panel),
    path: panel.knowledge?.relPath || panel.cwd,
    pendingAiCount,
    focusable: panel.kind !== 'knowledge',
    text: terminalContextText(panel)
  }
})
const openAiSessionsFromContextBar = () => {
  workspace.activeModule = 'aiSessions'
  workspace.leftPanelOpen = true
}
const refreshAiSessionsFromContextBar = async () => {
  const refreshed = await workspace.refreshManagedAiSessions()
  if (!refreshed && !workspace.managedAiSessionsError) workspace.setTopNotice(t('terminal.context.refreshFailed'))
}
const focusActiveTerminalFromContextBar = () => {
  const panel = activeTerminalPanel.value
  if (!panel || panel.kind === 'knowledge') return
  workspace.activeModule = 'workspace'
  workspace.activePanelId = panel.id
  nextTick(() => terminalViews.get(panel.id)?.terminal.focus())
}
const copyActiveTerminalContext = async () => {
  const context = activeTerminalContextBar.value
  if (!context) return
  const copied = await copyTextToClipboard(context.text)
  workspace.setTopNotice(copied ? t('terminal.context.copied') : t('terminal.context.copyFailed'))
}
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
type SplitLayoutRect = { x: number; y: number; width: number; height: number }

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

const writeRuntimeLog = (level: RuntimeLogLevel, event: string, fields: Record<string, unknown> = {}) => {
  void window.aiops?.writeRuntimeLog?.(level, event, fields)
}

const emptyZmodemProgress = (): TerminalZmodemProgress => ({
  visible: false,
  type: 'download',
  fileName: '',
  transferred: 0,
  total: 0,
  status: 'running',
  message: ''
})

const zmodemSessionId = ref('')
const zmodemProgress = reactive<TerminalZmodemProgress>(emptyZmodemProgress())
const zmodemPercent = computed(() =>
  zmodemProgress.total > 0 ? Math.max(0, Math.min(100, Math.round((zmodemProgress.transferred / zmodemProgress.total) * 100))) : 0
)

const isTerminalSuggestionData = (value: unknown): value is TerminalSuggestion => {
  if (!isRecord(value)) return false
  if (typeof value.command !== 'string' || !value.command.trim()) return false
  if (!terminalSuggestionSources.has(value.source as TerminalSuggestion['source'])) return false
  if (value.explanation !== undefined && typeof value.explanation !== 'string') return false
  return true
}

const normalizeTerminalSuggestions = (value: unknown): TerminalSuggestion[] | null => {
  if (!Array.isArray(value)) return null
  if (!value.every(isTerminalSuggestionData)) return null
  return value.map((item) => ({
    command: item.command.trim(),
    source: item.source,
    ...(item.explanation !== undefined ? { explanation: item.explanation } : {})
  }))
}

const applyTerminalSettingsToView = (
  panelId: string,
  view: TerminalView,
  settings: TerminalSettings = workspace.terminalSettings,
  options: { preservePaneFontSize?: boolean; refit?: boolean } = {}
) => {
  const preservePaneFontSize = options.preservePaneFontSize ?? true
  setXtermTermName(view.terminal, settings.terminalType)
  view.terminal.options.fontFamily = settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
  view.terminal.options.fontSize = preservePaneFontSize && paneFontSizes[panelId] ? paneFontSizes[panelId] : settings.fontSize || defaultTerminalFontSize()
  view.terminal.options.lineHeight = settings.lineHeight || 1
  view.terminal.options.cursorBlink = settings.cursorBlink
  view.terminal.options.cursorStyle = settings.cursorStyle
  view.terminal.options.scrollback = settings.scrollBack
  if (options.refit !== false) {
    scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 3, forceGeometry: true })
  }
}

const bridgeErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

const formatZmodemBytes = (bytes: number) => {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

const terminalZmodemRuntime = createTerminalZmodemRuntime({
  getApi: () => window.aiops,
  appendData: (sessionId, data) => workspace.appendTerminalOutput(sessionId, data),
  onProgress: (sessionId, progress) => {
    if (zmodemProgressHideTimer !== null) {
      window.clearTimeout(zmodemProgressHideTimer)
      zmodemProgressHideTimer = null
    }
    zmodemSessionId.value = sessionId
    Object.assign(zmodemProgress, progress)
    if (progress.status !== 'running') {
      zmodemProgressHideTimer = window.setTimeout(() => {
        Object.assign(zmodemProgress, emptyZmodemProgress())
        zmodemSessionId.value = ''
        zmodemProgressHideTimer = null
      }, 1800)
    }
  },
  onNotice: (message) => workspace.setTopNotice(message)
})

const writeTerminalDisplayOutput = (view: TerminalView, data: string, options: { suppressInputReplies?: boolean } = {}) => {
  if (!data) return
  if (!options.suppressInputReplies) {
    view.terminal.write(data)
    return
  }
  view.suppressInputReplyDepth = (view.suppressInputReplyDepth || 0) + 1
  const restoreInputReplies = () => {
    view.suppressInputReplyDepth = Math.max(0, (view.suppressInputReplyDepth || 1) - 1)
  }
  if (view.terminal.write.length >= 2) {
    view.terminal.write(data, restoreInputReplies)
  } else {
    view.terminal.write(data)
    restoreInputReplies()
  }
}

const syncTerminalView = (panel: TerminalPanel, options: { suppressInputReplies?: boolean } = {}) => {
  if (panel.kind === 'knowledge') return
  const view = terminalViews.get(panel.id)
  if (!view) return
  const displayOutput = workspace.getHighlightedTerminalOutput(panel.id)
  if (displayOutput !== view.lastOutput) {
    if (displayOutput.startsWith(view.lastOutput)) {
      const chunk = displayOutput.slice(view.lastOutput.length)
      writeTerminalDisplayOutput(view, chunk, { suppressInputReplies: options.suppressInputReplies })
    } else {
      view.terminal.clear()
      writeTerminalDisplayOutput(view, displayOutput, { suppressInputReplies: true })
    }
    view.lastOutput = displayOutput
  }
  scheduleTerminalFit(panel.id, { scrollToBottom: true })
  updateSelectionButtonPosition(panel.id)
  updateSuggestionsPosition(panel.id)
}

const notifyBackendResize = (panelId: string, view: TerminalView) => {
  const panel = workspace.panels.find((item) => item.id === panelId)
  if (!panel?.sessionId || !window.aiops) return
  if (view.lastFitCols === view.terminal.cols && view.lastFitRows === view.terminal.rows) return
  view.lastFitCols = view.terminal.cols
  view.lastFitRows = view.terminal.rows
  window.aiops.resizeTerminal(panel.sessionId, view.terminal.cols, view.terminal.rows)
  writeRuntimeLog('debug', 'renderer.terminal.fit-resize', {
    panelId,
    sessionId: panel.sessionId,
    cols: view.terminal.cols,
    rows: view.terminal.rows
  })
}

const resetTerminalHostGeometry = (element: HTMLElement) => {
  element.style.width = ''
  element.style.height = ''
  element.style.maxWidth = ''
  element.style.maxHeight = ''
  const sizedNodes = element.querySelectorAll<HTMLElement>(
    '.xterm, .xterm-rows, .xterm-screen, .xterm-viewport, .xterm-scroll-area, .xterm-screen canvas, .xterm-screen .xterm-decoration-container, .xterm-screen .xterm-selection-layer, .xterm-screen .xterm-link-layer, .xterm-screen .xterm-text-layer'
  )
  sizedNodes.forEach((node) => {
    if (!node) return
    node.style.width = ''
    node.style.height = ''
    node.style.maxWidth = ''
    node.style.maxHeight = ''
    if (node instanceof HTMLCanvasElement) {
      node.removeAttribute('width')
      node.removeAttribute('height')
    }
  })
}

const scheduleTerminalFit = (panelId: string, options: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean } = {}) => {
  const frames = options.frames ?? 2
  const run = (remaining: number) => {
    window.requestAnimationFrame(() => {
      const view = terminalViews.get(panelId)
      const element = terminalElements.get(panelId)
      if (!view || !element?.isConnected) return
      if (options.forceGeometry) resetTerminalHostGeometry(element)
      view.fit.fit()
      notifyBackendResize(panelId, view)
      if (options.forceGeometry) view.terminal.refresh(0, Math.max(0, view.terminal.rows - 1))
      if (options.scrollToBottom) view.terminal.scrollToBottom()
      updateSelectionButtonPosition(panelId)
      updateSuggestionsPosition(panelId)
      if (remaining > 1) run(remaining - 1)
    })
  }
  run(Math.max(1, frames))
}

const scheduleVisibleTerminalFit = (options: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean } = {}) => {
  visibleTerminalPanels.value
    .filter((panel) => panel.kind !== 'knowledge')
    .forEach((panel) => scheduleTerminalFit(panel.id, options))
}

const refitAfterLayoutChange = () => {
  nextTick(() => scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 6, forceGeometry: true }))
}

const createTerminalView = (panel: TerminalPanel, element: HTMLElement) => {
  if (panel.kind === 'knowledge') return
  if (terminalViews.has(panel.id)) return
  const terminal = new XtermTerminal({
    cursorBlink: workspace.terminalSettings.cursorBlink,
    convertEol: true,
    cursorStyle: workspace.terminalSettings.cursorStyle,
    fontFamily: workspace.terminalSettings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: terminalFontSizeForPanel(panel.id),
    lineHeight: workspace.terminalSettings.lineHeight || 1,
    scrollback: workspace.terminalSettings.scrollBack,
    theme: {
      background: '#090b10',
      foreground: '#d7dae3',
      cursor: '#8ccf7e',
      selectionBackground: '#2d4059'
    }
  })
  const fit = new FitAddon()
  const searchAddon = new SearchAddon()
  terminal.loadAddon(fit)
  terminal.loadAddon(searchAddon)
  terminal.open(element)
  const view: TerminalView = { terminal, fit, search: searchAddon, lastOutput: '' }
  applyTerminalSettingsToView(panel.id, view, workspace.terminalSettings, { refit: false })
  if (typeof ResizeObserver !== 'undefined') {
    view.resizeObserver = new ResizeObserver(() => {
      scheduleTerminalFit(panel.id, { frames: 2 })
    })
    view.resizeObserver.observe(element)
  }
  terminalViews.set(panel.id, view)
  writeRuntimeLog('debug', 'renderer.terminal-view.created', {
    panelId: panel.id,
    hasSession: Boolean(panel.sessionId)
  })
  syncTerminalView(panel, { suppressInputReplies: Boolean(panel.output) })
  terminal.onData((data) => {
    if (view.suppressInputReplyDepth) {
      writeRuntimeLog('debug', 'renderer.terminal-input.suppressed-replay-reply', {
        panelId: panel.id,
        bytes: new TextEncoder().encode(data).length
      })
      return
    }
    void writeXtermInput(panel.id, data)
  })
  terminal.onSelectionChange(() => {
    const selectedText = terminal.getSelection()
    if (selectedText.trim()) void mirrorTextToClipboardQuietly(selectedText.trim())
    updateSelectionButtonPosition(panel.id)
  })
  terminal.onResize(({ cols, rows }) => {
    if (panel.sessionId && window.aiops) {
      window.aiops.resizeTerminal(panel.sessionId, cols, rows)
      writeRuntimeLog('debug', 'renderer.terminal.resize', {
        panelId: panel.id,
        sessionId: panel.sessionId,
        cols,
        rows
      })
    }
    updateSelectionButtonPosition(panel.id)
    updateSuggestionsPosition(panel.id)
  })
  element.querySelector('.xterm-viewport')?.addEventListener(
    'scroll',
    () => {
      updateSelectionButtonPosition(panel.id)
      updateSuggestionsPosition(panel.id)
    },
    { passive: true }
  )
}

const writeXtermInput = async (panelId: string, data: string) => {
  const panel = workspace.panels.find((item) => item.id === panelId || item.sessionId === panelId)
  const sessionId = panel?.sessionId
  const bytes = new TextEncoder().encode(data).length
  if (!panel || !sessionId) {
    workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
    writeRuntimeLog('warn', 'renderer.terminal-input.missing-session', {
      panelId,
      bytes
    })
    return
  }
  if (typeof window.aiops?.writeTerminal !== 'function') {
    workspace.setTopNotice('终端写入服务不可用')
    writeRuntimeLog('warn', 'renderer.terminal-input.missing-bridge', {
      panelId,
      sessionId,
      bytes
    })
    return
  }
  try {
    writeRuntimeLog('debug', 'renderer.terminal-input.write-request', {
      panelId,
      sessionId,
      bytes
    })
    const result = await window.aiops.writeTerminal(sessionId, data)
    if (!result?.ok || !isRecord(result.data) || result.data.id !== sessionId || result.data.bytes !== bytes) {
      workspace.setTopNotice(result?.errorMessage || '终端写入服务返回数据无效')
      writeRuntimeLog('warn', 'renderer.terminal-input.write-rejected', {
        panelId,
        sessionId,
        bytes,
        ok: result?.ok,
        errorCode: result?.errorCode,
        errorMessage: result?.errorMessage
      })
      return
    }
    writeRuntimeLog('debug', 'renderer.terminal-input.write-accepted', {
      panelId,
      sessionId,
      bytes
    })
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : '终端写入失败，请重新打开本地 shell 或连接 SSH'
    workspace.setTopNotice(message)
    writeRuntimeLog('error', 'renderer.terminal-input.write-error', {
      panelId,
      sessionId,
      bytes,
      message
    })
  }
}

const getPanelTitle = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)?.title || ''

const activatePanel = (panelId: string) => {
  workspace.activePanelId = panelId
  nextTick(() => terminalViews.get(panelId)?.terminal.focus())
}

const setTerminalElement = (panelId: string, element: Element | ComponentPublicInstance | null) => {
  if (!(element instanceof HTMLElement)) {
    terminalElements.delete(panelId)
    const view = terminalViews.get(panelId)
    if (view) {
      view.resizeObserver?.disconnect()
      view.terminal.dispose()
      terminalViews.delete(panelId)
    }
    return
  }
  terminalElements.set(panelId, element)
  const panel = workspace.panels.find((item) => item.id === panelId)
  if (panel && panel.kind !== 'knowledge') {
    createTerminalView(panel, element)
  }
}

const openMenu = (event: MouseEvent, panelId: string) => {
  const position = clampFloatingMenuPosition(event, 154, 320)
  menu.visible = true
  menu.x = position.x
  menu.y = position.y
  menu.panelId = panelId
  termMenu.visible = false
  aiButtonPanelId.value = ''
}

const openTerminalMenu = (event: MouseEvent, panelId: string) => {
  const position = clampFloatingMenuPosition(event, 214, 560)
  workspace.activePanelId = panelId
  hideSuggestions()
  termMenu.visible = true
  termMenu.x = position.x
  termMenu.y = position.y
  termMenu.panelId = panelId
  menu.visible = false
  aiButtonPanelId.value = ''
}

const clampFloatingMenuPosition = (event: MouseEvent, width: number, height: number) => {
  const padding = 8
  const maxX = Math.max(padding, window.innerWidth - width - padding)
  const maxY = Math.max(padding, window.innerHeight - height - padding)
  return {
    x: Math.max(padding, Math.min(event.clientX, maxX)),
    y: Math.max(padding, Math.min(event.clientY, maxY))
  }
}

const getSelectionVisibleRow = (view: { terminal: XtermTerminal }, panelId: string) => {
  const selectionPosition = view.terminal.getSelectionPosition()
  const selectedText = view.terminal.getSelection().trim()
  if (!selectionPosition || !selectedText) return null

  const viewportY = view.terminal.buffer.active.viewportY
  const visibleStart = viewportY
  const visibleEnd = viewportY + view.terminal.rows - 1
  const startY = selectionPosition.start.y
  const endY = selectionPosition.end.y
  if ((startY < visibleStart || startY > visibleEnd) && (endY < visibleStart || endY > visibleEnd)) return null

  const visibleSelectionRow = Math.max(visibleStart, Math.min(startY, visibleEnd))
  const terminalElement = terminalElements.get(panelId)
  const hostHeight = terminalElement?.clientHeight || terminalElement?.getBoundingClientRect().height || view.terminal.rows * 18
  const contentHeight = Math.max(0, hostHeight - terminalContentPaddingTop - terminalContentPaddingBottom)
  const cellHeight = Math.max(12, (contentHeight || hostHeight) / Math.max(view.terminal.rows, 1))
  const hostTop = terminalElement?.offsetTop || 0
  const contentTop = hostTop + terminalContentPaddingTop
  const rowIndex = Math.max(0, visibleSelectionRow - viewportY)
  const preferredTop = contentTop + Math.max(0, rowIndex - 2) * cellHeight
  const bottomSafe = Math.max(terminalBottomSafePx, cellHeight * 2)
  const minTop = hostTop + terminalFloatingGap
  const maxTop = hostTop + Math.max(minTop, hostHeight - terminalAiButtonHeight - bottomSafe)
  const aboveSelectionTop = contentTop + rowIndex * cellHeight - terminalAiButtonHeight - terminalFloatingGap
  const top = preferredTop > maxTop ? aboveSelectionTop : preferredTop
  return Math.round(Math.max(minTop, Math.min(top, maxTop)))
}

const updateSelectionButtonPosition = (panelId: string) => {
  const view = terminalViews.get(panelId)
  if (!view || !view.terminal.hasSelection()) {
    if (aiButtonPanelId.value === panelId) aiButtonPanelId.value = ''
    return
  }

  const top = getSelectionVisibleRow(view, panelId)
  if (top === null) {
    if (aiButtonPanelId.value === panelId) aiButtonPanelId.value = ''
    return
  }

  aiButtonPosition.top = top
  aiButtonPosition.right = 26
  aiButtonPanelId.value = panelId
}

const estimateTerminalCellSize = (view: { terminal: XtermTerminal }, panelId: string) => {
  const terminalElement = terminalElements.get(panelId)
  const rect = terminalElement?.getBoundingClientRect()
  const hostWidth = terminalElement?.clientWidth || rect?.width || view.terminal.cols * 9
  const hostHeight = terminalElement?.clientHeight || rect?.height || view.terminal.rows * 18
  return {
    width: Math.max(6, hostWidth / Math.max(view.terminal.cols, 1)),
    height: Math.max(12, hostHeight / Math.max(view.terminal.rows, 1)),
    hostWidth,
    hostHeight
  }
}

const updateSuggestionsPosition = (panelId = suggestionPanel.panelId) => {
  if (!panelId || suggestionPanel.panelId !== panelId || (!suggestionItems.value.length && !aiSuggestLoading.value)) return
  const view = terminalViews.get(panelId)
  if (!view) return
  const { width: cellWidth, height: cellHeight, hostWidth, hostHeight } = estimateTerminalCellSize(view, panelId)
  const cursorX = view.terminal.buffer.active.cursorX || 0
  const cursorY = view.terminal.buffer.active.cursorY || 0
  const panelWidth = 320
  const estimatedRows = Math.min(6, suggestionItems.value.length + (aiSuggestLoading.value ? 1 : 0))
  const panelHeight = estimatedRows * 30 + 42
  const bufferDistance = Math.max(3, cellHeight * 0.2)
  const cursorLeft = cursorX * cellWidth
  const cursorTop = cursorY * cellHeight
  const belowTop = cursorTop + cellHeight + bufferDistance
  const aboveTop = cursorTop - panelHeight - bufferDistance

  suggestionPosition.left = Math.max(8, Math.min(cursorLeft, Math.max(8, hostWidth - panelWidth - 12)))
  suggestionPosition.top = belowTop + panelHeight > hostHeight ? Math.max(8, aboveTop) : belowTop
}

const handleTerminalContextMenu = async (panelId: string, event: MouseEvent) => {
  workspace.activePanelId = panelId
  switch (workspace.terminalSettings.rightMouseEvent) {
    case 'paste':
      await pasteClipboard(panelId)
      break
    case 'contextMenu':
      openTerminalMenu(event, panelId)
      break
    case 'none':
      termMenu.visible = false
      aiButtonPanelId.value = ''
      break
  }
}

const handleTerminalMouseDown = async (panelId: string, event: MouseEvent) => {
  workspace.activePanelId = panelId
  if (event.button !== 1) return
  event.preventDefault()
  switch (workspace.terminalSettings.middleMouseEvent) {
    case 'paste':
      await pasteClipboard(panelId)
      break
    case 'contextMenu':
      openTerminalMenu(event, panelId)
      break
    case 'closeTab':
      workspace.closePanel(panelId)
      termMenu.visible = false
      break
    case 'none':
      termMenu.visible = false
      aiButtonPanelId.value = ''
      break
  }
}

const startRename = (panelId: string, title: string) => {
  renamingId.value = panelId
  renameText.value = title
}

const finishRename = () => {
  workspace.renamePanel(renamingId.value, renameText.value)
  renamingId.value = ''
}

const closeSelected = () => {
  workspace.closePanel(menu.panelId)
  menu.visible = false
}

const closeTab = (panelId: string) => {
  workspace.closePanel(panelId)
  menu.visible = false
  termMenu.visible = false
  nextTick(() => scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 3, forceGeometry: true }))
}

const closeOtherTabsFromMenu = () => {
  workspace.activePanelId = menu.panelId
  workspace.closeOthers()
  menu.visible = false
}

const closeAllTabsFromMenu = () => {
  workspace.closeAllPanels()
  menu.visible = false
}

const renameSelected = () => {
  startRename(menu.panelId, getPanelTitle(menu.panelId))
  menu.visible = false
}

const cloneSelected = () => {
  const source = workspace.panels.find((panel) => panel.id === menu.panelId)
  const sourcePanelId = source?.id
  workspace.createPanel()
  if (source) {
    workspace.renamePanel(workspace.activePanelId, `${source.title} copy`)
    const panel = panelById(workspace.activePanelId)
    if (panel) {
      panel.cwd = source.cwd
      panel.sshSession = source.sshSession
        ? {
            ...source.sshSession,
            connectionId: undefined,
            sourcePanelId
          }
        : undefined
    }
  }
  menu.visible = false
}

const terminalViewSize = (panelId: string) => {
  const view = terminalViews.get(panelId)
  view?.fit.fit()
  return {
    cols: view?.terminal.cols || 80,
    rows: view?.terminal.rows || 24
  }
}

const startLocalTerminalForPanel = async (panel: TerminalPanel) => {
  if (!window.aiops?.createTerminal) {
    workspace.setTopNotice('本地终端启动服务不可用')
    return false
  }
  await nextTick()
  const size = terminalViewSize(panel.id)
  try {
    const session = await window.aiops.createTerminal({
      kind: 'local',
      panelId: panel.id,
      workspaceId: 'workspace',
      cols: size.cols,
      rows: size.rows,
      terminalType: workspace.terminalSettings.terminalType
    })
    const connected = Boolean(workspace.applyLocalTerminalSession(panel.id, session))
    if (!connected) workspace.setTopNotice('本地终端启动失败')
    return connected
  } catch (error) {
    workspace.setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
    return false
  }
}

const startSshTerminalForPanel = async (panel: TerminalPanel) => {
  const ssh = panel.sshSession
  if (!ssh) return false
  if (!window.aiops?.createTerminal) {
    workspace.setTopNotice('SSH 终端启动服务不可用')
    return false
  }
  await nextTick()
  const size = terminalViewSize(panel.id)
  try {
    const session = await window.aiops.createTerminal({
      kind: 'ssh',
      assetId: ssh.assetId,
      title: panel.title,
      cols: size.cols,
      rows: size.rows,
      terminalType: workspace.terminalSettings.terminalType,
      ssh: {
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        needProxy: Boolean(ssh.needProxy),
        proxyName: ssh.proxyName || '',
        ...(ssh.forkFromConnectionId ? { forkFromConnectionId: ssh.forkFromConnectionId } : {})
      }
    })
    const connected = Boolean(workspace.applySshTerminalSession(panel.id, session, {
      id: ssh.assetId,
      name: ssh.assetName,
      title: ssh.assetName,
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      group_name: ssh.organizationId,
      asset_type: ssh.assetType,
      auth_type: ssh.authType,
      needProxy: ssh.needProxy,
      proxyName: ssh.proxyName
    }))
    if (!connected) workspace.setTopNotice('SSH 终端启动失败')
    return connected
  } catch (error) {
    workspace.setTopNotice(error instanceof Error ? error.message : 'SSH 终端启动失败')
    return false
  }
}

const connectSplitPanelFromSource = async (panel: TerminalPanel, sourcePanel?: TerminalPanel | null) => {
  if (!sourcePanel?.sessionId || sourcePanel.status === 'closed' || sourcePanel.status === 'error') return false
  return panel.sshSession ? startSshTerminalForPanel(panel) : startLocalTerminalForPanel(panel)
}

const createSplitPanel = async (direction: 'right' | 'below', sourcePanelId: string) => {
  const sourcePanel = panelById(sourcePanelId)
  workspace.activePanelId = sourcePanelId
  const panel = workspace.createPanel(direction)
  await nextTick()
  void connectSplitPanelFromSource(panel, sourcePanel)
  return panel
}

const splitSelected = (direction: 'right' | 'below') => {
  void createSplitPanel(direction, menu.panelId)
  menu.visible = false
}

const unsplitSelected = () => {
  workspace.unsplitPanel(menu.panelId)
  menu.visible = false
  refitAfterLayoutChange()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
}

const forkSelected = async () => {
  const sourcePanelId = menu.panelId
  const forkPanel = workspace.forkSshPanel(menu.panelId)
  menu.visible = false
  if (!forkPanel) return
  const pendingSsh = forkPanel.sshSession ? { ...forkPanel.sshSession } : null
  const connected = await startSshTerminalForPanel(forkPanel)
  if (!connected) {
    workspace.discardPendingTerminalPanel(forkPanel.id, sourcePanelId)
    return
  }
  const ssh = forkPanel.sshSession
  if (!ssh) return
  const contextId = pendingSsh?.assetId || ssh.assetId || ssh.connectionId || forkPanel.id
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== contextId),
    {
      id: contextId,
      kind: 'hosts',
      label: pendingSsh?.host || ssh.host,
      detail: `${pendingSsh?.assetName || ssh.assetName} fork`
    }
  ]
}

const activeView = () => terminalViews.get(workspace.activePanelId)
const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)

const getSuggestionContext = (panelId: string, mode: TerminalCommandSuggestionContext['mode'] = 'base'): TerminalCommandSuggestionContext => {
  const panel = panelById(panelId)
  return {
    panelId,
    mode,
    ...(panel?.sshSession?.host ? { host: panel.sshSession.host } : { host: 'local' }),
    shell: panel?.sessionId ? (panel.sshSession ? 'ssh' : 'local-shell') : 'bash',
    modelName: workspace.terminalCommandModelOptions[0] || ''
  }
}

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

const handleTabDrop = (event: DragEvent, targetPanel: TerminalPanel) => {
  const draggedId = getDraggedTerminalPanelId(event)
  if (!draggedId || draggedId === targetPanel.id) {
    clearTerminalTabDragState()
    return
  }
  workspace.attachPanelToSplit(draggedId, targetPanel.id, 'right')
  clearTerminalTabDragState()
  refitAfterLayoutChange()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
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
  refitAfterLayoutChange()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
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
  workspace.attachPanelToSplit(draggedId, targetPanel.id, 'right')
  clearTerminalTabDragState()
  refitAfterLayoutChange()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
}

const copySelection = async (panelId = workspace.activePanelId) => {
  const selectedText = terminalViews.get(panelId)?.terminal.getSelection()
  if (selectedText) {
    const copied = await copyTextToClipboard(selectedText)
    workspace.setTopNotice(copied ? '终端内容已复制' : '终端复制失败')
  }
  menu.visible = false
  termMenu.visible = false
}

const pasteClipboard = async (panelId = workspace.activePanelId) => {
  const clipboardRead = await readTextFromClipboard()
  if (!clipboardRead.ok) {
    if (clipboardRead.error === 'unavailable') {
      workspace.setTopNotice('终端剪贴板读取服务不可用')
    } else {
      workspace.setTopNotice(clipboardRead.message || '终端剪贴板读取失败')
    }
    termMenu.visible = false
    return
  }
  const text = clipboardRead.text
  if (!text) {
    termMenu.visible = false
    return
  }
  const panel = panelById(panelId)
  if (!panel || panel.kind === 'knowledge') {
    termMenu.visible = false
    return
  }
  const result = await workspace.runTerminalCommand(panel.id, text, {
    inputText: text,
    shellText: text,
    writeToShell: true,
    source: 'direct'
  })
  if (result?.status === 'allow') syncTerminalView(panel)
  menu.visible = false
  termMenu.visible = false
}

const clearTerminal = (panelId = workspace.activePanelId) => {
  const panel = panelById(panelId)
  if (!panel || panel.kind === 'knowledge') return
  workspace.replaceTerminalOutput(panel.id, '')
  const view = terminalViews.get(panelId)
  view?.terminal.clear()
  if (view) view.lastOutput = ''
  menu.visible = false
  termMenu.visible = false
}

const clearTerminalHistoryForControl = async (params: Record<string, unknown>) => {
  const panel = resolveControlTerminalPanel(params)
  if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  if (panel.kind === 'knowledge') return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
  const view = terminalViews.get(panel.id)
  if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, sessionId: panel.sessionId })
  workspace.replaceTerminalOutput(panel.id, '')
  view.terminal.clear()
  view.lastOutput = ''
  await nextTick()
  return controlOk({ terminal: terminalSummaryForControl(panel), cleared: true })
}

const findNext = () => {
  if (!search.value.trim() || searchMatchCount.value === 0) return
  const found = activeView()?.search.findNext(search.value, { caseSensitive: false })
  if (found && searchMatchCount.value > 0) {
    searchMatchIndex.value = searchMatchIndex.value >= searchMatchCount.value ? 1 : searchMatchIndex.value + 1
  }
}

const findPrevious = () => {
  if (!search.value.trim() || searchMatchCount.value === 0) return
  const found = activeView()?.search.findPrevious(search.value, { caseSensitive: false })
  if (found && searchMatchCount.value > 0) {
    searchMatchIndex.value = searchMatchIndex.value <= 1 ? searchMatchCount.value : searchMatchIndex.value - 1
  }
}

const recalculateSearchMatches = () => {
  const panel = workspace.activePanel
  const needle = search.value.trim().toLowerCase()
  if (!needle) {
    searchMatchCount.value = 0
    searchMatchIndex.value = 0
    return
  }
  const count = panel.output.toLowerCase().split(needle).length - 1
  searchMatchCount.value = Math.max(0, count)
  searchMatchIndex.value = count > 0 ? 1 : 0
}

const runIncrementalSearch = () => {
  const term = search.value.trim()
  const searchAddon = activeView()?.search
  if (!term) {
    searchAddon?.clearDecorations()
    searchMatchCount.value = 0
    searchMatchIndex.value = 0
    return
  }
  searchAddon?.findNext(term, { incremental: true, caseSensitive: false })
  recalculateSearchMatches()
}

const getSearchOverlayInput = () => {
  const input = searchOverlayInput.value
  if (Array.isArray(input)) {
    return input.find((item) => item?.isConnected) || input[0] || null
  }
  return input
}

const getCommandDialogInput = () => {
  const input = commandDialogInput.value
  if (Array.isArray(input)) {
    return input.find((item) => item?.isConnected) || input[0] || null
  }
  return input
}

const getCommandLineInput = () => {
  const input = commandLineInput.value
  if (Array.isArray(input)) {
    return input.find((item) => item?.isConnected) || input[0] || null
  }
  return input
}

const focusCommandLineInput = () => {
  const input = getCommandLineInput()
  if (input && typeof input.focus === 'function') input.focus({ preventScroll: true })
}

const commandLineStyle = (panelId: string) => {
  if (commandLinePanelId.value !== panelId) return {}
  const view = terminalViews.get(panelId)
  if (!view) return {}
  const { width: cellWidth, height: cellHeight, hostWidth, hostHeight } = estimateTerminalCellSize(view, panelId)
  const width = Math.max(320, Math.min(720, hostWidth - 24))
  const cursorLeft = (view.terminal.buffer.active.cursorX || 0) * cellWidth
  const cursorTop = (view.terminal.buffer.active.cursorY || 0) * cellHeight + cellHeight + 6
  const top = Math.min(Math.max(42, cursorTop), Math.max(42, hostHeight - 56))
  const left = Math.min(Math.max(12, cursorLeft), Math.max(12, hostWidth - width - 12))
  return {
    width: `${Math.floor(width)}px`,
    left: `${Math.floor(left)}px`,
    top: `${Math.floor(top)}px`
  }
}

const openCommandLine = async (panelId = workspace.activePanelId) => {
  const panel = panelById(panelId)
  if (!panel || panel.kind === 'knowledge') return
  workspace.activePanelId = panel.id
  commandLinePanelId.value = panel.id
  command.value = ''
  hideSuggestions()
  termMenu.visible = false
  menu.visible = false
  aiButtonPanelId.value = ''
  await nextTick()
  focusCommandLineInput()
}

const openCommandLineFromMenu = () => {
  void openCommandLine(termMenu.panelId)
}

const closeCommandLine = () => {
  command.value = ''
  commandLinePanelId.value = ''
  hideSuggestions()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
}

const focusCommandDialogInput = () => {
  const input = getCommandDialogInput()
  if (input && typeof input.focus === 'function') {
    input.focus({ preventScroll: true })
  }
}

const resizeCommandDialogInput = () => {
  const input = getCommandDialogInput()
  if (!input) return
  input.style.height = 'auto'
  input.style.height = `${Math.max(28, input.scrollHeight)}px`
  nextTick(() => updateCommandDialogPosition(commandDialog.panelId))
}

const commandDialogStyle = (panelId: string) => {
  if (commandDialog.panelId !== panelId) return {}
  return {
    top: `${commandDialog.top}px`,
    left: `${commandDialog.left}px`,
    width: `${commandDialog.width}px`
  }
}

const updateCommandDialogPosition = async (panelId = commandDialog.panelId) => {
  if (!commandDialog.visible || !panelId) return
  const host = terminalElements.get(panelId)
  const pane = host?.closest('.terminal-pane') as HTMLElement | null
  if (!host || !pane) return
  const view = terminalViews.get(panelId)
  const margin = 18
  const paneWidth = pane.clientWidth || pane.getBoundingClientRect().width || 640
  const paneHeight = pane.clientHeight || pane.getBoundingClientRect().height || 420
  const dialogWidth = Math.max(320, Math.min(600, paneWidth - margin * 2, 520))
  commandDialog.width = Math.floor(dialogWidth)

  await nextTick()
  const dialogElement = (Array.isArray(commandDialogRef.value) ? commandDialogRef.value.find((item) => item?.isConnected) : commandDialogRef.value) as HTMLElement | null
  const dialogHeight = dialogElement?.querySelector('.command-dialog-card')?.clientHeight || dialogElement?.clientHeight || 118
  const cell = view ? estimateTerminalCellSize(view, panelId) : { height: 18 }
  const cursorY = view?.terminal.buffer.active.cursorY || 0
  const cursorTop = host.offsetTop + cursorY * cell.height
  const below = cursorTop + cell.height + margin
  const bottom = paneHeight - dialogHeight - margin
  const top = below + dialogHeight <= paneHeight - margin ? below : bottom

  commandDialog.left = Math.max(margin, Math.min(Math.round((paneWidth - dialogWidth) / 2), paneWidth - dialogWidth - margin))
  commandDialog.top = Math.max(margin, Math.min(Math.round(top), Math.max(margin, bottom)))
}

const resetCommandDialog = () => {
  commandDialog.instruction = ''
  commandDialog.generatedCommand = ''
  commandDialog.loading = false
  commandDialog.error = ''
}

const openCommandDialog = async (panelId = workspace.activePanelId) => {
  const panel = workspace.panels.find((item) => item.id === panelId)
  if (!panel || panel.kind === 'knowledge') return
  workspace.activePanelId = panelId
  commandDialog.visible = true
  commandDialog.panelId = panelId
  commandDialog.modelName = commandDialog.modelName || workspace.terminalCommandModelOptions[0] || ''
  commandDialog.error = ''
  termMenu.visible = false
  menu.visible = false
  aiButtonPanelId.value = ''
  void workspace.refreshAiModelCatalog()
  await nextTick()
  resizeCommandDialogInput()
  await updateCommandDialogPosition(panelId)
  focusCommandDialogInput()
}

const openCommandDialogFromTabMenu = () => {
  void openCommandDialog(menu.panelId)
}

const openCommandDialogFromTermMenu = () => {
  void openCommandDialog(termMenu.panelId)
}

const closeCommandDialog = () => {
  resetCommandDialog()
  commandDialog.visible = false
  commandDialog.panelId = ''
  const active = workspace.activePanel
  if (active?.kind !== 'knowledge') {
    nextTick(() => terminalViews.get(active.id)?.terminal.focus())
  }
}

const submitCommandDialog = async () => {
  const panelId = commandDialog.panelId
  if (!panelId || commandDialog.loading) return
  if (!commandDialog.instruction.trim()) {
    commandDialog.error = '请输入命令描述'
    return
  }
  if (!workspace.terminalCommandModelOptions.length) {
    await workspace.refreshAiModelCatalog()
  }
  if (!workspace.terminalCommandModelOptions.length) {
    commandDialog.error = '没有可用命令模型'
    return
  }
  if (!workspace.terminalCommandModelOptions.includes(commandDialog.modelName)) {
    commandDialog.modelName = workspace.terminalCommandModelOptions[0]
  }
  commandDialog.loading = true
  commandDialog.error = ''
  commandDialog.generatedCommand = ''
  const instruction = commandDialog.instruction.trim()
  const requestId = ++commandGenerationRequestId
  try {
    const record = await workspace.generateTerminalCommand(panelId, instruction, commandDialog.modelName)
    if (requestId !== commandGenerationRequestId || !commandDialog.visible || commandDialog.panelId !== panelId) return
    commandDialog.loading = false
    if (!record) {
      commandDialog.error = '命令生成失败'
      commandDialog.instruction = instruction
      return
    }
    commandDialog.generatedCommand = record.command
    applyGeneratedCommand(panelId)
  } catch (error) {
    if (requestId !== commandGenerationRequestId || !commandDialog.visible || commandDialog.panelId !== panelId) return
    commandDialog.loading = false
    commandDialog.error = error instanceof Error ? error.message : '命令生成失败'
    commandDialog.instruction = instruction
  }
}

const applyGeneratedCommand = (panelId: string) => {
  if (!commandDialog.generatedCommand.trim()) return
  const result = workspace.injectGeneratedTerminalCommand(panelId, commandDialog.generatedCommand)
  if (result?.status === 'allow') {
    const panel = panelById(panelId)
    if (panel) syncTerminalView(panel)
    command.value = commandDialog.generatedCommand
    commandDialog.instruction = ''
    commandDialog.generatedCommand = ''
    commandDialog.error = ''
    nextTick(() => {
      resizeCommandDialogInput()
      focusCommandDialogInput()
    })
  }
}

const focusSearchOverlayInput = () => {
  const input = getSearchOverlayInput()
  if (input && typeof input.focus === 'function') {
    input.focus()
  }
}

const openSearchOverlay = async (panelId = workspace.activePanelId) => {
  workspace.activePanelId = panelId
  searchOverlayPanelId.value = panelId
  termMenu.visible = false
  aiButtonPanelId.value = ''
  await nextTick()
  focusSearchOverlayInput()
  recalculateSearchMatches()
}

const closeSearchOverlay = () => {
  clearSearch({ refocus: false })
  searchOverlayPanelId.value = ''
  aiButtonPanelId.value = ''
}

const clearSearch = (options: { refocus?: boolean } = {}) => {
  activeView()?.search.clearDecorations()
  search.value = ''
  searchMatchCount.value = 0
  searchMatchIndex.value = 0
  if (options.refocus !== false && searchOverlayPanelId.value) {
    nextTick(focusSearchOverlayInput)
  }
}

const clearSearchFromButton = () => {
  clearSearch()
}

const updateFontSize = (panelId: string, nextSize: number) => {
  const view = terminalViews.get(panelId)
  if (!view) return
  const normalized = Math.min(24, Math.max(9, nextSize))
  paneFontSizes[panelId] = normalized
  view.terminal.options.fontSize = normalized
  scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 4, forceGeometry: true })
}

const increaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) + 1)
const decreaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) - 1)
const increaseFontFromMenu = () => {
  increaseFont(termMenu.panelId || workspace.activePanelId)
  termMenu.visible = false
  menu.visible = false
}
const decreaseFontFromMenu = () => {
  decreaseFont(termMenu.panelId || workspace.activePanelId)
  termMenu.visible = false
  menu.visible = false
}

const handleTerminalWheel = (panelId: string, event: WheelEvent) => {
  if (!workspace.terminalSettings.pinchZoomStatus || (!event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  if (event.deltaY < 0) increaseFont(panelId)
  if (event.deltaY > 0) decreaseFont(panelId)
}

const sendCommand = async (panel: TerminalPanel) => {
  if (suggestionSelectionMode.value && activeSuggestion.value >= 0 && suggestionItems.value[activeSuggestion.value]) {
    command.value = suggestionItems.value[activeSuggestion.value].command
  }
  const text = command.value.trim()
  if (!text) return
  hideSuggestions()
  const decision = await workspace.runTerminalCommand(panel.id, text, {
    writeToShell: true,
    source: 'direct'
  })
  if (decision.status === 'allow') {
    command.value = ''
    commandLinePanelId.value = ''
    syncTerminalView(panel)
  }
}

const updateSuggestions = async (panelId: string) => {
  const rawQuery = command.value.trim()
  const query = rawQuery.toLowerCase()
  const requestId = ++suggestionRequestId
  suggestionPanel.panelId = panelId
  suggestionSelectionMode.value = false
  activeSuggestion.value = -1
  aiSuggestLoading.value = false
  if (!query) {
    suggestionItems.value = []
    suggestionPanel.panelId = ''
    return
  }
  if (!workspace.extensionSettings.autoCompleteStatus) {
    suggestionItems.value = []
    suggestionPanel.panelId = ''
    return
  }
  let base: TerminalSuggestion[] = []
  let suggestionNotice = ''
  try {
    const suggestionBridge = window.aiops?.getTerminalCommandSuggestions
    if (typeof suggestionBridge !== 'function') {
      suggestionNotice = unavailableTerminalSuggestionMessage
      throw new Error(unavailableTerminalSuggestionMessage)
    }
    const result = await suggestionBridge(rawQuery, getSuggestionContext(panelId, 'base'))
    const normalized = normalizeTerminalSuggestions(result)
    if (!normalized) {
      suggestionNotice = malformedTerminalSuggestionMessage
      throw new Error(malformedTerminalSuggestionMessage)
    }
    base = normalized
  } catch (error) {
    base = []
    suggestionNotice = suggestionNotice || bridgeErrorMessage(error, failedTerminalSuggestionMessage)
  }
  if (requestId !== suggestionRequestId || suggestionPanel.panelId !== panelId || command.value.trim().toLowerCase() !== query) return
  if (suggestionNotice) workspace.setTopNotice(suggestionNotice)
  suggestionItems.value = base.slice(0, 6)
  nextTick(() => updateSuggestionsPosition(panelId))
}

const hideSuggestions = () => {
  suggestionRequestId += 1
  suggestionItems.value = []
  suggestionPanel.panelId = ''
  suggestionSelectionMode.value = false
  activeSuggestion.value = -1
  aiSuggestLoading.value = false
}

const enterSuggestionSelection = () => {
  if (!suggestionItems.value.length) return
  suggestionSelectionMode.value = true
  activeSuggestion.value = Math.max(0, activeSuggestion.value)
  updateSuggestionsPosition()
}

const moveSuggestion = (delta: number) => {
  if (!suggestionItems.value.length) return
  suggestionSelectionMode.value = true
  const max = suggestionItems.value.length - 1
  activeSuggestion.value = activeSuggestion.value < 0 ? 0 : Math.min(max, Math.max(0, activeSuggestion.value + delta))
  updateSuggestionsPosition()
}

const applySuggestion = (value: string) => {
  command.value = value
  hideSuggestions()
}

const triggerAiSuggestion = async () => {
  const rawQuery = command.value.trim()
  const query = rawQuery.toLowerCase()
  const panelId = suggestionPanel.panelId || workspace.activePanelId
  if (!workspace.extensionSettings.autoCompleteStatus || !rawQuery || suggestionSelectionMode.value || aiSuggestLoading.value || hasAiSuggestion.value) return
  const requestId = ++suggestionRequestId
  aiSuggestLoading.value = true
  updateSuggestionsPosition()
  let suggestionErrorMessage = ''
  try {
    const suggestionBridge = window.aiops?.getTerminalCommandSuggestions
    if (typeof suggestionBridge !== 'function') {
      suggestionErrorMessage = unavailableTerminalSuggestionMessage
      throw new Error(unavailableTerminalSuggestionMessage)
    }
    const result = await suggestionBridge(rawQuery, getSuggestionContext(panelId, 'ai'))
    const aiSuggestions = normalizeTerminalSuggestions(result)
    if (!aiSuggestions) {
      suggestionErrorMessage = malformedTerminalSuggestionMessage
      throw new Error(malformedTerminalSuggestionMessage)
    }
    if (requestId !== suggestionRequestId || command.value.trim().toLowerCase() !== query) return
    suggestionItems.value = [...aiSuggestions, ...suggestionItems.value].slice(0, 6)
  } catch (error) {
    if (requestId !== suggestionRequestId) return
    suggestionItems.value = suggestionItems.value.filter((item) => item.source !== 'ai')
    workspace.setTopNotice(suggestionErrorMessage || bridgeErrorMessage(error, failedTerminalSuggestionMessage))
  } finally {
    if (requestId !== suggestionRequestId) return
    aiSuggestLoading.value = false
    nextTick(() => updateSuggestionsPosition())
  }
}

const sendGlobalCommand = async () => {
  const text = globalCommand.value.trim()
  if (!text) return
  const decision = await workspace.runGlobalTerminalCommand(text)
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
  if (decision.status !== 'allow') return
  globalCommand.value = ''
}

const approveSecurityPrompt = async () => {
  const execution = workspace.approveTerminalSecurityPrompt()
  if (!execution) return
  const decision = execution.writeToShell ? await workspace.writeTerminalExecution(execution) : null
  if (!execution.writeToShell || decision?.status === 'allow') {
    command.value = ''
    commandLinePanelId.value = ''
    hideSuggestions()
  }
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
}

const cancelSecurityPrompt = () => {
  workspace.cancelTerminalSecurityPrompt()
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel))
}

const toggleGlobalInput = () => {
  globalInputVisible.value = !globalInputVisible.value
  termMenu.visible = false
  aiButtonPanelId.value = ''
}

const reconnectTerminalPanel = async (panel: TerminalPanel) => {
  if (!window.aiops?.createTerminal) {
    workspace.setTopNotice('终端启动服务不可用')
    return false
  }
  if (panel.sshSession) {
    return startSshTerminalForPanel(panel)
  }
  return startLocalTerminalForPanel(panel)
}

const disconnectTerminalPanel = async (panel: TerminalPanel) => {
  if (!panel.sessionId) {
    workspace.setTopNotice('终端会话不可用，请先打开本地 shell 或连接 SSH')
    return false
  }
  if (!window.aiops?.killTerminal) {
    workspace.setTopNotice('终端断开服务不可用')
    return false
  }
  const sessionId = panel.sessionId
  let result: TerminalKillResult
  try {
    result = await window.aiops.killTerminal(sessionId)
  } catch (error) {
    workspace.setTopNotice(error instanceof Error ? error.message : '终端断开失败')
    return false
  }
  if (!result?.ok || !isTerminalKillSuccess(result, sessionId)) {
    workspace.setTopNotice(result?.ok ? '终端断开失败' : result?.errorMessage || '终端断开失败')
    return false
  }
  if (panel.sessionId === sessionId) {
    panel.sessionId = undefined
    panel.status = 'closed'
  }
  return true
}

const togglePanelConnection = async (panelId: string) => {
  const panel = panelById(panelId)
  if (!panel || panel.kind === 'knowledge') return
  const wasNeverConnected = !panel.sessionId && panel.status === 'ready'
  if (!panel.sessionId) {
    const connected = await reconnectTerminalPanel(panel)
    if (connected) workspace.setTopNotice(wasNeverConnected && !panel.sshSession ? '本地 shell 已打开' : '终端已重新连接')
  } else {
    const disconnected = await disconnectTerminalPanel(panel)
    if (disconnected) workspace.setTopNotice('终端已断开连接')
  }
  syncTerminalView(panel)
  termMenu.visible = false
}

const toggleTabConnectionFromMenu = async () => {
  await togglePanelConnection(menu.panelId)
  menu.visible = false
}

const createTerminalFromMenu = () => {
  workspace.createPanel()
  termMenu.visible = false
}

const closeTerminalFromMenu = () => {
  workspace.closePanel(termMenu.panelId)
  termMenu.visible = false
}

const splitFromTermMenu = (direction: 'right' | 'below') => {
  void createSplitPanel(direction, termMenu.panelId)
  termMenu.visible = false
}

const unsplitFromTermMenu = () => {
  workspace.unsplitPanel(termMenu.panelId)
  termMenu.visible = false
  refitAfterLayoutChange()
  nextTick(() => terminalViews.get(workspace.activePanelId)?.terminal.focus())
}

const openFileManagerFromMenu = () => {
  void workspace.ensureFileSessionForTerminalPanel(termMenu.panelId || workspace.activePanelId)
  termMenu.visible = false
}

const handleTerminalData = (event: TerminalDataEvent) => {
  if (!terminalZmodemRuntime.handleTerminalData(event)) {
    workspace.appendTerminalOutput(event.id, event.data)
  }
}

const cancelZmodemTransfer = () => {
  if (!zmodemSessionId.value || zmodemProgress.status !== 'running') return
  void terminalZmodemRuntime.cancel(zmodemSessionId.value)
}

const handleTerminalMouseUp = (panelId: string, event: MouseEvent) => {
  if (event.button !== 0 || termMenu.visible || searchOverlayPanelId.value === panelId) {
    aiButtonPanelId.value = ''
    return
  }
  updateSelectionButtonPosition(panelId)
}

const chatSelectionToAi = (panelId: string) => {
  const view = terminalViews.get(panelId)
  const selected = view?.terminal.getSelection().trim()
  if (selected) {
    workspace.rightPanelOpen = true
    workspace.selectedContexts = [...workspace.selectedContexts.filter((item) => item.id !== `terminal-${panelId}`), { id: `terminal-${panelId}`, kind: 'hosts', label: `Terminal selection: ${selected.slice(0, 24)}` }]
    void workspace.sendChat(`Terminal output:\n\`\`\`\n${selected}\n\`\`\``, undefined, undefined, { skipKnowledgeSearch: true })
    view?.terminal.clearSelection()
  }
  aiButtonPanelId.value = ''
}

onMounted(() => {
  offData = window.aiops?.onTerminalData(handleTerminalData) || null
  offLifecycle = window.aiops?.onTerminalLifecycle((event) => workspace.applyTerminalLifecycle(event)) || null
  offExit = window.aiops?.onTerminalExit((event) => workspace.applyTerminalExit(event)) || null
  offControlRequest = window.aiops?.onControlRequest(handleControlRequest) || null
  document.addEventListener('click', closeTerminalMenusFromDocument)
  window.addEventListener('keydown', handleShortcut)
})

onUnmounted(() => {
  offData?.()
  offLifecycle?.()
  offExit?.()
  offControlRequest?.()
  if (controlFlashTimer) {
    window.clearTimeout(controlFlashTimer)
    controlFlashTimer = null
  }
  terminalZmodemRuntime.dispose()
  if (zmodemProgressHideTimer !== null) {
    window.clearTimeout(zmodemProgressHideTimer)
    zmodemProgressHideTimer = null
  }
  terminalViews.forEach((view) => {
    view.resizeObserver?.disconnect()
    view.terminal.dispose()
  })
  terminalViews.clear()
  document.removeEventListener('click', closeTerminalMenusFromDocument)
  window.removeEventListener('keydown', handleShortcut)
})

const handleShortcut = async (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openSearchOverlay(workspace.activePanelId)
    return
  }
  if (event.key === 'Escape') {
    menu.visible = false
    termMenu.visible = false
    closeSearchOverlay()
    if (commandDialog.visible) closeCommandDialog()
    hideSuggestions()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (commandDialog.visible) {
      const activeInput = getCommandDialogInput()
      if (document.activeElement === activeInput) {
        terminalViews.get(commandDialog.panelId)?.terminal.focus()
      } else {
        focusCommandDialogInput()
      }
      return
    }
    openCommandDialog(workspace.activePanelId)
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    clearTerminal()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '=') {
    event.preventDefault()
    increaseFont(workspace.activePanelId)
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '-') {
    event.preventDefault()
    decreaseFont(workspace.activePanelId)
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
    event.preventDefault()
    await workspace.ensureFileSessionForTerminalPanel(workspace.activePanelId)
  }
}

watch(search, runIncrementalSearch)

watch(
  () =>
    workspace.panels
      .filter((panel) => panel.kind !== 'knowledge')
      .map((panel) => `${panel.id}:${panel.output.length}:${panel.outputSegments?.length || 0}:${panel.title}`)
      .join('|') + `${workspace.extensionSettings.highlightStatus}|${JSON.stringify(workspace.keywordHighlightSettings)}`,
  () => {
    nextTick(() => workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel)))
  }
)

watch(
  () => workspace.panels.map((panel) => panel.id).join('|'),
  () => {
    nextTick(() => {
      workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => {
        const element = terminalElements.get(panel.id)
        if (element) createTerminalView(panel, element)
      })
      for (const panelId of terminalViews.keys()) {
        if (!workspace.panels.some((panel) => panel.id === panelId)) {
          terminalViews.get(panelId)?.terminal.dispose()
          terminalViews.get(panelId)?.resizeObserver?.disconnect()
          terminalViews.delete(panelId)
          terminalElements.delete(panelId)
          delete paneFontSizes[panelId]
        }
      }
    })
  }
)

watch(
  terminalSettingsSignature,
  () => {
    terminalViews.forEach((view, panelId) => applyTerminalSettingsToView(panelId, view))
  }
)

watch(
  () => workspace.extensionSettings.autoCompleteStatus,
  (enabled) => {
    if (!enabled) hideSuggestions()
  }
)

watch(
  () => splitLayoutItems.value.map(({ panel, style }) => `${panel.id}:${panel.splitGroupId || ''}:${panel.split || ''}:${JSON.stringify(style)}`).join('|'),
  () => {
    refitAfterLayoutChange()
  },
  { flush: 'post' }
)

watch(
  () => workspace.activePanelId,
  (panelId, previousPanelId) => {
    if (previousPanelId && previousPanelId !== panelId && workspace.panels.some((panel) => panel.id === previousPanelId)) {
      lastActiveControlPanelId.value = previousPanelId
    }
    if (commandDialog.visible && commandDialog.panelId !== panelId) {
      resetCommandDialog()
      commandDialog.visible = false
      commandDialog.panelId = ''
    }
  }
)

watch(
  () => workspace.terminalCommandModelOptions.join('|'),
  (models) => {
    if (!commandDialog.modelName || !models.split('|').includes(commandDialog.modelName)) {
      commandDialog.modelName = workspace.terminalCommandModelOptions[0] || ''
    }
  },
  { immediate: true }
)
</script>
