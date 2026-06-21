import type { AiopsAssetRecord, AiopsCustomFolderRecord } from '@shared/contracts/assets'

export type WorkspaceTabKey = 'direct' | 'bastion'

export type WorkspacePanelAsset = AiopsAssetRecord & {
  isLocalShell?: boolean
}

export type WorkspacePanelFolder = AiopsCustomFolderRecord

export type WorkspacePanelGroup = {
  key: string
  title: string
  children: WorkspacePanelAsset[]
  childGroups: WorkspacePanelGroup[]
  originalCount: number
  type: 'system' | 'direct-group' | 'organization' | 'custom-folder'
  refreshable?: boolean
  menu?: boolean
  parentKey?: string
  folderUuid?: string
  groupName?: string
  organizationId?: string
}

export type WorkspacePanelTreeRow =
  | { key: string; kind: 'group'; group: WorkspacePanelGroup; depth: number }
  | { key: string; kind: 'asset'; asset: WorkspacePanelAsset; depth: number; parentGroupKey: string }

export const ungroupedGroupName = '未分组'

export const normalizeDirectGroupName = (name?: string) => {
  const trimmed = String(name || '').trim()
  return !trimmed || trimmed === 'Hosts' ? ungroupedGroupName : trimmed
}

export const assetGroupName = (asset: WorkspacePanelAsset) => normalizeDirectGroupName(asset.group || asset.group_name)

export const folderScopeMatches = (folder: WorkspacePanelFolder, scope: WorkspaceTabKey) =>
  scope === 'direct' ? folder.scope === 'direct' : folder.scope !== 'direct'

export const directGroupKey = (name: string) => `group-${name}`

export const folderGroupKey = (folder: WorkspacePanelFolder) => (folder.scope === 'direct' ? directGroupKey(folder.name) : folder.uuid)

export const makeGroup = (
  input: Omit<WorkspacePanelGroup, 'childGroups' | 'children'> & Partial<Pick<WorkspacePanelGroup, 'children' | 'childGroups'>>
): WorkspacePanelGroup => ({
  ...input,
  children: input.children || [],
  childGroups: input.childGroups || []
})

export const flattenGroups = (group: WorkspacePanelGroup): WorkspacePanelGroup[] => [group, ...group.childGroups.flatMap(flattenGroups)]

export const buildDirectGroups = (input: {
  directAssets: WorkspacePanelAsset[]
  localShellAssets: WorkspacePanelAsset[]
  directFolders: WorkspacePanelFolder[]
  recentAssetIds: string[]
}): WorkspacePanelGroup[] => {
  const source = input.directAssets
  const foldersByName = new Map(input.directFolders.map((folder) => [folder.name, folder]))
  const groupNames = [
    ...new Set([...input.directFolders.map((folder) => folder.name), ...source.map((asset) => normalizeDirectGroupName(assetGroupName(asset)))])
  ].filter(Boolean)
  const groupsByName = new Map<string, WorkspacePanelGroup>()
  groupNames.forEach((name) => {
    const folder = foldersByName.get(name)
    const parentFolder = folder?.parentUuid ? input.directFolders.find((item) => item.uuid === folder.parentUuid) : null
    const children = source.filter((asset) => normalizeDirectGroupName(assetGroupName(asset)) === name)
    groupsByName.set(
      name,
      makeGroup({
        key: directGroupKey(name),
        title: name,
        children,
        originalCount: children.length,
        type: 'direct-group',
        menu: true,
        groupName: name,
        ...(parentFolder ? { parentKey: directGroupKey(parentFolder.name) } : {}),
        ...(folder ? { folderUuid: folder.uuid } : {})
      })
    )
  })
  const roots: WorkspacePanelGroup[] = []
  groupsByName.forEach((group) => {
    if (group.parentKey && groupsByName.size) {
      const parent = [...groupsByName.values()].find((item) => item.key === group.parentKey)
      if (parent && parent.key !== group.key) {
        parent.childGroups.push(group)
        return
      }
    }
    roots.push(group)
  })
  const recentChildren = input.recentAssetIds.map((id) => source.find((asset) => asset.id === id)).filter((asset): asset is WorkspacePanelAsset => Boolean(asset))
  const groups: WorkspacePanelGroup[] = [
    makeGroup({
      key: 'recent_connections',
      title: '最近连接',
      children: recentChildren,
      originalCount: recentChildren.length,
      type: 'system',
      menu: false
    }),
    ...roots,
    makeGroup({
      key: 'local_connections',
      title: '本地连接',
      children: input.localShellAssets,
      originalCount: input.localShellAssets.length,
      type: 'system',
      menu: false
    })
  ]
  return groups.filter((group) => group.children.length > 0 || group.childGroups.length > 0 || group.type !== 'system')
}

export const buildBastionGroups = (input: {
  bastionFolders: WorkspacePanelFolder[]
  bastionResourceAssets: WorkspacePanelAsset[]
  organizationAssets: WorkspacePanelAsset[]
}): WorkspacePanelGroup[] => {
  const folderGroupsByUuid = new Map(
    input.bastionFolders.map((folder) => {
      const children = input.bastionResourceAssets.filter((asset) => asset.folderUuid === folder.uuid)
      return [
        folder.uuid,
        makeGroup({
          key: folder.uuid,
          title: folder.name,
          children,
          originalCount: children.length,
          type: 'custom-folder' as const,
          refreshable: false,
          menu: true,
          folderUuid: folder.uuid,
          ...(folder.parentUuid ? { parentKey: folder.parentUuid } : {})
        })
      ] as const
    })
  )
  const folderRoots: WorkspacePanelGroup[] = []
  folderGroupsByUuid.forEach((group) => {
    const parent = group.parentKey ? folderGroupsByUuid.get(group.parentKey) : null
    if (parent && parent.key !== group.key) parent.childGroups.push(group)
    else folderRoots.push(group)
  })
  const orgGroups = input.organizationAssets.map((org) => {
    const children = [
      org,
      ...input.bastionResourceAssets.filter((asset) => !asset.folderUuid && (!asset.organizationId || asset.organizationId === org.uuid))
    ]
    return makeGroup({
      key: org.uuid,
      title: org.name,
      children,
      originalCount: children.length,
      type: 'organization' as const,
      refreshable: true,
      menu: true,
      organizationId: org.uuid
    })
  })

  return [...orgGroups, ...folderRoots]
}

export const filterGroupTree = (group: WorkspacePanelGroup, keyword: string): WorkspacePanelGroup | null => {
  const groupMatches = `${group.title} ${group.folderUuid || ''}`.toLowerCase().includes(keyword)
  const childGroups = group.childGroups.map((child) => filterGroupTree(child, keyword)).filter((child): child is WorkspacePanelGroup => Boolean(child))
  const children = groupMatches
    ? group.children
    : group.children.filter((asset) =>
        `${asset.title} ${asset.name} ${asset.host} ${asset.ip} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
      )
  if (!groupMatches && childGroups.length === 0 && children.length === 0) return null
  return {
    ...group,
    children,
    childGroups,
    originalCount: group.originalCount
  }
}

export const collectGroupAssets = (group: WorkspacePanelGroup): WorkspacePanelAsset[] => [...group.children, ...group.childGroups.flatMap(collectGroupAssets)]

export const assetGroupAssetCount = (group: WorkspacePanelGroup): number => collectGroupAssets(group).length

export const collectTreeRows = (
  groups: WorkspacePanelGroup[],
  isGroupExpanded: (key: string) => boolean,
  depth = 0
): WorkspacePanelTreeRow[] =>
  groups.flatMap((group) => {
    const rows: WorkspacePanelTreeRow[] = [{ key: `group-row-${group.key}`, kind: 'group', group, depth }]
    if (isGroupExpanded(group.key)) {
      rows.push(...collectTreeRows(group.childGroups, isGroupExpanded, depth + 1))
      rows.push(...group.children.map((asset) => ({ key: `asset-row-${group.key}-${asset.id}`, kind: 'asset' as const, asset, depth: depth + 1, parentGroupKey: group.key })))
    }
    return rows
  })
