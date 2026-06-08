<template>
  <section class="snippets-panel-native">
    <header class="snippets-title">
      <h2>快捷命令</h2>
    </header>

    <div
      v-if="workspace.isMacroRecording"
      class="recording-status-bar"
    >
      <div>
        <span class="recording-indicator"></span>
        <span>录制中</span>
        <i>|</i>
        <small>{{ workspace.recordedCommands.length }}</small>
        <small
          v-if="workspace.macroCurrentLineBuffer"
          class="recording-buffer"
        >{{ workspace.macroCurrentLineBuffer }}</small>
      </div>
      <div class="recording-actions">
        <button @click="workspace.cancelMacroRecording">取消</button>
        <button @click="stopMacroRecording">停止录制</button>
      </div>
    </div>

    <div
      v-if="!editingCommand"
      class="snippets-toolbar"
    >
      <template v-if="!isSearchActive">
        <div class="snippets-toolbar-left">
          <button
            v-if="workspace.selectedSnippetGroupUuid"
            class="icon-only"
            title="返回"
            @click="workspace.selectedSnippetGroupUuid = null"
          >
            <ArrowLeft />
          </button>
          <strong v-if="workspace.selectedSnippetGroupUuid">{{ workspace.currentSnippetGroupName }}</strong>
          <button
            v-else
            class="text-button"
            @click="startAddGroup"
          >
            <FolderPlus />
            命令组
          </button>
        </div>
        <div class="snippets-toolbar-right">
          <button
            class="icon-only macro-btn"
            :class="{ recording: workspace.isMacroRecording }"
            :title="workspace.isMacroRecording ? '停止录制' : '宏录制'"
            @click="toggleMacroRecording"
          >
            <Video />
          </button>
          <button
            class="icon-only"
            title="新建片段"
            @click="openAddCommand"
          >
            <FileTerminal />
          </button>
          <button
            class="icon-only"
            title="搜索"
            @click="activateSearch"
          >
            <Search />
          </button>
        </div>
      </template>
      <label
        v-else
        class="snippet-search"
      >
        <Search />
        <input
          ref="searchInput"
          v-model="workspace.snippetSearchQuery"
          placeholder="搜索"
          @blur="handleSearchBlur"
          @keydown.enter="handleSearchBlur"
        />
        <button
          v-if="workspace.snippetSearchQuery"
          type="button"
          title="清空搜索"
          @mousedown.prevent
          @click="clearSearch"
        >
          <X />
        </button>
      </label>
    </div>

    <div class="snippets-list">
      <div
        v-if="editingCommand"
        class="snippet-edit-panel"
      >
        <h3>{{ isEditMode ? '编辑片段' : '新建片段' }}</h3>
        <input
          v-model="commandForm.name"
          placeholder="脚本名称"
        />
        <select v-model="commandForm.groupUuid">
          <option value="">无命令组</option>
          <option
            v-for="group in workspace.snippetGroups"
            :key="group.uuid"
            :value="group.uuid"
          >
            {{ group.group_name }}
          </option>
        </select>

        <div class="script-editor-container">
          <div class="line-numbers">
            <span
              v-for="line in scriptLineCount"
              :key="line"
            >
              {{ line }}
            </span>
          </div>
          <textarea
            ref="scriptTextarea"
            v-model="commandForm.content"
            placeholder="请输入脚本内容..."
            @scroll="syncLineNumberScroll"
          ></textarea>
        </div>

        <div class="script-help">
          <button
            class="help-header"
            @click="showHelp = !showHelp"
          >
            <span>脚本语法说明</span>
            <ChevronDown :class="{ rotated: !showHelp }" />
          </button>
          <div
            v-if="showHelp"
            class="help-content"
          >
            <div>
              <strong>基本命令：</strong>
              <span>每行一个命令，按顺序执行</span>
            </div>
            <div>
              <strong>延时命令：</strong>
              <code>sleep==3000</code>
            </div>
            <div>
              <strong>特殊按键：</strong>
              <code>esc</code>
              <code>tab</code>
              <code>return</code>
              <code>backspace</code>
            </div>
            <div>
              <strong>方向键：</strong>
              <code>up</code>
              <code>down</code>
              <code>left</code>
              <code>right</code>
            </div>
            <div>
              <strong>Ctrl组合键：</strong>
              <code>ctrl+c</code>
              <code>ctrl+d</code>
              <code>ctrl+z</code>
            </div>
            <div class="example-header">
              <strong>示例脚本：</strong>
              <button
                type="button"
                class="copy-example"
                @click="copyExampleScript"
              >
                {{ copyExampleSuccess ? '已复制' : '复制' }}
              </button>
            </div>
            <pre>{{ exampleScript }}</pre>
          </div>
        </div>

        <footer>
          <button @click="cancelEditCommand">取消</button>
          <button @click="saveCommand">确定</button>
        </footer>
      </div>

      <template v-else>
        <div
          v-if="workspace.selectedSnippetGroupUuid === null && !workspace.snippetSearchQuery && editingGroupId !== undefined"
          class="snippet-item group-folder editing"
        >
          <div class="snippet-info">
            <Folder />
            <input
              ref="groupInput"
              v-model="editingGroupName"
              placeholder="命令组"
              @keydown.enter="confirmGroupEdit"
              @keydown.esc="cancelGroupEdit"
            />
          </div>
          <div class="edit-actions">
            <button
              title="确定"
              @click="confirmGroupEdit"
            >
              <Check />
            </button>
            <button
              title="取消"
              @click="cancelGroupEdit"
            >
              <X />
            </button>
          </div>
        </div>

        <template v-if="workspace.selectedSnippetGroupUuid === null && !workspace.snippetSearchQuery">
          <div
            v-for="group in workspace.snippetGroups"
            :key="group.uuid"
            class="snippet-item group-folder"
            @click="workspace.selectedSnippetGroupUuid = group.uuid"
            @contextmenu.prevent="openGroupMenu($event, group.uuid)"
          >
            <div class="snippet-info">
              <Folder />
              <strong>{{ group.group_name }}</strong>
            </div>
            <span class="group-count">
              <FileTerminal />
              {{ groupCount(group.uuid) }}
            </span>
          </div>
        </template>

        <div
          v-for="(command, index) in workspace.filteredQuickCommands"
          :key="command.id"
          class="snippet-item"
          draggable="true"
          :class="{
            'drag-over-up': dragOverIndex === index && dragDirection === 'up' && !workspace.snippetSearchQuery,
            'drag-over-down': dragOverIndex === index && dragDirection === 'down' && !workspace.snippetSearchQuery
          }"
          @click="workspace.runQuickCommand(command.id, true)"
          @contextmenu.prevent="openCommandMenu($event, command.id)"
          @dragstart="handleDragStart(command.id, index)"
          @dragover.prevent="handleDragOver(index)"
          @dragleave="clearDragState"
          @drop.prevent="handleDrop(command.id)"
          @dragend="clearDragState"
        >
          <div class="snippet-info">
            <span class="snippet-name">
              <FileTerminal />
              {{ command.snippet_name }}
            </span>
            <span class="snippet-preview">{{ command.snippet_content }}</span>
          </div>
          <div
            class="snippet-actions"
            @click.stop
          >
            <button
              title="运行"
              @click="workspace.runQuickCommand(command.id, true)"
            >
              <PlayCircle />
            </button>
            <button
              title="粘贴"
              @click="workspace.runQuickCommand(command.id, false)"
            >
              <Copy />
            </button>
          </div>
        </div>

        <div
          v-if="workspace.quickCommands.length === 0"
          class="empty-state"
        >
          暂无数据
        </div>
      </template>
    </div>

    <div
      v-if="commandMenu.visible"
      class="snippet-context-menu"
      :style="{ left: `${commandMenu.x}px`, top: `${commandMenu.y}px` }"
    >
      <button @click="runCommandInAllTabs">
        <PlayCircle />
        全部窗口执行
      </button>
      <button @click="editCommandFromMenu">
        <Pencil />
        编辑
      </button>
      <button @click="deleteCommandFromMenu">
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="groupMenu.visible"
      class="snippet-context-menu"
      :style="{ left: `${groupMenu.x}px`, top: `${groupMenu.y}px` }"
    >
      <button @click="editGroupFromMenu">
        <Pencil />
        编辑
      </button>
      <button @click="deleteGroupFromMenu">
        <Trash2 />
        删除
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  FileTerminal,
  Folder,
  FolderPlus,
  Pencil,
  PlayCircle,
  Search,
  Trash2,
  Video,
  X
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const editingCommand = ref(false)
const isEditMode = ref(false)
const editingCommandId = ref<number | null>(null)
const showHelp = ref(false)
const copyExampleSuccess = ref(false)
const isSearchActive = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const scriptTextarea = ref<HTMLTextAreaElement | null>(null)
const groupInput = ref<HTMLInputElement | null>(null)
const editingGroupId = ref<string | null | undefined>(undefined)
const editingGroupName = ref('')
const draggingId = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const dragDirection = ref<'up' | 'down' | null>(null)
const commandMenu = reactive({ visible: false, x: 0, y: 0, commandId: 0 })
const groupMenu = reactive({ visible: false, x: 0, y: 0, groupUuid: '' })
const commandForm = reactive({ name: '', content: '', groupUuid: '' })
const exampleScript = `# System monitoring
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

onMounted(() => {
  void workspace.refreshQuickCommands()
})

const scriptLineCount = computed(() => Math.max(1, commandForm.content.split('\n').length))

const activateSearch = () => {
  isSearchActive.value = true
  nextTick(() => searchInput.value?.focus())
}

const handleSearchBlur = () => {
  if (!workspace.snippetSearchQuery) isSearchActive.value = false
}

const clearSearch = () => {
  workspace.snippetSearchQuery = ''
  nextTick(() => searchInput.value?.focus())
}

const syncLineNumberScroll = () => {
  const textarea = scriptTextarea.value
  const lineNumbers = textarea?.parentElement?.querySelector<HTMLElement>('.line-numbers')
  if (textarea && lineNumbers) {
    lineNumbers.scrollTop = textarea.scrollTop
  }
}

const copyExampleScript = async () => {
  try {
    await navigator.clipboard.writeText(exampleScript)
    copyExampleSuccess.value = true
    window.setTimeout(() => {
      copyExampleSuccess.value = false
    }, 2000)
  } catch {
    copyExampleSuccess.value = false
  }
}

const startAddGroup = () => {
  editingGroupId.value = null
  editingGroupName.value = ''
  nextTick(() => groupInput.value?.focus())
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
  commandForm.name = command.snippet_name
  commandForm.content = command.snippet_content
  commandForm.groupUuid = command.group_uuid || ''
}

const saveCommand = async () => {
  if (!commandForm.name.trim() || !commandForm.content.trim()) return
  const payload = {
    snippet_name: commandForm.name.trim(),
    snippet_content: commandForm.content,
    group_uuid: commandForm.groupUuid || null
  }
  if (isEditMode.value && editingCommandId.value !== null) {
    await workspace.updateQuickCommand(editingCommandId.value, payload)
  } else {
    await workspace.createQuickCommand(payload)
  }
  cancelEditCommand()
}

const cancelEditCommand = () => {
  editingCommand.value = false
  isEditMode.value = false
  editingCommandId.value = null
  commandForm.name = ''
  commandForm.content = ''
  commandForm.groupUuid = ''
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
  workspace.runQuickCommand(commandMenu.commandId, true, true)
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
  nextTick(() => groupInput.value?.focus())
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
</script>
