import { computed, nextTick, onMounted, reactive, ref, type Ref } from 'vue'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import type { SnippetsCommandForm, SnippetsCommandMenu, SnippetsGroupMenu } from '@/services/quick-commands/snippetsPanelTypes'

export const snippetsExampleScript = `# System monitoring
ls -la
sleep==2000
# Navigate to log directory
cd /var/log
pwd
sleep==1000
# Check service status
sudo systemctl status nginx
# Interrupt after 3 seconds
sleep==3000
ctrl+c`

type SnippetsPanelRuntimeOptions = {
  searchInput: Ref<HTMLInputElement | null>
  scriptTextarea: Ref<HTMLTextAreaElement | null>
  groupInput: Ref<HTMLInputElement | null>
}

export const useSnippetsPanelRuntime = (options: SnippetsPanelRuntimeOptions) => {
  const workspace = useWorkspaceStore()
  const editingCommand = ref(false)
  const isEditMode = ref(false)
  const editingCommandId = ref<number | null>(null)
  const showHelp = ref(false)
  const copyExampleSuccess = ref(false)
  const isSearchActive = ref(false)
  const editingGroupId = ref<string | null | undefined>(undefined)
  const editingGroupName = ref('')
  const draggingId = ref<number | null>(null)
  const dragOverIndex = ref<number | null>(null)
  const dragDirection = ref<'up' | 'down' | null>(null)
  const commandMenu = reactive<SnippetsCommandMenu>({ visible: false, x: 0, y: 0, commandId: 0 })
  const groupMenu = reactive<SnippetsGroupMenu>({ visible: false, x: 0, y: 0, groupUuid: '' })
  const commandForm = reactive<SnippetsCommandForm>({ name: '', content: '', groupUuid: '' })
  const commandFormError = ref('')
  const commandSaving = ref(false)

  onMounted(() => {
    void workspace.refreshQuickCommands()
  })

  const scriptLineCount = computed(() => Math.max(1, commandForm.content.split('\n').length))

  const activateSearch = () => {
    isSearchActive.value = true
    nextTick(() => options.searchInput.value?.focus())
  }

  const handleSearchBlur = () => {
    if (!workspace.snippetSearchQuery) isSearchActive.value = false
  }

  const clearSearch = () => {
    workspace.snippetSearchQuery = ''
    nextTick(() => options.searchInput.value?.focus())
  }

  const syncLineNumberScroll = () => {
    const textarea = options.scriptTextarea.value
    const lineNumbers = textarea?.parentElement?.querySelector<HTMLElement>('.line-numbers')
    if (textarea && lineNumbers) {
      lineNumbers.scrollTop = textarea.scrollTop
    }
  }

  const copyExampleScript = async () => {
    const copied = await copyTextToClipboard(snippetsExampleScript)
    copyExampleSuccess.value = copied
    if (copied) {
      window.setTimeout(() => {
        copyExampleSuccess.value = false
      }, 2000)
    } else {
      workspace.setTopNotice('示例脚本复制失败')
    }
  }

  const startAddGroup = () => {
    editingGroupId.value = null
    editingGroupName.value = ''
    nextTick(() => options.groupInput.value?.focus())
  }

  const confirmGroupEdit = async () => {
    if (!editingGroupName.value.trim()) {
      cancelGroupEdit()
      return
    }
    if (editingGroupId.value === null) {
      await workspace.createSnippetGroup(editingGroupName.value)
    } else if (editingGroupId.value) {
      await workspace.renameSnippetGroup(editingGroupId.value, editingGroupName.value)
    }
    cancelGroupEdit()
  }

  const cancelGroupEdit = () => {
    editingGroupId.value = undefined
    editingGroupName.value = ''
  }

  const openAddCommand = () => {
    editingCommand.value = true
    isEditMode.value = false
    editingCommandId.value = null
    commandFormError.value = ''
    commandForm.name = ''
    commandForm.content = ''
    commandForm.groupUuid = workspace.selectedSnippetGroupUuid || ''
  }

  const openEditCommand = (id: number) => {
    const command = workspace.quickCommands.find((item) => item.id === id)
    if (!command) return
    editingCommand.value = true
    isEditMode.value = true
    editingCommandId.value = id
    commandFormError.value = ''
    commandForm.name = command.snippet_name
    commandForm.content = command.snippet_content
    commandForm.groupUuid = command.group_uuid || ''
  }

  const saveCommand = async () => {
    if (commandSaving.value) return
    commandFormError.value = ''
    if (!commandForm.name.trim()) {
      commandFormError.value = '请输入快捷命令名称'
      return
    }
    if (!commandForm.content.trim()) {
      commandFormError.value = '请输入脚本内容'
      return
    }
    const payload = {
      snippet_name: commandForm.name.trim(),
      snippet_content: commandForm.content,
      group_uuid: commandForm.groupUuid || null
    }
    commandSaving.value = true
    try {
      const saved =
        isEditMode.value && editingCommandId.value !== null
          ? await workspace.updateQuickCommand(editingCommandId.value, payload)
          : await workspace.createQuickCommand(payload)
      if (saved) cancelEditCommand()
    } finally {
      commandSaving.value = false
    }
  }

  const cancelEditCommand = () => {
    editingCommand.value = false
    isEditMode.value = false
    editingCommandId.value = null
    commandForm.name = ''
    commandForm.content = ''
    commandForm.groupUuid = ''
    commandFormError.value = ''
    commandSaving.value = false
  }

  const stopMacroRecording = async () => {
    await workspace.stopMacroRecording()
  }

  const toggleMacroRecording = async () => {
    if (workspace.isMacroRecording) {
      await stopMacroRecording()
      return
    }
    workspace.startMacroRecording(workspace.activePanelId)
  }

  const groupCount = (uuid: string) => workspace.quickCommands.filter((command) => command.group_uuid === uuid).length

  const runCommand = (id: number, autoExecute: boolean, allTabs = false) => {
    void workspace.runQuickCommand(id, autoExecute, allTabs)
  }

  const openCommandMenu = (event: MouseEvent, commandId: number) => {
    groupMenu.visible = false
    commandMenu.visible = true
    commandMenu.x = event.clientX
    commandMenu.y = event.clientY
    commandMenu.commandId = commandId
  }

  const openGroupMenu = (event: MouseEvent, groupUuid: string) => {
    commandMenu.visible = false
    groupMenu.visible = true
    groupMenu.x = event.clientX
    groupMenu.y = event.clientY
    groupMenu.groupUuid = groupUuid
  }

  const runCommandInAllTabs = () => {
    runCommand(commandMenu.commandId, true, true)
    commandMenu.visible = false
  }

  const editCommandFromMenu = () => {
    openEditCommand(commandMenu.commandId)
    commandMenu.visible = false
  }

  const deleteCommandFromMenu = async () => {
    await workspace.deleteQuickCommand(commandMenu.commandId)
    commandMenu.visible = false
  }

  const editGroupFromMenu = () => {
    const group = workspace.snippetGroups.find((item) => item.uuid === groupMenu.groupUuid)
    if (!group) return
    editingGroupId.value = group.uuid
    editingGroupName.value = group.group_name
    groupMenu.visible = false
    nextTick(() => options.groupInput.value?.focus())
  }

  const deleteGroupFromMenu = async () => {
    await workspace.deleteSnippetGroup(groupMenu.groupUuid)
    groupMenu.visible = false
  }

  const handleDragStart = (commandId: number, index: number) => {
    if (workspace.snippetSearchQuery) return
    draggingId.value = commandId
    dragOverIndex.value = index
  }

  const handleDragOver = (index: number) => {
    if (workspace.snippetSearchQuery || draggingId.value === null) return
    if (dragOverIndex.value === null) {
      dragDirection.value = null
    } else if (index < dragOverIndex.value) {
      dragDirection.value = 'up'
    } else if (index > dragOverIndex.value) {
      dragDirection.value = 'down'
    }
    dragOverIndex.value = index
  }

  const handleDrop = async (targetId: number) => {
    if (draggingId.value !== null) await workspace.reorderQuickCommand(draggingId.value, targetId)
    clearDragState()
  }

  const clearDragState = () => {
    draggingId.value = null
    dragOverIndex.value = null
    dragDirection.value = null
  }

  return {
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
    exampleScript: snippetsExampleScript,
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
  }
}
