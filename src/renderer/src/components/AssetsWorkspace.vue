<template>
  <section
    class="assets-workspace"
    data-ui-focus-scope="assets"
    data-ui-focus-primary
    tabindex="-1"
  >
    <AssetsPanel
      query=""
      mode="workspace"
    />
  </section>
</template>

<script setup lang="ts">
import AssetsPanel from '@/components/panels/AssetsPanel.vue'
</script>
