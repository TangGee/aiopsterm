import { describe, expect, it } from 'vitest'
import {
  buildFilesPanelFolderContextOptions,
  buildFilesPanelGroups,
  buildFilesPanelSessionContextOptions,
  collectFilesPanelTreeRows,
  directFilesPanelGroupKey,
  displayFilesPanelSession,
  filesPanelDeleteFolderAssetCount,
  filesPanelFolderForGroup,
  filesPanelFoldersForTab,
  filesPanelGroupSessionCount,
  filterFilesPanelGroups,
  findFilesPanelGroup
} from '@/services/filesPanelTreeRuntime'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'

const folders: FileSessionFolderRecord[] = [
  { uuid: 'direct-prod', name: '生产', description: '生产直连', scope: 'direct' },
  { uuid: 'direct-db', name: '数据库', description: '数据库直连', parentUuid: 'direct-prod', scope: 'direct' },
  { uuid: 'bastion-core', name: '核心业务', description: '核心堡垒机资产', scope: 'bastion' },
  { uuid: 'bastion-temp', name: '临时排障', description: '短期排障入口', scope: 'bastion' }
]

const sessions: FileSessionInfo[] = [
  {
    id: 'local',
    label: 'Local',
    host: 'localhost',
    group: 'Local',
    kind: 'local',
    rootPath: '/',
    status: 'active'
  },
  {
    id: 'prod',
    label: 'prod-bastion',
    host: '10.24.8.12',
    username: 'ops',
    group: '生产',
    kind: 'remote',
    rootPath: '/home/ops',
    status: 'active',
    favorite: true,
    assetType: 'person',
    organizationId: 'org-prod',
    comment: '生产入口'
  },
  {
    id: 'mysql',
    label: 'mysql-primary',
    host: '10.24.12.44',
    username: 'dba',
    group: '数据库',
    kind: 'remote',
    rootPath: '/var/lib/mysql',
    status: 'active',
    favorite: false,
    assetType: 'person'
  },
  {
    id: 'staging',
    label: 'staging-api',
    host: '10.24.9.20',
    username: 'deploy',
    group: 'Hosts',
    kind: 'remote',
    rootPath: '/srv/app',
    status: 'active',
    favorite: false,
    assetType: 'person',
    folderUuid: 'bastion-core',
    comment: '预发布'
  },
  {
    id: 'org-prod',
    label: 'jumpserver-org',
    host: '10.24.0.10',
    group: '组织',
    kind: 'remote',
    rootPath: '/',
    status: 'active',
    assetType: 'organization',
    organizationId: 'org-prod'
  },
  {
    id: 'common_seed',
    label: 'common-host',
    host: '10.24.0.11',
    group: '组织',
    kind: 'remote',
    rootPath: '/',
    status: 'active',
    assetType: 'person',
    organizationId: 'org-prod'
  }
]

describe('filesPanelTreeRuntime', () => {
  it('builds direct session groups with recent, nested folders, local sessions, and Hosts fallback', () => {
    const groups = buildFilesPanelGroups({
      tab: 'direct',
      sessions,
      folders,
      recentSessionIds: ['prod', 'missing']
    })

    expect(groups.map((group) => group.name)).toEqual(['最近连接', '生产', '未分组', '组织', '本地连接'])
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['prod'])
    const prodGroup = findFilesPanelGroup(groups, directFilesPanelGroupKey('生产'))
    expect(prodGroup?.childGroups.map((group) => group.name)).toEqual(['数据库'])
    expect(prodGroup?.sessions.map((session) => session.id)).toEqual(['prod'])
    expect(findFilesPanelGroup(groups, directFilesPanelGroupKey('数据库'))?.sessions.map((session) => session.id)).toEqual(['mysql'])
    expect(findFilesPanelGroup(groups, directFilesPanelGroupKey('未分组'))?.sessions.map((session) => session.id)).toEqual(['staging'])
    expect(findFilesPanelGroup(groups, directFilesPanelGroupKey('组织'))?.sessions.map((session) => session.id)).toEqual(['common_seed'])
    expect(findFilesPanelGroup(groups, 'local_connections')?.sessions.map((session) => session.id)).toEqual(['local'])
  })

  it('builds bastion organization and folder groups, filters them, and projects expanded rows', () => {
    const groups = buildFilesPanelGroups({
      tab: 'bastion',
      sessions,
      folders,
      recentSessionIds: []
    })

    expect(groups.map((group) => group.name)).toEqual(['jumpserver-org', '核心业务', '临时排障'])
    expect(findFilesPanelGroup(groups, 'org-prod')?.sessions.map((session) => session.id)).toEqual(['org-prod', 'prod', 'common_seed'])
    expect(findFilesPanelGroup(groups, 'bastion-core')?.sessions.map((session) => session.id)).toEqual(['staging'])
    expect(filesPanelGroupSessionCount(findFilesPanelGroup(groups, 'org-prod')!)).toBe(3)

    const filtered = filterFilesPanelGroups(groups, '预发布')
    expect(filtered.map((group) => group.name)).toEqual(['核心业务'])
    expect(filtered[0].sessions.map((session) => session.id)).toEqual(['staging'])

    const rows = collectFilesPanelTreeRows(filtered, () => true)
    expect(rows.map((row) => row.key)).toEqual(['files-group-bastion-core', 'files-session-bastion-core-staging'])
  })

  it('resolves folder records, delete counts, context menus, and display names without Vue state', () => {
    const directFolders = filesPanelFoldersForTab(folders, 'direct')
    const bastionFolders = filesPanelFoldersForTab(folders, 'bastion')
    const groups = buildFilesPanelGroups({
      tab: 'bastion',
      sessions,
      folders,
      recentSessionIds: []
    })
    const folderGroup = findFilesPanelGroup(groups, 'bastion-core')

    expect(filesPanelFolderForGroup({ group: folderGroup, directFolders, bastionFolders })?.uuid).toBe('bastion-core')
    expect(filesPanelDeleteFolderAssetCount({ groups, sessions, folderUuid: 'bastion-core' })).toBe(1)
    expect(filesPanelDeleteFolderAssetCount({ groups: [], sessions, folderUuid: 'bastion-core' })).toBe(1)
    expect(displayFilesPanelSession(sessions[1], false)).toBe('prod-bastion')
    expect(displayFilesPanelSession(sessions[1], true)).toBe('10.24.8.12')

    expect(buildFilesPanelSessionContextOptions(sessions[1], 'direct')).toEqual({
      favorite: true,
      comment: true,
      move: false,
      remove: false,
      editFolder: false,
      deleteFolder: false
    })
    expect(buildFilesPanelSessionContextOptions(sessions[3], 'bastion')).toEqual({
      favorite: true,
      comment: true,
      move: true,
      remove: true,
      editFolder: false,
      deleteFolder: false
    })
    expect(buildFilesPanelSessionContextOptions(sessions[5], 'bastion').comment).toBe(false)
    expect(buildFilesPanelFolderContextOptions(bastionFolders[0], folderGroup, 'bastion')).toEqual({
      favorite: false,
      comment: false,
      move: false,
      remove: false,
      editFolder: true,
      deleteFolder: true
    })
  })
})
