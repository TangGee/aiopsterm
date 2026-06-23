import { describe, expect, it } from 'vitest'
import {
  assetGroupAssetCount,
  buildBastionGroups,
  buildDirectGroups,
  collectTreeRows,
  directGroupKey,
  filterGroupTree,
  folderGroupKey,
  folderScopeMatches,
  normalizeDirectGroupName,
  ungroupedGroupName,
  type WorkspacePanelAsset,
  type WorkspacePanelFolder
} from '@/services/assets/workspaceAssetTreeRuntime'

const asset = (overrides: Partial<WorkspacePanelAsset>): WorkspacePanelAsset => ({
  id: 'asset-1',
  uuid: 'asset-1',
  name: 'asset-1',
  title: 'asset-1',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: '',
  group_name: '',
  status: 'online',
  tags: [],
  username: 'root',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  ...overrides
})

const folder = (overrides: Partial<WorkspacePanelFolder>): WorkspacePanelFolder => ({
  uuid: 'folder-1',
  name: 'folder-1',
  description: '',
  scope: 'direct',
  ...overrides
})

describe('workspaceAssetTreeRuntime', () => {
  it('builds direct groups with recent and local shell system groups', () => {
    const prod = folder({ uuid: 'direct-prod', name: 'Prod' })
    const child = folder({ uuid: 'direct-db', name: 'DB', parentUuid: prod.uuid })
    const prodHost = asset({ id: 'prod-1', name: 'prod-host', title: 'prod-host', group: 'Prod', group_name: 'Prod' })
    const dbHost = asset({ id: 'db-1', name: 'db-host', title: 'db-host', group: 'DB', group_name: 'DB' })
    const ungroupedHost = asset({ id: 'ungrouped-1', name: 'loose-host', title: 'loose-host', group: 'Hosts', group_name: 'Hosts' })
    const local = asset({ id: 'local-shell', name: 'Local Shell', title: 'Local Shell', isLocalShell: true })

    const groups = buildDirectGroups({
      directAssets: [prodHost, dbHost, ungroupedHost],
      localShellAssets: [local],
      directFolders: [prod, child],
      recentAssetIds: [dbHost.id, 'missing']
    })

    expect(groups.map((group) => group.key)).toEqual(['recent_connections', directGroupKey('Prod'), directGroupKey(ungroupedGroupName), 'local_connections'])
    expect(groups[0].children.map((item) => item.id)).toEqual([dbHost.id])
    expect(groups[1].children.map((item) => item.id)).toEqual([prodHost.id])
    expect(groups[1].childGroups[0].key).toBe(directGroupKey('DB'))
    expect(groups[1].childGroups[0].children.map((item) => item.id)).toEqual([dbHost.id])
    expect(groups[2].children.map((item) => item.id)).toEqual([ungroupedHost.id])
    expect(groups[3].children.map((item) => item.id)).toEqual([local.id])
  })

  it('builds bastion organization and folder trees', () => {
    const org = asset({ id: 'org-1', uuid: 'org-1', name: 'Jumpserver', title: 'Jumpserver', asset_type: 'organization' })
    const rootFolder = folder({ uuid: 'bastion-prod', name: 'Prod', scope: 'bastion' })
    const childFolder = folder({ uuid: 'bastion-db', name: 'DB', scope: 'bastion', parentUuid: rootFolder.uuid })
    const orgHost = asset({ id: 'org-host', name: 'org-host', title: 'org-host', organizationId: org.uuid })
    const folderHost = asset({ id: 'folder-host', name: 'folder-host', title: 'folder-host', organizationId: org.uuid, folderUuid: childFolder.uuid })

    const groups = buildBastionGroups({
      bastionFolders: [rootFolder, childFolder],
      bastionResourceAssets: [orgHost, folderHost],
      organizationAssets: [org]
    })

    expect(groups.map((group) => group.key)).toEqual([org.uuid, rootFolder.uuid])
    expect(groups[0].children.map((item) => item.id)).toEqual([org.id, orgHost.id])
    expect(groups[1].childGroups[0].key).toBe(childFolder.uuid)
    expect(groups[1].childGroups[0].children.map((item) => item.id)).toEqual([folderHost.id])
    expect(folderScopeMatches(rootFolder, 'bastion')).toBe(true)
    expect(folderScopeMatches(rootFolder, 'direct')).toBe(false)
    expect(folderGroupKey(childFolder)).toBe(childFolder.uuid)
  })

  it('filters group trees and collects visible rows by expanded state', () => {
    const groups = buildDirectGroups({
      directAssets: [
        asset({ id: 'prod-1', name: 'prod-api', title: 'prod-api', host: '10.0.0.1', group: 'Prod', group_name: 'Prod' }),
        asset({ id: 'qa-1', name: 'qa-api', title: 'qa-api', host: '10.0.1.1', group: 'QA', group_name: 'QA' })
      ],
      localShellAssets: [],
      directFolders: [folder({ uuid: 'direct-prod', name: 'Prod' }), folder({ uuid: 'direct-qa', name: 'QA' })],
      recentAssetIds: []
    })

    const filtered = groups.map((group) => filterGroupTree(group, 'qa-api')).filter((group): group is NonNullable<typeof group> => Boolean(group))
    const rows = collectTreeRows(filtered, (key) => key === directGroupKey('QA'))

    expect(filtered.map((group) => group.title)).toEqual(['QA'])
    expect(assetGroupAssetCount(filtered[0])).toBe(1)
    expect(rows.map((row) => row.key)).toEqual([`group-row-${directGroupKey('QA')}`, `asset-row-${directGroupKey('QA')}-qa-1`])
    expect(rows[1]).toMatchObject({ kind: 'asset', depth: 1, parentGroupKey: directGroupKey('QA') })
  })

  it('normalizes legacy empty direct group names', () => {
    expect(normalizeDirectGroupName()).toBe(ungroupedGroupName)
    expect(normalizeDirectGroupName('')).toBe(ungroupedGroupName)
    expect(normalizeDirectGroupName('Hosts')).toBe(ungroupedGroupName)
    expect(normalizeDirectGroupName('Prod')).toBe('Prod')
  })
})
