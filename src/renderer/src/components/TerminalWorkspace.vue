<template>
  <section class="terminal-workspace">
    <div
      class="terminal-tabs"
      data-onboarding-id="main-workspace-tabs"
    >
      <button
        v-for="panel in workspace.panels"
        :key="panel.id"
        class="terminal-tab"
        :class="{ active: panel.id === workspace.activePanelId }"
        :draggable="panel.kind === 'knowledge'"
        @click="workspace.activePanelId = panel.id"
        @contextmenu.prevent="openMenu($event, panel.id)"
        @dragstart="handleTabDragStart($event, panel)"
      >
        <span
          v-if="renamingId !== panel.id"
          @dblclick.stop="startRename(panel.id, panel.title)"
        >{{ panel.title }}</span>
        <input
          v-else
          v-model="renameText"
          @blur="finishRename"
          @keydown.enter="finishRename"
          @keydown.esc="renamingId = ''"
        />
        <i>{{ panel.kind === 'knowledge' ? 'editor' : panel.status }}</i>
      </button>
      <button
        class="new-tab-button"
        title="新建终端"
        @click="workspace.createPanel()"
      >
        <Plus />
      </button>
    </div>

    <div
      v-if="menu.visible"
      class="tab-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button @click="closeSelected">关闭</button>
      <button @click="workspace.closeOthers(); menu.visible = false">关闭其他</button>
      <button @click="workspace.closeAllPanels(); menu.visible = false">关闭全部</button>
      <button @click="renameSelected">重命名</button>
      <button @click="cloneSelected">克隆</button>
      <button
        v-if="canForkSelected"
        @click="forkSelected"
      >
        Fork SSH Channel
      </button>
      <button @click="workspace.createPanel('right'); menu.visible = false">向右拆分</button>
      <button @click="workspace.createPanel('below'); menu.visible = false">向下拆分</button>
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
      <button @click="togglePanelConnection(termMenu.panelId)">{{ isReconnectablePanel(panelById(termMenu.panelId)) ? '重新连接' : '断开连接' }}<kbd>{{ isReconnectablePanel(panelById(termMenu.panelId)) ? 'Enter' : 'Ctrl+D' }}</kbd></button>
      <i />
      <button @click="createTerminalFromMenu"><span>新建终端</span><kbd>Ctrl+N</kbd></button>
      <button @click="closeTerminalFromMenu"><span>关闭终端</span><kbd>Ctrl+W</kbd></button>
      <button @click="clearTerminal(termMenu.panelId)"><span>清屏</span><kbd>Ctrl+L</kbd></button>
      <i />
      <button @click="splitFromTermMenu('right')">向右拆分</button>
      <button @click="splitFromTermMenu('below')">向下拆分</button>
      <i />
      <button @click="toggleGlobalInput">{{ globalInputVisible ? '关闭全局执行' : '全局执行' }}</button>
      <i />
      <button @click="openFileManagerFromMenu"><span>文件管理</span><kbd>Ctrl+M</kbd></button>
      <i />
      <button @click="increaseFont"><span>字体放大</span><kbd>Ctrl+=</kbd></button>
      <button @click="decreaseFont"><span>字体缩小</span><kbd>Ctrl+-</kbd></button>
    </div>

    <div class="terminal-toolbar">
      <div class="toolbar-group">
        <button @click="workspace.createPanel('right')"><PanelRight /> 向右拆分</button>
        <button @click="workspace.createPanel('below')"><PanelBottom /> 向下拆分</button>
        <button @click="startRealShell"><Terminal /> 打开本地 shell</button>
        <button
          :class="{ active: commandDialog.visible }"
          title="AI 命令生成"
          @click="openCommandDialog(workspace.activePanelId)"
        ><Sparkles /> AI 命令</button>
        <button
          :class="{ active: globalInputVisible }"
          @click="toggleGlobalInput"
        ><RadioTower /> 全局执行</button>
        <button @click="decreaseFont"><Minus /> 缩小</button>
        <button @click="increaseFont"><Plus /> 放大</button>
      </div>
      <div class="terminal-search">
        <Search />
        <input
          v-model="search"
          placeholder="搜索终端输出"
          @keydown.enter="findNext"
        />
        <button
          title="上一个"
          @click="findPrevious"
        >
          <ChevronUp />
        </button>
        <button
          title="下一个"
          @click="findNext"
        >
          <ChevronDown />
        </button>
      </div>
    </div>

    <div
      v-if="globalInputVisible"
      class="terminal-global-command"
    >
      <span><RadioTower /> Broadcast to {{ workspace.panels.filter((panel) => panel.kind !== 'knowledge').length }} windows</span>
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
      ref="terminalGrid"
      class="terminal-grid"
      :class="{ split: workspace.panels.length > 1 }"
    >
      <div
        v-if="showDashboard"
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
      <div
        v-for="panel in workspace.panels"
        :key="panel.id"
        class="terminal-pane"
        :class="{ active: panel.id === workspace.activePanelId, below: panel.split === 'below', 'knowledge-pane': panel.kind === 'knowledge' }"
        @click="activatePanel(panel.id)"
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
        <div class="command-line">
          <span>$</span>
          <input
            v-model="command"
            placeholder="输入命令，Enter 发送"
            @focus="workspace.activePanelId = panel.id"
            @input="updateSuggestions(panel.id)"
            @keydown.right.prevent="enterSuggestionSelection"
            @keydown.down.prevent="moveSuggestion(1)"
            @keydown.up.prevent="moveSuggestion(-1)"
            @keydown.esc.prevent="hideSuggestions"
            @keydown.enter.prevent="sendCommand(panel)"
          />
        </div>
        </template>
      </div>
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
import { ChevronDown, ChevronUp, Clock, ListTree, LoaderCircle, Minus, PanelBottom, PanelRight, Plus, RadioTower, Search, Sparkles, Terminal, X } from 'lucide-vue-next'
import TransferProgress from '@/components/files/TransferProgress.vue'
import KnowledgeCenterEditor from '@/components/KnowledgeCenterEditor.vue'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import type { TerminalCommandSuggestion, TerminalCommandSuggestionContext } from '@shared/preload'

const workspace = useWorkspaceStore()
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
let offData: (() => void) | null = null
let offLifecycle: (() => void) | null = null
let offExit: (() => void) | null = null
const fontSize = ref(12)
const terminalElements = new Map<string, HTMLElement>()
const terminalViews = new Map<string, { terminal: XtermTerminal; fit: FitAddon; search: SearchAddon; lastOutput: string }>()
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

const suggestionItems = ref<TerminalSuggestion[]>([])
const hasAiSuggestion = computed(() => suggestionItems.value.some((item) => item.source === 'ai'))
const canForkSelected = computed(() => workspace.canForkSshPanel(menu.panelId))
const isReconnectablePanel = (panel?: TerminalPanel | null) => panel?.status === 'closed' || panel?.status === 'error'
let suggestionRequestId = 0
let commandGenerationRequestId = 0

const showDashboard = ref(true)

const syncTerminalView = (panel: TerminalPanel) => {
  if (panel.kind === 'knowledge') return
  const view = terminalViews.get(panel.id)
  if (!view) return
  const displayOutput = workspace.getHighlightedTerminalOutput(panel.id)
  if (displayOutput !== view.lastOutput) {
    view.terminal.clear()
    view.terminal.write(displayOutput.replace(/\n/g, '\r\n'))
    view.lastOutput = displayOutput
  }
  window.requestAnimationFrame(() => view.fit.fit())
  updateSelectionButtonPosition(panel.id)
  updateSuggestionsPosition(panel.id)
}

const createTerminalView = (panel: TerminalPanel, element: HTMLElement) => {
  if (panel.kind === 'knowledge') return
  if (terminalViews.has(panel.id)) return
  const terminal = new XtermTerminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 12,
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
  terminalViews.set(panel.id, { terminal, fit, search: searchAddon, lastOutput: '' })
  syncTerminalView(panel)
  terminal.onSelectionChange(() => {
    const selectedText = terminal.getSelection()
    if (selectedText.trim() && navigator.clipboard) {
      navigator.clipboard.writeText(selectedText.trim()).catch(() => undefined)
    }
    updateSelectionButtonPosition(panel.id)
  })
  terminal.onResize(({ cols, rows }) => {
    if (panel.sessionId && window.aiops) {
      window.aiops.resizeTerminal(panel.sessionId, cols, rows)
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

const getPanelTitle = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)?.title || ''

const activatePanel = (panelId: string) => {
  workspace.activePanelId = panelId
  nextTick(() => terminalViews.get(panelId)?.terminal.focus())
}

const setTerminalElement = (panelId: string, element: Element | ComponentPublicInstance | null) => {
  if (!(element instanceof HTMLElement)) return
  terminalElements.set(panelId, element)
  const panel = workspace.panels.find((item) => item.id === panelId)
  if (panel && panel.kind !== 'knowledge') {
    createTerminalView(panel, element)
  }
}

const openMenu = (event: MouseEvent, panelId: string) => {
  menu.visible = true
  menu.x = event.clientX
  menu.y = event.clientY
  menu.panelId = panelId
  termMenu.visible = false
  aiButtonPanelId.value = ''
}

const openTerminalMenu = (event: MouseEvent, panelId: string) => {
  workspace.activePanelId = panelId
  hideSuggestions()
  termMenu.visible = true
  termMenu.x = event.clientX
  termMenu.y = event.clientY
  termMenu.panelId = panelId
  menu.visible = false
  aiButtonPanelId.value = ''
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
  const cellHeight = Math.max(12, hostHeight / Math.max(view.terminal.rows, 1))
  return Math.max(0, visibleSelectionRow - viewportY - 2) * cellHeight
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
  if (event.button !== 1) return
  event.preventDefault()
  workspace.activePanelId = panelId
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

const renameSelected = () => {
  startRename(menu.panelId, getPanelTitle(menu.panelId))
  menu.visible = false
}

const cloneSelected = () => {
  const source = workspace.panels.find((panel) => panel.id === menu.panelId)
  workspace.createPanel()
  if (source) {
    workspace.renamePanel(workspace.activePanelId, `${source.title} copy`)
  }
  menu.visible = false
}

const terminalViewSize = (panelId: string) => {
  const view = terminalViews.get(panelId)
  view?.fit.fit()
  return {
    cols: view?.terminal.cols,
    rows: view?.terminal.rows
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

const forkSelected = async () => {
  const forkPanel = workspace.forkSshPanel(menu.panelId)
  menu.visible = false
  if (forkPanel) await startSshTerminalForPanel(forkPanel)
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
    modelName: workspace.terminalCommandModelOptions[0] || workspace.config.modelName
  }
}

const handleTabDragStart = (event: DragEvent, panel: TerminalPanel) => {
  if (panel.kind !== 'knowledge' || !panel.knowledge?.relPath || !event.dataTransfer) return
  const payload = {
    contextType: panel.knowledge.isImage ? 'image' : 'doc',
    relPath: panel.knowledge.relPath,
    name: panel.title || panel.knowledge.relPath.split('/').pop() || 'KnowledgeCenter'
  }
  const serialized = JSON.stringify(payload)
  event.dataTransfer.setData('application/x-aiopsterm-context', serialized)
  event.dataTransfer.setData('text/html', `<span data-aiopsterm-context="${encodeURIComponent(serialized)}"></span>`)
  event.dataTransfer.setData('text/plain', panel.knowledge.relPath)
  event.dataTransfer.effectAllowed = 'copy'
}

const copySelection = async (panelId = workspace.activePanelId) => {
  const selectedText = terminalViews.get(panelId)?.terminal.getSelection()
  if (selectedText && navigator.clipboard) {
    await navigator.clipboard.writeText(selectedText)
  }
  menu.visible = false
}

const pasteClipboard = async (panelId = workspace.activePanelId) => {
  if (!navigator.clipboard) return
  const text = await navigator.clipboard.readText()
  if (!text) return
  const panel = panelById(panelId)
  if (!panel || panel.kind === 'knowledge') return
  const result = await workspace.runTerminalCommand(panel.id, text, {
    inputText: text,
    shellText: text,
    writeToShell: true,
    source: 'direct'
  })
  if (result?.status === 'allow') syncTerminalView(panel)
  menu.visible = false
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
  commandDialog.modelName = commandDialog.modelName || workspace.terminalCommandModelOptions[0] || workspace.config.modelName
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

const updateFontSize = (nextSize: number) => {
  fontSize.value = Math.min(20, Math.max(10, nextSize))
  terminalViews.forEach((view) => {
    view.terminal.options.fontSize = fontSize.value
    window.requestAnimationFrame(() => view.fit.fit())
  })
}

const increaseFont = () => updateFontSize(fontSize.value + 1)
const decreaseFont = () => updateFontSize(fontSize.value - 1)

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
    showDashboard.value = false
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
  let base: TerminalSuggestion[] = []
  try {
    base = window.aiops?.getTerminalCommandSuggestions
      ? await window.aiops.getTerminalCommandSuggestions(rawQuery, getSuggestionContext(panelId, 'base'))
      : []
  } catch {
    base = []
  }
  if (requestId !== suggestionRequestId || suggestionPanel.panelId !== panelId || command.value.trim().toLowerCase() !== query) return
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
  if (!rawQuery || suggestionSelectionMode.value || aiSuggestLoading.value || hasAiSuggestion.value) return
  const requestId = ++suggestionRequestId
  aiSuggestLoading.value = true
  updateSuggestionsPosition()
  try {
    const aiSuggestions = window.aiops?.getTerminalCommandSuggestions
      ? await window.aiops.getTerminalCommandSuggestions(rawQuery, getSuggestionContext(panelId, 'ai'))
      : []
    if (requestId !== suggestionRequestId || command.value.trim().toLowerCase() !== query) return
    suggestionItems.value = [...aiSuggestions, ...suggestionItems.value].slice(0, 6)
  } catch {
    if (requestId !== suggestionRequestId) return
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
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach(syncTerminalView)
  if (decision.status !== 'allow') return
  showDashboard.value = false
  globalCommand.value = ''
}

const approveSecurityPrompt = async () => {
  const execution = workspace.approveTerminalSecurityPrompt()
  if (!execution) return
  if (execution.writeToShell) await workspace.writeTerminalExecution(execution)
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach(syncTerminalView)
}

const cancelSecurityPrompt = () => {
  workspace.cancelTerminalSecurityPrompt()
  workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach(syncTerminalView)
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
  await nextTick()
  const size = terminalViewSize(panel.id)
  try {
    const session = await window.aiops.createTerminal({
      kind: 'local',
      cols: size.cols,
      rows: size.rows
    })
    const connected = Boolean(workspace.applyLocalTerminalSession(panel.id, session))
    if (!connected) workspace.setTopNotice('本地终端启动失败')
    return connected
  } catch (error) {
    workspace.setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
    return false
  }
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
  const result = await window.aiops.killTerminal(sessionId)
  if (!result?.ok) {
    workspace.setTopNotice(result?.errorMessage || '终端断开失败')
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
  if (isReconnectablePanel(panel)) {
    const connected = await reconnectTerminalPanel(panel)
    if (connected) workspace.setTopNotice('终端已重新连接')
  } else {
    const disconnected = await disconnectTerminalPanel(panel)
    if (disconnected) workspace.setTopNotice('终端已断开连接')
  }
  syncTerminalView(panel)
  termMenu.visible = false
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
  workspace.createPanel(direction)
  termMenu.visible = false
}

const openFileManagerFromMenu = () => {
  void workspace.ensureFileSessionForTerminalPanel(termMenu.panelId || workspace.activePanelId)
  termMenu.visible = false
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
    void workspace.sendChat(`Terminal output:\n\`\`\`\n${selected}\n\`\`\``)
    view?.terminal.clearSelection()
  }
  aiButtonPanelId.value = ''
}

const startRealShell = async () => {
  if (!window.aiops?.createTerminal) {
    workspace.setTopNotice('本地终端启动服务不可用')
    return
  }
  const panel = workspace.activePanel
  if (panel.kind === 'knowledge') return
  const size = terminalViewSize(panel.id)
  try {
    const session = await window.aiops.createTerminal({
      kind: 'local',
      cols: size.cols,
      rows: size.rows
    })
    if (!workspace.applyLocalTerminalSession(panel.id, session)) {
      workspace.setTopNotice('本地终端启动失败')
    }
  } catch (error) {
    workspace.setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
  }
}

onMounted(() => {
  offData = window.aiops?.onTerminalData((event) => workspace.appendTerminalOutput(event.id, event.data)) || null
  offLifecycle = window.aiops?.onTerminalLifecycle((event) => workspace.applyTerminalLifecycle(event)) || null
  offExit = window.aiops?.onTerminalExit((event) => workspace.applyTerminalExit(event)) || null
  document.addEventListener('click', () => {
    menu.visible = false
    termMenu.visible = false
  })
  window.addEventListener('keydown', handleShortcut)
})

onUnmounted(() => {
  offData?.()
  offLifecycle?.()
  offExit?.()
  terminalViews.forEach((view) => view.terminal.dispose())
  terminalViews.clear()
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
    increaseFont()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '-') {
    event.preventDefault()
    decreaseFont()
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
      .join('|') + JSON.stringify(workspace.keywordHighlightSettings),
  () => {
    nextTick(() => workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach(syncTerminalView))
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
          terminalViews.delete(panelId)
          terminalElements.delete(panelId)
        }
      }
    })
  }
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
      commandDialog.modelName = workspace.terminalCommandModelOptions[0] || workspace.config.modelName
    }
  },
  { immediate: true }
)
</script>
