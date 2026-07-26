import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ExtensionRuntimeFeatures from '@/components/extensions/ExtensionRuntimeFeatures.vue'
import type { ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

const originalAiops = window.aiops

const plugin: ExtensionPluginRuntimeConfig = {
  pluginId: 'example.runtime-ui',
  name: 'Runtime UI',
  description: 'Runtime UI fixture',
  kind: 'runtime',
  iconKey: 'local',
  tabName: 'Runtime UI',
  show: true,
  isPlugin: true,
  installed: true,
  hasUpdate: false,
  installedVersion: '1.0.0',
  latestVersion: '1.0.0',
  source: 'local',
  main: 'main.cjs',
  enabled: true,
  runtimeStatus: 'active',
  commands: [{ id: 'example.runtime-ui.run', title: 'Run check', description: 'Run check' }],
  views: [{ id: 'example.runtime-ui.tree', name: 'Runtime tree' }],
  menus: {
    'view/title': [{ command: 'example.runtime-ui.run', when: 'view == example.runtime-ui.tree' }]
  },
  viewsWelcome: [
    {
      view: 'example.runtime-ui.tree',
      content: 'Runtime view is ready.',
      when: 'example.runtime-ui.ready'
    }
  ],
  configuration: {
    title: 'Runtime configuration',
    properties: [
      { key: 'endpoint', title: 'Endpoint', type: 'text' },
      { key: 'token', title: 'Token', type: 'password' }
    ]
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('ExtensionRuntimeFeatures', () => {
  it('renders host views, executes runtime commands, saves configuration and changes runtime state', async () => {
    const stop = vi.fn()
    window.aiops = {
      ...originalAiops,
      listExtensionContexts: vi.fn(async () => ({ ok: true, data: { 'example.runtime-ui.ready': true } })),
      listExtensionTreeChildren: vi.fn(async () => ({
        ok: true,
        data: {
          viewId: 'example.runtime-ui.tree',
          items: [
            {
              id: 'check',
              label: 'System check',
              command: 'example.runtime-ui.run',
              commandArgs: ['uptime']
            }
          ]
        }
      })),
      executeExtensionCommand: vi.fn(async (input) => ({
        ok: true,
        data: { commandId: input.commandId, value: { terminalText: String(input.args?.[0] || 'uptime'), message: 'done' } }
      })),
      getExtensionConfiguration: vi.fn(async () => ({
        ok: true,
        data: { endpoint: 'https://cmdb.example.test', token: true }
      })),
      saveExtensionConfiguration: vi.fn(async (input) => ({ ok: true, data: input.values })),
      runExtensionRuntimeAction: vi.fn(async (input) => ({
        ok: true,
        data: { plugin: { ...plugin, enabled: input.action !== 'disable' }, message: `${input.action} complete` }
      })),
      onExtensionRuntimeEvent: vi.fn(() => stop)
    }

    const wrapper = mount(ExtensionRuntimeFeatures, {
      props: { plugin },
      global: { plugins: [createPinia()] }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Runtime view is ready.')
    expect(wrapper.text()).toContain('System check')
    const treeButton = wrapper.findAll('button').find((button) => button.text().includes('System check'))
    await treeButton?.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('runTerminalText')).toEqual([['uptime']])

    const endpoint = wrapper.find('input[type="text"]')
    await endpoint.setValue('https://new.example.test/assets')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveExtensionConfiguration).toHaveBeenCalledWith({
      pluginId: plugin.pluginId,
      values: { endpoint: 'https://new.example.test/assets' }
    })
    expect(window.aiops.runExtensionRuntimeAction).toHaveBeenCalledWith({ pluginId: plugin.pluginId, action: 'reload' })

    const disable = wrapper.findAll('button').find((button) => button.text() === '禁用')
    await disable?.trigger('click')
    await flushPromises()
    expect(window.aiops.runExtensionRuntimeAction).toHaveBeenCalledWith({ pluginId: plugin.pluginId, action: 'disable' })

    wrapper.unmount()
    expect(stop).toHaveBeenCalled()
  })
})
