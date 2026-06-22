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
      <AiPanelHeader />
    </div>

    <AiPanelCodexShell />

    <div
      v-show="aiPanelMode === 'classic'"
      ref="chatScrollRef"
      class="chat-scroll"
    >
      <AiPanelChatSearchBar />
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

    <AiPanelCommandAuditDialog />
  </aside>
</template>

<script setup lang="ts">
import AiPanelChatSearchBar from '@/components/ai/AiPanelChatSearchBar.vue'
import AiPanelCodexShell from '@/components/ai/AiPanelCodexShell.vue'
import AiPanelCommandAuditDialog from '@/components/ai/AiPanelCommandAuditDialog.vue'
import AiPanelHeader from '@/components/ai/AiPanelHeader.vue'
import {
  BookOpen,
  Bot,
  Brain,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FileText,
  FolderGit2,
  Image,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Mic,
  MinusSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Square,
  Star,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/aiPanelContext'

const {
  agentMode,
  aiChatModeOptions,
  aiPanelComposerRuntime,
  aiPanelMode,
  allVisibleHostContextsSelected,
  applyCommand,
  applyContext,
  approveMcpResourceAccess,
  approveMcpToolCall,
  bindCodexTarget,
  bindHostContextToCodex,
  cancelHistoryTitleEdit,
  cancelMessageEdit,
  chatExportNotice,
  chatMode,
  chatScrollRef,
  clearHistorySearch,
  clearHostContexts,
  closeCodexConversation,
  closeConversationTab,
  closeHistoryMenu,
  closePopups,
  codexConversations,
  codexConversationTitle,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandKeyboardIndex,
  commandLineCountForMessage,
  commandOutputLineCount,
  commandPopupOpen,
  commandQuery,
  commandSearchInputRef,
  commandTarget,
  commandTextForMessage,
  composerIsEmpty,
  confirmMessageEdit,
  contextKeyboardIndex,
  contextLevel,
  contextPopupOpen,
  contextQuery,
  contextSearchInputRef,
  contextUsage,
  contextUsageColor,
  contextUsageTooltip,
  contextUsageTrackColor,
  conversationTabTooltip,
  copyCommandToClipboard,
  copyMessageToClipboard,
  copyRenderedTextToClipboard,
  createNewAiConversation,
  createNewCodexConversation,
  currentAiPanelModeLabel,
  currentChatMode,
  deleteHistoryConversation,
  displayConversationTitle,
  displayedOpenedHosts,
  displayModelName,
  dropActive,
  editableRef,
  editDraft,
  editFileInputParts,
  editHistoryTitle,
  editHostContexts,
  editImageInputParts,
  editingHistoryId,
  editingHistoryTitle,
  editingMessageId,
  exportCurrentChat,
  filteredCommands,
  filteredContextOptions,
  filteredLockedModelOptions,
  filteredModelOptions,
  formatHistoryTime,
  formatLineCount,
  formatMcpToolArguments,
  getChipLabel,
  groupedVisibleHistory,
  handleCommandKeydown,
  handleContextKeydown,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleEditableKeydown,
  handleEditEditableClick,
  handleEditEditableInput,
  handleEditEditableKeydown,
  handleEditEditablePaste,
  handleFileUpload,
  handleModelKeydown,
  handlePanelKeydown,
  handleSend,
  hasMoreHistoryConversations,
  historyFavoriteLabel,
  historyFavoritesOnly,
  historyLoadingMore,
  historyMenuOpen,
  historySearchInputRef,
  historySearchTerm,
  hostContextsForPopup,
  iconMarkupByChipType,
  inputPlaceholderNotice,
  isCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isContextSelectedForPopup,
  isReadOnlyCommandMessage,
  isThinkingModelName,
  loadMoreHistoryConversations,
  lockedModelTooltip,
  modelDropdownWidthPx,
  modelMenuOpen,
  modelQuery,
  modelSearchInputRef,
  modeDropdownWidthPx,
  modeMenuOpen,
  moreActionsMenuOpen,
  normalizedCommandOutputText,
  openChatSearch,
  openCommandAuditDialog,
  openContextCategory,
  openEditContextPopup,
  openImagePicker,
  openModelLogin,
  openModelSettings,
  panelModeMenuOpen,
  rejectMcpResourceAccess,
  rejectMcpToolCall,
  rejectMessageCommand,
  removeEditHostContext,
  renderedMarkdownParts,
  restartCodexSession,
  restoreConversationFromTab,
  restoreHistoryConversation,
  retryAssistantMessage,
  returnContextPopupToMain,
  runMessageCommand,
  saveEditableSelection,
  saveHistoryTitle,
  selectAiPanelMode,
  selectAllVisibleHostContexts,
  selectChatMode,
  selectCodexConversation,
  selectedCommandRef,
  selectedModelLabel,
  selectModel,
  setEditEditableRef,
  setMessageFeedback,
  showNoAvailableModelPrompt,
  streaming,
  summarizeMessageToKnowledge,
  summarizeMessageToSkill,
  t,
  toggleAiPanelModeMenu,
  toggleContextPopup,
  toggleHistoryFavorite,
  toggleHistoryMenu,
  toggleMessageFavorite,
  toggleModelMenu,
  toggleModeMenu,
  toggleMoreActionsMenu,
  toggleVoiceInput,
  visibleContextCategories,
  visibleConversationTabs,
  voiceButtonTitle,
  voiceRecording,
  voiceTranscribing,
  workspace,
} = useAiPanelRuntimeContext()
</script>
