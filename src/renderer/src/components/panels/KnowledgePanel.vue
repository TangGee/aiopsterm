<template>
  <section
    class="kb-sidebar-root"
    @dragover.prevent
    @drop.prevent="handleRootDrop"
  >
    <header class="kb-panel-header">
      <h2>知识库</h2>
    </header>

    <KnowledgePanelToolbar
      v-model:search-query="workspace.kbSearchQuery"
      v-model:add-menu-open="addMenuOpen"
      @upload="uploadFile()"
      @create-file="createInline('file')"
      @create-dir="createInline('dir')"
      @refresh="refreshTree"
    />

    <KnowledgePanelTreeView
      v-model:editing-name="editingName"
      :search-visible="workspace.kbContentSearchVisible"
      :search-loading="workspace.kbSearchLoading"
      :search-results="workspace.kbContentSearchResults"
      :search-error="workspace.kbSearchError"
      :filtered-tree="workspace.filteredKnowledgeTree"
      :editing-key="editingKey"
      :drag-over-rel-path="kbDragOverRelPath"
      :drag-over-root="kbDragOverRoot"
      :expanded-keys="workspace.kbExpandedKeys"
      :selected-keys="workspace.kbSelectedKeys"
      :import-job-count="workspace.kbImportJobs.length"
      :used-bytes="workspace.kbUsedBytes"
      :total-bytes="workspace.kbTotalBytes"
      :capacity-percent="workspace.kbCapacityPercent"
      @clear-blank-selection="clearBlankSelection"
      @open-blank-menu="openBlankMenu"
      @root-drag-over="handleRootDragOver"
      @root-drag-leave="handleRootDragLeave"
      @root-drop="handleRootDrop"
      @open-search-result="openSearchResult"
      @select-node="selectNode"
      @toggle-expanded="toggleExpanded"
      @open-node-menu="openNodeMenu"
      @drag-start="handleKnowledgeDragStart"
      @drag-over="handleKnowledgeNodeDragOver"
      @drag-leave="handleKnowledgeNodeDragLeave"
      @drag-end="clearKnowledgeDragState"
      @drop-node="handleKnowledgeNodeDrop"
      @confirm-rename="confirmRename"
      @cancel-rename="cancelRename"
      @show-capacity-detail="showCapacityDetail = true"
    />

    <KnowledgePanelContextMenus
      :node-menu="nodeMenu"
      :blank-menu="blankMenu"
      :modifier-key="modifierKey"
      :clipboard-available="clipboardAvailable"
      @add-to-chat="addToChat"
      @create-file="createInline('file', $event)"
      @create-dir="createInline('dir', $event)"
      @upload="uploadFile"
      @start-rename="startRename"
      @delete-selection="deleteSelection"
      @copy-path="copyPath"
      @copy-selection="copySelection"
      @paste-into="pasteInto"
      @refresh-tree="refreshTree"
    />

    <KnowledgePanelCapacityDetailModal
      :open="showCapacityDetail"
      :total-bytes="workspace.kbTotalBytes"
      @close="showCapacityDetail = false"
    />

    <KnowledgePanelTransfers :jobs="workspace.kbImportJobs" />
  </section>
</template>

<script setup lang="ts">
import KnowledgePanelCapacityDetailModal from '@/components/knowledge/KnowledgePanelCapacityDetailModal.vue'
import KnowledgePanelContextMenus from '@/components/knowledge/KnowledgePanelContextMenus.vue'
import KnowledgePanelToolbar from '@/components/knowledge/KnowledgePanelToolbar.vue'
import KnowledgePanelTransfers from '@/components/knowledge/KnowledgePanelTransfers.vue'
import KnowledgePanelTreeView from '@/components/knowledge/KnowledgePanelTreeView.vue'
import { useKnowledgePanelRuntime } from '@/services/knowledge/knowledgePanelRuntime'

const props = defineProps<{ query?: string }>()

const {
  workspace,
  addMenuOpen,
  showCapacityDetail,
  editingKey,
  editingName,
  kbDragOverRelPath,
  kbDragOverRoot,
  nodeMenu,
  blankMenu,
  modifierKey,
  clipboardAvailable,
  selectNode,
  openSearchResult,
  toggleExpanded,
  openNodeMenu,
  openBlankMenu,
  clearBlankSelection,
  createInline,
  startRename,
  confirmRename,
  cancelRename,
  deleteSelection,
  copySelection,
  pasteInto,
  clearKnowledgeDragState,
  handleKnowledgeDragStart,
  handleKnowledgeNodeDragOver,
  handleKnowledgeNodeDragLeave,
  handleKnowledgeNodeDrop,
  handleRootDragOver,
  handleRootDragLeave,
  handleRootDrop,
  copyPath,
  addToChat,
  uploadFile,
  refreshTree
} = useKnowledgePanelRuntime(props)
</script>
