<template>
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
</template>

<script setup lang="ts">
import AiPanelChatSearchBar from '@/components/ai/AiPanelChatSearchBar.vue'
import {
  BookOpen,
  Bot,
  Check,
  CheckCircle,
  CheckSquare,
  CircleHelp,
  Code2,
  Copy,
  LoaderCircle,
  Maximize2,
  Play,
  RefreshCw,
  Server,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

const {
  aiPanelMode,
  approveMcpResourceAccess,
  approveMcpToolCall,
  cancelMessageEdit,
  chatScrollRef,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandOutputLineCount,
  commandTextForMessage,
  confirmMessageEdit,
  copyCommandToClipboard,
  copyMessageToClipboard,
  copyRenderedTextToClipboard,
  editDraft,
  editFileInputParts,
  editHostContexts,
  editImageInputParts,
  editingMessageId,
  formatLineCount,
  formatMcpToolArguments,
  getChipLabel,
  handleEditEditableClick,
  handleEditEditableInput,
  handleEditEditableKeydown,
  handleEditEditablePaste,
  handleFileUpload,
  iconMarkupByChipType,
  isCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  openCommandAuditDialog,
  openEditContextPopup,
  openModelLogin,
  openModelSettings,
  rejectMcpResourceAccess,
  rejectMcpToolCall,
  rejectMessageCommand,
  removeEditHostContext,
  renderedMarkdownParts,
  retryAssistantMessage,
  runMessageCommand,
  setEditEditableRef,
  setMessageFeedback,
  showNoAvailableModelPrompt,
  summarizeMessageToKnowledge,
  summarizeMessageToSkill,
  t,
  toggleMessageFavorite,
  workspace
} = useAiPanelRuntimeContext()
</script>

<style scoped>
/* 长会话窗口化：视口外消息跳过渲染与布局开销；
   contain-intrinsic-size 记忆实际高度作屏外占位，保持滚动条与滚动到底部跟随行为 */
.message {
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}
</style>
