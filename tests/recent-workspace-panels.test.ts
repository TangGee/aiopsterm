import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { AiopsAssetRecord, AiopsAssetSnapshot } from '@shared/contracts/assets'
import { filterRecentWorkspaceEntries, findOpenHostPanel } from '@/services/workspace/recentWorkspaceHostsRuntime'
import RecentWorkspacePanels from '@/components/RecentWorkspacePanels.vue'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { createEmptyTerminalPanel } from '@/services/terminal/terminalPanelRuntime'

enableAutoUnmount(afterEach)

const terminalPanel = (id: string, title: string): TerminalPanel => ({
  ...createEmptyTerminalPanel(id, title),
  sessionId: `session-${id}`
})

const hostAsset = (id: string, patch: Partial<AiopsAssetRecord> = {}): AiopsAssetRecord => ({
  id, uuid: id, name: id, title: id, host: '10.0.0.8', ip: '10.0.0.8',
  port: 2222, username: 'deploy', group: 'Production', group_name: 'Production',
  status: 'unknown', tags: ['api'], asset_type: 'person', auth_type: 'password',
  comment: '', data_source: 'manual', ...patch
})

const originalListAssets = window.aiops.listAssets
const originalCreateTerminal = window.aiops.createTerminal

describe('RecentWorkspacePanels', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.aiops.listAssets = vi.fn(async () => ({ assets: [], folders: [] }))
    window.aiops.createTerminal = vi.fn(originalCreateTerminal)
  })

  afterEach(() => {
    window.aiops.listAssets = originalListAssets
    window.aiops.createTerminal = originalCreateTerminal
  })

  it('shows MRU panels, searches metadata, and activates the selected result', async () => {
    const workspace = useWorkspaceStore()
    const terminal = terminalPanel('terminal-a', 'Production terminal')
    const projectFile: TerminalPanel = {
      ...terminalPanel('project-file-a', 'main.ts'),
      kind: 'project-file',
      projectFile: {
        source: 'codex',
        sessionId: 'session-file',
        projectRoot: '/work/demo',
        relativePath: 'src/main.ts'
      }
    }
    workspace.panels = [terminal, projectFile]
    workspace.selectPanelForLifecycle(projectFile.id)
    workspace.selectPanelForLifecycle(terminal.id)
    const wrapper = mount(RecentWorkspacePanels, { attachTo: document.body })

    expect(workspace.triggerShortcutAction('recentPanels')).toBe(true)
    await flushPromises()

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.findAll('.recent-workspace-panels-row').map((row) => row.attributes('data-panel-id'))).toEqual([
      terminal.id,
      projectFile.id
    ])
    const search = wrapper.get('input[type="search"]')
    expect(document.activeElement).toBe(search.element)
    await search.setValue('demo main.ts')
    expect(wrapper.findAll('.recent-workspace-panels-row')).toHaveLength(1)
    expect(wrapper.get('.recent-workspace-panels-row').attributes('data-panel-id')).toBe(projectFile.id)

    await search.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(workspace.activePanelId).toBe(projectFile.id)
    expect(workspace.recentPanelsOpen).toBe(false)
    expect(workspace.panelFocusRequest).toEqual(expect.objectContaining({
      panelId: projectFile.id,
      cause: 'keyboard'
    }))
  })

  it('supports keyboard selection and restores focus when cancelled', async () => {
    const workspace = useWorkspaceStore()
    const first = terminalPanel('terminal-a', 'First')
    const second = terminalPanel('terminal-b', 'Second')
    workspace.panels = [first, second]
    workspace.selectPanelForLifecycle(first.id)
    workspace.selectPanelForLifecycle(second.id)
    const previousFocus = document.createElement('button')
    document.body.appendChild(previousFocus)
    previousFocus.focus()
    const wrapper = mount(RecentWorkspacePanels, { attachTo: document.body })

    workspace.openRecentPanels()
    await flushPromises()
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(workspace.activePanelId).toBe(second.id)

    previousFocus.focus()
    workspace.openRecentPanels()
    await flushPromises()
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(workspace.recentPanelsOpen).toBe(false)
    expect(document.activeElement).toBe(previousFocus)
    previousFocus.remove()
  })

  it('routes back and forward shortcut actions through activation history', () => {
    const workspace = useWorkspaceStore()
    const first = terminalPanel('terminal-a', 'First')
    const second = terminalPanel('terminal-b', 'Second')
    workspace.panels = [first, second]
    workspace.selectPanelForLifecycle(first.id)
    workspace.selectPanelForLifecycle(second.id)
    workspace.mode = 'agents'
    workspace.activeModule = 'settings'

    expect(workspace.triggerShortcutAction('navigatePanelBack')).toBe(true)
    expect(workspace.activePanelId).toBe(first.id)
    expect(workspace.mode).toBe('agents')
    expect(workspace.activeModule).toBe('settings')
    expect(workspace.panelFocusRequest).toEqual(expect.objectContaining({
      panelId: first.id,
      cause: 'keyboard'
    }))
    expect(workspace.triggerShortcutAction('navigatePanelForward')).toBe(true)
    expect(workspace.activePanelId).toBe(second.id)
    expect(workspace.panelFocusRequest).toEqual(expect.objectContaining({
      panelId: second.id,
      cause: 'keyboard'
    }))
  })

  it('emits a new focus request when explicitly activating the current panel', () => {
    const workspace = useWorkspaceStore()
    const panel = terminalPanel('terminal-a', 'First')
    workspace.panels = [panel]
    workspace.selectPanelForLifecycle(panel.id)

    expect(workspace.activatePanelSurface(panel.id, { cause: 'pointer' })).toBe(true)
    const firstSequence = workspace.panelFocusRequest?.sequence || 0
    expect(workspace.panelFocusRequest).toEqual(expect.objectContaining({
      panelId: panel.id,
      cause: 'pointer'
    }))

    expect(workspace.activatePanelSurface(panel.id, { cause: 'keyboard' })).toBe(true)
    expect(workspace.panelFocusRequest?.sequence).toBe(firstSequence + 1)
    expect(workspace.panelFocusRequest?.cause).toBe('keyboard')
  })

  it('keeps all open panels ahead of unopened hosts and reuses an open SSH tab', async () => {
    const workspace = useWorkspaceStore()
    const opened = hostAsset('opened')
    const unopened = hostAsset('unopened', { host: '10.0.0.9', title: 'API backup' })
    window.aiops.listAssets = vi.fn(async () => ({ assets: [unopened, opened, unopened], folders: [] }))
    const ssh = {
      ...terminalPanel('ssh', 'API primary'),
      sshSession: { assetId: opened.id, assetName: opened.name, host: opened.host, port: opened.port, username: opened.username }
    }
    const local = terminalPanel('local', 'Local')
    workspace.panels = [ssh, local]
    workspace.selectPanelForLifecycle(ssh.id)
    workspace.selectPanelForLifecycle(local.id)
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()

    expect(wrapper.findAll('[role="option"]').map((row) => row.attributes('data-panel-id') || row.attributes('data-asset-id')))
      .toEqual(['local', 'ssh', 'unopened'])
    expect(wrapper.get('[data-asset-id="unopened"]').text()).toContain('未打开的主机')
    await wrapper.get('[data-panel-id="ssh"]').trigger('click')
    expect(workspace.activePanelId).toBe('ssh')
    expect(workspace.panels).toHaveLength(2)
    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
  })

  it.each(['keyboard', 'pointer'] as const)('opens a host in a new tab by %s and does not offer it again', async (cause) => {
    const workspace = useWorkspaceStore()
    const previous = terminalPanel('previous', 'Existing')
    workspace.panels = [previous]
    workspace.selectPanelForLifecycle(previous.id)
    const host = hostAsset('backup', { title: 'Backup API' })
    window.aiops.listAssets = vi.fn(async () => ({ assets: [host], folders: [] }))
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    const search = wrapper.get('input')
    await search.setValue(' BACKUP deploy 2222 production ')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    if (cause === 'keyboard') await search.trigger('keydown', { key: 'Enter' })
    else await wrapper.get('[data-asset-id="backup"]').trigger('click')
    await flushPromises()

    expect(window.aiops.createTerminal).toHaveBeenCalledTimes(1)
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ssh', assetId: 'backup', title: 'Backup API', panelId: workspace.activePanelId
    }))
    expect(workspace.panels).toHaveLength(2)
    expect(workspace.panels.find((panel) => panel.id === workspace.activePanelId)?.sshSession?.assetId).toBe('backup')
    expect(workspace.panelFocusRequest).toMatchObject({ panelId: workspace.activePanelId, cause })
    expect(workspace.recentPanelsOpen).toBe(false)
    workspace.openRecentPanels()
    await flushPromises()
    expect(wrapper.find('[data-asset-id="backup"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-panel-id]')).toHaveLength(2)
  })

  it('opens a local host from the welcome screen', async () => {
    const workspace = useWorkspaceStore()
    const host = hostAsset('local-host', { isLocalShell: true, host: '127.0.0.1' })
    window.aiops.listAssets = vi.fn(async () => ({ assets: [host], folders: [] }))
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    await wrapper.get('[data-asset-id="local-host"]').trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }))
    expect(workspace.panels.find((panel) => panel.id === workspace.activePanelId)?.sessionId).toBeTruthy()
    expect(workspace.recentPanelsOpen).toBe(false)
  })

  it('rejects repeated Enter while connecting and does not steal focus after dismissal', async () => {
    const workspace = useWorkspaceStore()
    const previous = terminalPanel('previous', 'Existing')
    workspace.panels = [previous]
    workspace.selectPanelForLifecycle(previous.id)
    const host = hostAsset('slow')
    window.aiops.listAssets = vi.fn(async () => ({ assets: [host], folders: [] }))
    let resolveConnection!: (session: Awaited<ReturnType<typeof originalCreateTerminal>>) => void
    window.aiops.createTerminal = vi.fn(() => new Promise<Awaited<ReturnType<typeof originalCreateTerminal>>>((resolve) => { resolveConnection = resolve }))
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    await wrapper.get('input').setValue('slow')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    expect(window.aiops.createTerminal).toHaveBeenCalledTimes(1)
    expect(workspace.activePanelId).toBe(previous.id)
    await wrapper.get('input').trigger('keydown', { key: 'Escape' })
    resolveConnection(await originalCreateTerminal({ kind: 'ssh', assetId: host.id }))
    await flushPromises()
    expect(workspace.recentPanelsOpen).toBe(false)
    expect(workspace.activePanelId).toBe(previous.id)
    expect(workspace.panelFocusRequest).toBeNull()
    expect(workspace.panels).toHaveLength(2)
  })

  it('removes a failed connection tab and leaves the host available to retry', async () => {
    const workspace = useWorkspaceStore()
    const previous = terminalPanel('previous', 'Existing')
    workspace.panels = [previous]
    workspace.selectPanelForLifecycle(previous.id)
    window.aiops.listAssets = vi.fn(async () => ({ assets: [hostAsset('failed')], folders: [] }))
    window.aiops.createTerminal = vi.fn(async () => { throw new Error('Authentication failed') })
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    await wrapper.get('[data-asset-id="failed"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Authentication failed')
    expect(workspace.panels.map((panel) => panel.id)).toEqual(['previous'])
    expect(workspace.activePanelId).toBe('previous')
    expect(workspace.recentPanelsOpen).toBe(true)
    expect(wrapper.get('[data-asset-id="failed"]').attributes('disabled')).toBeUndefined()
  })

  it.each(['rejected', 'malformed', 'unavailable'])('keeps open panels usable when host loading is %s', async (failure) => {
    const workspace = useWorkspaceStore()
    workspace.panels = [terminalPanel('existing', 'Existing')]
    if (failure === 'rejected') window.aiops.listAssets = vi.fn(async () => { throw new Error('Offline') })
    if (failure === 'malformed') window.aiops.listAssets = vi.fn(async () => ({ assets: [{}], folders: [] })) as any
    if (failure === 'unavailable') window.aiops.listAssets = undefined as any
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    await wrapper.get('[data-panel-id="existing"]').trigger('click')
    expect(workspace.activePanelId).toBe('existing')
    expect(workspace.recentPanelsOpen).toBe(false)
  })

  it('refreshes hosts on reopening and ignores a stale catalog response', async () => {
    const workspace = useWorkspaceStore()
    let resolveOld!: (snapshot: AiopsAssetSnapshot) => void
    window.aiops.listAssets = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ assets: [hostAsset('fresh')], folders: [] })
    const wrapper = mount(RecentWorkspacePanels)
    workspace.openRecentPanels()
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    workspace.closeRecentPanels()
    await flushPromises()
    workspace.openRecentPanels()
    await flushPromises()
    resolveOld({ assets: [hostAsset('stale')], folders: [] })
    await flushPromises()
    expect(wrapper.find('[data-asset-id="fresh"]').exists()).toBe(true)
    expect(wrapper.find('[data-asset-id="stale"]').exists()).toBe(false)
    await wrapper.get('input').setValue('missing')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('没有匹配的面板或主机')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
  })

})


describe('recent workspace host matching', () => {
  it('matches multiple terms without case sensitivity and keeps panel ordering', () => {
    const panels = [terminalPanel('second', 'API second'), terminalPanel('first', 'API first')]
    const host = hostAsset('host', { title: 'API third' })
    expect(filterRecentWorkspaceEntries(panels, [host], '  API  ').map((entry) => entry.key))
      .toEqual(['panel:second', 'panel:first', 'host:host'])
    expect(filterRecentWorkspaceEntries(panels, [host], 'DEPLOY 10.0.0.8 2222 Production').map((entry) => entry.key))
      .toEqual(['host:host'])
    expect(filterRecentWorkspaceEntries([], [host], 'API missing')).toEqual([])
  })

  it('matches by asset identity and uses host, port and username only for terminals without an asset id', () => {
    const host = hostAsset('host')
    const ssh = { ...terminalPanel('ssh', 'Renamed'), sshSession: {
      assetName: host.name, host: host.host, port: host.port, username: host.username
    } }
    expect(findOpenHostPanel([ssh], host)?.id).toBe('ssh')
    expect(findOpenHostPanel([ssh], { ...host, username: 'root' })).toBeUndefined()
    expect(findOpenHostPanel([ssh], { ...host, port: 22 })).toBeUndefined()
    const differentAsset = { ...ssh, sshSession: { ...ssh.sshSession, assetId: 'other' } }
    expect(findOpenHostPanel([differentAsset], host)).toBeUndefined()
    const sameAsset = { ...ssh, sshSession: { ...ssh.sshSession, assetId: host.id, host: 'old-address' } }
    expect(filterRecentWorkspaceEntries([sameAsset], [host], '').map((entry) => entry.key)).toEqual(['panel:ssh'])
    expect(filterRecentWorkspaceEntries([sameAsset], [host], 'production 10.0.0.8').map((entry) => entry.key)).toEqual(['panel:ssh'])
    expect(filterRecentWorkspaceEntries([], [host], '').map((entry) => entry.key)).toEqual(['host:host'])
  })
})
