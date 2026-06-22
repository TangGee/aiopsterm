<template>
  <WorkspaceHostFormDialog />
  <WorkspaceHostProxyChildDialog />
  <WorkspaceHostKeyChildDialog />
  <WorkspaceHostJumpChildDialog />
</template>

<script setup lang="ts">
import WorkspaceHostFormDialog from '@/components/workspace/WorkspaceHostFormDialog.vue'
import WorkspaceHostJumpChildDialog from '@/components/workspace/WorkspaceHostJumpChildDialog.vue'
import WorkspaceHostKeyChildDialog from '@/components/workspace/WorkspaceHostKeyChildDialog.vue'
import WorkspaceHostProxyChildDialog from '@/components/workspace/WorkspaceHostProxyChildDialog.vue'
</script>
