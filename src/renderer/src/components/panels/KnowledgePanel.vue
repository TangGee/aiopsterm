<template>
  <section
    class="kb-sidebar-root"
    @dragover.prevent
    @drop.prevent="handleDropImport"
  >
    <header class="kb-panel-header">
      <h2>知识库</h2>
    </header>

    <div class="kb-toolbar">
      <label class="kb-search">
        <input
          v-model="workspace.kbSearchQuery"
          placeholder="搜索"
        />
        <Search />
      </label>
      <div class="kb-add-wrapper">
        <button
          class="kb-add-button"
          title="添加"
          @click="addMenuOpen = !addMenuOpen"
        >
          <Plus />
        </button>
        <div
          v-if="addMenuOpen"
          class="kb-add-menu"
        >
          <button @click="uploadFile">
            <UploadCloud />
            上传文件
          </button>
          <button @click="createInline('file')">
            <FilePlus />
            新建文件
          </button>
          <button @click="createInline('dir')">
            <FolderPlus />
            新建文件夹
          </button>
          <i></i>
          <button @click="refreshTree">
            <RefreshCw />
            刷新
          </button>
        </div>
      </div>
    </div>

    <div
      class="kb-tree-wrapper"
      @click="clearBlankSelection"
      @contextmenu.prevent="openBlankMenu"
    >
      <div class="kb-tree-scroll">
        <div
          v-if="workspace.kbContentSearchVisible"
          class="kb-search-results"
        >
          <div class="kb-search-results-header">
            <span>内容搜索</span>
            <small v-if="workspace.kbSearchLoading">索引中...</small>
            <small v-else>{{ workspace.kbContentSearchResults.length }} results</small>
          </div>
          <button
            v-for="result in workspace.kbContentSearchResults"
            :key="`${result.path}:${result.startLine}`"
            class="kb-search-result"
            @click.stop="openSearchResult(result)"
          >
            <strong>{{ result.path }}</strong>
            <span>Lines {{ result.startLine }}-{{ result.endLine }} · {{ result.matchCount }} matches</span>
            <small>{{ result.snippet }}</small>
          </button>
          <div
            v-if="!workspace.kbSearchLoading && !workspace.kbContentSearchResults.length"
            class="kb-search-empty"
          >
            {{ workspace.kbSearchError || '没有内容搜索结果' }}
          </div>
        </div>
        <KnowledgeTreeNode
          v-for="node in workspace.filteredKnowledgeTree"
          :key="node.relPath"
          :node="node"
          :level="0"
          :editing-key="editingKey"
          :editing-name="editingName"
          @select="selectNode"
          @toggle="toggleExpanded"
          @context="openNodeMenu"
          @rename-input="editingName = $event"
          @confirm-rename="confirmRename"
          @cancel-rename="cancelRename"
        />
      </div>

      <div class="kb-capacity-bar">
        <Cloud :class="{ syncing: workspace.kbImportJobs.length > 0 }" />
        <div class="kb-capacity-info">
          <div class="kb-capacity-label">我的容量</div>
          <div class="kb-capacity-value">{{ formatCapacity(workspace.kbUsedBytes) }} / {{ formatCapacity(workspace.kbTotalBytes) }}</div>
          <div class="progress">
            <span :style="{ width: `${workspace.kbCapacityPercent}%` }"></span>
          </div>
        </div>
        <button
          class="kb-capacity-detail-link"
          @click.stop="showCapacityDetail = true"
        >
          明细
        </button>
      </div>
    </div>

    <div
      v-if="nodeMenu.visible"
      class="kb-context-menu"
      :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }"
    >
      <button
        v-if="nodeMenu.type === 'file'"
        @click="addToChat"
      >
        添加到聊天
      </button>
      <button
        v-if="nodeMenu.type === 'dir'"
        @click="createInline('file', nodeMenu.relPath)"
      >
        新建文件
      </button>
      <button
        v-if="nodeMenu.type === 'dir'"
        @click="createInline('dir', nodeMenu.relPath)"
      >
        新建文件夹
      </button>
      <i v-if="nodeMenu.type === 'dir'"></i>
      <button @click="startRename(nodeMenu.relPath)">重命名</button>
      <button @click="deleteSelection">删除</button>
      <i></i>
      <button
        v-if="nodeMenu.type === 'file'"
        @click="copyPath"
      >
        复制路径
      </button>
      <button @click="copySelection('copy')">
        <span>复制</span>
        <em>{{ modifierKey }}C</em>
      </button>
      <button @click="copySelection('cut')">
        <span>剪切</span>
        <em>{{ modifierKey }}X</em>
      </button>
      <button
        :disabled="!workspace.kbClipboard"
        @click="pasteInto(nodeMenu.relPath)"
      >
        <span>粘贴</span>
        <em>{{ modifierKey }}V</em>
      </button>
    </div>

    <div
      v-if="blankMenu.visible"
      class="kb-context-menu"
      :style="{ left: `${blankMenu.x}px`, top: `${blankMenu.y}px` }"
    >
      <button @click="createInline('file')">新建文件</button>
      <button @click="createInline('dir')">新建文件夹</button>
      <button
        :disabled="!workspace.kbClipboard"
        @click="pasteInto('')"
      >
        <span>粘贴</span>
        <em>{{ modifierKey }}V</em>
      </button>
      <button @click="refreshTree">刷新</button>
    </div>

    <div
      v-if="showCapacityDetail"
      class="file-modal"
    >
      <div class="file-modal-card kb-capacity-detail-modal">
        <header>
          <strong>容量来源明细</strong>
          <button
            title="关闭"
            @click="showCapacityDetail = false"
          >
            <X />
          </button>
        </header>
        <table>
          <thead>
            <tr>
              <th>服务项</th>
              <th>到期时间</th>
              <th>容量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>个人免费版</td>
              <td>长期有效</td>
              <td>{{ formatCapacity(workspace.kbTotalBytes) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="kb-capacity-total">总计: {{ formatCapacity(workspace.kbTotalBytes) }}</div>
      </div>
    </div>

    <div
      v-if="workspace.kbImportJobs.length"
      class="kb-transfer"
    >
      <div
        v-for="job in workspace.kbImportJobs"
        :key="job.id"
        class="kb-transfer-item"
      >
        <div class="kb-transfer-title">{{ job.destRelPath }}</div>
        <div class="progress">
          <span :style="{ width: `${job.percent}%` }"></span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, reactive, ref, watch, type VNode } from 'vue'
import { ChevronDown, ChevronRight, Cloud, File, FilePlus, Folder, FolderPlus, Plus, RefreshCw, Search, UploadCloud, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { KnowledgeBaseSearchResult, KnowledgeNode } from '@shared/preload'

const props = defineProps<{ query?: string }>()
const workspace = useWorkspaceStore()
const addMenuOpen = ref(false)
const showCapacityDetail = ref(false)
const editingKey = ref('')
const editingName = ref('')
const nodeMenu = reactive({ visible: false, x: 0, y: 0, relPath: '', type: 'file' as 'file' | 'dir' })
const blankMenu = reactive({ visible: false, x: 0, y: 0 })

const modifierKey = computed(() => (navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl+'))

onMounted(() => {
  void workspace.refreshKnowledgeTree({ persist: false })
})

watch(
  () => props.query,
  (query) => {
    if (query !== undefined) workspace.kbSearchQuery = query
  },
  { immediate: true }
)

watch(
  () => workspace.kbSearchQuery,
  () => {
    void workspace.searchKnowledgeContent()
  },
  { immediate: true }
)

const KnowledgeTreeNode = defineComponent({
  name: 'KnowledgeTreeNode',
  props: {
    node: { type: Object as () => KnowledgeNode, required: true },
    level: { type: Number, required: true },
    editingKey: { type: String, required: true },
    editingName: { type: String, required: true }
  },
  emits: ['select', 'toggle', 'context', 'renameInput', 'confirmRename', 'cancelRename'],
  setup(nodeProps, { emit }) {
    const store = useWorkspaceStore()
    const renderNode = (node: KnowledgeNode, level: number): VNode => {
      const expanded = store.kbExpandedKeys.includes(node.relPath)
      const selected = store.kbSelectedKeys.includes(node.relPath)
      const editing = nodeProps.editingKey === node.relPath
      return h('div', { class: 'kb-tree-node-wrap' }, [
        h(
          'div',
          {
            class: ['kb-tree-node', { selected, editing }],
            style: { paddingLeft: `${level * 16 + 6}px` },
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              emit('select', node.relPath, event.ctrlKey || event.metaKey)
            },
            onDblclick: (event: MouseEvent) => {
              event.stopPropagation()
              if (node.type === 'dir') emit('toggle', node.relPath)
            },
            onContextmenu: (event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              emit('context', event, node)
            }
          },
          [
            node.type === 'dir'
              ? h(
                  'button',
                  {
                    class: 'kb-expand-button',
                    onClick: (event: MouseEvent) => {
                      event.stopPropagation()
                      emit('toggle', node.relPath)
                    }
                  },
                  [expanded ? h(ChevronDown) : h(ChevronRight)]
                )
              : h('span', { class: 'kb-expand-spacer' }),
            node.type === 'dir' ? h(Folder, { class: 'kb-node-icon' }) : h(File, { class: 'kb-node-icon' }),
            editing
              ? h('input', {
                  class: 'kb-rename-input',
                  value: nodeProps.editingName,
                  autofocus: true,
                  onInput: (event: Event) => emit('renameInput', (event.target as HTMLInputElement).value),
                  onKeydown: (event: KeyboardEvent) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') emit('confirmRename')
                    if (event.key === 'Escape') emit('cancelRename')
                  },
                  onBlur: () => emit('cancelRename')
                })
              : h('span', { class: 'kb-title-text' }, node.title)
          ]
        ),
        node.type === 'dir' && expanded && node.children?.length ? node.children.map((child) => renderNode(child, level + 1)) : null
      ])
    }
    return () => renderNode(nodeProps.node, nodeProps.level)
  }
})

const formatCapacity = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

const getParent = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

const selectedTargetDir = () => {
  const selected = workspace.kbSelectedKeys[0]
  if (!selected) return ''
  const node = workspace.findKnowledgeNode(selected)
  return node?.type === 'dir' ? selected : getParent(selected)
}

const selectNode = (relPath: string, multi: boolean) => {
  workspace.selectKnowledgeNode(relPath, multi)
  if (!multi && workspace.findKnowledgeNode(relPath)?.type === 'file') {
    workspace.openKnowledgeFile(relPath)
  }
}

const openSearchResult = (result: KnowledgeBaseSearchResult) => {
  workspace.openKnowledgeFile(result.path, {
    startLine: result.startLine,
    endLine: result.endLine
  })
}

const toggleExpanded = (relPath: string) => {
  workspace.kbExpandedKeys = workspace.kbExpandedKeys.includes(relPath)
    ? workspace.kbExpandedKeys.filter((key) => key !== relPath)
    : [...workspace.kbExpandedKeys, relPath]
}

const openNodeMenu = (event: MouseEvent, node: KnowledgeNode) => {
  blankMenu.visible = false
  workspace.selectKnowledgeNode(node.relPath, false)
  nodeMenu.visible = true
  nodeMenu.x = event.clientX
  nodeMenu.y = event.clientY
  nodeMenu.relPath = node.relPath
  nodeMenu.type = node.type
}

const openBlankMenu = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.kb-tree-node')) return
  nodeMenu.visible = false
  blankMenu.visible = true
  blankMenu.x = event.clientX
  blankMenu.y = event.clientY
}

const clearBlankSelection = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.kb-tree-node') || (event.target as HTMLElement).closest('.kb-capacity-bar')) return
  workspace.kbSelectedKeys = []
}

const createInline = async (kind: 'file' | 'dir', parentRelDir = selectedTargetDir()) => {
  addMenuOpen.value = false
  nodeMenu.visible = false
  blankMenu.visible = false
  const node = await workspace.createKnowledgeNode(kind, parentRelDir, kind === 'dir' ? 'New Folder' : 'New File.md')
  if (node) startRename(node.relPath)
}

const startRename = (relPath: string) => {
  const node = workspace.findKnowledgeNode(relPath)
  if (!node) return
  editingKey.value = relPath
  editingName.value = node.title
  nodeMenu.visible = false
  nextTick(() => document.querySelector<HTMLInputElement>('.kb-rename-input')?.focus())
}

const confirmRename = async () => {
  await workspace.renameKnowledgeNode(editingKey.value, editingName.value)
  editingKey.value = ''
  editingName.value = ''
}

const cancelRename = () => {
  editingKey.value = ''
  editingName.value = ''
}

const deleteSelection = async () => {
  const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
  await workspace.deleteKnowledgeNodes(targets)
  nodeMenu.visible = false
}

const copySelection = (mode: 'copy' | 'cut') => {
  const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
  workspace.copyKnowledgeNodes(targets, mode)
  nodeMenu.visible = false
}

const pasteInto = async (relPath: string) => {
  await workspace.pasteKnowledgeNodes(relPath)
  nodeMenu.visible = false
  blankMenu.visible = false
}

const copyPath = async () => {
  if (navigator.clipboard) await navigator.clipboard.writeText(workspace.kbSelectedKeys.join('\n') || nodeMenu.relPath)
  nodeMenu.visible = false
}

const addToChat = async () => {
  const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
  await workspace.addKnowledgeFilesToChat(targets)
  nodeMenu.visible = false
}

const importKnowledgePath = async (filePath: string, targetDir: string, fallbackName: string) => {
  if (!window.aiops?.kbCheckPath) {
    workspace.setTopNotice('知识库导入需要路径检查服务')
    return
  }
  let info: { exists: boolean; isDirectory: boolean; isFile: boolean }
  try {
    info = await window.aiops.kbCheckPath(filePath)
  } catch {
    workspace.setTopNotice('知识库导入路径检查失败')
    return
  }
  if (!info.exists) {
    workspace.setTopNotice('知识库导入路径不存在')
    return
  }
  const fileName = filePath.split(/[\\/]/).pop() || fallbackName
  if (info.isDirectory) {
    await workspace.addKnowledgeImportJob(`${targetDir}/${fileName}`.replace(/^\/+/, ''), filePath, 'folder')
    return
  }
  if (info.isFile) {
    await workspace.addKnowledgeImportJob(`${targetDir}/${fileName}`.replace(/^\/+/, ''), filePath, 'file')
    return
  }
  workspace.setTopNotice('知识库导入路径类型不支持')
}

const uploadFile = async () => {
  addMenuOpen.value = false
  if (!window.aiops?.showOpenDialog) {
    workspace.setTopNotice('知识库导入需要文件选择服务')
    return
  }
  const result = await window.aiops.showOpenDialog({
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  if (result?.canceled || !result?.filePaths.length) return
  const targetDir = selectedTargetDir()
  for (const filePath of result.filePaths) {
    await importKnowledgePath(filePath, targetDir, 'imported-note.md')
  }
}

const handleDropImport = async (event: DragEvent) => {
  const files = Array.from(event.dataTransfer?.files || [])
  const localPaths = files.map((file) => String((file as File & { path?: string }).path || '').trim()).filter(Boolean)
  if (!localPaths.length) {
    workspace.setTopNotice('知识库拖拽导入需要真实本地路径')
    return
  }
  const targetDir = selectedTargetDir()
  for (const filePath of localPaths) {
    await importKnowledgePath(filePath, targetDir, 'dropped-file.md')
  }
}

const refreshTree = async () => {
  addMenuOpen.value = false
  blankMenu.visible = false
  await workspace.refreshKnowledgeTree()
}
</script>
