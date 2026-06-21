<template>
  <WorkspacePanelPresentation />
</template>

<script setup lang="ts">
import WorkspacePanelPresentation from '@/components/workspace/WorkspacePanelPresentation.vue'
import { provideWorkspacePanelRuntime } from '@/services/workspacePanelContext'
import { useWorkspacePanelRuntime } from '@/services/workspacePanelRuntime'

provideWorkspacePanelRuntime(useWorkspacePanelRuntime())
</script>
