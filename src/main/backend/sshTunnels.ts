import type {
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelRecord,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelStopInput,
  AiopsSshTunnelType
} from '@shared/preload'
import { getAsset, listAssets, saveAsset } from './assets'

const activeTunnels = new Map<string, AiopsSshTunnelRecord>()

const defaultTunnelType: AiopsSshTunnelType = 'local_forward'

const asTunnelError = (errorCode: string, errorMessage: string): AiopsSshTunnelMutationResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const normalizeTunnelType = (type?: AiopsSshTunnelType): AiopsSshTunnelType =>
  type === 'remote_forward' || type === 'dynamic_socks' || type === 'local_forward' ? type : defaultTunnelType

const tunnelIdForAsset = (assetId: string, explicitTunnelId?: string) => {
  const id = String(explicitTunnelId || '').trim()
  return id || `tunnel-${assetId}`
}

const assertTunnelAsset = (assetId?: string): AiopsAssetRecord | null => {
  const id = String(assetId || '').trim()
  if (!id) return null
  const asset = getAsset(id)
  if (!asset) return null
  if (asset.isLocalShell) throw new Error('本地连接不支持 SSH 隧道')
  if (asset.asset_type !== 'person') throw new Error('只有 SSH 主机资产支持隧道')
  if (!asset.host && !asset.ip) throw new Error('隧道主机地址不能为空')
  return asset
}

const assetToTunnelInput = (asset: AiopsAssetRecord, tunnelState: AiopsAssetRecord['tunnelState']): AiopsAssetInput => ({
  id: asset.id,
  name: asset.name,
  title: asset.title,
  host: asset.host,
  ip: asset.ip,
  group: asset.group,
  group_name: asset.group_name,
  status: asset.status,
  username: asset.username,
  port: asset.port,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  comment: asset.comment,
  data_source: asset.data_source,
  tags: [...asset.tags],
  favorite: asset.favorite,
  folderUuid: asset.folderUuid,
  organizationId: asset.organizationId,
  tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  keychainId: asset.keychainId
})

const saveTunnelState = (asset: AiopsAssetRecord, tunnelState: AiopsAssetRecord['tunnelState']) => {
  const saved = saveAsset(assetToTunnelInput(asset, tunnelState))
  if (!saved.ok || !saved.data) throw new Error(saved.errorMessage || '隧道状态保存失败')
  return saved.data
}

const resultWithSnapshot = (tunnel: AiopsSshTunnelRecord, message: string): AiopsSshTunnelMutationResult => ({
  ok: true,
  data: {
    ...listAssets(),
    tunnel,
    message
  }
})

export const startSshTunnel = (input: AiopsSshTunnelStartInput): AiopsSshTunnelMutationResult => {
  try {
    const asset = assertTunnelAsset(input?.assetId)
    if (!asset) return asTunnelError('SSH_TUNNEL_ASSET_NOT_FOUND', '隧道主机不存在')
    const tunnelId = tunnelIdForAsset(asset.id, input.tunnelId)
    const tunnel: AiopsSshTunnelRecord = {
      assetId: asset.id,
      tunnelId,
      type: normalizeTunnelType(input.type),
      state: 'active',
      localPort: Number.isFinite(input.localPort) ? Number(input.localPort) : undefined,
      remoteHost: String(input.remoteHost || asset.host || asset.ip).trim(),
      remotePort: Number.isFinite(input.remotePort) ? Number(input.remotePort) : asset.port,
      startedAt: new Date().toISOString()
    }
    saveTunnelState(asset, 'active')
    activeTunnels.set(tunnelId, tunnel)
    return resultWithSnapshot(tunnel, `隧道已连接 ${asset.name}`)
  } catch (error) {
    return asTunnelError('SSH_TUNNEL_START_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export const stopSshTunnel = (input: AiopsSshTunnelStopInput): AiopsSshTunnelMutationResult => {
  try {
    const assetId = String(input?.assetId || '').trim()
    const tunnelId = tunnelIdForAsset(assetId, input?.tunnelId)
    const activeTunnel = input?.tunnelId ? activeTunnels.get(tunnelId) : undefined
    const asset = assertTunnelAsset(assetId || activeTunnel?.assetId)
    if (!asset) return asTunnelError('SSH_TUNNEL_ASSET_NOT_FOUND', '隧道主机不存在')
    const stoppedTunnel: AiopsSshTunnelRecord = {
      ...(activeTunnels.get(tunnelId) || {
        assetId: asset.id,
        tunnelId,
        type: defaultTunnelType
      }),
      assetId: asset.id,
      tunnelId,
      state: 'created',
      stoppedAt: new Date().toISOString()
    }
    saveTunnelState(asset, 'created')
    activeTunnels.delete(tunnelId)
    return resultWithSnapshot(stoppedTunnel, `隧道已停止 ${asset.name}`)
  } catch (error) {
    return asTunnelError('SSH_TUNNEL_STOP_FAILED', error instanceof Error ? error.message : String(error))
  }
}
