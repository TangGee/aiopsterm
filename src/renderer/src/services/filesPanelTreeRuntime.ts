import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'

export type FilesPanelTab = 'direct' | 'bastion'

export type FilesPanelGroup = {
  name: string
  key: string
  sessions: FileSessionInfo[]
  childGroups: FilesPanelGroup[]
  originalCount: number
  type: 'system' | 'direct-group' | 'organization' | 'custom-folder'
  parentKey?: string
  folderUuid?: string
  organizationId?: string
  groupName?: string
  description?: string
}

export type FilesPanelTreeRow =
  | { key: string; kind: 'group'; group: FilesPanelGroup; depth: number }
  | { key: string; kind: 'session'; session: FileSessionInfo; depth: number; parentGroupKey: string }

export type FilesPanelContextMenuOptions = {
  favorite: boolean
  comment: boolean
  move: boolean
  remove: boolean
  editFolder: boolean
  deleteFolder: boolean
}

const ungroupedGroupName = '未分组'

const makeGroup = (
  input: Omit<FilesPanelGroup, 'sessions' | 'childGroups'> & Partial<Pick<FilesPanelGroup, 'sessions' | 'childGroups'>>
): FilesPanelGroup => ({
  ...input,
  sessions: input.sessions || [],
  childGroups: input.childGroups || []
})

export const normalizeDirectFilesPanelGroupName = (name?: string) => {
  const trimmed = String(name || '').trim()
  return !trimmed || trimmed === 'Hosts' ? ungroupedGroupName : trimmed
}

export const directFilesPanelGroupKey = (name: string) => `group-${name}`

const sessionGroupName = (session: FileSessionInfo) => normalizeDirectFilesPanelGroupName(session.group)

export const filesPanelFolderScope = (folder: Pick<FileSessionFolderRecord, 'scope'>) => (folder.scope === 'direct' ? 'direct' : 'bastion')

export const filesPanelFoldersForTab = (folders: FileSessionFolderRecord[], tab: FilesPanelTab) =>
  folders.filter((folder) => filesPanelFolderScope(folder) === tab)

export const buildFilesPanelDirectGroups = (input: {
  sessions: FileSessionInfo[]
  folders: FileSessionFolderRecord[]
  recentSessionIds: string[]
}): FilesPanelGroup[] => {
  const localSessions = input.sessions.filter((session) => session.kind === 'local')
  const directSessions = input.sessions.filter((session) => session.kind === 'remote' && session.assetType !== 'organization')
  const foldersByName = new Map(input.folders.map((folder) => [folder.name, folder]))
  const groupNames = [
    ...new Set([...input.folders.map((folder) => folder.name), ...directSessions.map((session) => sessionGroupName(session))])
  ].filter(Boolean)
  const groupsByName = new Map<string, FilesPanelGroup>()

  groupNames.forEach((name) => {
    const folder = foldersByName.get(name)
    const parentFolder = folder?.parentUuid ? input.folders.find((item) => item.uuid === folder.parentUuid) : null
    const sessions = directSessions.filter((session) => sessionGroupName(session) === name)
    groupsByName.set(
      name,
      makeGroup({
        key: directFilesPanelGroupKey(name),
        name,
        sessions,
        originalCount: sessions.length,
        type: 'direct-group',
        groupName: name,
        ...(folder ? { folderUuid: folder.uuid, description: folder.description } : {}),
        ...(parentFolder ? { parentKey: directFilesPanelGroupKey(parentFolder.name) } : {})
      })
    )
  })

  const roots: FilesPanelGroup[] = []
  groupsByName.forEach((group) => {
    const parent = group.parentKey ? [...groupsByName.values()].find((item) => item.key === group.parentKey) : null
    if (parent && parent.key !== group.key) {
      parent.childGroups.push(group)
      return
    }
    roots.push(group)
  })

  const recentSessions = input.recentSessionIds
    .map((id) => directSessions.find((session) => session.id === id))
    .filter((session): session is FileSessionInfo => Boolean(session))
  const groups = [
    makeGroup({
      key: 'recent_connections',
      name: '最近连接',
      sessions: recentSessions,
      originalCount: recentSessions.length,
      type: 'system'
    }),
    ...roots,
    makeGroup({
      key: 'local_connections',
      name: '本地连接',
      sessions: localSessions,
      originalCount: localSessions.length,
      type: 'system'
    })
  ]
  return groups.filter((group) => group.sessions.length > 0 || group.childGroups.length > 0 || group.type !== 'system')
}

export const buildFilesPanelBastionGroups = (input: {
  sessions: FileSessionInfo[]
  folders: FileSessionFolderRecord[]
}): FilesPanelGroup[] => {
  const organizationSessions = input.sessions.filter((session) => session.kind === 'remote' && session.assetType === 'organization')
  const bastionResourceSessions = input.sessions.filter((session) => {
    if (session.kind !== 'remote' || session.assetType === 'organization') return false
    const folder = session.folderUuid ? input.folders.find((item) => item.uuid === session.folderUuid) : null
    return Boolean(session.organizationId || (folder && filesPanelFolderScope(folder) === 'bastion'))
  })

  const folderGroupsByUuid = new Map(
    input.folders.map((folder) => {
      const sessions = bastionResourceSessions.filter((session) => session.folderUuid === folder.uuid)
      return [
        folder.uuid,
        makeGroup({
          key: folder.uuid,
          name: folder.name,
          sessions,
          originalCount: sessions.length,
          type: 'custom-folder' as const,
          folderUuid: folder.uuid,
          description: folder.description,
          ...(folder.parentUuid ? { parentKey: folder.parentUuid } : {})
        })
      ] as const
    })
  )
  const folderRoots: FilesPanelGroup[] = []
  folderGroupsByUuid.forEach((group) => {
    const parent = group.parentKey ? folderGroupsByUuid.get(group.parentKey) : null
    if (parent && parent.key !== group.key) parent.childGroups.push(group)
    else folderRoots.push(group)
  })

  const organizationGroups = organizationSessions.map((organization) => {
    const organizationId = organization.organizationId || organization.id
    const sessions = [
      organization,
      ...bastionResourceSessions.filter((session) => !session.folderUuid && (!session.organizationId || session.organizationId === organizationId))
    ]
    return makeGroup({
      key: organizationId,
      name: organization.label,
      sessions,
      originalCount: sessions.length,
      type: 'organization' as const,
      organizationId
    })
  })
  return [...organizationGroups, ...folderRoots]
}

export const buildFilesPanelGroups = (input: {
  tab: FilesPanelTab
  sessions: FileSessionInfo[]
  folders: FileSessionFolderRecord[]
  recentSessionIds: string[]
}) =>
  input.tab === 'direct'
    ? buildFilesPanelDirectGroups({
        sessions: input.sessions,
        folders: filesPanelFoldersForTab(input.folders, 'direct'),
        recentSessionIds: input.recentSessionIds
      })
    : buildFilesPanelBastionGroups({
        sessions: input.sessions,
        folders: filesPanelFoldersForTab(input.folders, 'bastion')
      })

export const flattenFilesPanelGroups = (group: FilesPanelGroup): FilesPanelGroup[] => [group, ...group.childGroups.flatMap(flattenFilesPanelGroups)]

const matchesSession = (session: FileSessionInfo, keyword: string) =>
  !keyword ||
  [session.label, session.host, session.username, session.group, session.comment]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword))

export const filterFilesPanelGroupTree = (group: FilesPanelGroup, keyword: string): FilesPanelGroup | null => {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const groupMatches =
    !normalizedKeyword || [group.name, group.description, group.folderUuid].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedKeyword))
  const childGroups = group.childGroups
    .map((child) => filterFilesPanelGroupTree(child, normalizedKeyword))
    .filter((child): child is FilesPanelGroup => Boolean(child))
  const sessions = groupMatches ? group.sessions : group.sessions.filter((session) => matchesSession(session, normalizedKeyword))
  if (!groupMatches && childGroups.length === 0 && sessions.length === 0) return null
  return { ...group, sessions, childGroups }
}

export const filterFilesPanelGroups = (groups: FilesPanelGroup[], query: string) => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return groups
  return groups.map((group) => filterFilesPanelGroupTree(group, keyword)).filter((group): group is FilesPanelGroup => Boolean(group))
}

export const filesPanelGroupSessions = (group: FilesPanelGroup): FileSessionInfo[] => [
  ...group.sessions,
  ...group.childGroups.flatMap(filesPanelGroupSessions)
]

export const filesPanelGroupSessionCount = (group: FilesPanelGroup) => filesPanelGroupSessions(group).length

export const collectFilesPanelTreeRows = (
  groups: FilesPanelGroup[],
  isGroupExpanded: (key: string) => boolean,
  depth = 0
): FilesPanelTreeRow[] =>
  groups.flatMap((group) => {
    const rows: FilesPanelTreeRow[] = [{ key: `files-group-${group.key}`, kind: 'group', group, depth }]
    if (isGroupExpanded(group.key)) {
      rows.push(...collectFilesPanelTreeRows(group.childGroups, isGroupExpanded, depth + 1))
      rows.push(
        ...group.sessions.map((session) => ({
          key: `files-session-${group.key}-${session.id}`,
          kind: 'session' as const,
          session,
          depth: depth + 1,
          parentGroupKey: group.key
        }))
      )
    }
    return rows
  })

export const findFilesPanelGroup = (groups: FilesPanelGroup[], key: string) =>
  groups.flatMap(flattenFilesPanelGroups).find((group) => group.key === key) || null

export const filesPanelFolderForGroup = (input: {
  group: FilesPanelGroup | null
  directFolders: FileSessionFolderRecord[]
  bastionFolders: FileSessionFolderRecord[]
}) => {
  const group = input.group
  if (!group) return null
  if (group.type === 'direct-group') return input.directFolders.find((folder) => folder.uuid === group.folderUuid || folder.name === group.groupName) || null
  if (group.type === 'custom-folder') return input.bastionFolders.find((folder) => folder.uuid === group.folderUuid) || null
  return null
}

export const filesPanelDeleteFolderAssetCount = (input: {
  groups: FilesPanelGroup[]
  sessions: FileSessionInfo[]
  folderUuid: string
}) => {
  const group = input.groups.flatMap(flattenFilesPanelGroups).find((item) => item.folderUuid === input.folderUuid)
  return group ? filesPanelGroupSessionCount(group) : input.sessions.filter((session) => session.folderUuid === input.folderUuid).length
}

export const emptyFilesPanelContextOptions: FilesPanelContextMenuOptions = {
  favorite: false,
  comment: false,
  move: false,
  remove: false,
  editFolder: false,
  deleteFolder: false
}

const isOrganizationAssetSession = (session: FileSessionInfo | null) => session?.assetType === 'person' || session?.assetType === 'organization'

export const buildFilesPanelSessionContextOptions = (
  session: FileSessionInfo | null,
  tab: FilesPanelTab
): FilesPanelContextMenuOptions => {
  const sessionKey = session?.id || ''
  const canManageFolders = tab === 'bastion'
  return {
    favorite: session?.favorite !== undefined,
    comment: isOrganizationAssetSession(session) && !sessionKey.startsWith('common_'),
    move: canManageFolders && isOrganizationAssetSession(session) && session?.assetType !== 'organization' && !sessionKey.startsWith('common_'),
    remove: canManageFolders && isOrganizationAssetSession(session) && !!session?.folderUuid,
    editFolder: false,
    deleteFolder: false
  }
}

export const buildFilesPanelFolderContextOptions = (
  folder: FileSessionFolderRecord | null,
  group: FilesPanelGroup | null,
  tab: FilesPanelTab
): FilesPanelContextMenuOptions => ({
  ...emptyFilesPanelContextOptions,
  editFolder: tab === 'bastion' && !!folder && group?.type === 'custom-folder',
  deleteFolder: tab === 'bastion' && !!folder && group?.type === 'custom-folder'
})

export const countFilesPanelContextOptions = (options: FilesPanelContextMenuOptions) => Object.values(options).filter(Boolean).length

export const displayFilesPanelSession = (session: FileSessionInfo, showIpMode: boolean) => (showIpMode ? session.host : session.label)
