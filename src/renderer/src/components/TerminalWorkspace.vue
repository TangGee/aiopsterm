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
        :class="{ active: panel.id === workspace.activePanelId, 'drag-over': tabDragOverPanelId === panel.id, 'ai-attention': panelNeedsAiAttention(panel) }"
        role="button"
        tabindex="0"
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
          class="terminal-tab-title"
          @dblclick.stop="startRename(panel.id, panel.title)"
        >{{ panel.title }}</span>
        <input
          v-else
          v-model="renameText"
          @blur="finishRename"
          @keydown.enter="finishRename"
          @keydown.esc="renamingId = ''"
        />
        <span
          v-if="panel.kind === 'knowledge'"
          class="terminal-tab-kind"
        >editor</span>
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
        :class="{ active: panel.id === workspace.activePanelId, below: panel.split === 'below', 'knowledge-pane': panel.kind === 'knowledge', 'drag-over': paneDragOverPanelId === panel.id, 'ai-attention': panelNeedsAiAttention(panel) }"
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
import { useWorkspaceStore, type TerminalPanel, type TerminalSettings } from '@/stores/workspace'
import { copyTextToClipboard, mirrorTextToClipboardQuietly, readTextFromClipboard } from '@/services/clipboardRuntime'
import { createTerminalZmodemRuntime, type TerminalZmodemProgress } from '@/services/zmodemRuntime'
import type {
  ControlAiAttentionSummary,
  ControlManagedAiSessionSummary,
  ControlRequest,
  ControlResponse,
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlSplitGroupSummary,
  ControlSurfaceSummary,
  ControlTerminalSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceSnapshot,
  RuntimeLogLevel,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext,
  TerminalDataEvent,
  TerminalKillResult
} from '@shared/preload'

const workspace = useWorkspaceStore()
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

type ControlWorkspaceGroupState = Omit<ControlWorkspaceGroupSummary, 'ref' | 'memberCount' | 'active'>

const controlWorkspaceGroups = ref<ControlWorkspaceGroupState[]>([])

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

const resolveControlPanelId = (value: unknown) => {
  const id = controlText(value)
  if (!id) return ''
  const panel = workspace.panels.find((item) => panelMatchesControlId(item, id))
  return panel?.id || ''
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
  return {
    panelId: panel.id,
    ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
    title: panel.title,
    kind: terminalKindForControl(panel),
    active: panel.id === workspace.activePanelId,
    connected: Boolean(panel.sessionId),
    status: panel.status,
    cwd: panel.cwd,
    ...(panel.sshSession?.host ? { host: panel.sshSession.host } : {}),
    ...(panel.sshSession?.port ? { port: panel.sshSession.port } : {}),
    ...(panel.sshSession?.username ? { username: panel.sshSession.username } : {}),
    ...(panel.sshSession?.assetId ? { assetId: panel.sshSession.assetId } : {}),
    ...(panel.sshSession?.assetName ? { assetName: panel.sshSession.assetName } : {}),
    ...(view ? { cols: view.terminal.cols, rows: view.terminal.rows } : {})
  }
}

const surfaceSummaryForControl = (panel: TerminalPanel): ControlSurfaceSummary => {
  const workspaceGroup = groupForPanelId(panel.id)
  return {
    panelId: panel.id,
    title: panel.title,
    surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
    active: panel.id === workspace.activePanelId,
    status: panel.status,
    cwd: panel.cwd,
    ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
    ...(panel.kind === 'knowledge' ? {} : { terminalKind: terminalKindForControl(panel), connected: Boolean(panel.sessionId) }),
    ...(panel.split ? { split: panel.split } : {}),
    ...(panel.splitSourceId ? { splitSourceId: panel.splitSourceId } : {}),
    ...(panel.splitGroupId ? { splitGroupId: panel.splitGroupId } : {}),
    ...(typeof panel.splitOrder === 'number' ? { splitOrder: panel.splitOrder } : {}),
    ...(workspaceGroup ? { workspaceGroupId: workspaceGroup.id, workspaceGroupName: workspaceGroup.name } : {}),
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
  return {
    generatedAt: Date.now(),
    mode: workspace.mode,
    activeModule: workspace.activeModule,
    activePanelId: workspace.activePanelId,
    workspaces: [
      {
        id: 'main',
        title: 'Main Workspace',
        active: true,
        mode: workspace.mode,
        activeModule: workspace.activeModule,
        activePanelId: workspace.activePanelId
      }
    ],
    terminals,
    surfaces,
    splitGroups,
    workspaceGroups,
    notifications: workspace.controlNotifications.map((notification) => ({ ...notification })),
    managedAiSessions,
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

const resolveControlTerminalPanel = (params: Record<string, unknown> = {}) => {
  const panelId = controlText(params.panelId || params.surfaceId)
  const sessionId = controlText(params.sessionId || params.terminalSessionId)
  if (panelId || sessionId) {
    return workspace.panels.find((panel) => panel.kind !== 'knowledge' && (panel.id === panelId || panel.sessionId === sessionId)) || null
  }
  const active = workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.id === workspace.activePanelId)
  return active || workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.sessionId) || null
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

const workspaceGroupPayload = (group?: ControlWorkspaceGroupState | null) => {
  const groups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
  return {
    groups,
    count: groups.length,
    ...(group ? { group: workspaceGroupSummaryForControl(group) } : {}),
    snapshot: workspaceSnapshotForControl()
  }
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

const handleControlRequest = async (request: ControlRequest): Promise<ControlResponse> => {
  const params = request.params || {}
  if (request.method.startsWith('workspace.group.')) return handleWorkspaceGroupControlRequest(request.method, params)
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
  if (panel.kind === 'knowledge') return '编辑器'
  if (panel.status === 'connecting') return '连接中'
  if (panel.status === 'error') return '异常'
  if (panel.status === 'closed') return '已断开'
  return '已连接'
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
  (panelId) => {
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
