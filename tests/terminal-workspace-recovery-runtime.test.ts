import { describe, expect, it, vi } from 'vitest'
import { createTerminalWorkspaceRecoveryRuntime, recoveryTabFromPanel } from '@/services/terminal/terminalWorkspaceRecoveryRuntime'
import { createEmptyTerminalPanel, defaultTerminalPanelTitle } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { TerminalRecoverySnapshot } from '@shared/contracts/terminalRecovery'

const snapshot: TerminalRecoverySnapshot = { version: 1, activePanelId: 'b', tabs: [
  { id: 'a', title: 'Local', cwd: '/tmp/a', history: 'old local', sessionId: 'live', resume: true, splitGroupId: 'group', splitOrder: 0 },
  { id: 'b', title: 'SSH', cwd: '/srv/app', history: 'old SSH', resume: true, splitGroupId: 'group', splitSourceId: 'a', split: 'right', splitOrder: 1, ssh: { host: 'host', username: 'user', port: 22, assetName: 'host' } }
] }
const fixture = () => {
  const workspace = {
    panels: [createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)], activePanelId: 'panel-main', terminalSettings: { restoreTerminalTabs: true },
    setTopNotice: vi.fn(),
    restorePanelCollection: vi.fn((panels: TerminalPanel[], selected: string) => { workspace.panels = panels; workspace.activePanelId = selected; return true }),
    applyLocalTerminalSession: vi.fn(), applySshTerminalSession: vi.fn()
  }
  const load = vi.fn(async () => ({ snapshot, liveSessions: [{ id: 'live', kind: 'local' as const, shell: '/bin/bash', cwd: '/tmp/a' }] }))
  const save = vi.fn(async (_snapshot: TerminalRecoverySnapshot) => {})
  const start = vi.fn(async (_panel: TerminalPanel) => true)
  const readHistory = vi.fn(async (panel: TerminalPanel) => panel.output)
  const beforeRestore = vi.fn()
  const afterDomUpdate = vi.fn(async () => {})
  const runtime = createTerminalWorkspaceRecoveryRuntime({ workspace: workspace as unknown as ReturnType<typeof useWorkspaceStore>, beforeRestore, afterDomUpdate, start, readHistory, client: { loadTerminalRecovery: () => load, saveTerminalRecovery: () => save } })
  return { workspace, load, save, start, readHistory, runtime, beforeRestore, afterDomUpdate }
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
  it('does not overwrite a single editor opened while the checkpoint loads', async () => {
    const f = fixture(); const restoring = f.runtime.restore()
    f.workspace.panels[0].kind = 'local-file'
    f.workspace.panels[0].localFile = { filePath: '/tmp/editor', dirty: true }
    await restoring
    expect(f.workspace.restorePanelCollection).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('honors disabling recovery while its load is in flight', async () => {
    const f = fixture(); const restoring = f.runtime.restore()
    f.workspace.terminalSettings.restoreTerminalTabs = false
    await restoring
    expect(f.workspace.restorePanelCollection).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('does not restore or show stale load errors after disposal', async () => {
    const f = fixture(); f.load.mockRejectedValue(new Error('late failure'))
    const restoring = f.runtime.restore(); f.runtime.dispose(); await restoring
    expect(f.workspace.setTopNotice).not.toHaveBeenCalled()
    expect(f.workspace.restorePanelCollection).not.toHaveBeenCalled()
    await f.runtime.save(); expect(f.save).not.toHaveBeenCalled()
  })
  it('rebuilds placeholder views before rendering history and opening a shell', async () => {
    const f = fixture(); await f.runtime.restore()
    expect(f.beforeRestore.mock.invocationCallOrder[0]).toBeLessThan(f.workspace.restorePanelCollection.mock.invocationCallOrder[0])
    expect(f.afterDomUpdate.mock.invocationCallOrder[0]).toBeLessThan(f.start.mock.invocationCallOrder[0])
  })
  it('continues restoring other tabs when one shell launch throws', async () => {
    const f = fixture(); f.load.mockResolvedValue({ snapshot, liveSessions: [] })
    f.start.mockRejectedValueOnce(new Error('asset removed'))
    await f.runtime.restore()
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.workspace.setTopNotice).toHaveBeenCalledWith('asset removed')
  })
  it('does not resurrect a tab removed while the prior tab is launching', async () => {
    const f = fixture(); f.load.mockResolvedValue({ snapshot, liveSessions: [] })
    f.start.mockImplementationOnce(async () => { f.workspace.panels = f.workspace.panels.filter((p) => p.id !== 'b'); return true })
    await f.runtime.restore()
    expect(f.start).toHaveBeenCalledTimes(1)
  })
  it('cancels a checkpoint after disposal while history reads are pending', async () => {
    const f = fixture(); await f.runtime.restore()
    let resolve!: (text: string) => void
    f.readHistory.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done }))
    const saving = f.runtime.save(); f.runtime.dispose(); resolve('history'); await saving
    expect(f.save).not.toHaveBeenCalled()
    expect(f.readHistory).toHaveBeenCalledTimes(1)
  })
  it('drops removed tabs and clears history when recovery is disabled during capture', async () => {
    const f = fixture(); await f.runtime.restore()
    f.readHistory.mockImplementation(async (panel) => {
      if (panel.id === 'b') f.workspace.terminalSettings.restoreTerminalTabs = false
      return panel.output
    })
    await f.runtime.save()
    expect(f.save.mock.calls[0][0].tabs).toEqual([])
  })
  it('does not save an already-captured tab removed during another history read', async () => {
    const f = fixture(); await f.runtime.restore()
    f.readHistory.mockImplementation(async (panel) => {
      if (panel.id === 'b') f.workspace.panels = f.workspace.panels.filter((p) => p.id !== 'a')
      return panel.output
    })
    await f.runtime.save()
    expect(f.save.mock.calls[0][0].tabs.map((tab) => tab.id)).toEqual(['b'])
  })
  it('coalesces concurrent save requests and bounds worker reads to 32 terminal tabs', async () => {
    const f = fixture(); await f.runtime.restore()
    f.workspace.panels = Array.from({ length: 40 }, (_, i) => ({ ...createEmptyTerminalPanel('p' + i, 'tab'), output: 'history' }))
    let resolve!: (text: string) => void
    f.readHistory.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done }))
    const saving = f.runtime.save(); await f.runtime.save(); await f.runtime.save()
    expect(f.readHistory).toHaveBeenCalledTimes(1)
    resolve('history'); await saving
    await vi.waitFor(() => expect(f.readHistory).toHaveBeenCalledTimes(64))
    expect(f.save.mock.calls[0][0].tabs).toHaveLength(32)
    expect(f.save).toHaveBeenCalledTimes(1)
  })
  it('retries an unchanged checkpoint after a failed persistence call', async () => {
    const f = fixture(); await f.runtime.restore()
    f.save.mockRejectedValueOnce(new Error('disk full'))
    await f.runtime.save(); await f.runtime.save()
    expect(f.save).toHaveBeenCalledTimes(2)
    expect(f.workspace.setTopNotice).toHaveBeenCalledWith('disk full')
  })

})
