<template>
  <div class="workspace-tree-panel">
    <WorkspacePanelTreeView />
    <WorkspacePanelContextMenus />
    <WorkspacePanelFolderDialogs />
    <WorkspacePanelHostDialogs />
    <WorkspacePanelOperationDialogs />

    <div
      v-if="notice"
      class="workspace-notice"
    >
      {{ notice }}
    </div>
  </div>
</template>

<script setup lang="ts">
import WorkspacePanelContextMenus from '@/components/workspace/WorkspacePanelContextMenus.vue'
import WorkspacePanelFolderDialogs from '@/components/workspace/WorkspacePanelFolderDialogs.vue'
import WorkspacePanelHostDialogs from '@/components/workspace/WorkspacePanelHostDialogs.vue'
import WorkspacePanelOperationDialogs from '@/components/workspace/WorkspacePanelOperationDialogs.vue'
import WorkspacePanelTreeView from '@/components/workspace/WorkspacePanelTreeView.vue'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const { notice } = useWorkspacePanelRuntimeContext()
</script>
