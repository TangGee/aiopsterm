import type { TerminalRecoverySnapshot, TerminalRecoveryTab } from '@shared/contracts/terminalRecovery'
import type { TerminalPanel } from './terminalPanelRuntime'
import { terminalClient } from './terminalClient'
import type { useWorkspaceStore } from '@/stores/workspace'

const tabLimit = 32
const historyLimit = 128 * 1024

export const recoveryTabFromPanel = (panel: TerminalPanel, history: string): TerminalRecoveryTab => ({
  id: panel.id, title: panel.title, cwd: panel.cwd, cwdVerified: panel.cwdVerified, history: history.slice(-historyLimit),
  resume: Boolean(panel.sessionId), sessionId: panel.sessionId, split: panel.split, splitSourceId: panel.splitSourceId,
  splitGroupId: panel.splitGroupId, splitOrder: panel.splitOrder,
  ...(panel.sshSession ? { ssh: {
    host: panel.sshSession.host, port: panel.sshSession.port, username: panel.sshSession.username,
    assetId: panel.sshSession.assetId, assetName: panel.sshSession.assetName,
    needProxy: panel.sshSession.needProxy, proxyName: panel.sshSession.proxyName, jumpHostId: panel.sshSession.jumpHostId
  } } : {})
})

export const panelFromRecoveryTab = (tab: TerminalRecoveryTab): TerminalPanel => {
  const output = tab.history.replace(/\r?\n/g, '\r\n') + (tab.history ? '\r\n' : '')
  return {
    id: tab.id, cwdVerified: tab.cwdVerified, title: tab.title, titleSource: 'user', cwd: tab.cwd, output,
    outputSegments: output ? [{ text: output, scope: 'output' }] : [],
    status: 'closed', kind: 'terminal', restoredHistory: true, split: tab.split, splitSourceId: tab.splitSourceId,
    splitGroupId: tab.splitGroupId, splitOrder: tab.splitOrder,
    ...(tab.ssh ? { sshSession: { ...tab.ssh } } : {})
  }
}

export const createTerminalWorkspaceRecoveryRuntime = (input: {
  workspace: ReturnType<typeof useWorkspaceStore>
  readHistory: (panel: TerminalPanel) => Promise<string>
  start: (panel: TerminalPanel) => Promise<boolean>
  beforeRestore?: () => void
  afterDomUpdate: () => Promise<unknown>
  client?: Pick<typeof terminalClient, 'loadTerminalRecovery' | 'saveTerminalRecovery'>
}) => {
  const { workspace } = input
  const client = input.client || terminalClient
  let initialized = false
  let disposed = false
  let saving = false
  let lastSaved = ''
  let saveAgain = false
  const eligiblePanels = () => workspace.panels.filter((panel) =>
    (!panel.kind || panel.kind === 'terminal') && (panel.sessionId || panel.sshSession || panel.output)
  ).slice(0, tabLimit)
  const report = (error: unknown) => workspace.setTopNotice(error instanceof Error ? error.message : 'Terminal recovery failed.')
  const save = async () => {
    if (!initialized || disposed || !client.saveTerminalRecovery()) return
    if (saving) { saveAgain = true; return }
    saving = true
    try {
      const panels = workspace.terminalSettings.restoreTerminalTabs === false ? [] : eligiblePanels()
      const tabs: TerminalRecoveryTab[] = []
      // Bound worker requests and storage. Avoid reading all terminals simultaneously.
      for (const panel of panels) {
        const history = await input.readHistory(panel)
        if (!workspace.panels.includes(panel)) continue
        tabs.push(recoveryTabFromPanel(panel, history))
      }
      if (disposed) return
      const snapshot: TerminalRecoverySnapshot = { version: 1, activePanelId: workspace.activePanelId, tabs }
      const serialized = JSON.stringify(snapshot)
      if (serialized !== lastSaved) {
        await client.saveTerminalRecovery()!(snapshot)
        lastSaved = serialized
      }
    } catch (error) { report(error) }
    finally {
      saving = false
      if (saveAgain && !disposed) { saveAgain = false; void save() }
    }
  }
  const restore = async () => {
    if (initialized || disposed) return
    const initialPanels = workspace.panels
    try {
      if (workspace.terminalSettings.restoreTerminalTabs === false || !client.loadTerminalRecovery()) return
      const result = await client.loadTerminalRecovery()!()
      if (disposed || workspace.panels !== initialPanels || initialPanels.some((panel) => panel.sessionId || panel.sshSession) || initialPanels.length > 1) return
      const snapshot = result.snapshot
      if (!snapshot?.tabs.length) return
      const panels = snapshot.tabs.map(panelFromRecoveryTab)
      input.beforeRestore?.()
      if (!workspace.restorePanelCollection(panels, snapshot.activePanelId)) return
      await input.afterDomUpdate()
      for (const tab of snapshot.tabs) {
        if (disposed) return
        const panel = workspace.panels.find((item) => item.id === tab.id)
        if (!panel) continue
        const live = result.liveSessions.find((session) => session.id === tab.sessionId)
        if (live) {
          if (tab.ssh) workspace.applySshTerminalSession(panel.id, live, { ...tab.ssh, id: tab.ssh.assetId, name: tab.ssh.assetName })
          else workspace.applyLocalTerminalSession(panel.id, live)
        } else if (tab.resume) {
          await input.start(panel)
        }
        panel.title = tab.title
        panel.titleSource = 'user'
      }
    } catch (error) { report(error) }
    finally { initialized = true }
  }
  return { restore, save, dispose: () => { disposed = true } }
}
