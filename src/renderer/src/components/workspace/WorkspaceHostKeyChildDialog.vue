<template>
  <AssetKeyFormDialog
    :visible="hostKeyEditorRuntime.keyEditorOpen.value"
    :edit-mode="hostKeyEditorRuntime.keyEditMode.value"
    :name="hostKeyEditorRuntime.keyForm.name"
    :private-key="hostKeyEditorRuntime.keyForm.privateKey"
    :public-key="hostKeyEditorRuntime.keyForm.publicKey"
    :passphrase="hostKeyEditorRuntime.keyForm.passphrase"
    :drag-over="hostKeyEditorRuntime.keyDragOver.value"
    :error="hostKeyEditorRuntime.keyFormError.value"
    :import-notice="hostKeyEditorRuntime.keyImportNotice.value"
    child
    @close="hostKeyEditorRuntime.closeKeyEditor"
    @submit="hostKeyEditorRuntime.submitKeyForm"
    @import="hostKeyEditorRuntime.openKeyImportDialog"
    @drop="hostKeyEditorRuntime.handleKeyDrop"
    @update:name="hostKeyEditorRuntime.keyForm.name = $event"
    @update:private-key="hostKeyEditorRuntime.keyForm.privateKey = $event"
    @update:public-key="hostKeyEditorRuntime.keyForm.publicKey = $event"
    @update:passphrase="hostKeyEditorRuntime.keyForm.passphrase = $event"
    @update:drag-over="hostKeyEditorRuntime.keyDragOver.value = $event"
  />
</template>

<script setup lang="ts">
import AssetKeyFormDialog from '@/components/assets/AssetKeyFormDialog.vue'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const { hostKeyEditorRuntime } = useWorkspacePanelRuntimeContext()
</script>
