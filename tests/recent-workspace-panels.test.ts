import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RecentWorkspacePanels from '@/components/RecentWorkspacePanels.vue'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { createEmptyTerminalPanel } from '@/services/terminal/terminalPanelRuntime'

enableAutoUnmount(afterEach)

const terminalPanel = (id: string, title: string): TerminalPanel => ({
  ...createEmptyTerminalPanel(id, title),
  sessionId: `session-${id}`
})

describe('RecentWorkspacePanels', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
    expect(workspace.mode).toBe('terminal')
    expect(workspace.activeModule).toBe('workspace')
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
})
