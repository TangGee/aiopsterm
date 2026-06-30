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
        @click="activatePanel(panel.id)"
        @keydown.enter.prevent="activatePanel(panel.id)"
        @keydown.space.prevent="activatePanel(panel.id)"
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
      <button @click="copySelection(termMenu.panelId)"><span>{{ t('terminal.context.copy') }}</span><kbd>Ctrl+Shift+C</kbd></button>
      <button @click="pasteClipboard(termMenu.panelId)"><span>{{ t('terminal.context.paste') }}</span><kbd>Ctrl+Shift+V</kbd></button>
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
        >{{ terminalOutputMirrorText(panel) }}</pre>
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
import '@xterm/xterm/css/xterm.css'
import { ChevronDown, ChevronUp, Clock, ListTree, LoaderCircle, RadioTower, Search, Sparkles, Terminal, X } from 'lucide-vue-next'
import TransferProgress from '@/components/files/TransferProgress.vue'
import KnowledgeCenterEditor from '@/components/KnowledgeCenterEditor.vue'
import { useTerminalWorkspaceContainerRuntime } from '@/services/terminal/terminalWorkspaceContainerRuntime'

const {
  activeSuggestion,
  activeTerminalContextBar,
  activatePanel,
  aiButtonPanelId,
  aiButtonPosition,
  aiSuggestLoading,
  applyGeneratedCommand,
  applySuggestion,
  approveSecurityPrompt,
  canForkSelected,
  cancelSecurityPrompt,
  cancelZmodemTransfer,
  chatSelectionToAi,
  clearSearchFromButton,
  clearTerminal,
  cloneSelected,
  closeAllTabsFromMenu,
  closeCommandDialog,
  closeCommandLine,
  closeOtherTabsFromMenu,
  closeSearchOverlay,
  closeSelected,
  closeTab,
  closeTerminalFromMenu,
  command,
  commandDialog,
  commandDialogInput,
  commandDialogRef,
  commandDialogStyle,
  commandLineInput,
  commandLinePanelId,
  commandLineStyle,
  connectedTerminalPanels,
  connectionActionLabel,
  connectionActionShortcut,
  controlFlashingPanelIds,
  copyActiveTerminalContext,
  copySelection,
  createTerminalFromMenu,
  decreaseFontFromMenu,
  enterSuggestionSelection,
  findNext,
  findPrevious,
  finishRename,
  forkSelected,
  formatZmodemBytes,
  focusActiveTerminalFromContextBar,
  globalCommand,
  globalInputVisible,
  handlePaneDragEnter,
  handlePaneDragLeave,
  handlePaneDragOver,
  handlePaneDrop,
  handleTabBarDragLeave,
  handleTabBarDragOver,
  handleTabBarDrop,
  handleTabDragEnd,
  handleTabDragEnter,
  handleTabDragLeave,
  handleTabDragOver,
  handleTabDragStart,
  handleTabDrop,
  handleTerminalContextMenu,
  handleTerminalMouseDown,
  handleTerminalMouseUp,
  handleTerminalWheel,
  hasAiSuggestion,
  increaseFontFromMenu,
  isTerminalMenuPanel,
  menu,
  moveSuggestion,
  openAiSessionsFromContextBar,
  openCommandDialogFromTabMenu,
  openCommandDialogFromTermMenu,
  openCommandLineFromMenu,
  openFileManagerFromMenu,
  openMenu,
  openSearchOverlay,
  panelById,
  paneDragOverPanelId,
  panelNeedsAiAttention,
  pasteClipboard,
  refreshAiSessionsFromContextBar,
  renameSelected,
  renameText,
  renamingId,
  resizeCommandDialogInput,
  search,
  searchMatchCount,
  searchMatchIndex,
  searchOverlayInput,
  searchOverlayPanelId,
  sendCommand,
  sendGlobalCommand,
  setTerminalElement,
  showTerminalDashboard,
  splitFromTermMenu,
  splitLayoutItems,
  splitSelected,
  startRename,
  submitCommandDialog,
  suggestionItems,
  suggestionPanel,
  suggestionPosition,
  suggestionSelectionMode,
  t,
  tabBarDragOver,
  tabDragOverPanelId,
  termMenu,
  terminalGrid,
  terminalGridClasses,
  terminalOutputMirrorText,
  terminalStatusLabel,
  terminalTabKindBadge,
  terminalTabMeta,
  terminalTabTooltip,
  toggleGlobalInput,
  togglePanelConnection,
  toggleTabConnectionFromMenu,
  triggerAiSuggestion,
  unsplitFromTermMenu,
  unsplitSelected,
  updateSuggestions,
  visibleTerminalTabPanels,
  workspace,
  zmodemPercent,
  zmodemProgress,
} = useTerminalWorkspaceContainerRuntime()
</script>
