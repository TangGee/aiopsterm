<template>
  <WorkspacePanelPresentation />
</template>

<script setup lang="ts">
import WorkspacePanelPresentation from '@/components/workspace/WorkspacePanelPresentation.vue'
import { provideWorkspacePanelRuntime } from '@/services/workspace/workspacePanelContext'
import { useWorkspacePanelRuntime } from '@/services/workspace/workspacePanelRuntime'

provideWorkspacePanelRuntime(useWorkspacePanelRuntime())
</script>
