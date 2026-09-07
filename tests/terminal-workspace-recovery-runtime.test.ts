import { describe, expect, it, vi } from 'vitest'
import { createTerminalWorkspaceRecoveryRuntime, recoveryTabFromPanel } from '@/services/terminal/terminalWorkspaceRecoveryRuntime'
import { createEmptyTerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { TerminalRecoverySnapshot } from '@shared/contracts/terminalRecovery'

const snapshot: TerminalRecoverySnapshot = { version: 1, activePanelId: 'b', tabs: [
  { id: 'a', title: 'Local', cwd: '/tmp/a', history: 'old local', sessionId: 'live', resume: true, splitGroupId: 'group', splitOrder: 0 },
  { id: 'b', title: 'SSH', cwd: '/srv/app', history: 'old SSH', resume: true, splitGroupId: 'group', splitSourceId: 'a', split: 'right', splitOrder: 1, ssh: { host: 'host', username: 'user', port: 22, assetName: 'host' } }
] }
const fixture = () => {
  const workspace = {
    panels: [createEmptyTerminalPanel('panel-main', 'Welcome')], activePanelId: 'panel-main', terminalSettings: { restoreTerminalTabs: true },
    setTopNotice: vi.fn(),
    restorePanelCollection: vi.fn((panels: TerminalPanel[], selected: string) => { workspace.panels = panels; workspace.activePanelId = selected; return true }),
    applyLocalTerminalSession: vi.fn(), applySshTerminalSession: vi.fn()
  }
  const load = vi.fn(async () => ({ snapshot, liveSessions: [{ id: 'live', kind: 'local' as const, shell: '/bin/bash', cwd: '/tmp/a' }] }))
  const save = vi.fn(async (_snapshot: TerminalRecoverySnapshot) => {})
  const start = vi.fn(async (_panel: TerminalPanel) => true)
  const readHistory = vi.fn(async (panel: TerminalPanel) => panel.output)
  const runtime = createTerminalWorkspaceRecoveryRuntime({ workspace: workspace as unknown as ReturnType<typeof useWorkspaceStore>, afterDomUpdate: async () => {}, start, readHistory, client: { loadTerminalRecovery: () => load, saveTerminalRecovery: () => save } })
  return { workspace, load, save, start, readHistory, runtime }
}

describe('workspace terminal recovery', () => {
  it('restores history and split layout before starting shells, reusing live Main sessions', async () => {
    const f = fixture()
    f.start.mockImplementation(async (panel) => {
      expect(panel.output).toContain('old SSH')
      expect(f.workspace.activePanelId).toBe('b')
      return true
    })
    await f.runtime.restore()
    expect(f.start).toHaveBeenCalledTimes(1)
    expect(f.workspace.applyLocalTerminalSession).toHaveBeenCalledWith('a', expect.objectContaining({ id: 'live' }))
    expect(f.workspace.panels[1]).toMatchObject({ splitSourceId: 'a', split: 'right', cwd: '/srv/app' })
    expect(f.workspace.panels[1].sessionId).toBeUndefined()
  })
  it('does not overwrite a terminal opened while disk recovery is pending', async () => {
    const f = fixture()
    const restoring = f.runtime.restore()
    f.workspace.panels.push(createEmptyTerminalPanel('user-opened', 'Local'))
    await restoring
    expect(f.workspace.restorePanelCollection).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('saves only display metadata, clears disabled recovery, and skips identical checkpoints', async () => {
    const f = fixture()
    await f.runtime.restore(); await f.runtime.save(); await f.runtime.save()
    expect(f.save).toHaveBeenCalledTimes(1)
    expect(f.save.mock.calls[0][0].tabs).toHaveLength(2)
    f.workspace.terminalSettings.restoreTerminalTabs = false
    await f.runtime.save()
    expect(f.save.mock.calls[1][0].tabs).toEqual([])
  })
  it('does not start disconnected tabs or revive a removed panel during recovery', async () => {
    const f = fixture()
    f.load.mockResolvedValue({ snapshot: { ...snapshot, tabs: [{ ...snapshot.tabs[1], resume: false }] }, liveSessions: [] })
    await f.runtime.restore()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('bounds histories and never serializes SSH credentials or connection pool aliases', () => {
    const panel = { ...createEmptyTerminalPanel('ssh', 'SSH'), sshSession: { host: 'h', port: 22, username: 'u', assetName: 'a', password: 'SECRET', forkFromConnectionId: 'old' } }
    const tab = recoveryTabFromPanel(panel, 'x'.repeat(256 * 1024))
    expect(tab.history).toHaveLength(128 * 1024)
    expect(JSON.stringify(tab)).not.toMatch(/SECRET|forkFromConnectionId/)
  })
  it('reports storage failures and keeps the application usable', async () => {
    const f = fixture()
    f.load.mockRejectedValue(new Error('disk unavailable'))
    await f.runtime.restore()
    expect(f.workspace.setTopNotice).toHaveBeenCalledWith('disk unavailable')
    expect(f.workspace.panels[0].id).toBe('panel-main')
  })
})
