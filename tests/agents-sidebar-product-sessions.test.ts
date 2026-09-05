import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

const sessions: ProductSessionRecord[] = [
  {
    id: 'classic-open',
    surface: 'classic',
    title: 'Production check',
    isOpen: true,
    projectRoot: '/srv/ops',
    lastKnownCwd: '/srv/ops/current',
    classicContext: {
      contexts: [
        {
          id: 'asset-ops',
          kind: 'hosts',
          label: 'ops-bastion',
          host: '10.0.0.8',
          port: 2222,
          username: 'deploy'
        },
        { id: 'asset-stage', kind: 'hosts', label: 'stage-api', host: '10.0.0.9' }
      ]
    },
    createdAt: 100,
    updatedAt: 200
  },
  {
    id: 'database-closed',
    surface: 'database',
    title: 'Metrics analysis',
    isOpen: false,
    database: { connectionId: 'conn-1', databaseName: 'metrics', schemaName: 'public' },
    createdAt: 100,
    updatedAt: 300
  },
  {
    id: 'codex-closed',
    surface: 'codex',
    title: 'Deploy fix',
    isOpen: false,
    projectRoot: '/srv/web',
    lastKnownCwd: '/srv/web/api',
    target: {
      kind: 'ssh',
      label: 'production web',
      assetName: 'prod-web-01',
      host: '192.0.2.10',
      port: 2202,
      username: 'root'
    },
    createdAt: 100,
    updatedAt: 100
  }
]

describe('AgentsSidebar product sessions', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useWorkspaceStore().config.language = 'en-US'
    vi.mocked(window.aiops.listProductSessions).mockResolvedValue({ ok: true, data: { sessions } })
    vi.mocked(window.aiops.deleteProductSession).mockImplementation(async (id) => ({
      ok: true,
      data: { id, deleted: true }
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sorts mixed surfaces and emits focus or restore from open state', async () => {
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    const rows = wrapper.findAll('.product-session-item')
    expect(rows.map((row) => row.attributes('data-session-id'))).toEqual([
      'database-closed',
      'classic-open',
      'codex-closed'
    ])
    expect(rows[0].text()).toContain('DB AI')
    expect(rows[0].find('.product-session-binding').text()).toBe('Connection: conn-1')
    expect(rows[0].find('.product-session-binding').attributes('data-binding-kind')).toBe('connection')
    expect(rows[0].text()).toContain('metrics / public')
    expect(rows[1].find('.product-session-open-dot').exists()).toBe(true)
    expect(rows[1].find('.conversation-title').text()).toBe('Production check')
    expect(rows[1].find('.product-session-binding').text()).toBe('ops-bastion +1')
    expect(rows[1].find('.product-session-binding').attributes('title')).toBe('ops-bastion (deploy@10.0.0.8:2222) · stage-api (10.0.0.9)')
    expect(rows[1].find('.product-session-scope').text()).toBe('/srv/ops/current')
    expect(rows[2].find('.conversation-title').text()).toBe('Deploy fix')
    expect(rows[2].find('.product-session-binding').text()).toBe('prod-web-01')
    expect(rows[2].find('.product-session-binding').attributes('title')).toBe('Host: prod-web-01 · root@192.0.2.10:2202')
    expect(rows[2].find('.product-session-scope').text()).toBe('/srv/web/api')

    await rows[1].find('.product-session-main').trigger('click')
    await rows[0].find('.product-session-main').trigger('click')
    expect(wrapper.emitted('requestProductSession')).toEqual([
      [{ action: 'focus', surface: 'classic', sessionId: 'classic-open' }],
      [{ action: 'restore', surface: 'database', sessionId: 'database-closed' }]
    ])

    await wrapper.find('.agents-search input').setValue('prod-web')
    expect(wrapper.findAll('.product-session-item')).toHaveLength(1)
    expect(wrapper.find('.product-session-item').attributes('data-session-id')).toBe('codex-closed')

    await wrapper.find('.agents-search input').setValue('deploy@10.0.0.8:2222')
    expect(wrapper.findAll('.product-session-item')).toHaveLength(1)
    expect(wrapper.find('.product-session-item').attributes('data-session-id')).toBe('classic-open')
    wrapper.unmount()
  })

  it('separates legacy target-derived Codex titles from their binding', async () => {
    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({
      ok: true,
      data: {
        sessions: [
          {
            id: 'codex-local',
            surface: 'codex',
            title: 'Local terminal',
            isOpen: false,
            projectRoot: '/home/tester',
            lastKnownCwd: '/home/tester',
            target: { kind: 'local', label: 'Local terminal' },
            createdAt: 100,
            updatedAt: 200
          },
          {
            id: 'database-main',
            surface: 'database',
            title: 'main',
            isOpen: false,
            database: { connectionId: 'main', databaseName: 'main' },
            createdAt: 100,
            updatedAt: 100
          }
        ]
      }
    })
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    const codex = wrapper.find('[data-session-id="codex-local"]')
    expect(codex.find('.conversation-title').text()).toBe('Codex CLI')
    expect(codex.find('.product-session-binding').text()).toBe('Local terminal')
    expect(codex.find('.product-session-scope').text()).toBe('/home/tester')

    const database = wrapper.find('[data-session-id="database-main"]')
    expect(database.find('.conversation-title').text()).toBe('main')
    expect(database.find('.product-session-binding').text()).toBe('Connection: main')
    expect(database.find('.product-session-scope').exists()).toBe(false)
    expect(codex.find('.delete-btn').attributes('aria-label')).toBe('Delete session permanently: Codex CLI')
    wrapper.unmount()
  })

  it('searches every selected Classic host and ignores the top-level target', async () => {
    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({
      ok: true,
      data: {
        sessions: [{
          id: 'classic-dual-target',
          surface: 'classic',
          title: 'Host handoff',
          isOpen: false,
          target: { kind: 'local', label: 'Current local terminal' },
          classicContext: {
            contexts: [
              { id: 'asset-bastion', kind: 'hosts', label: 'previous-bastion', host: '10.8.0.9', username: 'ops' },
              { id: 'asset-worker', kind: 'hosts', label: 'worker-02', host: '10.8.0.10', username: 'deploy' }
            ]
          },
          createdAt: 100,
          updatedAt: 100
        }]
      }
    })
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    await wrapper.find('.agents-search input').setValue('ops@10.8.0.9')
    expect(wrapper.find('[data-session-id="classic-dual-target"]').exists()).toBe(true)
    await wrapper.find('.agents-search input').setValue('worker-02')
    expect(wrapper.find('[data-session-id="classic-dual-target"]').exists()).toBe(true)
    await wrapper.find('.agents-search input').setValue('Current local terminal')
    expect(wrapper.find('[data-session-id="classic-dual-target"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers all three new-session surfaces', async () => {
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    await wrapper.find('[data-testid="agents-new-session-open"]').trigger('click')
    expect(wrapper.find('[data-testid="agents-new-session-menu"]').exists()).toBe(true)
    await wrapper.find('[data-testid="agents-new-classic"]').trigger('click')
    await wrapper.find('[data-testid="agents-new-session-open"]').trigger('click')
    await wrapper.find('[data-testid="agents-new-codex"]').trigger('click')
    await wrapper.find('[data-testid="agents-new-session-open"]').trigger('click')
    await wrapper.find('[data-testid="agents-new-database"]').trigger('click')

    expect(wrapper.emitted('requestProductSession')).toEqual([
      [{ action: 'create', surface: 'classic' }],
      [{ action: 'create', surface: 'codex' }],
      [{ action: 'create', surface: 'database' }]
    ])
    wrapper.unmount()
  })

  it('requires confirmation before permanent deletion', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm')
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    const deleteButton = wrapper.find('[data-session-id="classic-open"] .delete-btn')
    await deleteButton.trigger('keydown', { key: ' ', code: 'Space' })
    expect(wrapper.emitted('requestProductSession')).toBeUndefined()
    await deleteButton.trigger('click')
    const dialog = () => document.querySelector<HTMLElement>('[data-testid="agents-delete-dialog"]')
    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain('Production check')
    expect(document.activeElement?.textContent).toContain('Cancel')
    dialog()?.querySelector<HTMLButtonElement>('footer button')?.click()
    await flushPromises()
    expect(window.aiops.deleteProductSession).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()

    await deleteButton.trigger('click')
    dialog()?.querySelector<HTMLButtonElement>('footer button.danger')?.click()
    await flushPromises()
    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(window.aiops.deleteProductSession).toHaveBeenCalledWith('classic-open')
    expect(wrapper.find('[data-session-id="classic-open"]').exists()).toBe(false)

    await wrapper.find('[data-session-id="codex-closed"] .delete-btn').trigger('click')
    dialog()?.querySelector<HTMLButtonElement>('footer button.danger')?.click()
    await flushPromises()
    expect(window.aiops.deleteProductSession).toHaveBeenLastCalledWith('codex-closed')
    wrapper.unmount()
  })

  it('renders empty and failed catalog states', async () => {
    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({ ok: true, data: { sessions: [] } })
    const emptyWrapper = mount(AgentsSidebar)
    await flushPromises()
    expect(emptyWrapper.text()).toContain('No sessions')
    emptyWrapper.unmount()

    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({
      ok: false,
      errorCode: 'PRODUCT_SESSION_LIST_FAILED',
      errorMessage: 'Catalog unavailable'
    })
    const failedWrapper = mount(AgentsSidebar)
    await flushPromises()
    expect(failedWrapper.text()).toContain('Catalog unavailable')
    failedWrapper.unmount()
  })

  it('refreshes from product-session change events and unsubscribes', async () => {
    vi.useFakeTimers()
    let changed: (() => void) | undefined
    const unsubscribe = vi.fn()
    vi.mocked(window.aiops.onProductSessionChanged).mockImplementation((listener) => {
      changed = () => listener({ type: 'deleted', id: 'classic-open' })
      return unsubscribe
    })
    const wrapper = mount(AgentsSidebar)
    await flushPromises()
    expect(wrapper.find('[data-session-id="classic-open"]').exists()).toBe(true)

    vi.mocked(window.aiops.listProductSessions).mockResolvedValue({
      ok: true,
      data: { sessions: sessions.filter((session) => session.id !== 'classic-open') }
    })
    changed?.()
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.find('[data-session-id="classic-open"]').exists()).toBe(false)

    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('loads every backend page while rendering only the visible session window', async () => {
    const catalog = Array.from({ length: 1005 }, (_, index): ProductSessionRecord => ({
      id: `deep-${index}`,
      surface: index % 3 === 0 ? 'classic' : index % 3 === 1 ? 'codex' : 'database',
      title: `Deep session ${index}`,
      isOpen: false,
      createdAt: index + 1,
      updatedAt: index + 1
    })).reverse()
    vi.mocked(window.aiops.listProductSessions).mockImplementation(async (input) => ({
      ok: true,
      data: {
        sessions: catalog.slice(input?.offset || 0, (input?.offset || 0) + (input?.limit || 200))
      }
    }))
    const wrapper = mount(AgentsSidebar)
    await flushPromises()

    expect(window.aiops.listProductSessions).toHaveBeenCalledWith({ limit: 500, offset: 0 })
    expect(window.aiops.listProductSessions).toHaveBeenCalledWith({ limit: 500, offset: 500 })
    expect(window.aiops.listProductSessions).toHaveBeenCalledWith({ limit: 500, offset: 1000 })
    expect(wrapper.findAll('.product-session-item')).toHaveLength(20)

    await wrapper.find('.agents-search input').setValue('deep session 0')
    expect(wrapper.findAll('.product-session-item')).toHaveLength(1)
    expect(wrapper.find('.product-session-item').attributes('data-session-id')).toBe('deep-0')
    wrapper.unmount()
  })
})
