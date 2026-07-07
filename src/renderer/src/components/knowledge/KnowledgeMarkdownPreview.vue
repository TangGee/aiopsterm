<template>
  <div
    ref="previewRef"
    class="kb-markdown-preview"
    v-html="html"
  ></div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import 'highlight.js/styles/atom-one-dark.css'

defineProps<{
  html: string
}>()

const previewRef = ref<HTMLDivElement | null>(null)
// mermaid 惰性加载：首次渲染 mermaid 块时才拉取模块，避免进入首屏 chunk
let mermaidModulePromise: Promise<typeof import('mermaid')['default']> | null = null
let lastMermaidTheme: 'dark' | 'default' | null = null

const loadMermaid = () => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => module.default)
  }
  return mermaidModulePromise
}

const renderMermaid = async (theme: 'dark' | 'default') => {
  if (!previewRef.value?.querySelector('.mermaid:not([data-processed])')) return
  const mermaid = await loadMermaid()
  const container = previewRef.value
  if (!container) return
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'))
  if (nodes.length === 0) return
  if (lastMermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme
    })
    lastMermaidTheme = theme
  }
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
