<template>
  <section class="snippets-panel-native">
    <header class="snippets-title">
      <h2>快捷命令</h2>
    </header>

    <SnippetsRecordingStatus
      v-if="workspace.isMacroRecording"
      :command-count="workspace.recordedCommands.length"
      :current-line-buffer="workspace.macroCurrentLineBuffer"
      @cancel="workspace.cancelMacroRecording"
      @stop="stopMacroRecording"
    />

    <SnippetsToolbar
      v-if="!editingCommand"
      ref="toolbarRef"
      :is-search-active="isSearchActive"
      :selected-group-uuid="workspace.selectedSnippetGroupUuid"
      :current-group-name="workspace.currentSnippetGroupName"
      :is-macro-recording="workspace.isMacroRecording"
      :search-query="workspace.snippetSearchQuery"
      @back="workspace.setSnippetBrowserState({ selectedGroupUuid: null })"
      @add-group="startAddGroup"
      @toggle-macro="toggleMacroRecording"
      @add-command="openAddCommand"
      @activate-search="activateSearch"
      @update:search-query="workspace.setSnippetBrowserState({ searchQuery: $event })"
      @search-blur="handleSearchBlur"
      @clear-search="clearSearch"
    />

    <div class="snippets-list">
      <SnippetCommandEditor
        v-if="editingCommand"
        ref="commandEditorRef"
        :is-edit-mode="isEditMode"
        :form="commandForm"
        :groups="workspace.snippetGroups"
        :script-line-count="scriptLineCount"
        :show-help="showHelp"
        :copy-example-success="copyExampleSuccess"
        :example-script="exampleScript"
        :error="commandFormError"
        :saving="commandSaving"
        @update:name="commandForm.name = $event"
        @update:content="commandForm.content = $event"
        @update:group-uuid="commandForm.groupUuid = $event"
        @scroll-script="syncLineNumberScroll"
        @toggle-help="showHelp = !showHelp"
        @copy-example="copyExampleScript"
        @cancel="cancelEditCommand"
        @save="saveCommand"
      />

      <SnippetsList
        v-else
        ref="snippetsListRef"
        :groups="workspace.snippetGroups"
        :commands="workspace.filteredQuickCommands"
        :selected-group-uuid="workspace.selectedSnippetGroupUuid"
        :search-query="workspace.snippetSearchQuery"
        :editing-group-id="editingGroupId"
        :editing-group-name="editingGroupName"
        :drag-over-index="dragOverIndex"
        :drag-direction="dragDirection"
        :total-command-count="workspace.quickCommands.length"
        :group-count="groupCount"
        @update:editing-group-name="editingGroupName = $event"
        @confirm-group="confirmGroupEdit"
        @cancel-group="cancelGroupEdit"
        @select-group="workspace.setSnippetBrowserState({ selectedGroupUuid: $event })"
        @open-group-menu="openGroupMenu"
        @run-command="runCommand"
        @open-command-menu="openCommandMenu"
        @drag-start="handleDragStart"
        @drag-over="handleDragOver"
        @drop-command="handleDrop"
        @clear-drag="clearDragState"
      />
    </div>

    <SnippetsContextMenus
      :command-menu="commandMenu"
      :group-menu="groupMenu"
      @run-command-all-tabs="runCommandInAllTabs"
      @edit-command="editCommandFromMenu"
      @delete-command="deleteCommandFromMenu"
      @edit-group="editGroupFromMenu"
      @delete-group="deleteGroupFromMenu"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import SnippetCommandEditor from '@/components/snippets/SnippetCommandEditor.vue'
import SnippetsContextMenus from '@/components/snippets/SnippetsContextMenus.vue'
import SnippetsList from '@/components/snippets/SnippetsList.vue'
import SnippetsRecordingStatus from '@/components/snippets/SnippetsRecordingStatus.vue'
import SnippetsToolbar from '@/components/snippets/SnippetsToolbar.vue'
import { useSnippetsPanelRuntime } from '@/services/quick-commands/snippetsPanelRuntime'

const toolbarRef = ref<InstanceType<typeof SnippetsToolbar> | null>(null)
const commandEditorRef = ref<InstanceType<typeof SnippetCommandEditor> | null>(null)
const snippetsListRef = ref<InstanceType<typeof SnippetsList> | null>(null)

const searchInput = computed(() => toolbarRef.value?.searchInput ?? null)
const scriptTextarea = computed(() => commandEditorRef.value?.scriptTextarea ?? null)
const groupInput = computed(() => snippetsListRef.value?.groupInput ?? null)

const {
  workspace,
  editingCommand,
  isEditMode,
  showHelp,
  copyExampleSuccess,
  isSearchActive,
  editingGroupId,
  editingGroupName,
  dragOverIndex,
  dragDirection,
  commandMenu,
  groupMenu,
  commandForm,
  commandFormError,
  commandSaving,
  exampleScript,
  scriptLineCount,
  activateSearch,
  handleSearchBlur,
  clearSearch,
  syncLineNumberScroll,
  copyExampleScript,
  startAddGroup,
  confirmGroupEdit,
  cancelGroupEdit,
  openAddCommand,
  saveCommand,
  cancelEditCommand,
  stopMacroRecording,
  toggleMacroRecording,
  groupCount,
  runCommand,
  openCommandMenu,
  openGroupMenu,
  runCommandInAllTabs,
  editCommandFromMenu,
  deleteCommandFromMenu,
  editGroupFromMenu,
  deleteGroupFromMenu,
  handleDragStart,
  handleDragOver,
  handleDrop,
  clearDragState
} = useSnippetsPanelRuntime({
  searchInput,
  scriptTextarea,
  groupInput
})
</script>
