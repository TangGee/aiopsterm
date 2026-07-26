<template>
  <header class="detail_header">
    <div class="header_content">
      <div class="title_group">
        <div :class="['plugin_icon_large', `icon-${iconKey}`]">
          <component :is="IconComponent" />
        </div>
        <div class="text_group">
          <h1 class="plugin_name">{{ name }}</h1>
          <p class="plugin_description">{{ description }}</p>
          <div class="action_buttons">
            <slot name="actions" />
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Cloud,
  FileText,
  ShieldCheck,
  WandSparkles
} from 'lucide-vue-next'
import type { ExtensionIconKey } from '@shared/contracts/extensions'

const props = defineProps<{
  name: string
  description: string
  iconKey: ExtensionIconKey
}>()

const iconMap: Record<ExtensionIconKey, Component> = {
  runbook: FileText,
  cloud: Cloud,
  private: ShieldCheck,
  local: WandSparkles
}

const IconComponent = computed(() => iconMap[props.iconKey])
</script>
