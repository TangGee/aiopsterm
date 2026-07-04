import { nextTick } from 'vue'
import { assetsClient } from '@/services/assets/assetsClient'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  type ControlWorkspaceRemoteState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type { TerminalPanel } from '@/stores/workspace'
import type { ControlResponse, ControlSurfaceSummary, ControlWorkspaceRemoteSummary, ControlWorkspaceSnapshot } from '@shared/contracts/control'
import type { AiopsAssetInput, AiopsAssetRecord } from '@shared/contracts/assets'

type TerminalControlSurfaceAssetDependencies = {
  workspace: WorkspaceStore
  controlWorkspaceRemote: { value: ControlWorkspaceRemoteState | null }
  workspaceRemoteSummaryForControl: () => ControlWorkspaceRemoteSummary | null
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  startSshTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
}

type AssetResolveResult =
  | { status: 'matched'; asset: AiopsAssetRecord }
  | { status: 'missing' }
  | { status: 'ambiguous'; matches: AiopsAssetRecord[] }

const normalizeLookupText = (value: unknown) => controlText(value).toLowerCase()

const assetHost = (asset: AiopsAssetRecord) => controlText(asset.host || asset.ip)

const assetDisplayName = (asset: AiopsAssetRecord) => controlText(asset.name || asset.title || assetHost(asset) || asset.id)

const isConnectableAsset = (asset: AiopsAssetRecord) =>
  !asset.isLocalShell && asset.asset_type !== 'organization' && Boolean(assetHost(asset))

const assetLookupValues = (asset: AiopsAssetRecord) => {
  const host = assetHost(asset)
  const username = controlText(asset.username) || 'root'
  return [
    asset.id,
    asset.uuid,
    asset.name,
    asset.title,
    host,
    asset.ip,
    host ? `${username}@${host}` : ''
  ]
    .map(normalizeLookupText)
    .filter(Boolean)
}

const uniqueAssets = (assets: AiopsAssetRecord[]) => {
  const seen = new Set<string>()
  const result: AiopsAssetRecord[] = []
  for (const asset of assets) {
    const key = asset.id || asset.uuid || `${asset.username}@${assetHost(asset)}:${asset.port}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(asset)
  }
  return result
}

const assetSummaryForControl = (asset: AiopsAssetRecord) => ({
  id: asset.id,
  uuid: asset.uuid,
  name: assetDisplayName(asset),
  title: asset.title || asset.name || assetHost(asset),
  host: assetHost(asset),
  ip: asset.ip || asset.host,
  username: asset.username || 'root',
  port: Number(asset.port) || 22,
  group: asset.group || asset.group_name || '',
  group_name: asset.group_name || asset.group || '',
  status: asset.status,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  favorite: Boolean(asset.favorite),
  needProxy: Boolean(asset.needProxy),
  need_proxy: Boolean(asset.needProxy),
  proxyName: asset.proxyName || '',
  proxy_name: asset.proxyName || '',
  jumpHostId: asset.jumpHostId || '',
  jump_host_id: asset.jumpHostId || '',
  connectable: isConnectableAsset(asset)
})

const completionTokenForAsset = (asset: AiopsAssetRecord) =>
  [asset.name, asset.title, assetHost(asset), asset.id, asset.uuid].map(controlText).find((value) => value && !/\s/.test(value)) || assetDisplayName(asset)

const resolveAssetTarget = (assets: AiopsAssetRecord[], target: string): AssetResolveResult => {
  const query = normalizeLookupText(target)
  if (!query) return { status: 'missing' }
  const exact = uniqueAssets(assets.filter((asset) => assetLookupValues(asset).some((value) => value === query)))
  if (exact.length === 1) return { status: 'matched', asset: exact[0] }
  if (exact.length > 1) return { status: 'ambiguous', matches: exact }
  const prefix = uniqueAssets(assets.filter((asset) => assetLookupValues(asset).some((value) => value.startsWith(query))))
  if (prefix.length === 1) return { status: 'matched', asset: prefix[0] }
  if (prefix.length > 1) return { status: 'ambiguous', matches: prefix }
  const contains = uniqueAssets(assets.filter((asset) => assetLookupValues(asset).some((value) => value.includes(query))))
  if (contains.length === 1) return { status: 'matched', asset: contains[0] }
  if (contains.length > 1) return { status: 'ambiguous', matches: contains }
  return { status: 'missing' }
}

const sortedAssetsForControl = (assets: AiopsAssetRecord[]) =>
  [...assets].sort((first, second) => {
    if (Boolean(first.favorite) !== Boolean(second.favorite)) return first.favorite ? -1 : 1
    if (first.status !== second.status) {
      if (first.status === 'online') return -1
      if (second.status === 'online') return 1
    }
    return assetDisplayName(first).localeCompare(assetDisplayName(second), 'zh-CN', { numeric: true, sensitivity: 'base' })
  })

export const createTerminalControlSurfaceAssetHandlers = ({
  workspace,
  controlWorkspaceRemote,
  workspaceRemoteSummaryForControl,
  workspaceSnapshotForControl,
  surfaceSummaryForControl,
  startSshTerminalForPanel
}: TerminalControlSurfaceAssetDependencies) => {
  const loadAssets = async () => {
    const listAssets = assetsClient.listAssets()
    if (!listAssets) return null
    return listAssets()
  }

  const assetControlPayload = (extra: Record<string, unknown> = {}) =>
    controlOk({
      window_id: null,
      window_ref: null,
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      ...extra,
      snapshot: workspaceSnapshotForControl()
    })

  const updateRemoteState = (panel: TerminalPanel, asset: AiopsAssetRecord) => {
    const host = assetHost(asset)
    const port = Number(asset.port) || 22
    const username = controlText(asset.username) || 'root'
    controlWorkspaceRemote.value = {
      surfaceId: panel.id,
      transport: 'ssh',
      destination: `${username}@${host}`,
      host,
      port,
      username,
      assetId: asset.id,
      assetName: assetDisplayName(asset),
      proxyName: asset.proxyName || '',
      needProxy: Boolean(asset.needProxy),
      updatedAt: Date.now()
    }
  }

  const findExistingAssetPanel = (asset: AiopsAssetRecord) => {
    const host = assetHost(asset)
    const port = Number(asset.port) || 22
    const username = controlText(asset.username) || 'root'
    return (
      workspace.panels.find((panel) => panel.sshSession?.assetId && panel.sshSession.assetId === asset.id) ||
      workspace.panels.find(
        (panel) =>
          panel.sshSession?.host === host &&
          Number(panel.sshSession?.port || 22) === port &&
          (panel.sshSession?.username || 'root') === username
      ) ||
      null
    )
  }

  const connectAsset = async (asset: AiopsAssetRecord, params: Record<string, unknown>) => {
    const reuse = controlBool(params.reuse, true)
    const autoConnect = controlBool(params.autoConnect ?? params.auto_connect ?? params.connect, true)
    const existing = reuse ? findExistingAssetPanel(asset) : null
    const panel = existing || workspace.createPanel()
    const created = !existing
    const title = assetDisplayName(asset)
    if (created) {
      workspace.renamePanel(panel.id, title)
      workspace.replaceTerminalOutput(panel.id, '')
      workspace.registerSshSession(panel.id, {
        id: asset.id,
        name: title,
        title,
        host: assetHost(asset),
        port: Number(asset.port) || 22,
        username: asset.username || 'root',
        group_name: asset.group_name || asset.group,
        asset_type: asset.asset_type,
        auth_type: asset.auth_type,
        needProxy: Boolean(asset.needProxy),
        proxyName: asset.proxyName || '',
        jumpHostId: asset.jumpHostId
      })
    }
    workspace.activateTerminalPanel(panel.id)
    updateRemoteState(panel, asset)
    let connected = Boolean(panel.sessionId)
    if (autoConnect && !connected) connected = await startSshTerminalForPanel(panel)
    await nextTick()
    return assetControlPayload({
      connected,
      configured: true,
      created,
      reused: Boolean(existing),
      autoConnect,
      auto_connect: autoConnect,
      asset: assetSummaryForControl(asset),
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel),
      remote: workspaceRemoteSummaryForControl()
    })
  }

  const handleAssetListControlRequest = async (params: Record<string, unknown>) => {
    const snapshot = await loadAssets()
    if (!snapshot) return controlFail('ASSET_BRIDGE_UNAVAILABLE', 'Asset bridge is unavailable.')
    const prefix = normalizeLookupText(params.prefix || params.query)
    const connectableOnly = controlBool(params.connectableOnly ?? params.connectable_only, true)
    const assets = sortedAssetsForControl(snapshot.assets)
      .filter((asset) => (connectableOnly ? isConnectableAsset(asset) : true))
      .filter((asset) => !prefix || assetLookupValues(asset).some((value) => value.startsWith(prefix) || value.includes(prefix)))
    return assetControlPayload({
      assets: assets.map(assetSummaryForControl),
      count: assets.length,
      namesOnly: controlBool(params.namesOnly ?? params.names_only, false),
      names_only: controlBool(params.namesOnly ?? params.names_only, false)
    })
  }

  const handleAssetCompleteControlRequest = async (params: Record<string, unknown>) => {
    const snapshot = await loadAssets()
    if (!snapshot) return controlFail('ASSET_BRIDGE_UNAVAILABLE', 'Asset bridge is unavailable.')
    const prefix = normalizeLookupText(params.prefix || params.query)
    const limit = controlNumber(params.limit, 100, 1, 500)
    const assets = sortedAssetsForControl(snapshot.assets)
      .filter(isConnectableAsset)
      .filter((asset) => !prefix || assetLookupValues(asset).some((value) => value.startsWith(prefix)))
      .slice(0, limit)
    return controlOk({
      completion: true,
      prefix,
      completions: assets.map(completionTokenForAsset),
      candidates: assets.map(assetSummaryForControl),
      count: assets.length
    })
  }

  const handleAssetSaveControlRequest = async (params: Record<string, unknown>) => {
    const saveAsset = assetsClient.saveAsset()
    if (!saveAsset) return controlFail('ASSET_BRIDGE_UNAVAILABLE', 'Asset save bridge is unavailable.')
    const host = controlText(params.host || params.ip || params.destination)
    if (!host) return controlFail('ASSET_HOST_REQUIRED', 'host add requires a host.')
    const name = controlText(params.name || params.title) || host
    const port = controlNumber(params.port, 22, 1, 65535)
    const authType = controlText(params.auth_type || params.authType || params.auth) === 'password' ? 'password' : 'keyBased'
    const assetInput: AiopsAssetInput = {
      id: controlText(params.id) || undefined,
      name,
      title: controlText(params.title) || name,
      host,
      ip: controlText(params.ip) || host,
      username: controlText(params.username || params.user) || 'root',
      port,
      group: controlText(params.group || params.group_name),
      group_name: controlText(params.group_name || params.group),
      asset_type: 'person',
      auth_type: authType,
      data_source: 'manual',
      keychainId: controlText(params.keychainId || params.keychain_id) || undefined,
      jumpHostId: controlText(params.jumpHostId || params.jump_host_id) || undefined,
      proxyName: controlText(params.proxyName || params.proxy_name) || undefined,
      needProxy: controlBool(params.needProxy ?? params.need_proxy, false)
    }
    const result = await saveAsset(assetInput)
    if (!result.ok || !result.data) return controlFail(result.errorCode || 'ASSET_SAVE_FAILED', result.errorMessage || 'Failed to save asset.')
    return assetControlPayload({
      saved: true,
      asset: assetSummaryForControl(result.data)
    })
  }

  const handleAssetSshConnectControlRequest = async (params: Record<string, unknown>) => {
    const snapshot = await loadAssets()
    if (!snapshot) return controlFail('ASSET_BRIDGE_UNAVAILABLE', 'Asset bridge is unavailable.')
    const target = controlText(params.target || params.query || params.asset || params.assetId || params.asset_id || params.name || params.host)
    if (!target) return controlFail('ASSET_TARGET_REQUIRED', 'aiossh requires a managed host name.')
    const assets = snapshot.assets.filter(isConnectableAsset)
    const resolved = resolveAssetTarget(assets, target)
    if (resolved.status === 'missing') return controlFail('ASSET_TARGET_NOT_FOUND', 'Managed host was not found.', { target })
    if (resolved.status === 'ambiguous') {
      return controlFail('ASSET_TARGET_AMBIGUOUS', 'Managed host name is ambiguous.', {
        target,
        matches: resolved.matches.slice(0, 10).map(assetSummaryForControl)
      })
    }
    return connectAsset(resolved.asset, params)
  }

  const handleAssetControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method === 'asset.list' || method === 'host.list') return handleAssetListControlRequest(params)
    if (method === 'asset.complete' || method === 'host.complete') return handleAssetCompleteControlRequest(params)
    if (method === 'asset.save' || method === 'asset.add' || method === 'host.add') return handleAssetSaveControlRequest(params)
    if (method === 'asset.ssh.connect' || method === 'host.ssh.connect') return handleAssetSshConnectControlRequest(params)
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    handleAssetControlRequest
  }
}
