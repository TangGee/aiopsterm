import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import DatabaseWorkspaceTabs from '@/components/database/DatabaseWorkspaceTabs.vue'
import type { WorkspaceTab } from '@/services/database/databaseWorkspaceTypes'

const tabs = [
  { id: 'overview', kind: 'overview', title: 'Overview' },
  { id: 'data-orders', kind: 'data', title: 'orders' }
] as WorkspaceTab[]

describe('DatabaseWorkspaceTabs', () => {
  it('renders valid tabs with an icon-only close button', async () => {
    const wrapper = mount(DatabaseWorkspaceTabs, {
      props: {
        tabs,
        activeTabId: 'overview',
        overflowOpen: false,
        dbAiPaneOpen: false,
        canToggleDbAiPane: true
      }
    })

    const renderedTabs = wrapper.findAll('.db-workspace-tab')
    expect(renderedTabs).toHaveLength(2)
    expect(renderedTabs.every((tab) => tab.element.tagName === 'DIV')).toBe(true)
    expect(renderedTabs[0].attributes('role')).toBe('tab')
    expect(wrapper.find('.db-workspace-tab-scroll').attributes('role')).toBe('tablist')

    const closeButton = renderedTabs[1].find('.db-workspace-tab-close')
    expect(closeButton.element.tagName).toBe('BUTTON')
    expect(closeButton.attributes('title')).toBe('Close')
    expect(closeButton.attributes('aria-label')).toBe('Close orders')
    expect(closeButton.find('svg').exists()).toBe(true)

    await renderedTabs[1].trigger('click')
    await renderedTabs[1].trigger('keydown', { key: 'Enter' })
    await renderedTabs[1].trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('update:activeTabId')).toEqual([['data-orders'], ['data-orders'], ['data-orders']])

    await closeButton.trigger('click')
    expect(wrapper.emitted('closeTab')).toEqual([['data-orders']])
  })

  it('keeps overflow menu clicks inside the tab control', async () => {
    const windowClick = vi.fn()
    window.addEventListener('click', windowClick)
    const wrapper = mount(DatabaseWorkspaceTabs, {
      attachTo: document.body,
      props: {
        tabs,
        activeTabId: 'overview',
        overflowOpen: false,
        dbAiPaneOpen: false,
        canToggleDbAiPane: true
      }
    })

    try {
      await wrapper.find('button[title="Tabs"]').trigger('click')
      expect(wrapper.emitted('update:overflowOpen')).toEqual([[true]])
      expect(windowClick).not.toHaveBeenCalled()

      await wrapper.setProps({ overflowOpen: true })
      await wrapper.find('.db-tab-menu').trigger('click')
      expect(windowClick).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
      window.removeEventListener('click', windowClick)
    }
  })

  it('keeps the new SQL button outside the scrolling tab list when many tabs are open', async () => {
    const manyTabs = [
      tabs[0],
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `sql-${index + 1}`,
        kind: 'sql' as const,
        title: `Query ${index + 1}`,
        connectionId: 'conn-1',
        catalogName: 'main',
        schemaName: '',
        sql: '',
        savedSql: '',
        saving: false,
        saveError: null,
        resultTabs: [],
        activeResultTabId: 'overview',
        history: []
      }))
    ] as WorkspaceTab[]
    manyTabs[manyTabs.length - 1].title = 'external_agent_config_imports'
    const wrapper = mount(DatabaseWorkspaceTabs, {
      props: {
        tabs: manyTabs,
        activeTabId: manyTabs.at(-1)!.id,
        overflowOpen: true,
        dbAiPaneOpen: false,
        canToggleDbAiPane: true
      }
    })

    expect(wrapper.findAll('.db-workspace-tab')).toHaveLength(21)
    expect(wrapper.find('.db-workspace-tab-scroll .db-workspace-add-tab').exists()).toBe(false)
    const addButton = wrapper.find('.db-workspace-tabs > .db-workspace-add-tab')
    expect(addButton.exists()).toBe(true)
    const longestTabButton = wrapper.findAll('.db-tab-menu button').at(-1)!
    expect(longestTabButton.text()).toBe('external_agent_config_imports')
    expect(longestTabButton.attributes('title')).toBe('external_agent_config_imports')

    await addButton.trigger('click')
    expect(wrapper.emitted('openSqlConsole')).toEqual([[]])
  })
})
