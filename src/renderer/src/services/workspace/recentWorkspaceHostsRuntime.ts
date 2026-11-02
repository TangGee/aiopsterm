import { computed, ref, watch } from 'vue'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import { managedAssetDisplayName, managedAssetEndpoint } from '@shared/assetDisplayRuntime'
import type { useWorkspaceStore, TerminalPanel } from '@/stores/workspace'
import type { I18nKey } from '@/i18n'
import type { UiFocusCause } from '@/services/app/uiFocusCoordinator'
import { assetsClient } from '@/services/assets/assetsClient'
import { isAiopsAssetSnapshot } from '@/services/assets/assetBackendGuards'
import { openLocalTerminalLaunch, openSshTerminalLaunch } from '@/services/terminal/terminalLaunchRuntime'
import { matchesWorkspacePanelQuery } from './workspacePanelNavigationRuntime'

export type RecentWorkspaceEntry =
  | { type: 'panel'; key: string; panel: TerminalPanel }
  | { type: 'host'; key: string; asset: AiopsAssetRecord }

const isHostPanel = (panel: TerminalPanel, asset: AiopsAssetRecord) => {
  if (panel.kind && panel.kind !== 'terminal') return false
  if (asset.isLocalShell) return Boolean(panel.sessionId && !panel.sshSession)
  const ssh = panel.sshSession
  if (!ssh) return false
  if (ssh.assetId) return ssh.assetId === asset.id
  return ssh.host === managedAssetEndpoint(asset)
    && ssh.port === (Number(asset.port) || 22)
    && ssh.username === (asset.username || 'root')
}

export const findOpenHostPanel = (panels: TerminalPanel[], asset: AiopsAssetRecord) =>
  panels.find((panel) => isHostPanel(panel, asset))

export const filterRecentWorkspaceEntries = (
  panels: TerminalPanel[],
  assets: AiopsAssetRecord[],
  query: string
): RecentWorkspaceEntry[] => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const hosts: RecentWorkspaceEntry[] = []
  const matchingHostPanelIds = new Set<string>()
  const seen = new Set<string>()
  for (const asset of assets) {
    if (seen.has(asset.id)) continue
    seen.add(asset.id)
    const searchText = [asset.name, asset.title, asset.host, asset.ip, asset.username,
      asset.port, asset.group, asset.group_name, asset.comment, ...asset.tags]
      .join(' ').toLocaleLowerCase()
    if (terms.every((term) => searchText.includes(term))) {
      const openPanels = panels.filter((panel) => isHostPanel(panel, asset))
      if (openPanels.length) openPanels.forEach((panel) => matchingHostPanelIds.add(panel.id))
      else hosts.push({ type: 'host', key: `host:${asset.id}`, asset })
    }
  }
  const entries: RecentWorkspaceEntry[] = panels
    .filter((panel) => matchesWorkspacePanelQuery(panel, query) || matchingHostPanelIds.has(panel.id))
    .map((panel) => ({ type: 'panel', key: `panel:${panel.id}`, panel }))
  return [...entries, ...hosts]
}

export const useRecentWorkspaceHosts = (
  workspace: ReturnType<typeof useWorkspaceStore>,
  t: (key: I18nKey) => string
) => {
  const assets = ref<AiopsAssetRecord[]>([])
  const loading = ref(false)
  const connecting = ref(false)
  const notice = ref('')
  let generation = 0

  watch(() => workspace.recentPanelsOpen, async (open, _, onCleanup) => {
    const currentGeneration = ++generation
    let cancelled = false
    onCleanup(() => { cancelled = true })
    if (!open) return
    notice.value = ''
    assets.value = []
    loading.value = true
    try {
      const listAssets = assetsClient.listAssets()
      if (!listAssets) throw new Error(t('workspace.recentPanels.loadFailed'))
      const snapshot = await listAssets()
      if (!isAiopsAssetSnapshot(snapshot)) throw new Error(t('workspace.recentPanels.loadFailed'))
      if (!cancelled && currentGeneration === generation) assets.value = snapshot.assets
    } catch (error) {
      if (!cancelled && currentGeneration === generation) {
        notice.value = error instanceof Error ? error.message : t('workspace.recentPanels.loadFailed')
      }
    } finally {
      if (!cancelled && currentGeneration === generation) loading.value = false
    }
  }, { immediate: true })

  const activateHost = async (asset: AiopsAssetRecord, cause: UiFocusCause) => {
    if (connecting.value) return
    const existing = findOpenHostPanel(workspace.recentWorkspacePanels, asset)
    if (existing) return workspace.activateRecentPanel(existing.id, cause)
    connecting.value = true
    notice.value = ''
    const currentGeneration = generation
    const previousPanelId = workspace.activePanelId
    const panelId = workspace.createPanel({ activation: 'preserve' }).id
    const title = managedAssetDisplayName(asset)
    workspace.renamePanel(panelId, title, 'auto')
    workspace.replaceTerminalOutput(panelId, '')
    const context = {
      panelId,
      terminalType: workspace.terminalSettings.terminalType,
      discardPendingPanel: () => workspace.discardPendingTerminalPanel(panelId, previousPanelId),
      setNotice: (message: string) => {
        if (currentGeneration === generation) notice.value = message
      },
      applyLocalTerminalSession: workspace.applyLocalTerminalSession,
      applySshTerminalSession: workspace.applySshTerminalSession,
      registerSshSession: workspace.registerSshSession,
      renamePanel: workspace.renamePanel
    }
    try {
      const panel = asset.isLocalShell
        ? await openLocalTerminalLaunch(context, { title })
        : await openSshTerminalLaunch(context, asset, { title })
      if (panel && workspace.recentPanelsOpen && currentGeneration === generation) {
        workspace.activateRecentPanel(panelId, cause)
      }
    } finally {
      connecting.value = false
    }
  }

  return { assets: computed(() => assets.value), loading, connecting, notice, activateHost }
}
