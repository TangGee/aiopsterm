<template>
  <div
    ref="previewRef"
    class="kb-markdown-preview"
    v-html="html"
  ></div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import mermaid from 'mermaid'
import 'highlight.js/styles/atom-one-dark.css'

defineProps<{
  html: string
}>()

const previewRef = ref<HTMLDivElement | null>(null)
let mermaidInitialized = false
let lastMermaidTheme: 'dark' | 'default' | null = null

const ensureMermaidInitialized = (theme: 'dark' | 'default') => {
  if (mermaidInitialized && lastMermaidTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme
  })
  mermaidInitialized = true
  lastMermaidTheme = theme
}

const renderMermaid = async (theme: 'dark' | 'default') => {
  const container = previewRef.value
  if (!container) return
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'))
  if (nodes.length === 0) return
  ensureMermaidInitialized(theme)
  try {
    await mermaid.run({ nodes })
  } catch (runError) {
    console.warn('Failed to render knowledge markdown Mermaid diagram', runError)
  }
}

defineExpose({
  renderMermaid
})
</script>
