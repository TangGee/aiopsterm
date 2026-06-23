<template>
  <section class="files-workspace">
    <div class="files-mode-switch">
      <button
        :class="{ active: workspace.filesUiMode === 'transfer' }"
        @click="workspace.setFilesUiMode('transfer')"
      >
        拖拽模式
      </button>
      <button
        :class="{ active: workspace.filesUiMode === 'default' }"
        @click="workspace.setFilesUiMode('default')"
      >
        默认模式
      </button>
    </div>

    <div
      v-if="workspace.filesUiMode === 'transfer'"
      class="files-transfer-layout"
    >
      <TransferSide
        side="left"
        :session="workspace.selectedLeftFileSession"
        @add="openAddConn('left')"
        @open-file="openFileEditor"
      />
      <div class="files-transfer-divider"></div>
      <TransferSide
        side="right"
        :session="workspace.selectedRightFileSession"
        @add="openAddConn('right')"
        @open-file="openFileEditor"
      />
    </div>

    <div
      v-else
      class="files-default-layout"
    >
      <div
        v-for="session in workspace.fileSessions"
        :key="session.id"
        class="files-default-session"
      >
        <button
          class="files-default-title"
          @click="toggleDefaultSession(session.id)"
        >
          <ChevronDown v-if="expandedDefault.includes(session.id)" />
          <ChevronRight v-else />
          <strong>{{ session.label }}</strong>
          <span v-if="session.errorMsg">SFTP 连接失败：{{ session.errorMsg }}</span>
        </button>
        <FileBrowser
          v-if="expandedDefault.includes(session.id)"
          :session="session"
          ui-mode="default"
          @open-file="openFileEditor"
        />
      </div>
    </div>

    <div
      v-for="editor in fileEditors"
      v-show="editor.visible"
      :key="editor.key"
      class="files-floating-editor"
      :class="{ active: editor.key === activeEditorKey, fullscreen: editor.fullscreen }"
      :style="editor.fullscreen ? undefined : editorGeometry(editor)"
      @click="activeEditorKey = editor.key"
    >
      <header
        class="files-editor-toolbar"
        @mousedown="startEditorDrag($event, editor)"
      >
        <button
          class="primary"
          :disabled="editor.loading"
          @click="saveFileEditor(editor.key, false)"
        >
          <Save />
          保存
        </button>
        <span :title="editor.filePath">{{ editor.action === 'create' ? '新建文件 ' : '编辑文件 ' }}{{ editor.filePath }}</span>
        <div>
          <button
            :title="editor.fullscreen ? '退出全屏' : '全屏'"
            @click="editor.fullscreen = !editor.fullscreen"
          >
            <Minimize2 v-if="editor.fullscreen" />
            <Maximize2 v-else />
          </button>
          <button
            title="关闭"
            @click="requestCloseFileEditor(editor.key)"
          >
            <X />
          </button>
        </div>
      </header>
      <FilesMonacoEditor
        :model-value="editor.content"
        :language="editor.language"
        :readonly="editor.loading"
        @update:model-value="updateFileEditorContent(editor, $event)"
        @save="saveFileEditor(editor.key, false)"
      />
      <footer>
        <span>{{ editor.sessionLabel }} · {{ editor.language }} · {{ editor.error || (editor.loading ? '加载中' : editor.dirty ? '未保存' : editor.saved ? '已保存' : '已打开') }}</span>
      </footer>
      <button
        v-if="!editor.fullscreen"
        class="files-editor-resize-handle"
        title="调整大小"
        @mousedown.stop.prevent="startEditorResize($event, editor)"
      ></button>
    </div>

    <div
      v-if="closeConfirm.visible && closeConfirm.editorKey"
      class="file-modal"
    >
      <div class="file-modal-card small">
        <header>
          <strong>保存确认</strong>
          <button
            title="关闭"
            @click="closeConfirm.visible = false"
          >
            <X />
          </button>
        </header>
        <p>文件 {{ closeConfirm.filePath }} 有未保存内容，是否保存后关闭？</p>
        <footer>
          <button @click="discardFileEditor(closeConfirm.editorKey)">不保存</button>
          <button @click="closeConfirm.visible = false">取消</button>
          <button
            class="primary"
            @click="saveFileEditor(closeConfirm.editorKey, true)"
          >
            保存
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="addConn.visible"
      class="file-modal"
    >
      <div class="file-modal-card add-conn">
        <header>
          <strong>添加 SFTP 连接</strong>
          <button
            title="关闭"
            @click="addConn.visible = false"
          >
            <X />
          </button>
        </header>
        <div class="add-conn-tabs">
          <button
            :class="{ active: addConn.tab === 'active' }"
            @click="setAddConnTab('active')"
          >
            活跃连接
          </button>
          <button
            :class="{ active: addConn.tab === 'asset' }"
            @click="setAddConnTab('asset')"
          >
            从资产添加
          </button>
        </div>

        <div
          v-if="addConn.tab === 'asset'"
          class="add-conn-search"
        >
          <input
            v-model="addConn.query"
            placeholder="搜索 SFTP 资产"
            @keydown.down.prevent="moveAddConnKeyboard(1)"
            @keydown.up.prevent="moveAddConnKeyboard(-1)"
            @keydown.enter.prevent="confirmAddConnKeyboard"
          />
        </div>

        <div class="add-conn-list">
          <button
            v-for="session in addConnOptions"
            :key="session.id"
            :data-session-id="session.id"
            :class="{ disabled: isSelected(session.id), 'keyboard-selected': session.id === addConn.keyboardSelectedId }"
            @mouseover="!isSelected(session.id) && (addConn.keyboardSelectedId = session.id)"
            @click="!isSelected(session.id) && pickAddConn(session.id)"
          >
            <span>{{ session.label }}</span>
            <small>{{ session.host }}</small>
            <Check v-if="isSelected(session.id)" />
          </button>
          <p v-if="!addConnOptions.length">没有可用连接</p>
        </div>
        <p class="add-conn-hint">
          {{ addConn.tab === 'active' ? '选择当前活跃连接加入文件面板。' : '从资产列表选择 SFTP 主机加入文件面板。' }}
        </p>
      </div>
    </div>

    <TransferProgress />
  </section>
</template>

<script setup lang="ts">
import { Check, ChevronDown, ChevronRight, Maximize2, Minimize2, Save, X } from 'lucide-vue-next'
import FileBrowser from '@/components/files/FileBrowser.vue'
import FilesMonacoEditor from '@/components/files/FilesMonacoEditor.vue'
import TransferProgress from '@/components/files/TransferProgress.vue'
import TransferSide from '@/components/files/TransferSide.vue'
import { useFilesWorkspaceRuntime } from '@/services/files/filesWorkspaceRuntime'

const {
  workspace,
  expandedDefault,
  addConn,
  fileEditors,
  activeEditorKey,
  closeConfirm,
  addConnOptions,
  openAddConn,
  setAddConnTab,
  pickAddConn,
  isSelected,
  moveAddConnKeyboard,
  confirmAddConnKeyboard,
  toggleDefaultSession,
  openFileEditor,
  editorGeometry,
  startEditorDrag,
  startEditorResize,
  updateFileEditorContent,
  saveFileEditor,
  discardFileEditor,
  requestCloseFileEditor
} = useFilesWorkspaceRuntime()
</script>
