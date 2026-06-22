<template>
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
</template>

<script setup lang="ts">
import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Download,
  Ellipsis,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/aiPanelContext'

const {
  activeCodexConversationId,
  agentMode,
  aiPanelMode,
  cancelHistoryTitleEdit,
  clearHistorySearch,
  closeCodexConversation,
  closeConversationTab,
  closeHistoryMenu,
  codexConversations,
  codexConversationTitle,
  conversationTabTooltip,
  createNewAiConversation,
  createNewCodexConversation,
  currentAiPanelModeLabel,
  deleteHistoryConversation,
  displayConversationTitle,
  editHistoryTitle,
  editingHistoryId,
  editingHistoryTitle,
  exportCurrentChat,
  formatHistoryTime,
  groupedVisibleHistory,
  hasMoreHistoryConversations,
  historyFavoriteLabel,
  historyFavoritesOnly,
  historyLoadingMore,
  historyMenuOpen,
  historySearchInputRef,
  historySearchTerm,
  loadMoreHistoryConversations,
  moreActionsMenuOpen,
  openChatSearch,
  panelModeMenuOpen,
  restartCodexSession,
  restoreConversationFromTab,
  restoreHistoryConversation,
  saveHistoryTitle,
  selectAiPanelMode,
  selectCodexConversation,
  t,
  toggleAiPanelModeMenu,
  toggleHistoryFavorite,
  toggleHistoryMenu,
  toggleMoreActionsMenu,
  visibleConversationTabs,
  workspace
} = useAiPanelRuntimeContext()
</script>
