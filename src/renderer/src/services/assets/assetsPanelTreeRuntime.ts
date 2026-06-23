import type { AiopsAssetGroupRecord, AiopsAssetRecord, AiopsCustomFolderRecord } from '@shared/contracts/assets'

export type AssetsPanelAsset = AiopsAssetRecord & {
  password?: string
  needProxy?: boolean
  proxyName?: string
}

export type AssetsPanelGroup = {
  key: string
  title: string
  children: AssetsPanelAsset[]
  childGroups: AssetsPanelGroup[]
  type: 'direct-group' | 'custom-folder' | 'organization'
  folderUuid?: string
  parentKey?: string
  groupName?: string
  organizationId?: string
}

export type AssetsPanelTreeRow =
  | { key: string; kind: 'group'; group: AssetsPanelGroup; depth: number }
  | { key: string; kind: 'asset'; asset: AssetsPanelAsset; depth: number; parentGroupKey: string }

export const normalizeDirectAssetGroupName = (name?: string) => {
  const trimmed = String(name || '').trim()
  return !trimmed || trimmed === 'Hosts' ? '未分组' : trimmed
}

export const directGroupKey = (name: string) => `group-${name}`

export const makeAssetGroup = (
  input: Omit<AssetsPanelGroup, 'childGroups' | 'children'> & Partial<Pick<AssetsPanelGroup, 'children' | 'childGroups'>>
): AssetsPanelGroup => ({
  ...input,
  children: input.children || [],
  childGroups: input.childGroups || []
})

export const assetGroupAssetCount = (group: AssetsPanelGroup): number =>
  group.children.length + group.childGroups.reduce((sum, child) => sum + assetGroupAssetCount(child), 0)

export const flattenAssetGroups = (groups: AssetsPanelGroup[]): AssetsPanelGroup[] =>
  groups.flatMap((group) => [group, ...flattenAssetGroups(group.childGroups)])

export const findAssetGroupByKey = (groups: AssetsPanelGroup[], key: string) => flattenAssetGroups(groups).find((group) => group.key === key) || null

export const buildDirectAssetGroups = (input: {
  assets: AssetsPanelAsset[]
  directFolders: AiopsCustomFolderRecord[]
  assetGroupOptions: AiopsAssetGroupRecord[]
  assetGroupOptionsReady: boolean
}): AssetsPanelGroup[] => {
  if (!input.assetGroupOptionsReady) return []
  const folderByName = new Map(input.directFolders.map((folder) => [folder.name, folder]))
  const groupNames = Array.from(
    new Set([
      ...input.directFolders.map((folder) => folder.name),
      ...input.assetGroupOptions.map((group) => normalizeDirectAssetGroupName(group.name)),
      ...input.assets.map((asset) => normalizeDirectAssetGroupName(asset.group || asset.group_name))
    ])
  )
  const groupsByName = new Map<string, AssetsPanelGroup>()
  groupNames.filter(Boolean).forEach((name) => {
    const folder = folderByName.get(name)
    const parentFolder = folder?.parentUuid ? input.directFolders.find((item) => item.uuid === folder.parentUuid) : null
    const children = input.assets.filter((asset) => normalizeDirectAssetGroupName(asset.group || asset.group_name) === name)
    groupsByName.set(
      name,
      makeAssetGroup({
        key: directGroupKey(name),
        title: name,
        children,
        type: folder ? 'custom-folder' : 'direct-group',
        groupName: name,
        ...(folder ? { folderUuid: folder.uuid } : {}),
        ...(parentFolder ? { parentKey: directGroupKey(parentFolder.name) } : {})
      })
    )
  })
  const roots: AssetsPanelGroup[] = []
  groupsByName.forEach((group) => {
    if (group.parentKey) {
      const parent = [...groupsByName.values()].find((candidate) => candidate.key === group.parentKey)
      if (parent && parent.key !== group.key) {
        parent.childGroups.push(group)
        return
      }
    }
    roots.push(group)
  })
  return roots
}

export const filterAssetGroups = (groups: AssetsPanelGroup[], keyword: string): AssetsPanelGroup[] => {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return groups
  return groups
    .map((group) => ({
      ...group,
      childGroups: filterAssetGroups(group.childGroups, normalized),
      children: group.children.filter((asset) =>
        `${asset.title} ${asset.host} ${asset.group_name} ${asset.username} ${asset.comment || ''} ${asset.tags.join(' ')}`.toLowerCase().includes(normalized)
      )
    }))
    .filter((group) => `${group.title} ${group.folderUuid || ''}`.toLowerCase().includes(normalized) || group.children.length > 0 || group.childGroups.length > 0)
}

export const buildExportAssetGroups = (assets: AssetsPanelAsset[]): AssetsPanelGroup[] => {
  const groupNames = Array.from(new Set(assets.map((asset) => normalizeDirectAssetGroupName(asset.group || asset.group_name))))
  return groupNames.map((group) => ({
    key: `export-group-${group}`,
    title: group,
    children: assets.filter((asset) => (asset.group || asset.group_name) === group),
    childGroups: [],
    type: 'direct-group' as const,
    groupName: group
  }))
}

export const pruneGroupForOrganization = (group: AssetsPanelGroup, organizationId: string): AssetsPanelGroup | null => {
  const children = group.children.filter((asset) => asset.organizationId === organizationId)
  const childGroups = group.childGroups.map((child) => pruneGroupForOrganization(child, organizationId)).filter((child): child is AssetsPanelGroup => Boolean(child))
  if (!children.length && !childGroups.length) return null
  return { ...group, children, childGroups }
}

export const pruneGroupWithoutOrganizations = (group: AssetsPanelGroup, organizationIds: Set<string>): AssetsPanelGroup | null => {
  const children = group.children.filter((asset) => !asset.organizationId || !organizationIds.has(asset.organizationId))
  const childGroups = group.childGroups.map((child) => pruneGroupWithoutOrganizations(child, organizationIds)).filter((child): child is AssetsPanelGroup => Boolean(child))
  if (!children.length && !childGroups.length) return null
  return { ...group, children, childGroups }
}

export const rewriteGroupKeyPrefix = (group: AssetsPanelGroup, prefix: string): AssetsPanelGroup => {
  const key = `${prefix}-${group.key}`
  return {
    ...group,
    key,
    parentKey: group.parentKey ? `${prefix}-${group.parentKey}` : group.parentKey,
    childGroups: group.childGroups.map((child) => rewriteGroupKeyPrefix(child, prefix))
  }
}

export const buildManagedFolderGroups = (sourceAssets: AssetsPanelAsset[], bastionFolders: AiopsCustomFolderRecord[]) => {
  const foldersByUuid = new Map(
    bastionFolders.map((folder) => {
      const children = sourceAssets.filter((asset) => asset.folderUuid === folder.uuid)
      return [
        folder.uuid,
        makeAssetGroup({
          key: `managed-folder-${folder.uuid}`,
          title: folder.name,
          children,
          type: 'custom-folder' as const,
          folderUuid: folder.uuid,
          ...(folder.parentUuid ? { parentKey: `managed-folder-${folder.parentUuid}` } : {})
        })
      ] as const
    })
  )
  const roots: AssetsPanelGroup[] = []
  foldersByUuid.forEach((group) => {
    const parent = group.parentKey ? foldersByUuid.get(group.parentKey.replace(/^managed-folder-/, '')) : null
    if (parent && parent.key !== group.key) parent.childGroups.push(group)
    else roots.push(group)
  })
  return roots
}

export const collectManagedAssetFallbackGroup = (asset: AssetsPanelAsset) => normalizeDirectAssetGroupName(asset.group || asset.group_name)

export const buildManagedLooseGroups = (sourceAssets: AssetsPanelAsset[]) => {
  const groups = Array.from(new Set(sourceAssets.filter((asset) => !asset.folderUuid && !asset.organizationId).map(collectManagedAssetFallbackGroup)))
  return groups.map((group) =>
    makeAssetGroup({
      key: `managed-group-${group}`,
      title: group,
      children: sourceAssets.filter((asset) => !asset.folderUuid && !asset.organizationId && collectManagedAssetFallbackGroup(asset) === group),
      childGroups: [],
      type: 'direct-group' as const,
      groupName: group
    })
  )
}

export const buildManagedGroups = (input: {
  sourceAssets: AssetsPanelAsset[]
  allAssets: AssetsPanelAsset[]
  bastionFolders: AiopsCustomFolderRecord[]
  managedOrganization?: AssetsPanelAsset | null
}): AssetsPanelGroup[] => {
  const folderGroups = buildManagedFolderGroups(input.sourceAssets, input.bastionFolders)
  const looseGroups = buildManagedLooseGroups(input.sourceAssets)
  const organizations = input.allAssets.filter((asset) => asset.asset_type === 'organization' && (!input.managedOrganization || asset.id === input.managedOrganization.id))
  const organizationGroups = organizations.map((organization) => {
    const organizationId = organization.uuid || organization.id
    return makeAssetGroup({
      key: `managed-org-${organization.uuid || organization.id}`,
      title: organization.title || organization.name,
      children: input.sourceAssets.filter((asset) => !asset.folderUuid && asset.organizationId === organizationId),
      childGroups: folderGroups
        .map((group) => pruneGroupForOrganization(group, organizationId))
        .filter((group): group is AssetsPanelGroup => Boolean(group))
        .map((group) => rewriteGroupKeyPrefix(group, `managed-org-folder-${organizationId}`)),
      type: 'organization' as const,
      organizationId
    })
  })
  const organizationIds = new Set(organizations.map((organization) => organization.uuid || organization.id))
  const orphanFolderGroups = folderGroups.map((group) => pruneGroupWithoutOrganizations(group, organizationIds)).filter((group): group is AssetsPanelGroup => Boolean(group))
  return [...organizationGroups.filter((group) => assetGroupAssetCount(group) > 0), ...orphanFolderGroups, ...looseGroups.filter((group) => assetGroupAssetCount(group) > 0)]
}

export const collectManagedRows = (
  groups: AssetsPanelGroup[],
  isManagedGroupExpanded: (key: string) => boolean,
  depth = 0
): AssetsPanelTreeRow[] =>
  groups.flatMap((group) => {
    const rows: AssetsPanelTreeRow[] = [{ key: `managed-group-${group.key}`, kind: 'group', group, depth }]
    if (isManagedGroupExpanded(group.key)) {
      rows.push(...collectManagedRows(group.childGroups, isManagedGroupExpanded, depth + 1))
      rows.push(...group.children.map((asset) => ({ key: `managed-asset-${group.key}-${asset.id}`, kind: 'asset' as const, asset, depth: depth + 1, parentGroupKey: group.key })))
    }
    return rows
  })
