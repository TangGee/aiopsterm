import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModulePanel from '@/components/ModulePanel.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const panelLifecycle = vi.hoisted(() => ({
  aiSessionsMounts: 0,
  aiSessionsUnmounts: 0
}))

vi.mock('@/components/panels/AiSessionsPanel.vue', async () => {
  const { defineComponent, h, onBeforeUnmount, onMounted } = await import('vue')
  return {
    default: defineComponent({
      name: 'AiSessionsPanel',
      setup() {
        onMounted(() => {
          panelLifecycle.aiSessionsMounts += 1
        })
        onBeforeUnmount(() => {
          panelLifecycle.aiSessionsUnmounts += 1
        })
        return () => h('section', { class: 'ai-sessions-panel' }, 'AI Sessions')
      }
    })
  }
})

vi.mock('@/components/panels/WorkspacePanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'WorkspacePanel', setup: () => () => h('section', { class: 'workspace-panel' }, 'Workspace') }) }
})
vi.mock('@/components/panels/AssetsPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'AssetsPanel', setup: () => () => h('section', { class: 'assets-panel' }, 'Assets') }) }
})
vi.mock('@/components/panels/FilesPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'FilesPanel', setup: () => () => h('section', { class: 'files-panel' }, 'Files') }) }
})
vi.mock('@/components/panels/SnippetsPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'SnippetsPanel', setup: () => () => h('section', { class: 'snippets-panel' }, 'Snippets') }) }
})
vi.mock('@/components/panels/KnowledgePanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'KnowledgePanel', setup: () => () => h('section', { class: 'knowledge-panel' }, 'Knowledge') }) }
})
vi.mock('@/components/panels/ExtensionsPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'ExtensionsPanel', setup: () => () => h('section', { class: 'extensions-panel' }, 'Extensions') }) }
})
vi.mock('@/components/panels/KubernetesPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'KubernetesPanel', setup: () => () => h('section', { class: 'kubernetes-panel' }, 'Kubernetes') }) }
})
vi.mock('@/components/panels/SettingsPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'SettingsPanel', setup: () => () => h('section', { class: 'settings-panel' }, 'Settings') }) }
})
vi.mock('@/components/panels/UserPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'UserPanel', setup: () => () => h('section', { class: 'user-panel' }, 'User') }) }
})

describe('ModulePanel', () => {
  beforeEach(() => {
    panelLifecycle.aiSessionsMounts = 0
    panelLifecycle.aiSessionsUnmounts = 0
    setActivePinia(createPinia())
  })

  it('keeps the AI Sessions panel cached when switching back from workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useWorkspaceStore()
    workspace.activeModule = 'aiSessions'

    const wrapper = mount(ModulePanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(wrapper.find('.ai-sessions-panel').exists()).toBe(true)
    expect(panelLifecycle.aiSessionsMounts).toBe(1)

    workspace.activeModule = 'workspace'
    await flushPromises()

    expect(wrapper.find('.workspace-panel').exists()).toBe(true)
    expect(wrapper.find('.ai-sessions-panel').exists()).toBe(false)
    expect(panelLifecycle.aiSessionsUnmounts).toBe(0)

    workspace.activeModule = 'aiSessions'
    await flushPromises()

    expect(wrapper.find('.ai-sessions-panel').exists()).toBe(true)
    expect(panelLifecycle.aiSessionsMounts).toBe(1)

    wrapper.unmount()
    expect(panelLifecycle.aiSessionsUnmounts).toBe(1)
  })
})
