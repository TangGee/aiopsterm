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
        <h2>{{ agentMode ? 'Agents' : 'AI' }}</h2>
      </div>
      <div class="ai-header-actions">
        <button
          type="button"
          class="ai-header-icon-button"
          title="新建会话"
          data-testid="ai-new-chat"
          @click.stop="createNewAiConversation"
        >
          <Plus />
        </button>
        <div
          class="ai-history-menu-wrap"
          @click.stop
        >
          <button
            type="button"
            class="ai-header-icon-button"
            title="会话历史"
            data-testid="ai-history-open"
            @click.stop="toggleHistoryMenu"
          >
            <History />
          </button>
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
                  placeholder="搜索历史"
                  data-testid="ai-history-search-input"
                  @keydown.esc.prevent="closeHistoryMenu"
                />
                <button
                  v-if="historySearchTerm"
                  type="button"
                  title="清空搜索"
                  @click="clearHistorySearch"
                >
                  <X />
                </button>
              </label>
              <button
                type="button"
                class="ai-history-favorite-toggle"
                :class="{ active: historyFavoritesOnly }"
                title="只看收藏"
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
                          title="保存"
                          @click.stop="saveHistoryTitle(conversation.id)"
                        >
                          <Check />
                        </button>
                        <button
                          type="button"
                          title="取消"
                          @click.stop="cancelHistoryTitleEdit"
                        >
                          <X />
                        </button>
                      </template>
                      <template v-else>
                        <button
                          type="button"
                          title="收藏"
                          :class="{ active: conversation.favorite }"
                          @click.stop="toggleHistoryFavorite(conversation.id)"
                        >
                          <Star />
                        </button>
                        <button
                          type="button"
                          title="编辑标题"
                          @click.stop="editHistoryTitle(conversation.id)"
                        >
                          <Pencil />
                        </button>
                        <button
                          type="button"
                          title="删除历史"
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
                  {{ historyLoadingMore ? '加载中...' : '加载更多' }}
                </button>
              </template>
              <div
                v-else
                class="ai-history-empty"
              >
                暂无数据
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="ai-header-icon-button"
          title="搜索聊天"
          data-testid="ai-chat-search-open"
          @click.stop="openChatSearch"
        >
          <Search />
        </button>
        <button
          type="button"
          class="ai-header-icon-button"
          title="导出聊天"
          data-testid="ai-chat-export"
          @click.stop="exportCurrentChat"
        >
          <Download />
        </button>
      </div>
    </header>

    <div
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
            placeholder="搜索聊天"
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
            无匹配
          </span>
          <button
            v-if="chatSearchTerm"
            type="button"
            title="清空"
            @click="clearChatSearch"
          >
            <X />
          </button>
        </div>
        <div class="ai-chat-search-controls">
          <button
            type="button"
            title="上一个"
            :disabled="chatSearchMatchCount === 0"
            @click="findPreviousChatMatch"
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            title="下一个"
            :disabled="chatSearchMatchCount === 0"
            @click="findNextChatMatch"
          >
            <ChevronRight />
          </button>
          <button
            type="button"
            title="关闭"
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
            :class="{ 'is-empty': !editDraft.trim() && !editImageInputParts.length && !editFileInputParts.length && !editHostContexts.length }"
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
          class="message-command-actions"
        >
          <button
            type="button"
            class="secondary"
            data-testid="ai-message-command-copy"
            @click.stop="copyMessageToClipboard(message)"
          >
            <Copy />
            <span>复制</span>
          </button>
          <button
            type="button"
            class="primary"
            data-testid="ai-message-command-run"
            @click.stop="void runMessageCommand(message)"
          >
            <Play />
            <span>运行</span>
          </button>
        </div>
        <div
          v-if="message.executedCommand"
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
          <button
            type="button"
            title="编辑并重新发送"
            data-testid="ai-message-edit"
            @click.stop="startMessageEdit(message)"
          >
            <RefreshCw />
          </button>
        </div>
        <div
          v-if="message.role === 'assistant'"
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
        v-if="workspace.chatMessages.length === 0"
        class="ai-empty-chat"
        :class="{ 'no-model': showNoAvailableModelPrompt }"
      >
        <template v-if="showNoAvailableModelPrompt">
          <Bot />
          <strong>没有可用的模型</strong>
          <p>{{ workspace.billingSettings.skippedLogin ? '请登录使用提供的内置模型或配置可用模型' : '请配置可用模型' }}</p>
          <div class="ai-empty-actions">
            <button
              v-if="workspace.billingSettings.skippedLogin"
              type="button"
              class="primary"
              data-testid="ai-no-model-login"
              @click.stop="openModelLogin"
            >
              登录
            </button>
            <button
              type="button"
              class="primary"
              data-testid="ai-no-model-configure"
              data-onboarding-id="ai-model-settings-button"
              @click.stop="openModelSettings"
            >
              配置模型
            </button>
          </div>
        </template>
        <template v-else>
          <Bot />
          <span>{{ workspace.config.modelName }}</span>
        </template>
      </div>
    </div>

    <section
      v-if="showTodoInlineDisplay"
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

    <span
      v-if="chatExportNotice"
      class="ai-operation-notice"
      data-testid="ai-chat-export-notice"
    >
      {{ chatExportNotice }}
    </span>

    <form
      v-if="!showNoAvailableModelPrompt"
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

      <div
        ref="editableRef"
        class="chat-editable"
        :class="{ 'is-empty': !draft.trim() && !workspace.selectedContexts.length && !imageInputParts.length && !fileInputParts.length && !selectedCommand }"
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
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component, type ComponentPublicInstance } from 'vue'
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
  ChevronUp,
  Code2,
  Copy,
  Download,
  LoaderCircle,
  FileText,
  FolderGit2,
  Image,
  ListTodo,
  LockKeyhole,
  Mic,
  MinusSquare,
  Minus,
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
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import {
  isAiChatExportData,
  isChatAttachmentStageData,
  isChatImageAttachmentPrepareData,
  isVoiceTranscriptionData,
  malformedAiBackendResultMessage
} from '@/services/aiBackendGuards'
import { chatAttachmentPathSegments, normalizeChatAttachmentPath, normalizeChatAttachmentTaskId, parseChatAttachmentRef } from '@shared/chatAttachment'
import type {
  AiChatChipContentPart,
  AiChipContentPart,
  AiCommandChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  AiSkillChipContentPart,
  AiSupportedImageType,
  ChatMessage,
  ConversationItem
} from '@/stores/workspace'
import type { TodoItem } from '@/stores/workspace'
import type { AiChatExportMessage, AiChatHistoryHostContext, AiCommandCatalogOption, AiContextKind, AiContextOption, VoiceTranscriptionInput } from '@shared/preload'

defineProps<{ agentMode?: boolean }>()

const workspace = useWorkspaceStore()
type AiChatMode = 'agent' | 'cmd'
type AiContextCategoryView = {
  id: AiContextKind
  label: string
  icon: Component
  options: AiContextOption[]
}

const aiChatModeOptions: Array<{ id: AiChatMode; label: string; detail: string }> = [
  { id: 'agent', label: 'Agent', detail: '自动规划并等待确认' },
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
const todoExpanded = ref(true)
const chatMode = ref<AiChatMode>('agent')
const modeMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const modelQuery = ref('')
const dropActive = ref(false)
const syncingFromEditable = ref(false)
const inputPlaceholderNotice = ref('')
const voiceRecording = ref(false)
const voiceTranscribing = ref(false)
const voiceRecordingStartedAt = ref(0)
const voiceAutoSendAfterInput = ref(false)
const voiceMediaRecorder = ref<MediaRecorder | null>(null)
const voiceMediaStream = ref<MediaStream | null>(null)
const voiceAudioChunks = ref<Blob[]>([])
const voiceRecordingMimeType = ref('')
const chatSearchOpen = ref(false)
const chatSearchTerm = ref('')
const chatSearchMatchCount = ref(0)
const chatSearchCurrentIndex = ref(0)
const historyMenuOpen = ref(false)
const historySearchTerm = ref('')
const historyFavoritesOnly = ref(false)
const historyCurrentPage = ref(1)
const historyLoadingMore = ref(false)
const editingHistoryId = ref<string | null>(null)
const editingHistoryTitle = ref('')
const chatExportNotice = ref('')
let inputPlaceholderNoticeTimer: number | undefined
let chatSearchTimer: number | undefined
let chatExportNoticeTimer: number | undefined
let voiceRecordingLimitTimer: number | undefined
const historyPageSize = 20
const historyFavoriteLabel = '收藏'
const voiceRecordingLimitMs = 60_000
const voiceRecordingMinimumMs = 220
const voiceMaxAudioBytes = 50 * 1024 * 1024
const preferredVoiceMimeTypes = [
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/mp3',
  'audio/m4a',
  'audio/aac',
  'audio/wav'
]
const imagePartMediaTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const chatAttachmentFilters = [
  {
    name: 'Text',
    extensions: [
      'txt',
      'md',
      'js',
      'ts',
      'py',
      'java',
      'cpp',
      'c',
      'html',
      'css',
      'json',
      'xml',
      'yaml',
      'yml',
      'sql',
      'sh',
      'bat',
      'ps1',
      'log',
      'csv',
      'tsv'
    ]
  }
]
const maxHostContexts = 5
const todoMaxItems = 20
const todoShowSubtasks = true
const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))
const voiceButtonTitle = computed(() => {
  if (voiceRecording.value) return '停止语音录制'
  if (voiceTranscribing.value) return '语音转写中'
  return '开始语音输入'
})
const focusedTodo = computed(() => workspace.todoItems.find((todo) => todo.isFocused || todo.status === 'in_progress') || null)
const currentChatMode = computed(() => aiChatModeOptions.find((option) => option.id === chatMode.value) || aiChatModeOptions[0])
const focusedTodoId = computed(() => focusedTodo.value?.id || null)
const visibleTodos = computed(() => workspace.todoItems.slice(0, todoMaxItems))
const showTodoInlineDisplay = computed(() => Boolean(focusedTodo.value || workspace.todoProgress.total > 0))
const filteredHistoryConversations = computed(() => {
  const keyword = historySearchTerm.value.trim().toLowerCase()
  return workspace.sortedConversations.filter((conversation) => {
    const matchesSearch = !keyword || conversation.title.toLowerCase().includes(keyword)
    const matchesFavorite = !historyFavoritesOnly.value || conversation.favorite
    return matchesSearch && matchesFavorite
  })
})
const visibleHistoryConversations = computed(() => filteredHistoryConversations.value.slice(0, historyCurrentPage.value * historyPageSize))
const hasMoreHistoryConversations = computed(() => visibleHistoryConversations.value.length < filteredHistoryConversations.value.length)
const groupedVisibleHistory = computed(() => {
  const groups = new Map<string, ConversationItem[]>()
  visibleHistoryConversations.value.forEach((conversation) => {
    const label = historyFavoritesOnly.value ? historyFavoriteLabel : historyDateLabel(conversation.ts)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(conversation)
  })
  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    items: [...items].sort((first, second) => second.ts - first.ts)
  }))
})

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

const historyDateLabel = (timestamp: number) => {
  const date = new Date(timestamp || Date.now())
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.floor((startOfToday - startOfTarget) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const formatHistoryTime = (timestamp: number) => {
  const date = new Date(timestamp || Date.now())
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return historyDateLabel(timestamp)
}

type ChatSearchMatch = {
  element: HTMLElement
}

const chatSearchMarks: HTMLElement[] = []
const chatSearchMatches: ChatSearchMatch[] = []

const getCurrentConversationTitle = () =>
  workspace.conversations.find((conversation) => conversation.id === workspace.selectedConversationId)?.title || 'Chat Export'

const plainTextForPart = (part: AiContentPart) => {
  if (part.type === 'text') return part.text
  if (part.type === 'image') return `[image: ${part.name || part.mediaType}]`
  if (part.chipType === 'doc') return `@${part.ref.name || part.ref.relPath || part.ref.absPath}`
  if (part.chipType === 'chat') return `@${part.ref.title || part.ref.taskId}`
  if (part.chipType === 'command') return part.ref.label || part.ref.command
  return `@skill:${part.ref.skillName}`
}

const messagePlainText = (message: { text: string; contentParts?: AiContentPart[] }) =>
  message.contentParts?.length ? message.contentParts.map(plainTextForPart).join('') : message.text

const chatExportHosts = (message: Pick<ChatMessage, 'hosts'>): AiChatHistoryHostContext[] | undefined => {
  const hosts = message.hosts
    ?.filter((host) => host.kind === 'hosts' && host.label.trim())
    .map((host) => ({
      id: host.id,
      kind: 'hosts' as const,
      label: host.label,
      detail: host.detail
    }))
  return hosts?.length ? hosts : undefined
}

const chatExportMessage = (message: ChatMessage): AiChatExportMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  contentParts: message.contentParts,
  hosts: chatExportHosts(message),
  state: message.state,
  favorite: message.favorite,
  feedback: message.feedback,
  executedCommand: message.executedCommand,
  ask: message.ask,
  say: message.say,
  action: message.action,
  commandExecution: message.commandExecution,
  mcpToolCall: message.mcpToolCall,
  mcpResourceAccess: message.mcpResourceAccess,
  followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
  selectedOption: message.selectedOption,
  partial: message.partial
})

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

const isCommandSuggestionMessage = (message: { role: string; contentParts?: AiContentPart[]; text: string; state?: string; ask?: string; commandExecution?: { command: string } }) => {
  if (message.role !== 'assistant' || message.state === 'streaming') return false
  if (message.ask === 'command' && message.commandExecution?.command.trim()) return true
  return Boolean(message.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command') || message.text.trim().startsWith('/'))
}

const commandTextForMessage = (message: { text: string; contentParts?: AiContentPart[]; commandExecution?: { command: string } }) =>
  message.commandExecution?.command.trim() || messagePlainText(message).trim()

const runMessageCommand = async (message: { text: string; contentParts?: AiContentPart[]; commandExecution?: { command: string }; executedCommand?: string }) => {
  const command = commandTextForMessage(message)
  if (!command) {
    showChatExportNotice('没有可运行的命令。')
    return
  }
  const decision = await workspace.runActiveTerminalCommand(command, 'agent')
  if (decision?.status === 'needs-approval') {
    showChatExportNotice('命令已送入终端安全确认。')
    return
  }
  if (decision?.status === 'blocked') {
    showChatExportNotice('命令被安全策略拦截。')
    return
  }
  if (decision?.status === 'unavailable') {
    showChatExportNotice(decision.reason)
    return
  }
  message.executedCommand = command
  showChatExportNotice('命令已写入终端输入区。')
}

const formatMcpToolArguments = (message: Pick<ChatMessage, 'mcpToolCall'>) => {
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
  if (workspace.chatMessages.length === 0) {
    showChatExportNotice('当前会话为空，无法导出。')
    return
  }
  const exportChat = window.aiops?.exportChat
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
    showChatExportNotice('已新建会话。')
  } else {
    showChatExportNotice('新建会话失败。')
  }
}

const restoreHistoryConversation = async (id: string) => {
  if (editingHistoryId.value) return
  const restored = await workspace.restoreConversation(id)
  if (restored) {
    closeHistoryMenu()
    showChatExportNotice('已恢复历史会话。')
  } else {
    showChatExportNotice('历史会话恢复失败。')
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
  showChatExportNotice(saved ? '历史标题已更新。' : '历史标题未更新。')
}

const deleteHistoryConversation = async (id: string) => {
  const deleted = await workspace.deleteConversation(id)
  if (visibleHistoryConversations.value.length === 0 && historyCurrentPage.value > 1) {
    historyCurrentPage.value -= 1
  }
  showChatExportNotice(deleted ? '历史会话已删除。' : '历史会话删除失败。')
}

const toggleHistoryFavorite = async (id: string) => {
  const toggled = await workspace.toggleConversationFavorite(id)
  const conversation = workspace.conversations.find((item) => item.id === id)
  showChatExportNotice(toggled ? (conversation?.favorite ? '历史会话已收藏。' : '已取消历史收藏。') : '历史收藏更新失败。')
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
  chatSearchMarks.splice(0).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  })
  chatSearchMatches.splice(0)
  chatSearchMatchCount.value = 0
  chatSearchCurrentIndex.value = 0
}

const isSearchableChatTextNode = (node: Node) => {
  const parent = node.parentElement
  if (!parent) return false
  if (!node.textContent?.trim()) return false
  if (parent.closest('.ai-chat-search-bar')) return false
  if (parent.closest('.chat-input')) return false
  if (parent.closest('.user-message-edit-container')) return false
  if (parent.closest('button')) return false
  return Boolean(parent.closest('.message'))
}

const findChatTextRanges = (root: HTMLElement, term: string) => {
  const ranges: Range[] = []
  const lowerTerm = term.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isSearchableChatTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.data.toLowerCase()
    let offset = 0
    while (true) {
      const index = text.indexOf(lowerTerm, offset)
      if (index === -1) break
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + term.length)
      ranges.push(range)
      offset = index + 1
    }
    node = walker.nextNode() as Text | null
  }
  return ranges
}

const setActiveChatSearchMatch = (index: number) => {
  chatSearchMatches.forEach((match) => match.element.classList.remove('active'))
  const match = chatSearchMatches[index]
  if (!match) return
  match.element.classList.add('active')
  if (typeof match.element.scrollIntoView === 'function') {
    match.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

const runChatSearch = () => {
  const root = chatScrollRef.value
  clearChatHighlights()
  const term = chatSearchTerm.value.trim()
  if (!root || !term) return

  const ranges = findChatTextRanges(root, term)
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const mark = document.createElement('mark')
    mark.className = 'ai-chat-search-highlight'
    try {
      ranges[index].surroundContents(mark)
      chatSearchMarks.unshift(mark)
    } catch {
      // Ignore ranges that cannot be wrapped in the rendered DOM.
    }
  }
  chatSearchMarks.forEach((element) => chatSearchMatches.push({ element }))
  chatSearchMatchCount.value = chatSearchMatches.length
  if (chatSearchMatches.length > 0) {
    chatSearchCurrentIndex.value = 1
    setActiveChatSearchMatch(0)
  }
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
  if (chatSearchMatches.length === 0) return
  const nextIndex = chatSearchCurrentIndex.value >= chatSearchMatches.length ? 0 : chatSearchCurrentIndex.value
  chatSearchCurrentIndex.value = nextIndex + 1
  setActiveChatSearchMatch(nextIndex)
}

const findPreviousChatMatch = () => {
  if (chatSearchMatches.length === 0) return
  const previousIndex = chatSearchCurrentIndex.value <= 1 ? chatSearchMatches.length - 1 : chatSearchCurrentIndex.value - 2
  chatSearchCurrentIndex.value = previousIndex + 1
  setActiveChatSearchMatch(previousIndex)
}

type AiCommandOption = AiCommandCatalogOption

const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
  editEditableRef.value = el instanceof HTMLElement ? el : null
}

const aiContextCategories = computed<AiContextCategoryView[]>(() =>
  workspace.aiContextCatalog.categories.map((category) => ({
    ...category,
    icon: aiContextCategoryIcons[category.id] || Search,
    options: category.options.map((option) => ({ ...option }))
  }))
)
const selectedContextCategory = computed(() => aiContextCategories.value.find((category) => category.id === contextLevel.value))
const docsContextOptions = computed<AiContextOption[]>(() =>
  (selectedContextCategory.value?.options || [])
    .filter((option) => option.parentRelPath === docsCurrentRelDir.value)
    .map((option) => ({ ...option }))
    .sort((first, second) => {
      if (first.contextType !== second.contextType) return first.contextType === 'dir' ? -1 : 1
      return first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
)
const commandOptions = computed<AiCommandOption[]>(() => workspace.aiCommandOptions.map((command) => ({ ...command })))
const displayedOpenedHosts = computed(() => {
  if (chatMode.value !== 'agent') return []
  const keyword = contextQuery.value.trim().toLowerCase()
  return workspace.aiContextCatalog.openedHosts
    .filter((host) => !keyword || `${host.label} ${host.detail || ''}`.toLowerCase().includes(keyword))
    .slice(0, 4)
})
const visibleContextCategories = computed(() => aiContextCategories.value.filter((category) => category.id !== 'hosts' || chatMode.value === 'agent'))
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
  const hasRemoteHost = hosts.some((host) => !isLocalhostContext(host))
  const selectableHosts = hasRemoteHost ? hosts.filter((host) => !isLocalhostContext(host)) : hosts
  return selectableHosts.length > 0 && selectableHosts.every((host) => hostContextsForPopup.value.some((context) => context.id === host.id))
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

const stripThinkingSuffix = (modelName: string) => modelName.replace(/-Thinking$/, '')
const displayModelName = (model: { id?: string; label?: string; displayName?: string } | string) =>
  typeof model === 'string' ? stripThinkingSuffix(model) : model.displayName || stripThinkingSuffix(model.label || model.id || '')
const isThinkingModelName = (modelName: string) => modelName.endsWith('-Thinking')
const lockedModelTooltip = (tier: string) => `模型已锁定，升级 ${tier} 后可用`
const selectedModelLabel = computed(() => {
  const model = workspace.aiModelOptions.find((option) => option.id === workspace.config.modelName)
  return model ? displayModelName(model) : displayModelName(workspace.config.modelName)
})
const matchesModelQuery = (model: { id: string; label: string; detail?: string; tier?: string; displayName?: string }) => {
  const keyword = modelQuery.value.trim().toLowerCase()
  if (!keyword) return true
  return `${model.id} ${model.label} ${displayModelName(model)} ${model.detail || ''} ${model.tier || ''}`.toLowerCase().includes(keyword)
}
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

const contextUsage = computed(() => {
  return workspace.aiContextUsage || { used: 0, contextWindow: 0, percent: 0 }
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
  if (!editable) return false
  editable.focus()

  const appendImageAtEnd = () => {
    const imageElement = createImageElement(part)
    editable.appendChild(imageElement)
    editable.appendChild(document.createTextNode(' '))
    onInserted()
    return true
  }

  const selection = window.getSelection()
  if (!selection) {
    appendImageAtEnd()
    return true
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
    return true
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
  return true
}

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

const clipboardHasImage = (event: ClipboardEvent) => Array.from(event.clipboardData?.items || []).some((item) => item.type.startsWith('image/'))

const preparePastedImagePart = async (): Promise<AiImageContentPart | null> => {
  const prepareClipboardImage = window.aiops?.prepareChatImageAttachmentFromClipboard
  if (typeof prepareClipboardImage !== 'function') {
    showInputPlaceholderNotice('图片上传失败：剪贴板图片服务不可用')
    return null
  }
  try {
    const result = await prepareClipboardImage()
    if (!result?.ok) {
      showInputPlaceholderNotice(`图片上传失败：${result?.errorMessage || result?.errorCode || '图片处理失败'}`)
      return null
    }
    if (!isChatImageAttachmentPrepareData(result.data)) {
      showInputPlaceholderNotice(`图片上传失败：${malformedAiBackendResultMessage}`)
      return null
    }
    return {
      type: 'image',
      mediaType: result.data.mediaType,
      data: result.data.data,
      name: result.data.name
    }
  } catch (error) {
    showInputPlaceholderNotice(`图片上传失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const insertPastedImageIntoEdit = async () => {
  const part = await preparePastedImagePart()
  if (part) insertImageAtEditCursor(part)
}

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
  if (!editable) return false
  editable.focus()

  const insertAtEnd = () => {
    if (editable.lastChild) editable.appendChild(document.createTextNode(' '))
    const chip = createChipElement(part, { removablePart: true })
    editable.appendChild(chip)
    editable.appendChild(document.createTextNode(' '))
    onInserted()
    return true
  }

  const selection = window.getSelection()
  if (!selection) {
    return insertAtEnd()
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
    return insertAtEnd()
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
  return true
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
  if (draft.value) {
    editable.appendChild(document.createTextNode(draft.value))
  }
  imageInputParts.value.forEach((part) => {
    editable.appendChild(document.createTextNode(' '))
    editable.appendChild(createImageElement(part))
    editable.appendChild(document.createTextNode(' '))
  })
  fileInputParts.value.forEach((part) => {
    editable.appendChild(document.createTextNode(' '))
    editable.appendChild(createChipElement(part, { removablePart: true }))
    editable.appendChild(document.createTextNode(' '))
  })
  if (selectedCommandRef.value) {
    editable.appendChild(document.createTextNode(' '))
    const commandChip = createCommandChipElement()
    if (commandChip) editable.appendChild(commandChip)
    editable.appendChild(document.createTextNode(' '))
  }
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
  editFileInputParts.value = parts.filter((part): part is AiDocChipContentPart => part.type === 'chip' && part.chipType === 'doc')
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
  editImageInputParts.value = extractContentPartsFromEditable(editEditableRef.value).filter(
    (part): part is AiImageContentPart => part.type === 'image'
  )
  editFileInputParts.value = extractContentPartsFromEditable(editEditableRef.value).filter(
    (part): part is AiDocChipContentPart => part.type === 'chip' && part.chipType === 'doc'
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
  const hasSendableContent = contentParts.some((part) => part.type !== 'text' || part.text.trim())
  if (!hasSendableContent) return
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
  const editable = editableRef.value
  if (!editable) return
  const commandPresent = Boolean(editable.querySelector('.mention-chip[data-command-chip]'))
  const domFileParts = Array.from(editable.querySelectorAll<HTMLElement>('.mention-chip[data-chip-type="doc"]:not([data-context-id])'))
    .map(chipPartFromChipElement)
    .filter((part): part is AiDocChipContentPart => Boolean(part && part.chipType === 'doc'))
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

  if (!commandPresent && workspace.selectedCommandId) {
    workspace.selectCommandPreset(null)
  }
  fileInputParts.value = domFileParts
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
  if (clipboardHasImage(event)) {
    event.preventDefault()
    void insertPastedImage()
    return
  }

  event.preventDefault()
  insertPlainTextAtEditableCursor(event.clipboardData?.getData('text/plain') || '')
}

const imagePickerFilters = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]

const processImageFilePath = async (filePath: string): Promise<AiImageContentPart | null> => {
  const prepareImageFromFile = window.aiops?.prepareChatImageAttachmentFromFile
  if (typeof prepareImageFromFile !== 'function') {
    showInputPlaceholderNotice('图片上传失败：图片读取服务不可用')
    return null
  }
  try {
    const result = await prepareImageFromFile({ filePath })
    if (!result?.ok) {
      showInputPlaceholderNotice(`图片上传失败：${result?.errorMessage || result?.errorCode || '图片处理失败'}`)
      return null
    }
    if (!isChatImageAttachmentPrepareData(result.data)) {
      showInputPlaceholderNotice(`图片上传失败：${malformedAiBackendResultMessage}`)
      return null
    }
    return {
      type: 'image',
      mediaType: result.data.mediaType,
      data: result.data.data,
      name: result.data.name
    }
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
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
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

const isStagedAttachmentForRequest = (staged: unknown, taskId: string, srcAbsPath: string) => {
  if (!isChatAttachmentStageData(staged)) return false
  const expectedTaskId = normalizeChatAttachmentTaskId(taskId)
  const expectedSource = normalizeChatAttachmentPath(srcAbsPath)
  if (staged.taskId !== expectedTaskId || normalizeChatAttachmentPath(staged.srcAbsPath) !== expectedSource) return false
  if (staged.name === '.' || staged.name === '..' || staged.name.includes('/') || staged.name.includes('\\')) return false
  const ref = parseChatAttachmentRef(staged.refPath)
  if (!ref || ref.taskId !== expectedTaskId || ref.name !== staged.name) return false
  const stagedParts = chatAttachmentPathSegments(staged.stagedPath)
  return stagedParts.at(-3) === 'chat-attachments' && stagedParts.at(-2) === expectedTaskId && stagedParts.at(-1) === staged.name
}

const handleFileUpload = async () => {
  if (streaming.value) return
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
    showInputPlaceholderNotice('文件上传失败：文件选择服务不可用')
    return
  }
  const stageAttachment = window.aiops?.stageChatAttachment
  if (typeof stageAttachment !== 'function') {
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
    if (!isStagedAttachmentForRequest(staged, taskId, srcAbsPath)) {
      throw new Error(malformedAiBackendResultMessage)
    }
    const displayName = staged.name || srcAbsPath.split(/[/\\]/).pop() || 'file'
    const part: AiDocChipContentPart = {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath: staged.refPath,
        relPath: staged.refPath,
        name: displayName,
        type: 'file'
      }
    }
    const inserted = editingMessageId.value ? insertFileChipAtEditCursor(part) : insertFileChipAtMainCursor(part)
    if (!inserted) {
      throw new Error('文件输入框不可用')
    }
    showInputPlaceholderNotice(`已添加文件：${displayName}`)
  } catch (error) {
    showInputPlaceholderNotice(`文件上传失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const clearVoiceTimers = () => {
  if (voiceRecordingLimitTimer) {
    window.clearTimeout(voiceRecordingLimitTimer)
    voiceRecordingLimitTimer = undefined
  }
}

const clearVoiceMedia = () => {
  const recorder = voiceMediaRecorder.value
  if (recorder) {
    recorder.ondataavailable = null
    recorder.onerror = null
    recorder.onstop = null
  }
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop()
    } catch {
      // Recorder can already be inactive while the stop event is queued.
    }
  }
  voiceMediaRecorder.value = null
  voiceMediaStream.value?.getTracks().forEach((track) => track.stop())
  voiceMediaStream.value = null
  voiceAudioChunks.value = []
  voiceRecordingMimeType.value = ''
}

const bestVoiceMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return ''
  return preferredVoiceMimeTypes.find((format) => MediaRecorder.isTypeSupported(format)) || ''
}

const canUseBrowserVoiceRecorder = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

const appendVoiceTranscriptionToInput = (text: string) => {
  restoreEditableSelection()
  const prefix = draft.value.trim() && !/\s$/.test(draft.value) ? ' ' : ''
  insertPlainTextAtEditableCursor(`${prefix}${text}`)
  requestAnimationFrame(moveEditableCaretToEnd)
}

const handleVoiceTranscriptionComplete = async (text: string) => {
  const normalized = text.trim()
  if (!normalized) {
    showInputPlaceholderNotice('语音识别结果为空。')
    return
  }
  appendVoiceTranscriptionToInput(normalized)
  showInputPlaceholderNotice(`语音转写完成：${normalized}`)
  if (voiceAutoSendAfterInput.value) {
    await nextTick()
    handleSend()
  }
}

const transcribeVoiceInput = async (input: VoiceTranscriptionInput) => {
  const transcribeVoice = window.aiops?.transcribeVoiceInput
  if (typeof transcribeVoice !== 'function') {
    showInputPlaceholderNotice('语音识别失败：语音识别服务不可用')
    return
  }
  voiceTranscribing.value = true
  try {
    const result = await transcribeVoice(input)
    if (!result?.ok) {
      showInputPlaceholderNotice(`语音识别失败：${result?.errorMessage || result?.errorCode || '识别结果为空'}`)
      return
    }
    if (!isVoiceTranscriptionData(result.data)) {
      showInputPlaceholderNotice(`语音识别失败：${malformedAiBackendResultMessage}`)
      return
    }
    await handleVoiceTranscriptionComplete(result.data.text)
  } catch (error) {
    showInputPlaceholderNotice(`语音识别失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    voiceTranscribing.value = false
  }
}

const processVoiceRecording = async (elapsed: number, options: { reachedLimit?: boolean; audioBlob?: Blob } = {}) => {
  if (!options.audioBlob) {
    showInputPlaceholderNotice('未获取到录音音频，无法进行语音识别。')
    return
  }
  if (!options.reachedLimit && elapsed < voiceRecordingMinimumMs) {
    showInputPlaceholderNotice('录制时间过短，请录制更长的语音内容。')
    return
  }
  if (options.audioBlob.size < 1024) {
    showInputPlaceholderNotice('录制时间过短，请录制更长的语音内容。')
    return
  }
  if (options.audioBlob.size > voiceMaxAudioBytes) {
    showInputPlaceholderNotice('音频文件超过 50 MiB，无法识别。')
    return
  }
  let audioBytes: ArrayBuffer
  try {
    audioBytes = await options.audioBlob.arrayBuffer()
  } catch (error) {
    showInputPlaceholderNotice(`语音识别失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const transcriptionInput: VoiceTranscriptionInput = {
    durationMs: elapsed,
    source: 'browser',
    audioBytes,
    audioFormat: options.audioBlob.type,
    audioSize: options.audioBlob.size
  }
  await transcribeVoiceInput(transcriptionInput)
}

const scheduleVoiceRecordingLimit = () => {
  voiceRecordingStartedAt.value = Date.now()
  voiceRecording.value = true
  voiceRecordingLimitTimer = window.setTimeout(() => {
    if (!voiceRecording.value) return
    showInputPlaceholderNotice('录制时间到达上限，已自动停止录制。')
    void finishVoiceRecording({ reachedLimit: true })
  }, voiceRecordingLimitMs)
}

const startBrowserVoiceRecorder = async () => {
  if (!canUseBrowserVoiceRecorder()) {
    throw new Error('Browser voice recording is unavailable.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 16000
    }
  })
  const mimeType = bestVoiceMimeType()
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128000
  })

  voiceMediaStream.value = stream
  voiceMediaRecorder.value = recorder
  voiceRecordingMimeType.value = mimeType
  voiceAudioChunks.value = []

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) voiceAudioChunks.value.push(event.data)
  }
  recorder.onerror = () => {
    voiceRecording.value = false
    clearVoiceTimers()
    clearVoiceMedia()
    showInputPlaceholderNotice('语音录制失败。')
  }
  recorder.onstop = () => {
    const elapsed = Date.now() - voiceRecordingStartedAt.value
    const audioBlob = new Blob(voiceAudioChunks.value, { type: voiceRecordingMimeType.value || 'audio/webm' })
    clearVoiceMedia()
    void processVoiceRecording(elapsed, { audioBlob })
  }
  recorder.start(100)
  scheduleVoiceRecordingLimit()
}

const startVoiceRecording = async () => {
  if (streaming.value || voiceRecording.value || voiceTranscribing.value) return
  closePopups()
  restoreEditableSelection()
  try {
    await startBrowserVoiceRecorder()
  } catch (error) {
    let message = '麦克风不可用，无法开始语音输入。'
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') message = '麦克风权限被拒绝，请允许麦克风访问后重试。'
      else if (error.name === 'NotFoundError') message = '未找到麦克风设备，无法开始语音输入。'
      else if (error.name === 'NotReadableError') message = '麦克风正被其他应用占用，无法开始语音输入。'
    }
    showInputPlaceholderNotice(message)
    clearVoiceMedia()
  }
}

const finishVoiceRecording = async (options: { reachedLimit?: boolean } = {}) => {
  if (!voiceRecording.value) return
  const elapsed = Date.now() - voiceRecordingStartedAt.value
  voiceRecording.value = false
  if (voiceRecordingLimitTimer) {
    window.clearTimeout(voiceRecordingLimitTimer)
    voiceRecordingLimitTimer = undefined
  }
  const recorder = voiceMediaRecorder.value
  if (recorder) {
    if (recorder.state !== 'inactive') recorder.stop()
    return
  }
  await processVoiceRecording(elapsed, options)
}

const toggleVoiceInput = () => {
  if (streaming.value || voiceTranscribing.value) return
  if (voiceRecording.value) {
    void finishVoiceRecording()
    return
  }
  void startVoiceRecording()
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
  const sent = await workspace.sendChat(draft.value, contentParts)
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
        if (category) void openContextCategory(category.id)
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
  () => workspace.chatMessages.map((message) => `${message.id}:${message.text}:${message.state || ''}`).join('|'),
  async () => {
    if (!chatSearchOpen.value || !chatSearchTerm.value.trim()) return
    await nextTick()
    runChatSearch()
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
  void workspace.refreshAiModelCatalog({ replaceSettingsOptions: false })
  void workspace.refreshAiContextCatalog({ hydrateSelection: true })
  void workspace.refreshAiCommandCatalog()
})

onBeforeUnmount(() => {
  if (chatSearchTimer) window.clearTimeout(chatSearchTimer)
  if (chatExportNoticeTimer) window.clearTimeout(chatExportNoticeTimer)
  if (inputPlaceholderNoticeTimer) window.clearTimeout(inputPlaceholderNoticeTimer)
  clearVoiceTimers()
  clearVoiceMedia()
  clearChatHighlights()
})

</script>
