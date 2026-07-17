export type ManagedAssetDisplaySource = {
  id?: unknown
  title?: unknown
  name?: unknown
  assetName?: unknown
  host?: unknown
  ip?: unknown
}

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) return normalized
  }
  return ''
}

export const managedAssetDisplayName = (asset: ManagedAssetDisplaySource) =>
  firstText(asset.title, asset.name, asset.assetName, asset.host, asset.ip, asset.id)

export const managedAssetEndpoint = (asset: ManagedAssetDisplaySource) =>
  firstText(asset.host, asset.ip)
