<template>
  <aside
    class="ai-panel"
    :class="{ 'agent-mode': agentMode }"
    tabindex="-1"
    @click="closePopups()"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
    @keydown="handlePanelKeydown"
  >
    <div class="ai-panel-top">
      <header class="ai-header">
        <div class="ai-header-title">
          <h2>{{ agentMode ? t('common.agents') : t('common.ai') }}</h2>
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
        <div
          class="ai-panel-mode-menu"
          data-testid="ai-panel-mode-menu"
          @click.stop
        >
          <button
            type="button"
            class="ai-panel-mode-trigger"
            :title="t('ai.panelMode')"
            data-testid="ai-panel-mode-open"
            @click.stop="toggleAiPanelModeMenu"
          >
            <Code2 v-if="aiPanelMode === 'codex'" />
            <Bot v-else />
            <span>{{ currentAiPanelModeLabel }}</span>
            <ChevronDown />
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
        <div class="ai-header-actions">
          <button
            v-if="aiPanelMode === 'codex'"
            type="button"
            class="ai-header-icon-button"
            :title="t('ai.newChat')"
            data-testid="ai-codex-new"
            @click.stop="createNewCodexConversation"
          >
            <Plus />
          </button>
          <button
            v-if="aiPanelMode === 'codex'"
            type="button"
            class="ai-header-icon-button"
            :title="t('ai.codexRestart')"
            data-testid="ai-codex-restart"
            @click.stop="restartCodexSession"
          >
            <RefreshCw />
          </button>
          <button
            v-if="aiPanelMode === 'classic'"
            type="button"
            class="ai-header-icon-button"
            :title="t('ai.newChat')"
            data-testid="ai-new-chat"
            @click.stop="createNewAiConversation"
          >
            <Plus />
          </button>
          <div
            v-if="aiPanelMode === 'classic'"
            class="ai-history-menu-wrap"
            @click.stop
          >
            <button
              type="button"
              class="ai-header-icon-button"
              :title="t('ai.moreActions')"
              data-testid="ai-more-actions-open"
              @click.stop="toggleMoreActionsMenu"
            >
              <Ellipsis />
            </button>
            <div
              v-if="moreActionsMenuOpen"
              class="ai-more-actions-menu"
              data-testid="ai-more-actions-menu"
            >
              <button
                type="button"
                data-testid="ai-history-open"
                @click.stop="toggleHistoryMenu"
              >
                <History />
                <span>{{ t('ai.history') }}</span>
              </button>
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
            </div>
            <div
              v-if="historyMenuOpen"
              class="ai-history-dropdown"
              data-testid="ai-history-dropdown"
            >
              <div class="ai-history-search-row">
                <label class="ai-history-search">
                  <Search />
                  <input
                    ref="historySearchInputRef"
                    v-model="historySearchTerm"
                    type="search"
                    :placeholder="t('ai.searchHistory')"
                    data-testid="ai-history-search-input"
                    @keydown.esc.prevent="closeHistoryMenu"
                  />
                  <button
                    v-if="historySearchTerm"
                    type="button"
                    :title="t('ai.clearSearch')"
                    @click="clearHistorySearch"
                  >
                    <X />
                  </button>
                </label>
                <button
                  type="button"
                  class="ai-history-favorite-toggle"
                  :class="{ active: historyFavoritesOnly }"
                  :title="t('ai.favoritesOnly')"
                  data-testid="ai-history-favorites-toggle"
                  @click="historyFavoritesOnly = !historyFavoritesOnly"
                >
                  <Star />
                </button>
              </div>

              <div class="ai-history-list">
                <template v-if="groupedVisibleHistory.length">
                  <section
                    v-for="group in groupedVisibleHistory"
                    :key="group.label"
                    class="ai-history-group"
                  >
                    <div
                      class="ai-history-date"
                      :class="{ favorite: group.label === historyFavoriteLabel }"
                    >
                      <Star v-if="group.label === historyFavoriteLabel" />
                      <span>{{ group.label }}</span>
                    </div>
                    <div
                      v-for="conversation in group.items"
                      :key="conversation.id"
                      class="ai-history-item"
                      :class="{ active: workspace.selectedConversationId === conversation.id, favorite: conversation.favorite }"
                      role="button"
                      tabindex="0"
                      @click="restoreHistoryConversation(conversation.id)"
                      @keydown.enter.prevent="restoreHistoryConversation(conversation.id)"
                      @keydown.delete.prevent="deleteHistoryConversation(conversation.id)"
                      @keydown.backspace.prevent="deleteHistoryConversation(conversation.id)"
                    >
                      <div class="ai-history-content">
                        <input
                          v-if="editingHistoryId === conversation.id"
                          v-model="editingHistoryTitle"
                          class="ai-history-title-input"
                          data-testid="ai-history-title-input"
                          @click.stop
                          @keydown.enter.prevent="saveHistoryTitle(conversation.id)"
                          @keydown.esc.prevent="cancelHistoryTitleEdit"
                        />
                        <span
                          v-else
                          class="ai-history-title"
                        >
                          {{ conversation.title }}
                        </span>
                        <span class="ai-history-meta">
                          <span>{{ formatHistoryTime(conversation.ts) }}</span>
                          <span v-if="conversation.ipAddress">{{ conversation.ipAddress }}</span>
                        </span>
                      </div>
                      <div class="ai-history-actions">
                        <template v-if="editingHistoryId === conversation.id">
                          <button
                            type="button"
                            :title="t('common.save')"
                            @click.stop="saveHistoryTitle(conversation.id)"
                          >
                            <Check />
                          </button>
                          <button
                            type="button"
                            :title="t('ai.cancelEdit')"
                            @click.stop="cancelHistoryTitleEdit"
                          >
                            <X />
                          </button>
                        </template>
                        <template v-else>
                          <button
                            type="button"
                            :title="t('ai.favorite')"
                            :class="{ active: conversation.favorite }"
                            @click.stop="toggleHistoryFavorite(conversation.id)"
                          >
                            <Star />
                          </button>
                          <button
                            type="button"
                            :title="t('ai.editTitle')"
                            @click.stop="editHistoryTitle(conversation.id)"
                          >
                            <Pencil />
                          </button>
                          <button
                            type="button"
                            :title="t('ai.deleteHistory')"
                            @click.stop="deleteHistoryConversation(conversation.id)"
                          >
                            <Trash2 />
                          </button>
                        </template>
                      </div>
                    </div>
                  </section>
                  <button
                    v-if="hasMoreHistoryConversations"
                    type="button"
                    class="ai-history-load-more"
                    :disabled="historyLoadingMore"
                    data-testid="ai-history-load-more"
                    @click="loadMoreHistoryConversations"
                  >
                    {{ historyLoadingMore ? t('ai.loadingMore') : t('ai.loadMore') }}
                  </button>
                </template>
                <div
                  v-else
                  class="ai-history-empty"
                >
                  {{ t('ai.noData') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>
    </div>

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

    <div
      v-show="aiPanelMode === 'classic'"
      ref="chatScrollRef"
      class="chat-scroll"
    >
      <div
        v-if="chatSearchOpen"
        class="ai-chat-search-bar"
        @click.stop
      >
        <div class="ai-chat-search-input-wrap">
          <Search />
          <input
            ref="chatSearchInputRef"
            v-model="chatSearchTerm"
            type="search"
            :placeholder="t('ai.searchChat')"
            data-testid="ai-chat-search-input"
            @keydown.enter.exact.prevent="findNextChatMatch"
            @keydown.shift.enter.prevent="findPreviousChatMatch"
            @keydown.esc.prevent="closeChatSearch"
          />
          <span
            v-if="chatSearchTerm && chatSearchMatchCount > 0"
            class="ai-chat-search-count"
            data-testid="ai-chat-search-count"
          >
            {{ chatSearchCurrentIndex }}/{{ chatSearchMatchCount }}
          </span>
          <span
            v-else-if="chatSearchTerm"
            class="ai-chat-search-count no-results"
            data-testid="ai-chat-search-count"
          >
            {{ t('ai.noMatches') }}
          </span>
          <button
            v-if="chatSearchTerm"
            type="button"
            :title="t('ai.clear')"
            @click="clearChatSearch"
          >
            <X />
          </button>
        </div>
        <div class="ai-chat-search-controls">
          <button
            type="button"
            :title="t('ai.previous')"
            :disabled="chatSearchMatchCount === 0"
            @click="findPreviousChatMatch"
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            :title="t('ai.next')"
            :disabled="chatSearchMatchCount === 0"
            @click="findNextChatMatch"
          >
            <ChevronRight />
          </button>
          <button
            type="button"
            :title="t('common.close')"
            @click="closeChatSearch"
          >
            <X />
          </button>
        </div>
      </div>
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
              :title="t('ai.addContext')"
              @click.stop="openEditContextPopup"
            >
              {{ editHostContexts.length ? '@' : t('ai.addContext') }}
            </button>
            <span
              v-for="context in editHostContexts"
              :key="context.id"
              class="context-tag"
            >
              {{ context.label }}
              <button
                type="button"
                :title="t('ai.removeContext')"
                @click.stop="removeEditHostContext(context.id)"
              >
                <X />
              </button>
            </span>
          </div>
          <div
            :ref="setEditEditableRef"
            class="chat-editable message-editable"
            :class="{ 'is-empty': !editDraft.trim() && !editImageInputParts.length && !editFileInputParts.length && !editHostContexts.length }"
            :data-placeholder="t('ai.editMessagePlaceholder')"
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
              title="上传文件"
              data-testid="ai-edit-file-upload-button"
              @click.stop="handleFileUpload"
            >
              <Upload />
            </button>
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
          data-testid="ai-user-message-content"
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
          v-else-if="message.role === 'user'"
          data-testid="ai-user-message-content"
        >
          {{ message.text }}
        </p>
        <div
          v-else-if="!isCommandSuggestionMessage(message) && message.say === 'command_output'"
          class="ai-command-output-renderer"
          data-testid="ai-command-output-renderer"
        >
          <div class="ai-rendered-block-header">
            <span class="ai-rendered-block-title">
              <Code2 />
              <strong>{{ t('ai.output') }}</strong>
            </span>
            <span class="ai-rendered-block-spacer"></span>
            <span class="ai-rendered-block-lines">{{ formatLineCount(commandOutputLineCount(message.text)) }}</span>
            <button
              type="button"
              class="ai-rendered-copy-button"
              title="复制输出"
              data-testid="ai-command-output-copy"
              @click.stop="copyRenderedTextToClipboard(normalizedCommandOutputText(message.text), '输出')"
            >
              <Copy />
            </button>
          </div>
          <pre
            class="ai-command-output-body"
            data-testid="ai-command-output-text"
          ><code>{{ normalizedCommandOutputText(message.text) }}</code></pre>
        </div>
        <div
          v-else-if="!isCommandSuggestionMessage(message)"
          class="ai-rendered-message"
          data-testid="ai-markdown-message"
        >
          <template
            v-for="(part, index) in renderedMarkdownParts(message.text)"
            :key="`${part.type}-${index}`"
          >
            <div
              v-if="part.type === 'html'"
              class="ai-markdown-content"
              v-html="part.html"
            ></div>
            <div
              v-else
              class="ai-rendered-code-block"
              data-testid="ai-markdown-code-block"
            >
              <div class="ai-rendered-block-header">
                <span class="ai-rendered-block-title">
                  <Code2 />
                  <strong>{{ part.language || 'text' }}</strong>
                </span>
                <span class="ai-rendered-block-spacer"></span>
                <span class="ai-rendered-block-lines">{{ formatLineCount(part.lineCount) }}</span>
                <button
                  type="button"
                  class="ai-rendered-copy-button"
                  title="复制代码"
                  data-testid="ai-markdown-code-copy"
                  @click.stop="copyRenderedTextToClipboard(part.code, '代码')"
                >
                  <Copy />
                </button>
              </div>
              <pre class="ai-rendered-code-body"><code class="hljs" v-html="part.html"></code></pre>
            </div>
          </template>
        </div>
        <em v-if="message.state === 'streaming'">streaming</em>
        <em v-else-if="message.state === 'cancelled'">cancelled</em>
        <em v-else-if="message.state === 'error'">error</em>
        <div
          v-if="message.ask === 'mcp_tool_call' && message.mcpToolCall"
          class="ai-mcp-tool-call"
          data-testid="ai-mcp-tool-call"
        >
          <div class="ai-mcp-tool-call-grid">
            <span>MCP Server</span>
            <strong>{{ message.mcpToolCall.serverName }}</strong>
            <span>Tool</span>
            <strong>{{ message.mcpToolCall.toolName }}</strong>
          </div>
          <pre v-if="message.mcpToolCall.arguments && Object.keys(message.mcpToolCall.arguments).length">{{ formatMcpToolArguments(message) }}</pre>
          <div
            v-if="!message.action"
            class="message-command-actions ai-mcp-approval-actions"
          >
            <button
              type="button"
              class="secondary"
              data-testid="ai-mcp-tool-reject"
              @click.stop="void rejectMcpToolCall(message.id)"
            >
              <X />
              <span>拒绝</span>
            </button>
            <button
              type="button"
              class="secondary"
              data-testid="ai-mcp-tool-auto-approve"
              @click.stop="void approveMcpToolCall(message.id, true)"
            >
              <CheckCircle />
              <span>自动批准并执行</span>
            </button>
            <button
              type="button"
              class="primary"
              data-testid="ai-mcp-tool-approve"
              @click.stop="void approveMcpToolCall(message.id)"
            >
              <Play />
              <span>批准</span>
            </button>
          </div>
          <div
            v-else
            class="ai-mcp-tool-call-status"
            :class="message.action"
          >
            <Check v-if="message.action === 'approved'" />
            <X v-else />
            <span>{{ message.action === 'approved' ? '已批准' : '已拒绝' }}</span>
          </div>
        </div>
        <div
          v-if="message.ask === 'mcp_resource_access' && message.mcpResourceAccess"
          class="ai-mcp-tool-call"
          data-testid="ai-mcp-resource-access"
        >
          <div class="ai-mcp-tool-call-grid">
            <span>MCP Server</span>
            <strong>{{ message.mcpResourceAccess.serverName }}</strong>
            <span>Resource</span>
            <strong>{{ message.mcpResourceAccess.uri }}</strong>
          </div>
          <div
            v-if="!message.action"
            class="message-command-actions ai-mcp-approval-actions"
          >
            <button
              type="button"
              class="secondary"
              data-testid="ai-mcp-resource-reject"
              @click.stop="void rejectMcpResourceAccess(message.id)"
            >
              <X />
              <span>拒绝</span>
            </button>
            <button
              type="button"
              class="primary"
              data-testid="ai-mcp-resource-approve"
              @click.stop="void approveMcpResourceAccess(message.id)"
            >
              <Play />
              <span>批准</span>
            </button>
          </div>
          <div
            v-else
            class="ai-mcp-tool-call-status"
            :class="message.action"
          >
            <Check v-if="message.action === 'approved'" />
            <X v-else />
            <span>{{ message.action === 'approved' ? '已批准' : '已拒绝' }}</span>
          </div>
        </div>
        <div
          v-if="isCommandSuggestionMessage(message)"
          class="message-command-card"
          data-testid="ai-message-command-card"
        >
          <div class="message-command-card-header">
            <span class="message-command-title">
              <Code2 />
              <strong>Command</strong>
              <button
                type="button"
                class="message-command-help"
                title="AI 生成的可执行命令会先进入确认卡片，不会自动写入终端。"
                @click.stop
              >
                <CircleHelp />
              </button>
            </span>
            <span
              v-if="commandHostForMessage(message)"
              class="message-command-host"
              :title="commandHostTooltipForMessage(message)"
              :aria-label="commandHostTooltipForMessage(message)"
              data-testid="ai-message-command-host"
            >
              <Server />
              <span class="visually-hidden">{{ commandHostForMessage(message) }}</span>
            </span>
            <span
              v-if="message.commandExecution?.requiresApproval"
              class="message-command-badge warning"
              title="需要确认"
              aria-label="需要确认"
              data-testid="ai-message-command-approval-badge"
            >
              <CheckSquare />
              <span class="visually-hidden">需要确认</span>
            </span>
            <span
              v-if="message.commandExecution?.interactive"
              class="message-command-badge"
              title="交互式命令"
              aria-label="交互式命令"
              data-testid="ai-message-command-interactive-badge"
            >
              <Zap />
              <span class="visually-hidden">交互式</span>
            </span>
            <span class="message-command-card-spacer"></span>
            <span
              class="message-command-line-count"
              data-testid="ai-message-command-line-count"
            >
              {{ commandLineCountForMessage(message) }} line{{ commandLineCountForMessage(message) === 1 ? '' : 's' }}
            </span>
            <button
              type="button"
              class="message-command-icon-button"
              :title="t('ai.commandReviewTitle')"
              :aria-label="t('ai.commandReviewTitle')"
              data-testid="ai-message-command-review"
              @click.stop="openCommandAuditDialog(message)"
            >
              <Maximize2 />
            </button>
            <button
              type="button"
              class="message-command-icon-button"
              title="复制命令"
              data-testid="ai-message-command-copy"
              @click.stop="copyCommandToClipboard(message)"
            >
              <Copy />
            </button>
          </div>
          <div class="message-command-code-shell">
            <pre
              class="message-command-code"
              data-testid="ai-message-command-text"
            ><code>{{ commandTextForMessage(message) }}</code></pre>
          </div>
          <div
            v-if="message.commandExecutionMessage || message.executedCommand || message.action === 'rejected'"
            class="message-command-status"
            :class="[message.commandExecutionStatus, message.action]"
            data-testid="ai-message-command-status"
          >
            <LoaderCircle
              v-if="message.commandExecutionStatus === 'running'"
              class="spinning"
            />
            <Check v-else-if="message.commandExecutionStatus === 'succeeded'" />
            <X v-else-if="message.commandExecutionStatus === 'failed' || message.action === 'rejected'" />
            <Zap v-else />
            <span>{{ message.commandExecutionMessage || (message.action === 'rejected' ? '已拒绝执行。' : `已发送到终端：${message.executedCommand}`) }}</span>
          </div>
          <div
            class="message-command-actions"
            data-testid="ai-message-command-actions"
          >
            <button
              type="button"
              class="secondary danger"
              data-testid="ai-message-command-reject"
              :title="t('ai.commandReject')"
              :aria-label="t('ai.commandReject')"
              :disabled="isCommandTerminalActionDisabled(message)"
              @click.stop="rejectMessageCommand(message)"
            >
              <X />
              <span>{{ t('ai.commandReject') }}</span>
            </button>
            <button
              v-if="isReadOnlyCommandMessage(message)"
              type="button"
              class="secondary success"
              data-testid="ai-message-command-auto-run"
              :title="t('ai.commandAutoRun')"
              :aria-label="t('ai.commandAutoRun')"
              :disabled="isCommandTerminalActionDisabled(message)"
              @click.stop="void runMessageCommand(message, { autoReadOnly: true })"
            >
              <CheckCircle />
              <span>{{ t('ai.commandAutoRun') }}</span>
            </button>
            <button
              type="button"
              class="primary"
              data-testid="ai-message-command-run"
              :title="message.commandExecutionStatus === 'running' ? t('ai.commandRunning') : t('ai.commandRun')"
              :aria-label="message.commandExecutionStatus === 'running' ? t('ai.commandRunning') : t('ai.commandRun')"
              :disabled="isCommandTerminalActionDisabled(message)"
              @click.stop="void runMessageCommand(message)"
            >
              <LoaderCircle
                v-if="message.commandExecutionStatus === 'running'"
                class="spinning"
              />
              <Play v-else />
              <span>{{ message.commandExecutionStatus === 'running' ? t('ai.commandRunning') : t('ai.commandRun') }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="message.executedCommand && !isCommandSuggestionMessage(message)"
          class="message-executed-command"
          data-testid="ai-message-executed-command"
        >
          <Check />
          <span>已发送到终端：{{ message.executedCommand }}</span>
        </div>
        <div
          v-if="message.role === 'user' && editingMessageId !== message.id"
          class="message-actions user-message-actions"
        >
          <button
            type="button"
            title="复制"
            data-testid="ai-message-copy"
            @click.stop="copyMessageToClipboard(message)"
          >
            <Copy />
          </button>
        </div>
        <div
          v-if="message.role === 'assistant' && !isCommandSuggestionMessage(message)"
          class="message-actions"
        >
          <button
            type="button"
            title="复制"
            data-testid="ai-message-copy"
            @click.stop="copyMessageToClipboard(message)"
          >
            <Copy />
          </button>
          <button
            type="button"
            :class="{ active: message.favorite }"
            title="收藏"
            @click.stop="toggleMessageFavorite(message.id)"
          >
            <Star />
          </button>
          <button
            type="button"
            :class="{ active: message.feedback === 'up' }"
            title="有帮助"
            @click.stop="setMessageFeedback(message.id, 'up')"
          >
            <ThumbsUp />
          </button>
          <button
            type="button"
            :class="{ active: message.feedback === 'down' }"
            title="无帮助"
            @click.stop="setMessageFeedback(message.id, 'down')"
          >
            <ThumbsDown />
          </button>
          <button
            type="button"
            title="重试"
            data-testid="ai-message-retry"
            @click.stop="retryAssistantMessage(message.id)"
          >
            <RefreshCw />
          </button>
          <button
            type="button"
            title="沉淀到知识"
            data-testid="ai-message-to-knowledge"
            @click.stop="summarizeMessageToKnowledge(message.id)"
          >
            <BookOpen />
          </button>
          <button
            type="button"
            title="沉淀到技能"
            data-testid="ai-message-to-skill"
            @click.stop="summarizeMessageToSkill(message.id)"
          >
            <Sparkles />
          </button>
        </div>
      </article>
      <div
        v-if="workspace.chatMessages.length === 0 || showNoAvailableModelPrompt"
        class="ai-empty-chat"
        :class="{ 'no-model': showNoAvailableModelPrompt }"
      >
        <template v-if="showNoAvailableModelPrompt">
          <Bot />
          <strong>{{ t('ai.emptyNoModelTitle') }}</strong>
          <p>{{ workspace.billingSettings.skippedLogin ? t('ai.emptyNoModelLogin') : t('ai.emptyNoModelConfigure') }}</p>
          <div class="ai-empty-actions">
            <button
              v-if="workspace.billingSettings.skippedLogin"
              type="button"
              class="primary"
              data-testid="ai-no-model-login"
              @click.stop="openModelLogin"
            >
              {{ t('common.login') }}
            </button>
            <button
              type="button"
              class="primary"
              data-testid="ai-no-model-configure"
              data-onboarding-id="ai-model-settings-button"
              @click.stop="openModelSettings"
            >
              {{ t('ai.configureModel') }}
            </button>
          </div>
        </template>
        <template v-else>
          <Bot />
          <span>{{ workspace.config.modelName }}</span>
        </template>
      </div>
    </div>

    <span
      v-if="aiPanelMode === 'classic' && chatExportNotice"
      class="ai-operation-notice"
      data-testid="ai-chat-export-notice"
    >
      {{ chatExportNotice }}
    </span>

    <form
      v-if="aiPanelMode === 'classic' && !showNoAvailableModelPrompt"
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
          {{ workspace.selectedContexts.length ? '@' : t('ai.addContext') }}
        </button>
        <span
          v-for="context in workspace.selectedContexts"
          :key="context.id"
          class="context-tag"
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
          {{ t('ai.processing') }}
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
        :class="{ 'is-empty': !draft.trim() && !workspace.selectedContexts.length && !imageInputParts.length && !fileInputParts.length && !selectedCommand }"
        :data-placeholder="t('ai.inputPlaceholder')"
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

    <div
      v-if="commandAuditDialog.open && activeCommandAuditMessage"
      class="ai-command-audit-backdrop"
      data-testid="ai-command-audit-dialog"
      @keydown.esc.prevent="closeCommandAuditDialog"
    >
      <section
        class="ai-command-audit-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('ai.commandReviewTitle')"
        @click.stop
      >
        <header>
          <div>
            <span>{{ t('ai.commandReview') }}</span>
            <strong>{{ t('ai.commandReviewTitle') }}</strong>
          </div>
          <button
            type="button"
            :title="t('common.close')"
            data-testid="ai-command-audit-close"
            @click="closeCommandAuditDialog"
          >
            <X />
          </button>
        </header>
        <p>{{ t('ai.commandReviewDescription') }}</p>
        <label>
          <span>Command</span>
          <textarea
            ref="commandAuditTextareaRef"
            v-model="commandAuditDialog.draft"
            data-testid="ai-command-audit-input"
            spellcheck="false"
            :readonly="!canEditActiveCommandAudit"
            @keydown.stop
          ></textarea>
        </label>
        <footer>
          <span data-testid="ai-command-audit-line-count">
            {{ commandLineCountForText(commandAuditDialog.draft) }} line{{ commandLineCountForText(commandAuditDialog.draft) === 1 ? '' : 's' }}
          </span>
          <button
            type="button"
            data-testid="ai-command-audit-copy"
            @click="copyCommandAuditDraft"
          >
            <Copy />
            <span>{{ t('ai.commandReviewCopy') }}</span>
          </button>
          <button
            type="button"
            data-testid="ai-command-audit-save"
            :disabled="!canEditActiveCommandAudit || !commandAuditDialog.draft.trim()"
            @click="saveCommandAuditDraft()"
          >
            <Check />
            <span>{{ t('ai.commandReviewSave') }}</span>
          </button>
          <button
            type="button"
            class="primary"
            data-testid="ai-command-audit-run"
            :disabled="!canEditActiveCommandAudit || !commandAuditDialog.draft.trim()"
            @click="void runCommandAuditDraft()"
          >
            <Play />
            <span>{{ t('ai.commandReviewRun') }}</span>
          </button>
        </footer>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component, type ComponentPublicInstance } from 'vue'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'highlight.js/styles/atom-one-dark.css'
import '@xterm/xterm/css/xterm.css'
import {
  Bot,
  Brain,
  BookOpen,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Focus,
  Link2,
  LoaderCircle,
  FileText,
  FolderGit2,
  Image,
  LockKeyhole,
  Maximize2,
  Mic,
  Monitor,
  MinusSquare,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Square,
  Star,
  History,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import { useWorkspaceStore, type TerminalSettings } from '@/stores/workspace'
import { readStoredAiPanelMode, storeAiPanelMode, type AiPanelMode } from '@/services/aiPanelModeRuntime'
import {
  aiChipPartFromContext,
  aiImagePartFromContext,
  cloneAiContextOption,
  fallbackAiContentPartsForMessage,
  hasSendableAiContent,
  splitAiContentInputParts
} from '@/services/aiPanelInputRuntime'
import {
  aiPanelChipLabel,
  aiPanelEditablePlainText,
  chipPartFromAiPanelChipElement,
  createAiPanelChipElement,
  createAiPanelCommandChipElement,
  createAiPanelContextChipElement,
  createAiPanelIconElement,
  createAiPanelImageElement,
  extractAiPanelContentPartsFromEditable,
  extractAiPanelEditablePlainTextFromNode,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  insertAiPanelPlainTextIntoEditableCursor,
  removeAiPanelTokenBeforeRange,
  removeAiPanelTokenFromEditableCursor,
  renderAiPanelMainEditableFromState,
  renderAiPanelPartsIntoEditable,
  syncAiPanelMainInputPartsFromEditable,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import {
  allVisibleAiPanelHostsSelected,
  backAiPanelDocsDir,
  clearAiPanelHostContexts,
  cloneAiPanelCommandOptions,
  cloneAiPanelContextCategories,
  enterAiPanelDocsDir,
  filteredAiPanelCommands,
  filteredAiPanelContextOptions,
  filteredAiPanelOpenedHosts,
  mainContextKeyboardSelection,
  modelMatchesAiPanelQuery,
  nextAiPanelPopupKeyboardIndex,
  planAiPanelCommandApply,
  planAiPanelContextApply,
  resetAiPanelDocsNavigation,
  selectedAiPanelCommand,
  selectedAiPanelCommandRef,
  selectedAiPanelContextCategory,
  selectedAiPanelVisibleHostContexts,
  sortedAiPanelDocsContextOptions,
  visibleAiPanelContextCategories,
  visibleAiPanelHostContextOptions,
  type AiPanelContextCategoryView
} from '@/services/aiPanelPopupRuntime'
import {
  aiPanelChatExportMessage as chatExportMessage,
  aiPanelMessagePlainText as messagePlainText,
  applyCommandTextToMessage,
  canEditCommandMessage,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandLineCountForText,
  commandOutputLineCount,
  commandTextForMessage,
  formatAiPanelLineCount as formatLineCount,
  isAiPanelCommandSuggestionMessage as isCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  renderAiPanelMarkdownParts as renderedMarkdownParts,
  setAiPanelCommandExecutionState as setCommandExecutionState,
  type AiPanelCommandSuggestionMessage as CommandSuggestionMessage
} from '@/services/aiPanelMessageRuntime'
import {
  activateAiChatSearchMatch,
  aiConversationTabTooltip,
  aiHistoryDateLabel,
  clearAiChatSearchHighlights,
  closeAiConversationTab,
  displayAiConversationTitle,
  ensureAiConversationTabId,
  filterAiHistoryConversations,
  formatAiHistoryTime,
  groupAiHistoryConversations,
  hasMoreAiHistoryConversations,
  nextAiChatSearchPosition,
  nextAiHistoryPageAfterDelete,
  previousAiChatSearchPosition,
  pruneAiConversationTabIds,
  runAiChatSearchHighlights,
  visibleAiConversationTabs,
  visibleAiHistoryConversations,
  type AiPanelChatSearchMatch
} from '@/services/aiPanelConversationRuntime'
import {
  aiPanelChatAttachmentFilters,
  aiPanelDropEffect,
  aiPanelImagePickerFilters,
  canAcceptAiPanelDrop as canAcceptAiPanelRuntimeDrop,
  clipboardHasImageItems,
  docPartFromStagedAttachment,
  imagePartFromChatImagePrepareResult,
  planAiPanelDrop
} from '@/services/aiPanelMediaRuntime'
import { createAiPanelVoiceRuntime } from '@/services/aiPanelVoiceRuntime'
import { aiChatClient } from '@/services/aiChatClient'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { codexSessionClient } from '@/services/codexSessionClient'
import { codexTargetSignature, type CodexTargetEventKind } from '@/services/codexTargetRuntime'
import {
  applyCodexExitEvent,
  applyCodexLifecycleEvent,
  applyCodexSessionStarted,
  applyCodexTargetBinding,
  applyCodexTargetUnbinding,
  closeCodexConversationRecord,
  codexAttentionId as codexRuntimeAttentionId,
  codexBoundTargetDetail as codexRuntimeBoundTargetDetail,
  codexBoundTargetLabel as codexRuntimeBoundTargetLabel,
  codexConversationTitle as codexRuntimeConversationTitle,
  codexStatusLabelKey,
  codexTargetContextFromPanel,
  codexTargetTitle as codexRuntimeTargetTitle,
  createCodexConversationRecord as createCodexConversationRuntimeRecord,
  currentBoundCodexTarget as currentBoundCodexRuntimeTarget,
  markCodexPendingTargetDelivered as markCodexRuntimePendingTargetDelivered,
  markCodexTargetSyncFailed,
  prepareCodexPendingTargetContext,
  prepareCodexTargetSync,
  resetCodexConversationForRestart,
  terminalSettingsSignature as codexTerminalSettingsSignature,
  type AiPanelCodexConversationRuntimeState
} from '@/services/aiPanelCodexRuntime'
import { localFilesClient } from '@/services/localFilesClient'
import { writeRendererRuntimeLog as writeAiRuntimeLog } from '@/services/runtimeLogClient'
import {
  isAiChatExportData,
  malformedAiBackendResultMessage
} from '@/services/aiBackendGuards'
import { useI18n } from '@/i18n'
import type {
  AiChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  ConversationItem,
  TerminalPanel
} from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string }
const setXtermTermName = (terminal: XtermTerminal, terminalType: string) => {
  ;(terminal.options as XtermRuntimeOptions).termName = terminalType || 'xterm-256color'
}

const props = defineProps<{ agentMode?: boolean }>()

const workspace = useWorkspaceStore()
const { locale, t } = useI18n()
type AiChatMode = 'agent' | 'cmd'
type AiContextCategoryView = AiPanelContextCategoryView<Component>

const aiChatModeOptions: Array<{ id: AiChatMode; label: string; detail: string }> = [
  { id: 'agent', label: 'Agent', detail: '上下文辅助与工具调用' },
  { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
]

const aiContextCategoryIcons: Record<AiContextKind, Component> = {
  hosts: Server,
  docs: FileText,
  images: Image,
  skills: Bot,
  chats: Search
}
const draft = ref('')
const aiPanelMode = ref<AiPanelMode>(readStoredAiPanelMode())
const imageInputParts = ref<AiImageContentPart[]>([])
const fileInputParts = ref<AiDocChipContentPart[]>([])
const chatScrollRef = ref<HTMLElement | null>(null)
const editableRef = ref<HTMLElement | null>(null)
const editEditableRef = ref<HTMLElement | null>(null)
const chatSearchInputRef = ref<HTMLInputElement | null>(null)
const historySearchInputRef = ref<HTMLInputElement | null>(null)
const editingMessageId = ref<string | null>(null)
const editDraft = ref('')
const editImageInputParts = ref<AiImageContentPart[]>([])
const editFileInputParts = ref<AiDocChipContentPart[]>([])
const editHostContexts = ref<AiContextOption[]>([])
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
const chatMode = ref<AiChatMode>('agent')
const modeMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const modelQuery = ref('')
const dropActive = ref(false)
const syncingFromEditable = ref(false)
const inputPlaceholderNotice = ref('')
const chatSearchOpen = ref(false)
const chatSearchTerm = ref('')
const chatSearchMatchCount = ref(0)
const chatSearchCurrentIndex = ref(0)
const panelModeMenuOpen = ref(false)
const moreActionsMenuOpen = ref(false)
const historyMenuOpen = ref(false)
const historySearchTerm = ref('')
const historyFavoritesOnly = ref(false)
const historyCurrentPage = ref(1)
const historyLoadingMore = ref(false)
const editingHistoryId = ref<string | null>(null)
const editingHistoryTitle = ref('')
const chatExportNotice = ref('')
const openConversationTabIds = ref<string[]>([])
const commandAuditTextareaRef = ref<HTMLTextAreaElement | null>(null)
const commandAuditDialog = ref({
  open: false,
  messageId: '',
  draft: ''
})
const codexTargetPickerOpen = ref(false)
const codexTargetQuery = ref('')
type CodexConversation = AiPanelCodexConversationRuntimeState & {
  host: HTMLElement | null
  terminal: XtermTerminal | null
  fit: FitAddon | null
  resizeObserver: ResizeObserver | null
}
const codexConversations = ref<CodexConversation[]>([])
const activeCodexConversationId = ref('')
let codexOffData: (() => void) | null = null
let codexOffLifecycle: (() => void) | null = null
let codexOffExit: (() => void) | null = null
let classicChatDataLoaded = false
let inputPlaceholderNoticeTimer: number | undefined
let chatSearchTimer: number | undefined
let chatExportNoticeTimer: number | undefined
let chatScrollFrame: number | undefined
const historyPageSize = 20
const historyFavoriteLabel = computed(() => t('ai.historyFavoriteGroup'))
const chatAttachmentFilters = aiPanelChatAttachmentFilters
const maxHostContexts = 5
const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))
const activeCodexConversation = computed(() => codexConversations.value.find((conversation) => conversation.id === activeCodexConversationId.value) || null)
const terminalSettingsSignature = () => codexTerminalSettingsSignature(workspace.terminalSettings)
const activeCodexBoundTarget = computed(() => activeCodexConversation.value?.boundTarget || null)
const codexStatusLabel = computed(() => {
  const labelKey = codexStatusLabelKey(activeCodexConversation.value?.status || 'idle')
  if (labelKey === 'starting') return t('ai.codexStarting')
  if (labelKey === 'ready') return t('ai.codexReady')
  if (labelKey === 'error') return t('ai.codexError')
  if (labelKey === 'closed') return t('ai.codexClosed')
  return t('ai.codexIdle')
})
const codexBoundTargetLabel = computed(() => codexRuntimeBoundTargetLabel(activeCodexBoundTarget.value, t('ai.codexTargetUnbound')))
const codexBoundTargetDetail = computed(() => codexRuntimeBoundTargetDetail(activeCodexBoundTarget.value, t('ai.codexTargetDropHint')))
const currentAiPanelModeLabel = computed(() => (aiPanelMode.value === 'codex' ? t('ai.codexCliMode') : t('ai.classicChatMode')))
const currentChatMode = computed(() => aiChatModeOptions.find((option) => option.id === chatMode.value) || aiChatModeOptions[0])
const visibleConversationTabs = computed(() => visibleAiConversationTabs(openConversationTabIds.value, workspace.conversations))
const displayConversationTitle = (conversation: Pick<ConversationItem, 'title'>) =>
  displayAiConversationTitle(conversation, t('ai.untitledChat'))
const conversationTabTooltip = (conversation: ConversationItem) => aiConversationTabTooltip(conversation, t('ai.untitledChat'))
const currentPanelTarget = computed(() => {
  const target = currentCodexTargetContext()
  return target.sessionId && target.kind !== 'unknown' ? target : null
})
const codexHostTargets = computed(() => {
  const hosts = workspace.aiContextCatalog.categories.find((category) => category.id === 'hosts')?.options || []
  const openedHosts = workspace.aiContextCatalog.openedHosts || []
  const byId = new Map<string, AiContextOption>()
  ;[...openedHosts, ...hosts].forEach((host) => {
    if (host.kind === 'hosts' && !byId.has(host.id)) byId.set(host.id, { ...host })
  })
  return [...byId.values()]
})
let codexConversationSequence = 0

const nextCodexConversationId = () => `codex-${Date.now().toString(36)}-${++codexConversationSequence}`

const codexTargetTitle = (target?: CodexSessionTargetContext | null) => codexRuntimeTargetTitle(target, t('ai.codexCliMode'))

const codexConversationTitle = (conversation: Pick<CodexConversation, 'title' | 'boundTarget'>) =>
  codexRuntimeConversationTitle(conversation, t('ai.codexCliMode'))

const codexAttentionId = (conversation: Pick<CodexConversation, 'id'>) => codexRuntimeAttentionId(conversation)

const syncCodexAttentionState = (conversation: CodexConversation) => {
  const id = codexAttentionId(conversation)
  if (conversation.status !== 'error') {
    workspace.removeAiAttentionItem(id)
    return
  }
  workspace.upsertAiAttentionItem({
    id,
    source: 'codex',
    kind: 'error',
    conversationId: conversation.id,
    sessionId: conversation.sessionId || undefined,
    surfaceId: props.agentMode ? 'agents-ai-panel' : 'terminal-ai-panel',
    title: codexConversationTitle(conversation),
    summary: conversation.error || t('ai.codexError')
  })
}

const createCodexConversationRecord = (target?: CodexSessionTargetContext | null): CodexConversation =>
  createCodexConversationRuntimeRecord<CodexConversation>(nextCodexConversationId(), target, {
  host: null,
  terminal: null,
  fit: null,
  resizeObserver: null
})

const setCodexTerminalHostRef = (conversationId: string, element: Element | ComponentPublicInstance | null) => {
  const conversation = codexConversations.value.find((item) => item.id === conversationId)
  if (!conversation) return
  conversation.host = element instanceof HTMLElement ? element : null
  if (!conversation.host) {
    conversation.resizeObserver?.disconnect()
    conversation.resizeObserver = null
    return
  }
  ensureCodexTerminal(conversation)
}

const ensureActiveCodexConversation = (target?: CodexSessionTargetContext | null) => {
  let conversation = activeCodexConversation.value
  if (conversation) return conversation
  conversation = createCodexConversationRecord(target || null)
  codexConversations.value = [...codexConversations.value, conversation]
  activeCodexConversationId.value = conversation.id
  return conversation
}

const filteredCodexHostTargets = computed(() => {
  const keyword = codexTargetQuery.value.trim().toLowerCase()
  return codexHostTargets.value
    .filter((host) => !keyword || `${host.label} ${host.detail || ''} ${host.host || ''} ${host.assetName || ''}`.toLowerCase().includes(keyword))
    .slice(0, 20)
})
const ensureConversationTab = (id: string) => {
  openConversationTabIds.value = ensureAiConversationTabId(openConversationTabIds.value, workspace.conversations, id)
}

const pruneConversationTabs = () => {
  openConversationTabIds.value = pruneAiConversationTabIds(openConversationTabIds.value, workspace.conversations)
}
const historyLabels = computed(() => ({
  today: t('ai.historyToday'),
  yesterday: t('ai.historyYesterday'),
  daysAgo: (count: number) => t('ai.historyDaysAgo').replace('{count}', String(count)),
  favoriteGroup: t('ai.historyFavoriteGroup')
}))
const filteredHistoryConversations = computed(() =>
  filterAiHistoryConversations(workspace.sortedConversations, historySearchTerm.value, historyFavoritesOnly.value)
)
const visibleHistoryConversations = computed(() =>
  visibleAiHistoryConversations(filteredHistoryConversations.value, historyCurrentPage.value, historyPageSize)
)
const hasMoreHistoryConversations = computed(() =>
  hasMoreAiHistoryConversations(filteredHistoryConversations.value.length, visibleHistoryConversations.value.length)
)
const groupedVisibleHistory = computed(() => {
  const labels = historyLabels.value
  return groupAiHistoryConversations(visibleHistoryConversations.value, (conversation) =>
    historyFavoritesOnly.value ? labels.favoriteGroup : aiHistoryDateLabel(conversation.ts, new Date(), locale.value, labels)
  )
})

const loadClassicChatData = async () => {
  if (classicChatDataLoaded) return
  classicChatDataLoaded = true
  await Promise.all([workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }), workspace.hydrateClassicChatData()])
}

const fitCodexTerminal = (options: { force?: boolean; conversation?: CodexConversation | null } = {}) => {
  const conversation = options.conversation || activeCodexConversation.value
  if (!conversation?.terminal || !conversation.fit || !conversation.host?.isConnected) return
  window.requestAnimationFrame(() => {
    if (activeCodexConversation.value?.id !== conversation.id) return
    if (!conversation.terminal || !conversation.fit || !conversation.host?.isConnected) return
    conversation.fit.fit()
    const resizeCodexSession = codexSessionClient.resizeCodexSession()
    if (!conversation.sessionId || !resizeCodexSession) return
    if (!options.force && conversation.terminal.cols === conversation.lastFitCols && conversation.terminal.rows === conversation.lastFitRows) return
    conversation.lastFitCols = conversation.terminal.cols
    conversation.lastFitRows = conversation.terminal.rows
    void resizeCodexSession(conversation.sessionId, conversation.terminal.cols, conversation.terminal.rows)
    writeAiRuntimeLog('debug', 'renderer.codex.fit-resize', {
      sessionId: conversation.sessionId,
      cols: conversation.terminal.cols,
      rows: conversation.terminal.rows
    })
  })
}

const focusCodexTerminal = () => {
  activeCodexConversation.value?.terminal?.focus()
}

const codexCopyShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if (key !== 'c') return false
  if (event.shiftKey && (event.ctrlKey || event.metaKey)) return true
  return event.metaKey && !event.ctrlKey && !event.altKey
}

const copyCodexSelection = async (source: 'contextmenu' | 'keyboard') => {
  const selectedText = activeCodexConversation.value?.terminal?.getSelection() || ''
  if (!selectedText) {
    workspace.setTopNotice('请先选择 Codex 终端内容')
    writeAiRuntimeLog('debug', 'renderer.codex.copy.empty', { source })
    return false
  }
  const copied = await copyTextToClipboard(selectedText)
  workspace.setTopNotice(copied ? 'Codex 终端内容已复制' : 'Codex 终端复制失败')
  writeAiRuntimeLog(copied ? 'debug' : 'warn', copied ? 'renderer.codex.copy' : 'renderer.codex.copy.failed', {
    source,
    bytes: new TextEncoder().encode(selectedText).length
  })
  return copied
}

const copyCodexSelectionFromContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  focusCodexTerminal()
  void copyCodexSelection('contextmenu')
}

const disposeCodexSubscriptions = () => {
  codexOffData?.()
  codexOffLifecycle?.()
  codexOffExit?.()
  codexOffData = null
  codexOffLifecycle = null
  codexOffExit = null
}

const subscribeCodexBridge = () => {
  if (codexOffData || codexOffLifecycle || codexOffExit) return
  const onCodexSessionData = codexSessionClient.onCodexSessionData()
  const onCodexSessionLifecycle = codexSessionClient.onCodexSessionLifecycle()
  const onCodexSessionExit = codexSessionClient.onCodexSessionExit()
  if (!onCodexSessionData && !onCodexSessionLifecycle && !onCodexSessionExit) return
  codexOffData = onCodexSessionData?.((event) => {
    const conversation = codexConversations.value.find((item) => item.sessionId === event.id)
    conversation?.terminal?.write(event.data)
  }) || null
  codexOffLifecycle = onCodexSessionLifecycle?.((event) => {
    const conversation = codexConversations.value.find((item) => item.sessionId === event.id)
    if (!conversation) return
    applyCodexLifecycleEvent(conversation, event, t('ai.codexError'))
    if (event.stage === 'ready') {
      syncCodexAttentionState(conversation)
      fitCodexTerminal({ force: true, conversation })
    }
    if (event.stage === 'error') {
      syncCodexAttentionState(conversation)
    }
    if (event.stage === 'closed') {
      syncCodexAttentionState(conversation)
    }
  }) || null
  codexOffExit = onCodexSessionExit?.((event) => {
    const conversation = codexConversations.value.find((item) => item.sessionId === event.id)
    if (!conversation) return
    applyCodexExitEvent(conversation, event)
    syncCodexAttentionState(conversation)
  }) || null
}

const syncActiveCodexBridgeTarget = async () => {
  const conversation = activeCodexConversation.value
  if (!conversation?.sessionId || !conversation.boundTarget || !codexSessionClient.setCodexSessionTarget()) return
  await syncCodexTargetContext({ force: true, conversation })
}

const ensureCodexTerminal = (conversation = ensureActiveCodexConversation()) => {
  const element = conversation.host
  if (!element || conversation.terminal) return
  const terminal = new XtermTerminal({
    allowTransparency: true,
    cursorBlink: workspace.terminalSettings.cursorBlink,
    convertEol: true,
    cursorStyle: workspace.terminalSettings.cursorStyle,
    fontFamily: workspace.terminalSettings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: workspace.terminalSettings.fontSize || 12,
    lineHeight: workspace.terminalSettings.lineHeight || 1,
    scrollback: workspace.terminalSettings.scrollBack,
    theme: {
      background: 'rgba(9, 11, 16, 0)',
      foreground: '#d7dae3',
      cursor: '#8ccf7e',
      selectionBackground: '#2d4059'
    }
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(element)
  conversation.terminal = terminal
  conversation.fit = fit
  applyCodexTerminalSettings(conversation, workspace.terminalSettings, { refit: false })
  terminal.attachCustomKeyEventHandler((event) => {
    if (!codexCopyShortcut(event)) return true
    event.preventDefault()
    event.stopPropagation()
    void copyCodexSelection('keyboard')
    return false
  })
  terminal.onData((data) => {
    const writeCodexSession = codexSessionClient.writeCodexSession()
    if (!conversation.sessionId || !writeCodexSession) return
    void syncCodexTargetContext({ force: true, conversation }).finally(() => {
      markCodexPendingTargetDelivered(conversation)
      void writeCodexSession(conversation.sessionId, data)
    })
  })
  terminal.onResize(({ cols, rows }) => {
    const resizeCodexSession = codexSessionClient.resizeCodexSession()
    if (!conversation.sessionId || !resizeCodexSession) return
    conversation.lastFitCols = cols
    conversation.lastFitRows = rows
    void resizeCodexSession(conversation.sessionId, cols, rows)
  })
  if (typeof ResizeObserver !== 'undefined') {
    conversation.resizeObserver?.disconnect()
    conversation.resizeObserver = new ResizeObserver(() => fitCodexTerminal({ conversation }))
    conversation.resizeObserver.observe(element)
  }
  fitCodexTerminal({ force: true, conversation })
  writeAiRuntimeLog('debug', 'renderer.codex-terminal.created', { localId: conversation.id })
}

const applyCodexTerminalSettings = (
  conversation: CodexConversation,
  settings: TerminalSettings = workspace.terminalSettings,
  options: { refit?: boolean } = {}
) => {
  const terminal = conversation.terminal
  if (!terminal) return
  setXtermTermName(terminal, settings.terminalType)
  terminal.options.fontFamily = settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
  terminal.options.fontSize = settings.fontSize || 12
  terminal.options.lineHeight = settings.lineHeight || 1
  terminal.options.cursorBlink = settings.cursorBlink
  terminal.options.cursorStyle = settings.cursorStyle
  terminal.options.scrollback = settings.scrollBack
  if (options.refit !== false) {
    fitCodexTerminal({ force: true, conversation })
  }
}

const currentCodexTargetContext = (): CodexSessionTargetContext => codexTargetContextFromPanel(workspace.activePanel)

const currentBoundCodexTarget = (conversation = activeCodexConversation.value) => currentBoundCodexRuntimeTarget(conversation, workspace.panels)

const syncCodexTargetContext = async (options: { force?: boolean; conversation?: CodexConversation | null } = {}) => {
  const conversation = options.conversation || activeCodexConversation.value
  const setCodexSessionTarget = codexSessionClient.setCodexSessionTarget()
  if (!conversation || !setCodexSessionTarget) return
  const target = currentBoundCodexTarget(conversation)
  const syncPlan = prepareCodexTargetSync(conversation, target, options.force)
  if (!syncPlan) return
  try {
    const result = await setCodexSessionTarget(syncPlan.target)
    writeAiRuntimeLog(result?.data?.registered ? 'debug' : 'warn', result?.data?.registered ? 'renderer.codex-target.updated' : 'renderer.codex-target.unavailable', {
      sessionId: conversation.sessionId,
      targetSessionId: syncPlan.target.sessionId,
      targetKind: syncPlan.target.kind,
      targetLabel: syncPlan.target.label,
      registered: Boolean(result?.data?.registered)
    })
  } catch (error) {
    markCodexTargetSyncFailed(conversation)
    writeAiRuntimeLog('warn', 'renderer.codex-target.update-failed', {
      sessionId: conversation.sessionId,
      targetSessionId: syncPlan.target.sessionId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

const setCodexPendingTargetContext = async (
  conversation: CodexConversation,
  kind: CodexTargetEventKind,
  target?: CodexSessionTargetContext | null,
  previous?: CodexSessionTargetContext | null
) => {
  const setCodexSessionPendingContext = codexSessionClient.setCodexSessionPendingContext()
  if (!conversation.sessionId || !setCodexSessionPendingContext) return
  const pending = prepareCodexPendingTargetContext(conversation, kind, target)
  if (pending.clear) {
    await setCodexSessionPendingContext(conversation.sessionId, '')
    return
  }
  await setCodexSessionPendingContext(conversation.sessionId, pending.text)
}

const markCodexPendingTargetDelivered = (conversation: CodexConversation) => {
  markCodexRuntimePendingTargetDelivered(conversation)
}

const bindCodexTarget = async (target: CodexSessionTargetContext | null, options: { reason?: string; start?: boolean } = {}) => {
  const conversation = ensureActiveCodexConversation(target)
  if (!target?.sessionId || target.kind === 'unknown') {
    conversation.error = t('ai.codexTargetMissing')
    return false
  }
  const previous = applyCodexTargetBinding(conversation, target, { fallbackLabel: t('ai.codexCliMode') })
  codexTargetPickerOpen.value = false
  codexTargetQuery.value = ''
  writeAiRuntimeLog('info', 'renderer.codex-target.bound', {
    reason: options.reason,
    sessionId: target.sessionId,
    panelId: target.panelId,
    targetKind: target.kind,
    targetLabel: target.label,
    previousSessionId: previous?.sessionId
  })
  if (conversation.sessionId) {
    await syncCodexTargetContext({ force: true, conversation })
    await setCodexPendingTargetContext(conversation, previous ? 'changed' : 'bound', target, previous)
  } else if (options.start !== false && aiPanelMode.value === 'codex') {
    await startCodexSession(conversation)
  }
  return true
}

const unbindCodexTarget = async () => {
  const conversation = activeCodexConversation.value
  if (!conversation) return
  const previous = applyCodexTargetUnbinding(conversation, t('ai.codexCliMode'))
  codexTargetPickerOpen.value = false
  codexTargetQuery.value = ''
  const setCodexSessionTarget = codexSessionClient.setCodexSessionTarget()
  if (conversation.sessionId && setCodexSessionTarget) {
    await setCodexSessionTarget(undefined)
    await setCodexPendingTargetContext(conversation, 'unbound', null, previous)
  }
}

const locateCodexBoundTarget = () => {
  const conversation = activeCodexConversation.value
  if (!conversation) return
  const target = conversation?.boundTarget
  if (!target?.sessionId) return
  const panel = workspace.activateTerminalPanel(target.panelId || target.sessionId)
  if (!panel) {
    conversation.error = t('ai.codexTargetClosed')
    return
  }
  conversation.error = ''
}

const closeCodexTargetPicker = () => {
  codexTargetPickerOpen.value = false
  codexTargetQuery.value = ''
}

const toggleCodexTargetPicker = async () => {
  codexTargetPickerOpen.value = !codexTargetPickerOpen.value
  if (!codexTargetPickerOpen.value) {
    codexTargetQuery.value = ''
    return
  }
  await workspace.refreshAiContextCatalog({ hydrateSelection: false })
}

const bindHostContextToCodex = async (host: AiContextOption) => {
  const panel = await workspace.openTerminalForAiHostContext(host)
  if (!panel?.sessionId) {
    ensureActiveCodexConversation().error = t('ai.codexTargetOpenFailed')
    return false
  }
  return bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'host-picker' })
}

const startCodexSession = async (targetConversation?: CodexConversation | null) => {
  if (aiPanelMode.value !== 'codex') return
  const conversation = targetConversation || ensureActiveCodexConversation()
  const target = currentBoundCodexTarget(conversation)
  if (!target) {
    conversation.status = 'idle'
    conversation.error = ''
    return
  }
  if (conversation.startPromise) return conversation.startPromise
  conversation.startPromise = (async () => {
    await nextTick()
    ensureCodexTerminal(conversation)
    const createCodexSession = codexSessionClient.createCodexSession()
    if (!createCodexSession) {
      conversation.status = 'error'
      conversation.error = t('ai.codexBridgeMissing')
      syncCodexAttentionState(conversation)
      return
    }
    if (conversation.sessionId && conversation.status === 'ready') {
      await syncCodexTargetContext({ force: true, conversation })
      return
    }
    conversation.status = 'starting'
    conversation.error = ''
    fitCodexTerminal({ force: true, conversation })
    const cols = conversation.terminal?.cols || 100
    const rows = conversation.terminal?.rows || 30
    try {
      const session = await createCodexSession({ cols, rows, target })
      applyCodexSessionStarted(conversation, session, target)
      subscribeCodexBridge()
      await syncCodexTargetContext({ force: true, conversation })
      fitCodexTerminal({ force: true, conversation })
      focusCodexTerminal()
      writeAiRuntimeLog('info', 'renderer.codex-session.started', {
        sessionId: session.id,
        runtimeKind: session.runtimeKind,
        binaryPath: session.binaryPath,
        codexHome: session.codexHome,
        cwd: session.cwd,
        target
      })
    } catch (error) {
      conversation.status = 'error'
      conversation.error = error instanceof Error && error.message.trim() ? error.message : t('ai.codexStartFailed')
      syncCodexAttentionState(conversation)
      writeAiRuntimeLog('error', 'renderer.codex-session.start-failed', { message: conversation.error })
    }
  })().finally(() => {
    conversation.startPromise = null
  })
  return conversation.startPromise
}

const stopCodexSession = async (conversation = activeCodexConversation.value) => {
  const sessionId = conversation?.sessionId
  const killCodexSession = codexSessionClient.killCodexSession()
  if (!sessionId || !killCodexSession) return
  try {
    await killCodexSession(sessionId)
  } catch (error) {
    writeAiRuntimeLog('warn', 'renderer.codex-session.kill-failed', {
      sessionId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

const restartCodexSession = async () => {
  const conversation = ensureActiveCodexConversation()
  await stopCodexSession(conversation)
  resetCodexConversationForRestart(conversation)
  syncCodexAttentionState(conversation)
  conversation.terminal?.clear()
  await startCodexSession(conversation)
}

const createNewCodexConversation = async () => {
  const conversation = createCodexConversationRecord(currentPanelTarget.value || null)
  codexConversations.value = [...codexConversations.value, conversation]
  activeCodexConversationId.value = conversation.id
  closeCodexTargetPicker()
  await nextTick()
  ensureCodexTerminal(conversation)
  if (conversation.boundTarget && aiPanelMode.value === 'codex') await startCodexSession(conversation)
}

const selectCodexConversation = async (id: string) => {
  if (activeCodexConversationId.value === id) return
  const conversation = codexConversations.value.find((item) => item.id === id)
  if (!conversation) return
  activeCodexConversationId.value = id
  closeCodexTargetPicker()
  await nextTick()
  ensureCodexTerminal(conversation)
  await syncActiveCodexBridgeTarget()
  fitCodexTerminal({ force: true, conversation })
  focusCodexTerminal()
}

const focusAiAttentionItem = async (item: typeof workspace.currentAiAttentionItem) => {
  if (!item || item.source !== 'codex' || !item.conversationId) return
  const conversation = codexConversations.value.find((entry) => entry.id === item.conversationId)
  if (!conversation) {
    workspace.removeAiAttentionItem(item.id)
    return
  }
  if (aiPanelMode.value !== 'codex') await selectAiPanelMode('codex')
  else panelModeMenuOpen.value = false
  await selectCodexConversation(conversation.id)
  focusCodexTerminal()
  if (conversation.status !== 'error') {
    workspace.markAiAttentionHandled(item.id)
    return
  }
  workspace.setTopNotice(`已定位到 ${codexConversationTitle(conversation)}`)
}

const closeCodexConversation = async (id: string) => {
  const closeResult = closeCodexConversationRecord(codexConversations.value, activeCodexConversationId.value, id)
  if (closeResult.status === 'missing') return
  if (closeResult.status === 'keep-one') {
    showChatExportNotice(t('ai.keepOneTab'))
    return
  }
  const conversation = closeResult.conversation
  await stopCodexSession(conversation)
  workspace.removeAiAttentionItem(codexAttentionId(conversation))
  conversation.resizeObserver?.disconnect()
  conversation.terminal?.dispose()
  codexConversations.value = closeResult.nextConversations
  if (closeResult.status === 'closed-active' && closeResult.nextConversation) {
    const nextConversation = closeResult.nextConversation
    activeCodexConversationId.value = closeResult.nextActiveId
    await nextTick()
    ensureCodexTerminal(nextConversation)
    await syncActiveCodexBridgeTarget()
    fitCodexTerminal({ force: true, conversation: nextConversation })
  }
  showChatExportNotice(t('ai.tabClosed'))
}

async function selectAiPanelMode(mode: AiPanelMode) {
  if (aiPanelMode.value === mode) {
    if (mode === 'codex') void startCodexSession()
    panelModeMenuOpen.value = false
    return
  }
  aiPanelMode.value = mode
  storeAiPanelMode(mode)
  closePopups()
  if (mode === 'classic') {
    await loadClassicChatData()
    return
  }
  ensureActiveCodexConversation()
  void startCodexSession()
}

const toggleAiPanelModeMenu = () => {
  panelModeMenuOpen.value = !panelModeMenuOpen.value
}

const closeModelMenu = () => {
  modelMenuOpen.value = false
  modelQuery.value = ''
}

const chatSearchMarks: HTMLElement[] = []
const chatSearchMatches: AiPanelChatSearchMatch[] = []

const formatHistoryTime = (timestamp: number) => formatAiHistoryTime(timestamp, new Date(), locale.value, historyLabels.value)

const getCurrentConversationTitle = () =>
  workspace.conversations.find((conversation) => conversation.id === workspace.selectedConversationId)?.title || 'Chat Export'

const copyRenderedTextToClipboard = async (text: string, label: string) => {
  if (!text) {
    showChatExportNotice(`${label}为空，无法复制。`)
    return
  }
  const copied = await copyTextToClipboard(text)
  showChatExportNotice(copied ? `${label}已复制。` : '复制失败。')
}

const showChatExportNotice = (message: string) => {
  chatExportNotice.value = message
  if (chatExportNoticeTimer) window.clearTimeout(chatExportNoticeTimer)
  chatExportNoticeTimer = window.setTimeout(() => {
    chatExportNotice.value = ''
    chatExportNoticeTimer = undefined
  }, 2400)
}

const copyMessageToClipboard = async (message: { text: string; contentParts?: AiContentPart[] }) => {
  const text = messagePlainText(message).trim()
  if (!text) {
    showChatExportNotice('消息为空，无法复制。')
    return
  }
  const copied = await copyTextToClipboard(text)
  showChatExportNotice(copied ? '消息已复制。' : '复制失败。')
}

const activeCommandAuditMessage = computed(() => {
  if (!commandAuditDialog.value.open || !commandAuditDialog.value.messageId) return null
  const message = workspace.chatMessages.find((item) => item.id === commandAuditDialog.value.messageId)
  return message && isCommandSuggestionMessage(message) ? (message as CommandSuggestionMessage) : null
})

const canEditActiveCommandAudit = computed(() => canEditCommandMessage(activeCommandAuditMessage.value))

const scrollChatToBottom = () => {
  const root = chatScrollRef.value
  if (!root) return
  root.scrollTop = root.scrollHeight
}

const scheduleChatScrollToBottom = () => {
  void nextTick(() => {
    if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
    chatScrollFrame = window.requestAnimationFrame(() => {
      chatScrollFrame = undefined
      scrollChatToBottom()
    })
  })
}

const copyCommandToClipboard = async (message: CommandSuggestionMessage) => {
  const command = commandTextForMessage(message).trim()
  if (!command) {
    showChatExportNotice('没有可复制的命令。')
    return
  }
  const copied = await copyTextToClipboard(command)
  showChatExportNotice(copied ? '命令已复制。' : '复制失败。')
}

const closeCommandAuditDialog = () => {
  commandAuditDialog.value = { open: false, messageId: '', draft: '' }
}

const openCommandAuditDialog = async (message: CommandSuggestionMessage) => {
  commandAuditDialog.value = {
    open: true,
    messageId: message.id,
    draft: commandTextForMessage(message)
  }
  closePopups()
  await nextTick()
  commandAuditTextareaRef.value?.focus()
  commandAuditTextareaRef.value?.select()
}

const saveCommandAuditDraft = (options: { silent?: boolean } = {}) => {
  const message = activeCommandAuditMessage.value
  if (!message) return false
  const saved = applyCommandTextToMessage(message, commandAuditDialog.value.draft)
  if (!saved) {
    showChatExportNotice('没有可运行的命令。')
    return false
  }
  commandAuditDialog.value.draft = commandTextForMessage(message)
  persistCommandExecutionState()
  if (!options.silent) showChatExportNotice('命令已更新。')
  return true
}

const copyCommandAuditDraft = async () => {
  const command = commandAuditDialog.value.draft.trim()
  if (!command) {
    showChatExportNotice('没有可复制的命令。')
    return
  }
  const copied = await copyTextToClipboard(command)
  showChatExportNotice(copied ? '命令已复制。' : '复制失败。')
}

const runCommandAuditDraft = async () => {
  const message = activeCommandAuditMessage.value
  if (!message) return
  if (!saveCommandAuditDraft({ silent: true })) return
  closeCommandAuditDialog()
  await runMessageCommand(message)
}

const persistCommandExecutionState = () => {
  void workspace.syncCurrentConversationSnapshot({ notifyFailure: true, notifyUnavailable: true })
}

const rejectMessageCommand = (message: CommandSuggestionMessage) => {
  if (message.commandExecutionStatus === 'running') return
  message.action = 'rejected'
  message.commandExecutionMessage = '已拒绝执行。'
  persistCommandExecutionState()
  showChatExportNotice('命令已拒绝。')
}

const enableSessionReadOnlyAutoRun = (message: CommandSuggestionMessage, options: { autoReadOnly?: boolean }) => {
  if (!options.autoReadOnly || chatMode.value !== 'agent' || !isReadOnlyCommandMessage(message)) return false
  return workspace.enableAgentReadOnlyAutoRunForCurrentConversation()
}

const runMessageCommand = async (message: CommandSuggestionMessage, options: { autoReadOnly?: boolean } = {}) => {
  if (message.action === 'rejected') {
    showChatExportNotice('命令已拒绝，无法执行。')
    return
  }
  const command = commandTextForMessage(message)
  if (!command) {
    setCommandExecutionState(message, 'failed', '没有可运行的命令。')
    persistCommandExecutionState()
    showChatExportNotice('没有可运行的命令。')
    return
  }
  const terminalPanel = workspace.activePanel.kind === 'knowledge' ? workspace.panels.find((panel) => panel.kind !== 'knowledge') : workspace.activePanel
  const outputStartLength = terminalPanel?.output.length ?? 0
  const terminalPanelId = terminalPanel?.id || ''
  const sessionAutoRunEnabled = enableSessionReadOnlyAutoRun(message, options)
  setCommandExecutionState(message, 'running', options.autoReadOnly ? '查询类命令正在发送到当前终端...' : '正在发送到当前终端...')
  const decision = await workspace.runActiveTerminalCommand(command, 'agent')
  if (!decision) {
    setCommandExecutionState(message, 'failed', '终端会话不可用，请先打开本地 shell 或连接 SSH。')
    persistCommandExecutionState()
    showChatExportNotice('终端会话不可用，请先打开本地 shell 或连接 SSH。')
    return
  }
  if (decision?.status === 'needs-approval') {
    setCommandExecutionState(message, 'pending', '命令已送入终端安全确认。')
    persistCommandExecutionState()
    showChatExportNotice('命令已送入终端安全确认。')
    return
  }
  if (decision?.status === 'blocked') {
    setCommandExecutionState(message, 'failed', '命令被安全策略拦截。')
    persistCommandExecutionState()
    showChatExportNotice('命令被安全策略拦截。')
    return
  }
  if (decision?.status === 'unavailable') {
    setCommandExecutionState(message, 'failed', decision.reason)
    persistCommandExecutionState()
    showChatExportNotice(decision.reason)
    return
  }
  setCommandExecutionState(message, 'succeeded', options.autoReadOnly ? `查询类命令已发送到终端：${command}` : `已发送到终端：${command}`, command)
  persistCommandExecutionState()
  if (chatMode.value !== 'agent' || message.ask !== 'command') {
    showChatExportNotice(options.autoReadOnly ? '查询类命令已写入终端输入区。' : '命令已写入终端输入区。')
    return
  }
  if (!terminalPanelId) {
    setCommandExecutionState(message, 'failed', '终端会话不可用，请先打开本地 shell 或连接 SSH。')
    persistCommandExecutionState()
    showChatExportNotice('终端会话不可用，请先打开本地 shell 或连接 SSH。')
    return
  }
  setCommandExecutionState(message, 'running', '命令已发送，正在等待终端输出...')
  persistCommandExecutionState()
  const loopResult = await workspace.continueAgentCommandLoop({
    commandMessageId: message.id,
    command,
    commandExecution: message.commandExecution
      ? {
          ip: message.commandExecution.ip || commandHostForMessage(message).replace(/^Host\s+/, '') || '127.0.0.1',
          command,
          requiresApproval: message.commandExecution.requiresApproval === true,
          interactive: message.commandExecution.interactive === true
        }
      : undefined,
    terminalPanelId,
    outputStartLength
  })
  if (loopResult.status === 'continued') {
    setCommandExecutionState(message, 'succeeded', `命令输出已回传 Agent：${command}`, command)
    persistCommandExecutionState()
    showChatExportNotice(sessionAutoRunEnabled ? '已开启本会话查询类自动执行，并继续分析。' : '命令输出已回传 Agent，正在继续分析。')
    return
  }
  showChatExportNotice(loopResult.reason)
}

const formatMcpToolArguments = (message: { mcpToolCall?: { arguments?: Record<string, unknown> } }) => {
  try {
    return JSON.stringify(message.mcpToolCall?.arguments || {}, null, 2)
  } catch {
    return String(message.mcpToolCall?.arguments || '')
  }
}

const approveMcpToolCall = async (id: string, autoApprove = false) => {
  const result = await workspace.approveAiMcpToolCall(id, { autoApprove })
  showChatExportNotice(result === 'approved' ? 'MCP 工具已执行。' : 'MCP 工具审批失败。')
}

const rejectMcpToolCall = async (id: string) => {
  const result = await workspace.rejectAiMcpToolCall(id)
  showChatExportNotice(result === 'rejected' ? 'MCP 工具调用已拒绝。' : 'MCP 工具拒绝失败。')
}

const approveMcpResourceAccess = async (id: string) => {
  const result = await workspace.approveAiMcpResourceAccess(id)
  showChatExportNotice(result === 'approved' ? 'MCP 资源已读取。' : 'MCP 资源审批失败。')
}

const rejectMcpResourceAccess = async (id: string) => {
  const result = await workspace.rejectAiMcpResourceAccess(id)
  showChatExportNotice(result === 'rejected' ? 'MCP 资源访问已拒绝。' : 'MCP 资源拒绝失败。')
}

const toggleMessageFavorite = async (id: string) => {
  const saved = await workspace.toggleMessageFavorite(id)
  if (!saved) return
  const message = workspace.chatMessages.find((item) => item.id === id)
  showChatExportNotice(message?.favorite ? '已收藏消息。' : '已取消收藏。')
}

const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
  const saved = await workspace.setMessageFeedback(id, feedback)
  if (!saved) return
  const message = workspace.chatMessages.find((item) => item.id === id)
  const current = message?.feedback
  showChatExportNotice(current ? (current === 'up' ? '已标记有帮助。' : '已标记无帮助。') : '已取消反馈。')
}

const retryAssistantMessage = (id: string) => {
  const retried = workspace.retryAssistantMessage(id)
  showChatExportNotice(retried ? '已重新发送上一条用户消息。' : '没有可重试的用户消息。')
}

const summarizeMessageToKnowledge = async (id: string) => {
  const result = await workspace.summarizeMessageToKnowledge(id)
  showChatExportNotice(result ? `已沉淀到知识：${result.relPath}` : '沉淀到知识失败。')
}

const summarizeMessageToSkill = async (id: string) => {
  const result = await workspace.summarizeMessageToSkill(id)
  showChatExportNotice(result ? `已创建技能：${result.name}` : '沉淀到技能失败。')
}

const exportCurrentChat = async () => {
  moreActionsMenuOpen.value = false
  if (workspace.chatMessages.length === 0) {
    showChatExportNotice('当前会话为空，无法导出。')
    return
  }
  const exportChat = aiChatClient.exportChat()
  if (typeof exportChat !== 'function') {
    showChatExportNotice('聊天导出服务不可用。')
    return
  }
  try {
    const result = await exportChat({
      title: getCurrentConversationTitle(),
      messages: workspace.chatMessages.map(chatExportMessage)
    })
    if (!result?.ok) {
      showChatExportNotice(`导出失败：${result?.errorMessage || '聊天导出失败。'}`)
      return
    }
    if (!isAiChatExportData(result.data)) {
      showChatExportNotice(`导出失败：${malformedAiBackendResultMessage}`)
      return
    }
    if (result.data.canceled) return
    showChatExportNotice('聊天已导出。')
  } catch (error) {
    showChatExportNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const openHistoryMenu = async () => {
  chatSearchOpen.value = false
  moreActionsMenuOpen.value = false
  closeContextPopup()
  closeCommandPopup()
  modeMenuOpen.value = false
  closeModelMenu()
  await workspace.loadChatConversationsFromBackend({ restoreIfEmpty: false })
  historyMenuOpen.value = true
  await nextTick()
  historySearchInputRef.value?.focus()
}

const closeHistoryMenu = () => {
  historyMenuOpen.value = false
  editingHistoryId.value = null
  editingHistoryTitle.value = ''
}

const toggleHistoryMenu = () => {
  if (historyMenuOpen.value) {
    closeHistoryMenu()
    return
  }
  void openHistoryMenu()
}

const toggleMoreActionsMenu = () => {
  if (moreActionsMenuOpen.value) {
    moreActionsMenuOpen.value = false
    return
  }
  closeHistoryMenu()
  moreActionsMenuOpen.value = true
}

const clearHistorySearch = () => {
  historySearchTerm.value = ''
  void nextTick(() => historySearchInputRef.value?.focus())
}

const createNewAiConversation = async () => {
  const created = await workspace.createConversation()
  historySearchTerm.value = ''
  historyCurrentPage.value = 1
  if (created) {
    closeHistoryMenu()
    showChatExportNotice(t('ai.chatCreated'))
  } else {
    showChatExportNotice(t('ai.chatCreateFailed'))
  }
}

const restoreConversationById = async (id: string, successMessage = t('ai.chatRestored'), failureMessage = t('ai.chatRestoreFailed')) => {
  if (editingHistoryId.value) return false
  const restored = await workspace.restoreConversation(id)
  if (restored) ensureConversationTab(id)
  showChatExportNotice(restored ? successMessage : failureMessage)
  return restored
}

const restoreConversationFromTab = async (id: string) => {
  if (workspace.selectedConversationId === id) return
  closeHistoryMenu()
  await restoreConversationById(id)
}

const closeConversationTab = async (id: string) => {
  closeHistoryMenu()
  const result = closeAiConversationTab(openConversationTabIds.value, visibleConversationTabs.value, workspace.selectedConversationId, id)
  if (result.status === 'keep-one') {
    showChatExportNotice(t('ai.keepOneTab'))
    return
  }
  openConversationTabIds.value = result.openIds
  if (result.status === 'closed-inactive' || result.status === 'closed') {
    showChatExportNotice(t('ai.tabClosed'))
    return
  }
  await restoreConversationById(result.nextConversationId, t('ai.tabClosed'), t('ai.chatRestoreFailed'))
}

const restoreHistoryConversation = async (id: string) => {
  const restored = await restoreConversationById(id)
  if (restored) {
    closeHistoryMenu()
  }
}

const editHistoryTitle = async (id: string) => {
  const conversation = workspace.conversations.find((item) => item.id === id)
  if (!conversation) return
  editingHistoryId.value = id
  editingHistoryTitle.value = conversation.title
  await nextTick()
  const input = historySearchInputRef.value?.closest('.ai-history-dropdown')?.querySelector<HTMLInputElement>('.ai-history-title-input')
  input?.focus()
  input?.select()
}

const cancelHistoryTitleEdit = () => {
  editingHistoryId.value = null
  editingHistoryTitle.value = ''
}

const saveHistoryTitle = async (id: string) => {
  if (!editingHistoryId.value) return
  const saved = await workspace.renameConversation(id, editingHistoryTitle.value)
  cancelHistoryTitleEdit()
  showChatExportNotice(saved ? t('ai.historyTitleUpdated') : t('ai.historyTitleUpdateFailed'))
}

const deleteHistoryConversation = async (id: string) => {
  const deleted = await workspace.deleteConversation(id)
  historyCurrentPage.value = nextAiHistoryPageAfterDelete(visibleHistoryConversations.value.length, historyCurrentPage.value)
  showChatExportNotice(deleted ? t('ai.chatDeleted') : t('ai.chatDeleteFailed'))
}

const toggleHistoryFavorite = async (id: string) => {
  const toggled = await workspace.toggleConversationFavorite(id)
  const conversation = workspace.conversations.find((item) => item.id === id)
  showChatExportNotice(toggled ? (conversation?.favorite ? t('ai.historyFavorited') : t('ai.historyUnfavorited')) : t('ai.historyFavoriteUpdateFailed'))
}

const loadMoreHistoryConversations = async () => {
  if (historyLoadingMore.value || !hasMoreHistoryConversations.value) return
  historyLoadingMore.value = true
  try {
    const refreshed = await workspace.loadChatConversationsFromBackend({ restoreIfEmpty: false })
    if (!refreshed) return
    historyCurrentPage.value += 1
  } finally {
    historyLoadingMore.value = false
  }
}

const clearChatHighlights = () => {
  clearAiChatSearchHighlights(chatSearchMarks)
  chatSearchMatches.splice(0)
  chatSearchMatchCount.value = 0
  chatSearchCurrentIndex.value = 0
}

const setActiveChatSearchMatch = (index: number) => {
  activateAiChatSearchMatch(chatSearchMatches, index)
}

const runChatSearch = () => {
  const root = chatScrollRef.value
  clearChatHighlights()
  const term = chatSearchTerm.value.trim()
  if (!root || !term) return

  const result = runAiChatSearchHighlights(root, term)
  chatSearchMarks.push(...result.marks)
  chatSearchMatches.push(...result.matches)
  chatSearchMatchCount.value = result.matchCount
  chatSearchCurrentIndex.value = result.currentIndex
}

const scheduleChatSearch = () => {
  if (chatSearchTimer) window.clearTimeout(chatSearchTimer)
  chatSearchTimer = window.setTimeout(() => {
    runChatSearch()
    chatSearchTimer = undefined
  }, 200)
}

const openChatSearch = async () => {
  chatSearchOpen.value = true
  moreActionsMenuOpen.value = false
  closePopups()
  await nextTick()
  chatSearchInputRef.value?.focus()
  if (chatSearchTerm.value.trim()) runChatSearch()
}

const closeChatSearch = () => {
  chatSearchOpen.value = false
  chatSearchTerm.value = ''
  if (chatSearchTimer) {
    window.clearTimeout(chatSearchTimer)
    chatSearchTimer = undefined
  }
  clearChatHighlights()
}

const clearChatSearch = async () => {
  chatSearchTerm.value = ''
  clearChatHighlights()
  await nextTick()
  chatSearchInputRef.value?.focus()
}

const findNextChatMatch = () => {
  const next = nextAiChatSearchPosition(chatSearchCurrentIndex.value, chatSearchMatches.length)
  if (!next) return
  chatSearchCurrentIndex.value = next.currentIndex
  setActiveChatSearchMatch(next.activeIndex)
}

const findPreviousChatMatch = () => {
  const previous = previousAiChatSearchPosition(chatSearchCurrentIndex.value, chatSearchMatches.length)
  if (!previous) return
  chatSearchCurrentIndex.value = previous.currentIndex
  setActiveChatSearchMatch(previous.activeIndex)
}

type AiCommandOption = AiCommandCatalogOption

const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
  editEditableRef.value = el instanceof HTMLElement ? el : null
}

const aiContextCategories = computed<AiContextCategoryView[]>(() =>
  cloneAiPanelContextCategories(workspace.aiContextCatalog.categories, (kind) => aiContextCategoryIcons[kind] || Search)
)
const selectedContextCategory = computed(() => selectedAiPanelContextCategory(aiContextCategories.value, contextLevel.value))
const docsContextOptions = computed<AiContextOption[]>(() =>
  sortedAiPanelDocsContextOptions(selectedContextCategory.value?.options || [], docsCurrentRelDir.value)
)
const commandOptions = computed<AiCommandOption[]>(() => cloneAiPanelCommandOptions(workspace.aiCommandOptions))
const displayedOpenedHosts = computed(() =>
  filteredAiPanelOpenedHosts(workspace.aiContextCatalog.openedHosts, contextQuery.value, chatMode.value)
)
const visibleContextCategories = computed(() => visibleAiPanelContextCategories(aiContextCategories.value, chatMode.value))
const filteredContextOptions = computed(() =>
  filteredAiPanelContextOptions({
    level: contextLevel.value,
    selectedCategoryOptions: selectedContextCategory.value?.options,
    docsOptions: docsContextOptions.value,
    skillOptions: workspace.aiSkillContextOptions,
    query: contextQuery.value
  })
)
const visibleHostContextOptions = computed(() => visibleAiPanelHostContextOptions(filteredContextOptions.value))
const hostContextsForPopup = computed(() =>
  contextTarget.value === 'edit' ? editHostContexts.value : workspace.selectedContexts.filter((context) => context.kind === 'hosts')
)
const allVisibleHostContextsSelected = computed(() => allVisibleAiPanelHostsSelected(visibleHostContextOptions.value, hostContextsForPopup.value))
const filteredCommands = computed(() => filteredAiPanelCommands(commandOptions.value, commandQuery.value))
const selectedCommand = computed(() => selectedAiPanelCommand(commandOptions.value, workspace.selectedCommandId))
const SELECT_CHROME_PX = 48
const THINKING_ICON_SELECT_EXTRA_PX = 22
const DROPDOWN_ROW_CHROME_PX = 52
const LOCK_ROW_ICON_EXTRA_PX = 22
const VIP_TAG_ROW_EXTRA_PX = 36

const stripThinkingSuffix = (modelName: string) => modelName.replace(/-Thinking$/, '')
const displayModelName = (model: { id?: string; label?: string; displayName?: string } | string) =>
  typeof model === 'string' ? stripThinkingSuffix(model) : model.displayName || stripThinkingSuffix(model.label || model.id || '')
const isThinkingModelName = (modelName: string) => modelName.endsWith('-Thinking')
const lockedModelTooltip = (tier: string) => `模型已锁定，升级 ${tier} 后可用`
const selectedModelLabel = computed(() => {
  const model = workspace.aiModelOptions.find((option) => option.id === workspace.config.modelName)
  return model ? displayModelName(model) : displayModelName(workspace.config.modelName)
})
const matchesModelQuery = (model: { id: string; label: string; detail?: string; tier?: string; displayName?: string }) =>
  modelMatchesAiPanelQuery(model, modelQuery.value, displayModelName)
const filteredModelOptions = computed(() => workspace.aiModelOptions.filter(matchesModelQuery))
const filteredLockedModelOptions = computed(() => workspace.lockedAiModelOptions.filter(matchesModelQuery))
const hasAvailableModels = computed(() => workspace.aiModelOptions.some((model) => !model.locked))
const modelCatalogReady = computed(() =>
  workspace.aiModelOptions.length > 0 || workspace.lockedAiModelOptions.length > 0 || workspace.settingModelOptions.length > 0
)
const showNoAvailableModelPrompt = computed(() => modelCatalogReady.value && !hasAvailableModels.value)

const measureUiTextWidthPx = (text: string) => {
  if (!text) return 0
  if (typeof document === 'undefined') return text.length * 7
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return text.length * 7
  context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
  return context.measureText(text).width
}

const modeDropdownWidthPx = computed(() => {
  const maxWidth = aiChatModeOptions.reduce((max, option) => {
    const width = Math.ceil(measureUiTextWidthPx(option.label)) + DROPDOWN_ROW_CHROME_PX
    return Math.max(max, width)
  }, 0)
  return Math.min(Math.max(maxWidth, 96), 400)
})

const modelDropdownWidthPx = computed(() => {
  const availableMaxWidth = workspace.aiModelOptions.reduce((max, model) => {
    const thinkingExtra = isThinkingModelName(model.id) ? THINKING_ICON_SELECT_EXTRA_PX : 0
    const width = Math.ceil(measureUiTextWidthPx(displayModelName(model))) + DROPDOWN_ROW_CHROME_PX + thinkingExtra
    return Math.max(max, width)
  }, 0)
  const lockedMaxWidth = workspace.lockedAiModelOptions.reduce((max, model) => {
    const width = Math.ceil(measureUiTextWidthPx(model.label)) + DROPDOWN_ROW_CHROME_PX + LOCK_ROW_ICON_EXTRA_PX + VIP_TAG_ROW_EXTRA_PX
    return Math.max(max, width)
  }, 0)
  const maxWidth = Math.max(availableMaxWidth, lockedMaxWidth)
  return Math.min(Math.max(maxWidth, 120), 720)
})
const selectedCommandRef = computed(() => {
  return selectedAiPanelCommandRef(selectedCommand.value, workspace.selectedCommandId, workspace.selectedCommandRef)
})

const contextUsage = computed(() => {
  return workspace.aiContextUsage || { used: 0, contextWindow: 0, percent: 0 }
})

const contextUsageColor = computed(() => {
  const percent = contextUsage.value.percent
  if (percent >= 90) return '#ef4444'
  if (percent >= 70) return '#f59e0b'
  return '#3b82f6'
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

const imagePartFromContext = aiImagePartFromContext
const chipPartFromContext = aiChipPartFromContext

const cloneContextOption = cloneAiContextOption

const removeEditHostContext = (id: string) => {
  editHostContexts.value = editHostContexts.value.filter((context) => context.id !== id)
}

const openEditContextPopup = () => {
  openContextPopupForTarget('edit')
}

const editableRenderOptions = computed<AiPanelEditableRenderOptions>(() => ({
  iconMarkupByContextKind,
  commandIconMarkup
}))

const getChipLabel = aiPanelChipLabel

const createIconElement = (kind: AiContextKind | 'command') => createAiPanelIconElement(kind, editableRenderOptions.value)

const createChipElement = (
  part: AiChipContentPart,
  options: { removableContextId?: string; removableCommand?: boolean; removablePart?: boolean } = {}
) => createAiPanelChipElement(part, editableRenderOptions.value, options)

const createContextChipElement = (context: AiContextOption) => createAiPanelContextChipElement(context, editableRenderOptions.value)

const createCommandChipElement = () => createAiPanelCommandChipElement(selectedCommandRef.value, editableRenderOptions.value)

const createImageElement = createAiPanelImageElement

const insertImageIntoEditableCursor = (editable: HTMLElement | null, part: AiImageContentPart, onInserted: () => void) =>
  insertAiPanelImageIntoEditableCursor(editable, part, onInserted)

const insertImageAtEditableCursor = (part: AiImageContentPart) => {
  return insertImageIntoEditableCursor(editableRef.value, part, () => {
    imageInputParts.value = [...imageInputParts.value, part]
    handleEditableInput()
  })
}

const insertImageAtEditCursor = (part: AiImageContentPart) => {
  return insertImageIntoEditableCursor(editEditableRef.value, part, () => {
    editImageInputParts.value = [...editImageInputParts.value, part]
    handleEditEditableInput()
  })
}

const insertContextAtEditCursor = (context: AiContextOption) => {
  const imagePart = imagePartFromContext(context)
  if (imagePart) {
    return insertImageAtEditCursor(imagePart)
  }

  const chipPart = chipPartFromContext(context)
  if (!chipPart) return false
  restoreEditSelection()
  const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
  return insertChipIntoEditableCursor(editTarget, chipPart, handleEditEditableInput, '@')
}

const insertFileChipAtMainCursor = (part: AiDocChipContentPart) => {
  restoreEditableSelection()
  return insertChipIntoEditableCursor(editableRef.value, part, () => {
    fileInputParts.value = [...fileInputParts.value, part]
    handleEditableInput()
  }, '@')
}

const insertFileChipAtEditCursor = (part: AiDocChipContentPart) => {
  restoreEditSelection()
  const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
  return insertChipIntoEditableCursor(editTarget, part, handleEditEditableInput, '@')
}

const clipboardHasImage = (event: ClipboardEvent) => clipboardHasImageItems(event.clipboardData?.items)

const preparePastedImagePart = async (): Promise<AiImageContentPart | null> => {
  const prepareClipboardImage = localFilesClient.prepareChatImageAttachmentFromClipboard()
  if (!prepareClipboardImage) {
    showInputPlaceholderNotice('图片上传失败：剪贴板图片服务不可用')
    return null
  }
  try {
    const result = await prepareClipboardImage()
    const imagePart = imagePartFromChatImagePrepareResult(result)
    if (imagePart.ok) return imagePart.data
    showInputPlaceholderNotice(`图片上传失败：${imagePart.message}`)
    return null
  } catch (error) {
    showInputPlaceholderNotice(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const insertPastedImageIntoEdit = async () => {
  const part = await preparePastedImagePart()
  if (part) insertImageAtEditCursor(part)
}

const insertPlainTextIntoEditableCursor = (editable: HTMLElement | null, text: string, onInserted: () => void) =>
  insertAiPanelPlainTextIntoEditableCursor(editable, text, onInserted)

const insertPlainTextAtEditCursor = (text: string) => {
  insertPlainTextIntoEditableCursor(editEditableRef.value, text, handleEditEditableInput)
}

const removeTokenBeforeRange = removeAiPanelTokenBeforeRange

const removeTokenFromEditableCursor = removeAiPanelTokenFromEditableCursor

const insertChipIntoEditableCursor = (editable: HTMLElement | null, part: AiChipContentPart, onInserted: () => void, triggerToken = '/') =>
  insertAiPanelChipIntoEditableCursor(editable, part, editableRenderOptions.value, onInserted, triggerToken)

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

const shouldTriggerCommandPopupFromEditableText = () => {
  const text = editablePlainText()
  return /(?:^|\s)\/$/.test(text)
}

const openCommandPopupForTarget = async (target: 'main' | 'edit') => {
  if (target === 'edit') {
    saveEditSelection()
  } else {
    saveEditableSelection()
  }
  await workspace.refreshAiCommandCatalog()
  commandTarget.value = target
  commandPopupOpen.value = true
  closeContextPopup()
  modeMenuOpen.value = false
  closeModelMenu()
  commandQuery.value = ''
  commandKeyboardIndex.value = -1
  await nextTick()
  commandSearchInputRef.value?.focus()
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
  void workspace.refreshAiContextCatalog({ hydrateSelection: false })
  void nextTick(() => contextSearchInputRef.value?.focus())
}

const renderPartsIntoEditable = (editable: HTMLElement, parts: AiContentPart[]) =>
  renderAiPanelPartsIntoEditable(editable, parts, editableRenderOptions.value)

const renderEditableFromState = () => {
  const editable = editableRef.value
  if (!editable) return
  syncingFromEditable.value = true
  const active = document.activeElement === editable
  renderAiPanelMainEditableFromState(
    editable,
    {
      draft: draft.value,
      images: imageInputParts.value,
      files: fileInputParts.value,
      command: selectedCommandRef.value
    },
    editableRenderOptions.value
  )
  if (active && !contextPopupOpen.value && !commandPopupOpen.value && !modelMenuOpen.value) {
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

const extractEditableTextFromNode = extractAiPanelEditablePlainTextFromNode

const editablePlainText = () => {
  return aiPanelEditablePlainText(editableRef.value)
}

const chipPartFromChipElement = chipPartFromAiPanelChipElement

const contextById = (id: string) => workspace.selectedContexts.find((item) => item.id === id) || null

const extractEditableContentParts = () => {
  return extractAiPanelContentPartsFromEditable(editableRef.value, { contextById })
}

const extractContentPartsFromEditable = (editable: HTMLElement | null) => {
  return extractAiPanelContentPartsFromEditable(editable, { contextById })
}

const fallbackPartsForMessage = fallbackAiContentPartsForMessage

const editableTextFromElement = (editable: HTMLElement | null) => {
  return aiPanelEditablePlainText(editable)
}

const renderEditEditableFromParts = (parts: AiContentPart[]) => {
  const editable = editEditableRef.value
  if (!editable) return
  renderPartsIntoEditable(editable, parts)
  editDraft.value = editableTextFromElement(editable)
  const splitParts = splitAiContentInputParts(parts)
  editImageInputParts.value = splitParts.images
  editFileInputParts.value = splitParts.docs
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
  editFileInputParts.value = []
  editHostContexts.value = []
  editSavedRange.value = null
}

const handleEditEditableInput = () => {
  editDraft.value = editableTextFromElement(editEditableRef.value)
  const splitParts = splitAiContentInputParts(extractContentPartsFromEditable(editEditableRef.value))
  editImageInputParts.value = splitParts.images
  editFileInputParts.value = splitParts.docs
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
  if (clipboardHasImage(event)) {
    event.preventDefault()
    void insertPastedImageIntoEdit()
    return
  }

  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') || ''
  insertPlainTextAtEditCursor(text)
}

const confirmMessageEdit = async () => {
  if (!editingMessageId.value) return
  const contentParts = extractContentPartsFromEditable(editEditableRef.value)
  if (!hasSendableAiContent(contentParts)) return
  const sent = await workspace.resendUserMessageFromParts(editingMessageId.value, contentParts, editHostContexts.value.map(cloneContextOption))
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
      void openCommandPopupForTarget('edit')
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
  const parts = syncAiPanelMainInputPartsFromEditable(editableRef.value)
  if (!parts.commandPresent && workspace.selectedCommandId) {
    workspace.selectCommandPreset(null)
  }
  fileInputParts.value = parts.files
  imageInputParts.value = parts.images
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
  if (clipboardHasImage(event)) {
    event.preventDefault()
    void insertPastedImage()
    return
  }

  event.preventDefault()
  insertPlainTextAtEditableCursor(event.clipboardData?.getData('text/plain') || '')
}

const imagePickerFilters = aiPanelImagePickerFilters

const processImageFilePath = async (filePath: string): Promise<AiImageContentPart | null> => {
  const prepareImageFromFile = localFilesClient.prepareChatImageAttachmentFromFile()
  if (!prepareImageFromFile) {
    showInputPlaceholderNotice('图片上传失败：图片读取服务不可用')
    return null
  }
  try {
    const result = await prepareImageFromFile({ filePath })
    const imagePart = imagePartFromChatImagePrepareResult(result)
    if (imagePart.ok) return imagePart.data
    showInputPlaceholderNotice(`图片上传失败：${imagePart.message}`)
    return null
  } catch (error) {
    showInputPlaceholderNotice(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const insertImageFilePaths = async (filePaths: string[]) => {
  if (streaming.value) return
  for (const filePath of filePaths) {
    const part = await processImageFilePath(filePath)
    if (part) insertImageAtEditableCursor(part)
  }
}

const insertPastedImage = async () => {
  const part = await preparePastedImagePart()
  if (part) insertImageAtEditableCursor(part)
}

const openImagePicker = async () => {
  if (streaming.value) return
  const showOpenDialog = localFilesClient.showOpenDialog()
  if (!showOpenDialog) {
    showInputPlaceholderNotice('图片上传失败：文件选择服务不可用')
    return
  }
  try {
    const result = await showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: imagePickerFilters
    })
    if (!result || result.canceled || !result.filePaths?.length) return
    await insertImageFilePaths(result.filePaths)
  } catch (error) {
    showInputPlaceholderNotice(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const showInputPlaceholderNotice = (message: string) => {
  inputPlaceholderNotice.value = message
  if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
  inputPlaceholderNoticeTimer = window.setTimeout(() => {
    inputPlaceholderNotice.value = ''
    inputPlaceholderNoticeTimer = undefined
  }, 2400)
}

const ensureAttachmentConversationId = async () => {
  if (workspace.selectedConversationId.trim()) return workspace.selectedConversationId.trim()
  const created = await workspace.createConversation()
  return created?.id || ''
}

const handleFileUpload = async () => {
  if (streaming.value) return
  const showOpenDialog = localFilesClient.showOpenDialog()
  if (!showOpenDialog) {
    showInputPlaceholderNotice('文件上传失败：文件选择服务不可用')
    return
  }
  const stageAttachment = localFilesClient.stageChatAttachment()
  if (!stageAttachment) {
    showInputPlaceholderNotice('文件上传失败：文件暂存服务不可用')
    return
  }
  const taskId = await ensureAttachmentConversationId()
  if (!taskId) {
    showInputPlaceholderNotice('请先创建会话后再上传文件。')
    return
  }
  try {
    const result = await showOpenDialog({
      properties: ['openFile'],
      filters: chatAttachmentFilters
    })
    if (!result || result.canceled || !result.filePaths?.length) return
    const srcAbsPath = result.filePaths[0]
    const staged = await stageAttachment({ taskId, srcAbsPath })
    const stagedPart = docPartFromStagedAttachment(staged, taskId, srcAbsPath)
    if (!stagedPart.ok) throw new Error(stagedPart.message)
    const inserted = editingMessageId.value ? insertFileChipAtEditCursor(stagedPart.data.part) : insertFileChipAtMainCursor(stagedPart.data.part)
    if (!inserted) {
      throw new Error('文件输入框不可用')
    }
    showInputPlaceholderNotice(`已添加文件：${stagedPart.data.displayName}`)
  } catch (error) {
    showInputPlaceholderNotice(`文件上传失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const appendVoiceTranscriptionToInput = (text: string) => {
  restoreEditableSelection()
  insertPlainTextAtEditableCursor(text)
  requestAnimationFrame(moveEditableCaretToEnd)
}

const aiPanelVoiceRuntime = createAiPanelVoiceRuntime({
  streaming: () => streaming.value,
  draft: () => draft.value,
  closePopups: () => closePopups(),
  restoreSelection: () => restoreEditableSelection(),
  insertTranscription: appendVoiceTranscriptionToInput,
  afterInsert: () => nextTick(),
  sendAfterTranscription: () => handleSend(),
  notify: showInputPlaceholderNotice
})

const { voiceRecording, voiceTranscribing, voiceButtonTitle, toggleVoiceInput } = aiPanelVoiceRuntime

const canAcceptAiPanelDrop = (event: DragEvent) => canAcceptAiPanelRuntimeDrop(aiPanelMode.value, event.dataTransfer)

const handleDragEnter = (event: DragEvent) => {
  if (canAcceptAiPanelDrop(event)) {
    dropActive.value = true
  }
}

const handleDragOver = (event: DragEvent) => {
  if (!canAcceptAiPanelDrop(event)) return
  dropActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = aiPanelDropEffect(aiPanelMode.value)
}

const handleClassicDrop = async (event: DragEvent) => {
  const plan = planAiPanelDrop('classic', event.dataTransfer)
  if (plan.kind !== 'classic-knowledge') return
  await workspace.addKnowledgeFilesToChat([plan.relPath])
  if (!draft.value.trim()) setDraft(plan.draftText)
  requestAnimationFrame(moveEditableCaretToEnd)
  closePopups()
}

const handleCodexDrop = async (event: DragEvent) => {
  const plan = planAiPanelDrop('codex', event.dataTransfer)
  if (plan.kind === 'codex-terminal') {
    const panel = workspace.panels.find((item) => item.id === plan.panelId)
    if (panel?.sessionId) await bindCodexTarget(codexTargetContextFromPanel(panel), { reason: 'drop-terminal-tab' })
    return
  }
  if (plan.kind === 'codex-host') await bindHostContextToCodex(plan.context)
}

const handleDragLeave = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (!target || !related || !target.contains(related)) {
    dropActive.value = false
  }
}

const handleDrop = async (event: DragEvent) => {
  dropActive.value = false
  if (aiPanelMode.value === 'codex') {
    await handleCodexDrop(event)
    return
  }
  await handleClassicDrop(event)
}

const closePopups = (options: { restoreCommandFocus?: boolean; restoreContextFocus?: boolean } = {}) => {
  closeContextPopup({ restoreFocus: options.restoreContextFocus })
  closeCommandPopup({ restoreFocus: options.restoreCommandFocus })
  closeCodexTargetPicker()
  moreActionsMenuOpen.value = false
  modeMenuOpen.value = false
  panelModeMenuOpen.value = false
  closeModelMenu()
  closeHistoryMenu()
}

const handleSend = async () => {
  if (streaming.value) {
    await workspace.cancelStreamingAiChatResponse()
    return
  }
  if (showNoAvailableModelPrompt.value) {
    showInputPlaceholderNotice('请先配置可用模型。')
    return
  }
  const contentParts = extractEditableContentParts()
  const sent = await workspace.sendChat(draft.value, contentParts, undefined, {
    mode: chatMode.value === 'agent' || props.agentMode ? 'agent' : 'command'
  })
  if (!sent) return
  imageInputParts.value = []
  fileInputParts.value = []
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

const selectModel = async (modelId: string) => {
  const saved = await workspace.selectAiModel(modelId)
  if (saved) closeModelMenu()
}

const openModelSettings = () => {
  closePopups()
  workspace.setActiveModule('settings')
  workspace.setActiveSettingsSection('models')
}

const openModelLogin = () => {
  closePopups()
  void workspace.openUserLogin()
}

const handleModelKeydown = async (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeModelMenu()
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  const model = filteredModelOptions.value[0]
  if (model) await selectModel(model.id)
}

const resetDocsContextNavigation = () => {
  const next = resetAiPanelDocsNavigation()
  docsCurrentRelDir.value = next.currentRelDir
  docsDirStack.value = next.dirStack
  contextQuery.value = next.query
  contextKeyboardIndex.value = next.keyboardIndex
}

const focusContextSearchInput = () => {
  void nextTick(() => {
    if (contextPopupOpen.value) contextSearchInputRef.value?.focus()
  })
}

const enterDocsDir = (context: AiContextOption) => {
  const next = enterAiPanelDocsDir({ currentRelDir: docsCurrentRelDir.value, dirStack: docsDirStack.value }, context)
  if (!next) return
  docsCurrentRelDir.value = next.currentRelDir
  docsDirStack.value = next.dirStack
  contextQuery.value = next.query
  contextKeyboardIndex.value = next.keyboardIndex
  focusContextSearchInput()
}

const goBackDocsDir = () => {
  const next = backAiPanelDocsDir({ dirStack: docsDirStack.value })
  if (!next) return false
  docsCurrentRelDir.value = next.currentRelDir
  docsDirStack.value = next.dirStack
  contextQuery.value = next.query
  contextKeyboardIndex.value = next.keyboardIndex
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

const openContextCategory = async (category: AiContextKind) => {
  contextLevel.value = category
  contextQuery.value = ''
  contextKeyboardIndex.value = -1
  if (category === 'docs') resetDocsContextNavigation()
  focusContextSearchInput()
  await workspace.refreshAiContextCatalog({ hydrateSelection: false })
  focusContextSearchInput()
}

const isContextSelected = (context: AiContextOption) => workspace.selectedContexts.some((item) => item.id === context.id)

const buildSelectedHostContextsFromVisible = (currentHosts: AiContextOption[]) =>
  selectedAiPanelVisibleHostContexts(currentHosts, visibleHostContextOptions.value, maxHostContexts)

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
  workspace.selectedContexts = clearAiPanelHostContexts(workspace.selectedContexts)
  renderEditableFromState()
  requestAnimationFrame(moveEditableCaretToEnd)
}

const isEditHostContextSelected = (context: AiContextOption) =>
  context.kind === 'hosts' && editHostContexts.value.some((item) => item.id === context.id)

const isContextSelectedForPopup = (context: AiContextOption) =>
  contextTarget.value === 'edit' ? isEditHostContextSelected(context) : isContextSelected(context)

const applyHostContextToEdit = (context: AiContextOption) => {
  removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, '@', handleEditEditableInput)
  const plan = planAiPanelContextApply({
    target: 'edit',
    context,
    mainContexts: workspace.selectedContexts,
    editHostContexts: editHostContexts.value,
    maxHostContexts
  })
  if (plan.kind === 'edit-host') editHostContexts.value = plan.nextHosts
  closeContextPopup({ restoreFocus: true })
}

const applyContext = (context: AiContextOption) => {
  const plan = planAiPanelContextApply({
    target: contextTarget.value,
    context,
    mainContexts: workspace.selectedContexts,
    editHostContexts: editHostContexts.value,
    maxHostContexts
  })
  if (plan.kind === 'enter-docs-dir') {
    enterDocsDir(context)
    return
  }

  if (plan.kind === 'edit-host') {
    removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, '@', handleEditEditableInput)
    editHostContexts.value = plan.nextHosts
    closeContextPopup({ restoreFocus: true })
    return
  }
  if (plan.kind === 'edit-insert') {
    insertContextAtEditCursor(plan.context)
    closeContextPopup({ restoreFocus: true })
    return
  }

  if (plan.kind === 'main-host') {
    removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
    workspace.selectedContexts = plan.nextContexts
    renderEditableFromState()
  } else if (plan.kind === 'main-insert') {
    removeTokenFromEditableCursor(editableRef.value, savedRange, '@', handleEditableInput)
    workspace.selectedContexts = plan.nextContexts
    closeContextPopup({ restoreFocus: true })
    renderEditableFromState()
  }
  requestAnimationFrame(moveEditableCaretToEnd)
}

const applyCommand = (preset: AiCommandOption) => {
  const editCommandTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
  const plan = planAiPanelCommandApply({
    target: commandTarget.value,
    editingMessageId: editingMessageId.value,
    hasEditTarget: Boolean(editCommandTarget),
    command: preset,
    draft: draft.value
  })
  if (plan.kind === 'edit-command') {
    restoreEditSelection()
    insertChipIntoEditableCursor(
      editCommandTarget,
      {
        type: 'chip',
        chipType: 'command',
        ref: {
          command: plan.command.command,
          label: plan.command.label,
          path: plan.command.path
        }
      },
      handleEditEditableInput
    )
    closeCommandPopup({ restoreFocus: true })
    return
  }

  workspace.selectCommandPreset(plan.id, plan.commandRef)
  closeCommandPopup()
  setDraft(plan.nextDraft)
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
      const hasInsertedSlashToken = shouldTriggerCommandPopupFromEditableText()
      if (!shouldOpenAfterKey && getCharBeforeCaret(editableRef.value, savedRange.value) !== '/' && !hasInsertedSlashToken) return
      if (!shouldOpenAfterKey && !shouldTriggerCommandPopupForSlash(editableRef.value, savedRange.value) && !hasInsertedSlashToken) return
      void openCommandPopupForTarget('main')
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
    contextKeyboardIndex.value = nextAiPanelPopupKeyboardIndex(contextKeyboardIndex.value, listLength, 'down', {
      mainLevel: contextLevel.value === 'main'
    })
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    contextKeyboardIndex.value = nextAiPanelPopupKeyboardIndex(contextKeyboardIndex.value, listLength, 'up', {
      mainLevel: contextLevel.value === 'main'
    })
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (contextLevel.value === 'main') {
      const selection = mainContextKeyboardSelection(contextKeyboardIndex.value, displayedOpenedHosts.value, visibleContextCategories.value)
      if (selection.kind === 'host') applyContext(selection.context)
      if (selection.kind === 'category') void openContextCategory(selection.category.id)
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
  if (aiPanelMode.value === 'codex') {
    if (event.key === 'Escape') closePopups()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    event.stopPropagation()
    void openChatSearch()
    return
  }
  if (event.key !== 'Escape') return
  if (chatSearchOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeChatSearch()
    return
  }
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
    commandKeyboardIndex.value = nextAiPanelPopupKeyboardIndex(commandKeyboardIndex.value, list.length, 'down')
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    commandKeyboardIndex.value = nextAiPanelPopupKeyboardIndex(commandKeyboardIndex.value, list.length, 'up')
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

watch(chatSearchTerm, () => {
  if (!chatSearchOpen.value) return
  scheduleChatSearch()
})

watch([historySearchTerm, historyFavoritesOnly], () => {
  historyCurrentPage.value = 1
  editingHistoryId.value = null
  editingHistoryTitle.value = ''
})

watch(
  [() => workspace.selectedConversationId, () => workspace.conversations.map((conversation) => conversation.id).join('|')],
  ([selectedConversationId]) => {
    pruneConversationTabs()
    ensureConversationTab(selectedConversationId)
  },
  { immediate: true }
)

watch(
  () =>
    workspace.chatMessages
      .map((message) =>
        [
          message.id,
          message.text,
          message.state || '',
          message.ask || '',
          message.say || '',
          message.action || '',
          message.executedCommand || '',
          message.commandExecutionStatus || '',
          message.commandExecutionMessage || '',
          message.contentParts?.length || 0
        ].join(':')
      )
      .join('|'),
  async () => {
    if (!chatSearchOpen.value || !chatSearchTerm.value.trim()) {
      scheduleChatScrollToBottom()
      return
    }
    await nextTick()
    runChatSearch()
  },
  { immediate: true }
)

watch(
  () => {
    const conversation = activeCodexConversation.value
    const target = conversation ? currentBoundCodexTarget(conversation) || conversation.boundTarget : null
    return target ? `${conversation?.id || ''}:${codexTargetSignature(target)}` : ''
  },
  () => {
    if (aiPanelMode.value !== 'codex') return
    void syncCodexTargetContext()
  }
)

watch(
  terminalSettingsSignature,
  () => {
    codexConversations.value.forEach((conversation) => applyCodexTerminalSettings(conversation))
  }
)

watch(
  () => workspace.aiAttentionFocusRequest.sequence,
  () => {
    const item = workspace.aiAttentionFocusRequest.item
    if (!item) return
    void focusAiAttentionItem(item)
  }
)

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
    () => `${workspace.selectedCommandRef?.command || ''}:${workspace.selectedCommandRef?.label || ''}:${workspace.selectedCommandRef?.path || ''}`,
    () => fileInputParts.value.map((part) => `${part.ref.absPath}:${part.ref.name || ''}`).join('|')
  ],
  () => {
    if (syncingFromEditable.value) return
    void nextTick(renderEditableFromState)
  },
  { immediate: true }
)

onMounted(() => {
  if (aiPanelMode.value === 'classic') void loadClassicChatData()
  if (aiPanelMode.value === 'codex') void startCodexSession()
})

onBeforeUnmount(() => {
  codexConversations.value.forEach((conversation) => {
    workspace.removeAiAttentionItem(codexAttentionId(conversation))
    void stopCodexSession(conversation)
    conversation.resizeObserver?.disconnect()
    conversation.terminal?.dispose()
  })
  disposeCodexSubscriptions()
  if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
  if (chatSearchTimer) window.clearTimeout(chatSearchTimer)
  if (chatExportNoticeTimer) window.clearTimeout(chatExportNoticeTimer)
  if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
  aiPanelVoiceRuntime.dispose()
  clearChatHighlights()
})

</script>
