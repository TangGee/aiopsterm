import { effectScope, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  createWorkspacePanelNavigationRuntime,
  matchesWorkspacePanelQuery
} from '@/services/workspace/workspacePanelNavigationRuntime'
import { createEmptyTerminalPanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { CenterSurface, ModuleKey } from '@/config/navigation'

const terminalPanel = (id: string, title = id): TerminalPanel => ({
  ...createEmptyTerminalPanel(id, title),
  sessionId: `session-${id}`
})

const createHarness = () => {
  const scope = effectScope()
  const state = {
    mode: ref<'terminal' | 'agents'>('terminal'),
    activeModule: ref<ModuleKey>('workspace'),
    activeCenterSurface: ref<CenterSurface>('main-workspace'),
    activePanelId: ref('panel-main'),
    panels: ref<TerminalPanel[]>([createEmptyTerminalPanel('panel-main', '欢迎')])
  }
  const runtime = scope.run(() => createWorkspacePanelNavigationRuntime(state))!
  return { scope, state, runtime }
}

describe('workspacePanelNavigationRuntime', () => {
  it('tracks MRU order and browser-style back and forward history', () => {
    const { scope, state, runtime } = createHarness()
    const panels = [terminalPanel('a'), terminalPanel('b'), terminalPanel('c')]
    state.panels.value = panels
    state.activePanelId.value = 'a'
    state.activePanelId.value = 'b'
    state.activePanelId.value = 'c'

    expect(runtime.recentPanelIds.value).toEqual(['c', 'b', 'a'])
    expect(runtime.panelNavigationHistory.value).toEqual(['a', 'b', 'c'])
    expect(runtime.navigatePanelBack()).toBe(true)
    expect(state.activePanelId.value).toBe('b')
    expect(runtime.navigatePanelBack()).toBe(true)
    expect(state.activePanelId.value).toBe('a')
    expect(runtime.navigatePanelBack()).toBe(false)
    expect(runtime.navigatePanelForward()).toBe(true)
    expect(state.activePanelId.value).toBe('b')
    scope.stop()
  })

  it('truncates the forward branch after a normal activation and prunes closed panels', () => {
    const { scope, state, runtime } = createHarness()
    state.panels.value = [terminalPanel('a'), terminalPanel('b'), terminalPanel('c')]
    state.activePanelId.value = 'a'
    state.activePanelId.value = 'b'
    state.activePanelId.value = 'c'
    runtime.navigatePanelBack()
    state.activePanelId.value = 'a'

    expect(runtime.panelNavigationHistory.value).toEqual(['a', 'b', 'a'])
    expect(runtime.navigatePanelForward()).toBe(false)

    state.panels.value = state.panels.value.filter((panel) => panel.id !== 'b')
    expect(runtime.panelNavigationHistory.value).toEqual(['a'])
    expect(runtime.recentPanelIds.value).toEqual(['a', 'c'])
    scope.stop()
  })

  it('cycles through the current tab-bar order independently of history', () => {
    const { scope, state, runtime } = createHarness()
    const panels = [terminalPanel('a'), terminalPanel('b'), terminalPanel('c')]
    state.panels.value = panels
    state.activePanelId.value = 'b'
    state.activePanelId.value = 'c'

    expect(runtime.navigatePanelByOrderForward()).toBe(true)
    expect(state.activePanelId.value).toBe('a')
    expect(runtime.navigatePanelByOrderBack()).toBe(true)
    expect(state.activePanelId.value).toBe('c')
    expect(runtime.panelNavigationHistory.value).toEqual(['b', 'c', 'a', 'c'])
    scope.stop()
  })

  it('activates a terminal panel without changing its source module or center surface', () => {
    const { scope, state, runtime } = createHarness()
    state.mode.value = 'agents'
    state.activeModule.value = 'knowledge'
    state.activeCenterSurface.value = 'settings'
    state.panels.value = [terminalPanel('a'), terminalPanel('b')]
    state.activePanelId.value = 'a'

    expect(runtime.activatePanelSurface('b')).toBe(true)
    expect(state.activePanelId.value).toBe('b')
    expect(state.mode.value).toBe('agents')
    expect(state.activeModule.value).toBe('knowledge')
    expect(state.activeCenterSurface.value).toBe('settings')
    scope.stop()
  })

  it('reveals the shared main workspace without changing its source module', () => {
    const { scope, state, runtime } = createHarness()
    state.activeModule.value = 'settings'
    state.activeCenterSurface.value = 'settings'
    state.panels.value = [terminalPanel('a'), terminalPanel('b')]

    expect(runtime.revealPanelSurface('b')).toBe(true)
    expect(state.activePanelId.value).toBe('b')
    expect(state.activeModule.value).toBe('settings')
    expect(state.activeCenterSurface.value).toBe('main-workspace')
    scope.stop()
  })

  it('excludes the welcome placeholder and caps navigation data at fifty entries', () => {
    const { scope, state, runtime } = createHarness()
    expect(runtime.recentWorkspacePanels.value).toEqual([])

    const panels = Array.from({ length: 55 }, (_, index) => terminalPanel(`panel-${index}`))
    state.panels.value = panels
    panels.forEach((panel) => {
      state.activePanelId.value = panel.id
    })

    expect(runtime.recentPanelIds.value).toHaveLength(50)
    expect(runtime.panelNavigationHistory.value).toHaveLength(50)
    expect(runtime.recentPanelIds.value[0]).toBe('panel-54')
    expect(runtime.panelNavigationHistory.value[0]).toBe('panel-5')
    scope.stop()
  })

  it('searches titles, paths, hosts, users, and session metadata with multiple terms', () => {
    const sshPanel: TerminalPanel = {
      ...terminalPanel('ssh', 'Production logs'),
      cwd: '/srv/api',
      sshSession: {
        host: '10.0.0.8',
        port: 22,
        username: 'deploy',
        assetName: 'API server'
      }
    }
    const projectPanel: TerminalPanel = {
      ...terminalPanel('file', 'main.ts'),
      kind: 'project-file',
      projectFile: {
        source: 'codex',
        sessionId: 'session-123',
        projectRoot: '/work/demo',
        relativePath: 'src/main.ts'
      }
    }

    expect(matchesWorkspacePanelQuery(sshPanel, 'deploy 10.0.0.8')).toBe(true)
    expect(matchesWorkspacePanelQuery(sshPanel, 'production missing')).toBe(false)
    expect(matchesWorkspacePanelQuery(projectPanel, 'demo main.ts')).toBe(true)
    expect(matchesWorkspacePanelQuery(projectPanel, 'CODEX session-123')).toBe(true)
  })
})
