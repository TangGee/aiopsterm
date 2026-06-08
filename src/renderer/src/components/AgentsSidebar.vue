<template>
  <aside class="agents-sidebar">
    <header class="agents-workspace-header">
      <div class="agents-search">
        <Search />
        <input
          v-model="query"
          placeholder="搜索会话"
          @keydown.esc.prevent="clearSearch"
        />
        <button
          v-if="query"
          class="agents-search-clear"
          title="清空搜索"
          type="button"
          @click="clearSearch"
        >
          <X />
        </button>
      </div>
      <button
        class="new-chat-btn"
        title="新建会话"
        @click="handleNewChat"
      >
        <Plus />
        <span>New Chat</span>
      </button>
    </header>

    <div class="agents-workspace-content">
      <div
        v-if="visibleConversations.length === 0"
        class="empty-state"
      >
        <span class="empty-text">暂无数据</span>
      </div>

      <div
        v-else
        class="conversation-list"
      >
        <div
          v-for="conversation in visibleConversations"
          :key="conversation.id"
          role="button"
          tabindex="0"
          class="conversation-item"
          :class="{ active: workspace.selectedConversationId === conversation.id }"
          @click="handleSelectConversation(conversation.id)"
          @keydown.enter="handleSelectConversation(conversation.id)"
          @keydown.delete.prevent="handleDeleteConversation(conversation.id)"
          @keydown.backspace.prevent="handleDeleteConversation(conversation.id)"
        >
          <div class="conversation-content">
            <div class="conversation-title">{{ conversation.title }}</div>
            <div class="conversation-meta">
              <span class="conversation-time">{{ formatConversationTime(conversation.ts) }}</span>
              <span
                v-if="conversation.ipAddress"
                class="conversation-ip"
              >
                {{ conversation.ipAddress }}
              </span>
            </div>
          </div>
          <button
            class="delete-btn"
            title="删除会话"
            @click.stop="handleDeleteConversation(conversation.id)"
          >
            <Trash2 />
          </button>
        </div>

        <button
          v-if="hasMoreConversations"
          class="load-more-btn"
          :disabled="isLoadingMore"
          @click="loadMoreConversations"
        >
          {{ isLoadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Search, Trash2, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const query = ref('')
const pageSize = 20
const currentPage = ref(1)
const isLoadingMore = ref(false)
const dayMs = 1000 * 60 * 60 * 24

const filteredConversations = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return workspace.sortedConversations
  return workspace.sortedConversations.filter((conversation) =>
    `${conversation.title} ${conversation.id} ${conversation.summary || ''} ${conversation.ipAddress || ''}`.toLowerCase().includes(keyword)
  )
})

const limit = computed(() => currentPage.value * pageSize)
const visibleConversations = computed(() => filteredConversations.value.slice(0, limit.value))
const hasMoreConversations = computed(() => limit.value < filteredConversations.value.length)

const formatConversationTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / dayMs)

  if (days === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  if (days < 7) {
    return `${days}天前`
  }

  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

watch(query, () => {
  currentPage.value = 1
})

const clearSearch = () => {
  query.value = ''
}

const handleNewChat = async () => {
  query.value = ''
  currentPage.value = 1
  await workspace.createConversation()
}

const handleSelectConversation = async (id: string) => {
  await workspace.restoreConversation(id)
}

const handleDeleteConversation = async (id: string) => {
  await workspace.deleteConversation(id)
  if (visibleConversations.value.length === 0 && currentPage.value > 1) {
    currentPage.value -= 1
  }
}

const loadMoreConversations = async () => {
  if (isLoadingMore.value || !hasMoreConversations.value) return
  isLoadingMore.value = true
  try {
    const refreshed = await workspace.loadChatConversationsFromBackend({ restoreIfEmpty: false })
    if (!refreshed) return
    currentPage.value += 1
  } finally {
    isLoadingMore.value = false
  }
}
</script>
