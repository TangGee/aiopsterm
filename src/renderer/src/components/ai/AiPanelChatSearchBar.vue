<template>
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
</template>

<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/aiPanelContext'

const {
  chatSearchCurrentIndex,
  chatSearchInputRef,
  chatSearchMatchCount,
  chatSearchOpen,
  chatSearchTerm,
  clearChatSearch,
  closeChatSearch,
  findNextChatMatch,
  findPreviousChatMatch,
  t
} = useAiPanelRuntimeContext()
</script>
