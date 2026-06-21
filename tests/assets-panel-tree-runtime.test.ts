import { describe, expect, it } from 'vitest'
import {
  assetGroupAssetCount,
  buildDirectAssetGroups,
  buildExportAssetGroups,
  buildManagedGroups,
  collectManagedRows,
  directGroupKey,
  filterAssetGroups,
  findAssetGroupByKey,
  flattenAssetGroups,
  normalizeDirectAssetGroupName,
  type AssetsPanelAsset
} from '@/services/assetsPanelTreeRuntime'
import type { AiopsAssetGroupRecord, AiopsCustomFolderRecord } from '@shared/contracts/assets'

const asset = (overrides: Partial<AssetsPanelAsset>): AssetsPanelAsset => ({
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

const folder = (overrides: Partial<AiopsCustomFolderRecord>): AiopsCustomFolderRecord => ({
  uuid: 'folder-1',
  name: 'folder-1',
  description: '',
  scope: 'direct',
  ...overrides
})

const groupOption = (name: string): AiopsAssetGroupRecord => ({
  key: `group-${name}`,
  name,
  count: 0
})

describe('assetsPanelTreeRuntime', () => {
  it('builds direct asset groups from folders, options, and legacy Hosts names', () => {
    const prod = folder({ uuid: 'direct-prod', name: 'Prod' })
    const database = folder({ uuid: 'direct-db', name: 'DB', parentUuid: prod.uuid })
    const prodHost = asset({ id: 'prod-1', title: 'prod-api', group: 'Prod', group_name: 'Prod' })
    const dbHost = asset({ id: 'db-1', title: 'database-primary', group: 'DB', group_name: 'DB' })
    const ungroupedHost = asset({ id: 'ungrouped-1', title: 'legacy-host', group: 'Hosts', group_name: 'Hosts' })

    expect(
      buildDirectAssetGroups({
        assets: [prodHost],
        directFolders: [prod],
        assetGroupOptions: [groupOption('Prod')],
        assetGroupOptionsReady: false
      })
    ).toEqual([])

    const groups = buildDirectAssetGroups({
      assets: [prodHost, dbHost, ungroupedHost],
      directFolders: [prod, database],
      assetGroupOptions: [groupOption('Prod'), groupOption('Hosts'), groupOption('Staging')],
      assetGroupOptionsReady: true
    })

    expect(groups.map((group) => group.key)).toEqual([directGroupKey('Prod'), directGroupKey('未分组'), directGroupKey('Staging')])
    expect(groups[0].children.map((item) => item.id)).toEqual([prodHost.id])
    expect(groups[0].childGroups[0]).toMatchObject({
      key: directGroupKey('DB'),
      parentKey: directGroupKey('Prod'),
      folderUuid: database.uuid
    })
    expect(groups[0].childGroups[0].children.map((item) => item.id)).toEqual([dbHost.id])
    expect(groups[1].children.map((item) => item.id)).toEqual([ungroupedHost.id])
    expect(assetGroupAssetCount(groups[0])).toBe(2)
    expect(assetGroupAssetCount(groups[2])).toBe(0)
    expect(findAssetGroupByKey(groups, directGroupKey('DB'))?.title).toBe('DB')
  })

  it('filters nested groups while preserving matching ancestors', () => {
    const groups = buildDirectAssetGroups({
      assets: [
        asset({ id: 'prod-1', title: 'prod-api', host: '10.0.0.1', group: 'Prod', group_name: 'Prod' }),
        asset({ id: 'db-1', title: 'database-primary', host: '10.0.0.2', group: 'DB', group_name: 'DB', tags: ['primary'] }),
        asset({ id: 'qa-1', title: 'qa-api', host: '10.0.1.1', group: 'QA', group_name: 'QA' })
      ],
      directFolders: [
        folder({ uuid: 'direct-prod', name: 'Prod' }),
        folder({ uuid: 'direct-db', name: 'DB', parentUuid: 'direct-prod' }),
        folder({ uuid: 'direct-qa', name: 'QA' })
      ],
      assetGroupOptions: [],
      assetGroupOptionsReady: true
    })

    const filtered = filterAssetGroups(groups, 'primary')

    expect(filtered.map((group) => group.title)).toEqual(['Prod'])
    expect(filtered[0].children).toEqual([])
    expect(filtered[0].childGroups.map((group) => group.title)).toEqual(['DB'])
    expect(flattenAssetGroups(filtered).flatMap((group) => group.children).map((item) => item.id)).toEqual(['db-1'])
  })

  it('builds export groups for selectable non-organization assets', () => {
    const groups = buildExportAssetGroups([
      asset({ id: 'prod-1', title: 'prod-api', group: 'Prod', group_name: 'Prod' }),
      asset({ id: 'prod-2', title: 'prod-worker', group: 'Prod', group_name: 'Prod' }),
      asset({ id: 'qa-1', title: 'qa-api', group: 'QA', group_name: 'QA' })
    ])

    expect(groups.map((group) => group.key)).toEqual(['export-group-Prod', 'export-group-QA'])
    expect(groups[0].children.map((item) => item.id)).toEqual(['prod-1', 'prod-2'])
    expect(groups[1].children.map((item) => item.id)).toEqual(['qa-1'])
  })

  it('builds managed organization, folder, and loose groups with visible rows', () => {
    const organization = asset({
      id: 'org-1',
      uuid: 'org-1',
      name: 'Jumpserver',
      title: 'Jumpserver',
      asset_type: 'organization'
    })
    const prodFolder = folder({ uuid: 'bastion-prod', name: 'Prod', scope: 'bastion' })
    const dbFolder = folder({ uuid: 'bastion-db', name: 'DB', scope: 'bastion', parentUuid: prodFolder.uuid })
    const orgHost = asset({ id: 'org-host', title: 'org-host', organizationId: organization.uuid })
    const dbHost = asset({ id: 'db-host', title: 'db-host', organizationId: organization.uuid, folderUuid: dbFolder.uuid })
    const orphanFolderHost = asset({ id: 'orphan-folder-host', title: 'orphan-folder-host', folderUuid: prodFolder.uuid })
    const looseHost = asset({ id: 'loose-host', title: 'loose-host', group: 'QA', group_name: 'QA' })

    const groups = buildManagedGroups({
      sourceAssets: [orgHost, dbHost, orphanFolderHost, looseHost],
      allAssets: [organization, orgHost, dbHost, orphanFolderHost, looseHost],
      bastionFolders: [prodFolder, dbFolder]
    })

    expect(groups.map((group) => group.key)).toEqual(['managed-org-org-1', 'managed-folder-bastion-prod', 'managed-group-QA'])
    expect(groups[0].children.map((item) => item.id)).toEqual([orgHost.id])
    expect(groups[0].childGroups[0].key).toBe('managed-org-folder-org-1-managed-folder-bastion-prod')
    expect(groups[0].childGroups[0].childGroups[0].children.map((item) => item.id)).toEqual([dbHost.id])
    expect(groups[1].children.map((item) => item.id)).toEqual([orphanFolderHost.id])
    expect(groups[2].children.map((item) => item.id)).toEqual([looseHost.id])

    const rows = collectManagedRows(groups, () => true)
    expect(rows.map((row) => row.key)).toEqual([
      'managed-group-managed-org-org-1',
      'managed-group-managed-org-folder-org-1-managed-folder-bastion-prod',
      'managed-group-managed-org-folder-org-1-managed-folder-bastion-db',
      'managed-asset-managed-org-folder-org-1-managed-folder-bastion-db-db-host',
      'managed-asset-managed-org-org-1-org-host',
      'managed-group-managed-folder-bastion-prod',
      'managed-asset-managed-folder-bastion-prod-orphan-folder-host',
      'managed-group-managed-group-QA',
      'managed-asset-managed-group-QA-loose-host'
    ])
    expect(rows.find((row) => row.key.endsWith('db-host'))).toMatchObject({ kind: 'asset', depth: 3 })
  })

  it('normalizes direct group names', () => {
    expect(normalizeDirectAssetGroupName()).toBe('未分组')
    expect(normalizeDirectAssetGroupName('')).toBe('未分组')
    expect(normalizeDirectAssetGroupName('Hosts')).toBe('未分组')
    expect(normalizeDirectAssetGroupName('Prod')).toBe('Prod')
  })
})
