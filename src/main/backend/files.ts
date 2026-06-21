import { randomUUID } from 'crypto'
import { app } from 'electron'
import Store from 'electron-store'
import { dirname as getLocalDirname, isAbsolute, join, resolve } from 'path'
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'fs/promises'
import type {
  FileSessionCatalog,
  FileSessionCatalogResult,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionMutationResult,
  FileSessionPatch,
  FileSessionSftpPayload,
  FileSessionTerminalContext,
  FileContentOptions,
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileListOptions,
  FileReadContentResult,
  FileTransferOperation,
  FileTransferOperationResult,
  FileWriteContentResult
} from '@shared/contracts/files'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { AiopsAssetInput } from '@shared/contracts/assets'
import { shouldUseFilesSeedData } from '@shared/runtimeSwitches'
import { deleteAssetFolder, getAsset, listAssets, saveAsset, saveAssetFolder } from './assets'
import { ensureTextSize, modeString, normalizeRemotePath, sortFileEntries as sortEntries, validateFileContentVersion } from './filesPathRuntime'
import {
  clearRemoteSftpPool,
  configureFilesSftpRuntime,
  copyRemoteTransferViaSftp,
  downloadRemoteDirectoryViaSftp,
  downloadRemoteFileViaSftp,
  isFilesSftpUnsupportedError,
  listRemoteFilesViaSftp,
  mutateRemoteFileEntryViaSftp,
  readRemoteFileViaSftp,
  sftpUnavailableError,
  sftpUnavailableMessage,
  uploadRemoteDirectoryViaSftp,
  uploadRemoteFileViaSftp,
  writeRemoteFileViaSftp
} from './filesSftpRuntime'
import { mutationTask, resetFileTransferRuntimeForTests, writeContentTask } from './filesTransferRuntime'
export { getRemoteSftpPoolSnapshotForTests as __getRemoteSftpPoolSnapshotForTests } from './filesSftpRuntime'
export { cancelFileTransferTask, listFileTransferTasks } from './filesTransferRuntime'

type FileSessionCatalogStoreShape = FileSessionCatalog
type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}

type FilesBackendRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
  sftpPoolIdleTtlMs?: number
}

const defaultFileSessionSeedMode = shouldUseFilesSeedData

const defaultFileSessionDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_FILES_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

type FilesBackendRuntimeState = Required<Pick<FilesBackendRuntimeConfig, 'databasePath' | 'useSeedData' | 'forceFallbackStore'>> & {
  sqliteFactory?: new (path: string) => SqliteDatabase
}

let filesRuntimeConfig: FilesBackendRuntimeState = {
  databasePath: defaultFileSessionDatabasePath(),
  useSeedData: defaultFileSessionSeedMode(),
  forceFallbackStore: false
}

export const configureFilesBackendRuntime = (config: FilesBackendRuntimeConfig = {}) => {
  clearRemoteSftpPool()
  configureFilesSftpRuntime({ getConfig: config.getConfig, sftpPoolIdleTtlMs: config.sftpPoolIdleTtlMs })
  filesRuntimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultFileSessionDatabasePath(),
    useSeedData: config.useSeedData ?? defaultFileSessionSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore),
    ...(config.sqliteFactory ? { sqliteFactory: config.sqliteFactory } : {})
  }
  fileSessionCatalog = null
  fileSessionCatalogStore = null
}

const seedTime = new Date('2026-06-04T05:10:00.000Z').getTime()

const textSecret = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const defaultFileSessionFolders: FileSessionFolderRecord[] = [
  {
    uuid: 'files-folder-a',
    name: '核心业务',
    description: '常用远程文件资产'
  },
  {
    uuid: 'files-folder-b',
    name: '临时排障',
    description: '短期调试入口'
  }
]

const defaultFileSessions: FileSessionInfo[] = [
  {
    id: 'local',
    label: 'Local',
    host: '127.0.0.1',
    group: '本地连接',
    kind: 'local',
    rootPath: '/',
    status: 'active',
    assetType: 'local'
  },
  {
    id: 'asset-1',
    label: 'prod-bastion',
    host: '10.24.8.12',
    group: '最近连接',
    kind: 'remote',
    rootPath: '/home/deploy',
    status: 'active',
    favorite: false,
    assetType: 'person',
    comment: '生产入口'
  },
  {
    id: 'folder_asset-2',
    label: 'staging-files',
    host: '10.24.9.20',
    group: '主机',
    kind: 'remote',
    rootPath: '/home/staging',
    status: 'idle',
    favorite: false,
    assetType: 'person',
    folderUuid: 'files-folder-a',
    comment: '预发文件'
  }
]

const fileSessionSeedCatalog = (): FileSessionCatalog => ({
  sessions: defaultFileSessions.map((session) => ({ ...session })),
  folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
})

const fileSessionSeedlessCatalog = (): FileSessionCatalog => ({
  sessions: [{ ...defaultFileSessions[0] }],
  folders: []
})

const defaultFileSessionCatalog = (): FileSessionCatalog =>
  filesRuntimeConfig.useSeedData ? fileSessionSeedCatalog() : fileSessionSeedlessCatalog()

let fileSessionCatalog: FileSessionCatalog | null = null

const cloneSession = (session: FileSessionInfo): FileSessionInfo => ({ ...session })
const cloneFolder = (folder: FileSessionFolderRecord): FileSessionFolderRecord => ({ ...folder })
const cloneFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => ({
  sessions: catalog.sessions.map(cloneSession),
  folders: catalog.folders.map(cloneFolder)
})

const fileSessionLocalEntry = () => cloneSession(defaultFileSessions[0])
const rootPathForAssetUsername = (username: string, fallback = '/') => {
  const name = textSecret(username)
  if (!name || name === 'local') return fallback
  if (name === 'root') return '/root'
  return `/home/${name}`
}
const seedFileSessionForField = (session?: FileSessionInfo) => (session?.id ? seedFileSessionById.get(session.id) : undefined)
const isUserChangedFileSessionField = <K extends keyof FileSessionInfo>(session: FileSessionInfo | undefined, field: K) => {
  if (!session) return false
  const seed = seedFileSessionForField(session)
  return !seed || stableJson(session[field]) !== stableJson(seed[field])
}

const assetToFileSession = (asset: ReturnType<typeof listAssets>['assets'][number], existing?: FileSessionInfo): FileSessionInfo | null => {
  if (asset.isLocalShell) return null
  const host = textSecret(asset.host || asset.ip)
  const username = textSecret(asset.username)
  if (!asset.id || !host) return null
  const isOrganization = asset.asset_type === 'organization'
  return {
    id: asset.id,
    label: asset.title || asset.name || host,
    host,
    ...(username ? { username } : {}),
    group: isUserChangedFileSessionField(existing, 'group') && existing?.group ? existing.group : asset.group_name || asset.group || (isOrganization ? '堡垒机资源' : '主机'),
    kind: 'remote',
    rootPath: isUserChangedFileSessionField(existing, 'rootPath') && existing?.rootPath ? existing.rootPath : rootPathForAssetUsername(username),
    status: isUserChangedFileSessionField(existing, 'status') && existing?.status ? existing.status : asset.status === 'offline' ? 'idle' : 'active',
    favorite: isUserChangedFileSessionField(existing, 'favorite') && typeof existing?.favorite === 'boolean' ? existing.favorite : Boolean(asset.favorite),
    assetType: isOrganization ? 'organization' : 'person',
    ...(asset.folderUuid ? { folderUuid: asset.folderUuid } : {}),
    ...(isOrganization ? { organizationId: asset.uuid || asset.id } : asset.organizationId ? { organizationId: asset.organizationId } : {}),
    ...(asset.jumpHostId ? { jumpHostId: asset.jumpHostId } : {}),
    ...(isUserChangedFileSessionField(existing, 'comment') && existing?.comment ? { comment: existing.comment } : asset.comment ? { comment: asset.comment } : {})
  }
}

const assetFoldersToFileFolders = (folders: ReturnType<typeof listAssets>['folders']): FileSessionFolderRecord[] =>
  folders.map((folder) => ({ ...folder }))

const findAssetFolder = (uuid: string) => listAssets().folders.find((folder) => folder.uuid === uuid)

const assetInputFromRecord = (asset: ReturnType<typeof listAssets>['assets'][number]): AiopsAssetInput => ({
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
  tags: asset.tags,
  favorite: asset.favorite,
  ...(asset.folderUuid ? { folderUuid: asset.folderUuid } : {}),
  ...(asset.organizationId ? { organizationId: asset.organizationId } : {}),
  ...(asset.tunnelState ? { tunnelState: asset.tunnelState } : {}),
  ...(typeof asset.needProxy === 'boolean' ? { needProxy: asset.needProxy } : {}),
  ...(asset.proxyName ? { proxyName: asset.proxyName } : {}),
  ...(asset.keychainId ? { keychainId: asset.keychainId } : {}),
  ...(asset.jumpHostId ? { jumpHostId: asset.jumpHostId } : {})
})

const syncAssetFromFileSessionPatch = (id: string, patch: FileSessionPatch) => {
  const asset = getAsset(id)
  if (!asset || asset.isLocalShell) return null
  const input = assetInputFromRecord(asset)
  if (Object.prototype.hasOwnProperty.call(patch, 'favorite')) input.favorite = patch.favorite
  if (Object.prototype.hasOwnProperty.call(patch, 'comment')) input.comment = patch.comment || ''
  if (Object.prototype.hasOwnProperty.call(patch, 'folderUuid')) {
    delete input.folderUuid
    const folderUuid = String(patch.folderUuid || '').trim()
    if (folderUuid) input.folderUuid = folderUuid
  }
  const result = saveAsset(input)
  if (!result.ok) {
    return {
      ok: false as const,
      errorCode: result.errorCode || 'FILES_ASSET_SYNC_FAILED',
      errorMessage: result.errorMessage || 'Asset sync failed.'
    }
  }
  return { ok: true as const }
}

const mergeAssetCatalogIntoFileSessions = (catalog: FileSessionCatalog): FileSessionCatalog => {
  const assetSnapshot = listAssets()
  const byId = new Map(catalog.sessions.map((session) => [session.id, session]))
  const local = normalizeSession(byId.get('local') || fileSessionLocalEntry()) || fileSessionLocalEntry()
  const assetSessions = assetSnapshot.assets
    .map((asset) => assetToFileSession(asset, byId.get(asset.id)))
    .filter((session): session is FileSessionInfo => Boolean(session))
  const assetIds = new Set(assetSnapshot.assets.map((asset) => asset.id))
  const customSessions = catalog.sessions.filter((session) => session.id !== 'local' && !assetIds.has(session.id) && !isUnmodifiedSeedFileSession(session))
  const assetFolders = assetFoldersToFileFolders(assetSnapshot.folders)
  const assetFolderIds = new Set(assetFolders.map((folder) => folder.uuid))
  const customFolders = catalog.folders.filter((folder) => !assetFolderIds.has(folder.uuid) && !isUnmodifiedSeedFileSessionFolder(folder))
  return normalizeFileSessionCatalog({
    sessions: [local, ...assetSessions, ...customSessions],
    folders: [...assetFolders, ...customFolders]
  })
}

const stableJson = (value: unknown) => JSON.stringify(value)

const seedFileSessionById = new Map(fileSessionSeedCatalog().sessions.filter((session) => session.id !== 'local').map((session) => [session.id, session]))
const seedFileSessionFolderByUuid = new Map(fileSessionSeedCatalog().folders.map((folder) => [folder.uuid, folder]))

const isUnmodifiedSeedFileSession = (session: FileSessionInfo) => {
  const seed = seedFileSessionById.get(session.id)
  return Boolean(seed && stableJson(session) === stableJson(seed))
}

const isUnmodifiedSeedFileSessionFolder = (folder: FileSessionFolderRecord) => {
  const seed = seedFileSessionFolderByUuid.get(folder.uuid)
  return Boolean(seed && stableJson(folder) === stableJson(seed))
}

const stripLegacySeedFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => {
  const sessions = catalog.sessions.filter((session) => !isUnmodifiedSeedFileSession(session))
  const referencedFolders = new Set(sessions.map((session) => session.folderUuid).filter((uuid): uuid is string => Boolean(uuid)))
  const folders = catalog.folders.filter((folder) => !isUnmodifiedSeedFileSessionFolder(folder) || referencedFolders.has(folder.uuid))
  return { sessions, folders }
}

const fileSessionResult = <T>(data: T) => ({ ok: true, data })

const normalizeSession = (session: FileSessionInfo): FileSessionInfo | null => {
  const id = String(session.id || '').trim()
  const label = String(session.label || '').trim()
  const host = String(session.host || '').trim()
  const rootPath = String(session.rootPath || '').trim()
  if (!id || !label || !host || !rootPath) return null
  return {
    id,
    label,
    host,
    ...(session.username ? { username: String(session.username).trim() } : {}),
    group: String(session.group || (session.kind === 'local' ? '本地连接' : '资产')).trim(),
    kind: session.kind === 'local' ? 'local' : 'remote',
    rootPath,
    status: session.status === 'idle' || session.status === 'error' ? session.status : 'active',
    ...(typeof session.favorite === 'boolean' ? { favorite: session.favorite } : {}),
    ...(session.assetType === 'local' || session.assetType === 'person' || session.assetType === 'organization' || session.assetType === 'custom_folder'
      ? { assetType: session.assetType }
      : {}),
    ...(session.folderUuid ? { folderUuid: String(session.folderUuid) } : {}),
    ...(session.organizationId ? { organizationId: String(session.organizationId) } : {}),
    ...(session.jumpHostId ? { jumpHostId: String(session.jumpHostId) } : {}),
    ...(session.comment ? { comment: String(session.comment) } : {}),
    ...(session.errorMsg ? { errorMsg: String(session.errorMsg) } : {})
  }
}

const payloadString = (payload: FileSessionSftpPayload, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

const terminalContextString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const terminalContextStatus = (status: FileSessionTerminalContext['panelStatus']) => (status === 'closed' ? 'idle' : 'active')

const terminalContextAssetType = (assetType?: string): FileSessionInfo['assetType'] => {
  const normalized = terminalContextString(assetType).toLowerCase()
  return normalized.includes('organization') ? 'organization' : 'person'
}

const normalizeFileSessionFolderInput = (folder: FileSessionFolderSaveInput, existing?: FileSessionFolderRecord): FileSessionFolderRecord | null => {
  const name = String(folder.name || '').trim()
  if (!name) return null
  return {
    uuid: existing?.uuid || `files-folder-${randomUUID()}`,
    name,
    description: String(folder.description ?? existing?.description ?? '').trim(),
    ...(folder.parentUuid || existing?.parentUuid ? { parentUuid: folder.parentUuid || existing?.parentUuid } : {}),
    ...(folder.scope || existing?.scope ? { scope: folder.scope || existing?.scope } : {})
  }
}

const normalizeStoredFileSessionFolder = (folder: Partial<FileSessionFolderRecord>): FileSessionFolderRecord | null => {
  const uuid = String(folder.uuid || '').trim()
  const name = String(folder.name || '').trim()
  if (!uuid || !name) return null
  return {
    uuid,
    name,
    description: String(folder.description || '').trim(),
    ...(folder.parentUuid ? { parentUuid: String(folder.parentUuid).trim() } : {}),
    ...(folder.scope === 'direct' || folder.scope === 'bastion' ? { scope: folder.scope } : {})
  }
}

const normalizeFileSessionCatalog = (catalog?: Partial<FileSessionCatalog> | null): FileSessionCatalog => {
  const fallback = defaultFileSessionCatalog()
  const hasSessionRows = Array.isArray(catalog?.sessions)
  const hasFolderRows = Array.isArray(catalog?.folders)
  const sessions = (hasSessionRows ? catalog?.sessions || [] : fallback.sessions)
    .map((session) => normalizeSession(session as FileSessionInfo))
    .filter((session): session is FileSessionInfo => Boolean(session))
  const folders = (hasFolderRows ? catalog?.folders || [] : fallback.folders)
    .map((folder) => normalizeStoredFileSessionFolder(folder as Partial<FileSessionFolderRecord>))
    .filter((folder): folder is FileSessionFolderRecord => Boolean(folder))
  if (!sessions.some((session) => session.id === 'local')) sessions.unshift(fileSessionLocalEntry())
  const normalized = { sessions, folders }
  return filesRuntimeConfig.useSeedData ? normalized : stripLegacySeedFileSessionCatalog(normalized)
}

class FallbackFileSessionCatalogStore {
  private store = new Store<FileSessionCatalogStoreShape>({
    projectName: 'aiopsterm',
    name: 'aiopsterm-file-sessions',
    defaults: defaultFileSessionCatalog()
  } as ConstructorParameters<typeof Store<FileSessionCatalogStoreShape>>[0] & { projectName: string })

  load(): FileSessionCatalog {
    const catalog = normalizeFileSessionCatalog({
      sessions: this.store.get('sessions') || [],
      folders: this.store.get('folders') || []
    })
    if (!filesRuntimeConfig.useSeedData) this.save(catalog)
    return catalog
  }

  save(catalog: FileSessionCatalog): FileSessionCatalog {
    const normalized = normalizeFileSessionCatalog(catalog)
    this.store.set('sessions', normalized.sessions)
    this.store.set('folders', normalized.folders)
    return cloneFileSessionCatalog(normalized)
  }

  reset(): FileSessionCatalog {
    return this.save(defaultFileSessionCatalog())
  }
}

class SqliteFileSessionCatalogStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_session_catalog (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `)
  }

  load(): FileSessionCatalog {
    const row = this.db.prepare('SELECT data FROM file_session_catalog WHERE key = ?').get('catalog') as { data: string } | undefined
    if (!row?.data) return this.reset()
    return this.save(JSON.parse(row.data) as FileSessionCatalog)
  }

  save(catalog: FileSessionCatalog): FileSessionCatalog {
    const normalized = normalizeFileSessionCatalog(catalog)
    this.db.prepare('INSERT OR REPLACE INTO file_session_catalog (key, data) VALUES (?, ?)').run('catalog', JSON.stringify(normalized))
    return cloneFileSessionCatalog(normalized)
  }

  reset(): FileSessionCatalog {
    return this.save(defaultFileSessionCatalog())
  }
}

let fileSessionCatalogStore: FallbackFileSessionCatalogStore | SqliteFileSessionCatalogStore | null = null

const createFileSessionCatalogStore = () => {
  if (filesRuntimeConfig.sqliteFactory) return new SqliteFileSessionCatalogStore(new filesRuntimeConfig.sqliteFactory(filesRuntimeConfig.databasePath))
  try {
    if (filesRuntimeConfig.forceFallbackStore) throw new Error('force fallback file-session store')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteFileSessionCatalogStore(new Database(filesRuntimeConfig.databasePath))
  } catch {
    return new FallbackFileSessionCatalogStore()
  }
}

const getFileSessionCatalogStore = () => {
  if (!fileSessionCatalogStore) fileSessionCatalogStore = createFileSessionCatalogStore()
  return fileSessionCatalogStore
}

const loadFileSessionCatalog = () => {
  if (!fileSessionCatalog) fileSessionCatalog = getFileSessionCatalogStore().load()
  return fileSessionCatalog
}

const saveFileSessionCatalog = (catalog: FileSessionCatalog) => {
  fileSessionCatalog = getFileSessionCatalogStore().save(catalog)
  return fileSessionCatalog
}

export const saveFileSessionFromSftpPayload = async (payload: FileSessionSftpPayload): Promise<FileSessionMutationResult> => {
  const id = payloadString(payload, ['uuid', 'id', 'assetId', 'host', 'ip'])
  const host = payloadString(payload, ['host', 'ip']) || id
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_PAYLOAD_INVALID', errorMessage: 'SFTP asset payload requires an id or host.' }
  }
  const username = payloadString(payload, ['username', 'user', 'loginName']) || 'deploy'
  const rootPath = payloadString(payload, ['rootPath', 'homePath', 'cwd']) || rootPathForAssetUsername(username, '/home/deploy')
  const rawAssetType = payloadString(payload, ['asset_type', 'assetType']).toLowerCase()
  const session: FileSessionInfo = {
    id,
    label: payloadString(payload, ['title', 'hostname', 'name', 'label']) || host,
    host,
    username,
    group: payloadString(payload, ['group', 'group_name', 'organizationName']) || '资产',
    kind: 'remote',
    rootPath,
    status: 'active',
    favorite: false,
    assetType: rawAssetType.includes('organization') ? 'organization' : 'person',
    ...(payloadString(payload, ['organizationId', 'orgId', 'organizationUuid']) ? { organizationId: payloadString(payload, ['organizationId', 'orgId', 'organizationUuid']) } : {}),
    ...(payloadString(payload, ['jumpHostId', 'jump_host_id']) ? { jumpHostId: payloadString(payload, ['jumpHostId', 'jump_host_id']) } : {}),
    ...(payloadString(payload, ['comment', 'description']) ? { comment: payloadString(payload, ['comment', 'description']) } : {})
  }
  return saveFileSession(session)
}

export const saveFileSessionFromTerminalContext = async (context: FileSessionTerminalContext): Promise<FileSessionMutationResult> => {
  if (context?.kind !== 'ssh') {
    return saveFileSession({
      id: 'local',
      label: 'Local',
      host: '127.0.0.1',
      group: '本地连接',
      kind: 'local',
      rootPath: terminalContextString(context?.cwd) || '/',
      status: terminalContextStatus(context?.panelStatus),
      assetType: 'local'
    })
  }

  const ssh = context.ssh || {}
  const assetId = terminalContextString(ssh.assetId)
  const asset = assetId ? getAsset(assetId) : null
  const connectionId = terminalContextString(ssh.connectionId || context.sessionId)
  const host = asset?.host || terminalContextString(ssh.host)
  const id = asset?.id || assetId || (connectionId ? `ssh-${connectionId}` : host)
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_TERMINAL_INVALID', errorMessage: 'Terminal file session requires an SSH asset, connection id, or host.' }
  }

  const username = asset?.username || terminalContextString(ssh.username) || 'deploy'
  const title = asset?.title || asset?.name || terminalContextString(ssh.assetName) || terminalContextString(context.panelTitle) || host
  const group = asset?.group_name || asset?.group || terminalContextString(ssh.organizationId) || '终端连接'
  const rootPath = terminalContextString(context.cwd) || rootPathForAssetUsername(username, '/home/deploy')
  return saveFileSession({
    id,
    label: title,
    host,
    username,
    group,
    kind: 'remote',
    rootPath,
    status: terminalContextStatus(context.panelStatus),
    favorite: typeof asset?.favorite === 'boolean' ? asset.favorite : false,
    assetType: terminalContextAssetType(asset?.asset_type || ssh.assetType),
    ...(asset?.folderUuid ? { folderUuid: asset.folderUuid } : {}),
    ...(asset?.asset_type === 'organization'
      ? { organizationId: asset.uuid || asset.id }
      : asset?.organizationId || terminalContextString(ssh.organizationId)
        ? { organizationId: asset?.organizationId || terminalContextString(ssh.organizationId) }
        : {}),
    ...(asset?.jumpHostId || terminalContextString(ssh.jumpHostId) ? { jumpHostId: asset?.jumpHostId || terminalContextString(ssh.jumpHostId) } : {}),
    ...(asset?.comment ? { comment: asset.comment } : terminalContextString(context.panelTitle) ? { comment: `Opened from ${context.panelTitle}` } : {})
  })
}

export const listFileSessionCatalog = async (): Promise<FileSessionCatalogResult> => {
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
  saveFileSessionCatalog(catalog)
  return fileSessionResult(cloneFileSessionCatalog(catalog))
}

export const saveFileSession = async (session: FileSessionInfo): Promise<FileSessionMutationResult> => {
  const normalized = normalizeSession(session)
  if (!normalized) {
    return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  }
  const catalog = loadFileSessionCatalog()
  const saved = saveFileSessionCatalog({
    ...catalog,
    sessions: catalog.sessions.some((item) => item.id === normalized.id)
      ? catalog.sessions.map((item) => (item.id === normalized.id ? normalized : item))
      : [...catalog.sessions, normalized]
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), session: cloneSession(normalized) })
}

export const updateFileSession = async (id: string, patch: FileSessionPatch): Promise<FileSessionMutationResult> => {
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
  const session = catalog.sessions.find((item) => item.id === id)
  if (!session) return { ok: false, errorCode: 'FILES_SESSION_NOT_FOUND', errorMessage: 'File session not found.' }
  const assetSyncResult = syncAssetFromFileSessionPatch(id, patch)
  if (assetSyncResult && !assetSyncResult.ok) {
    return { ok: false, errorCode: assetSyncResult.errorCode, errorMessage: assetSyncResult.errorMessage }
  }
  const normalized = normalizeSession({ ...session, ...patch, id })
  if (!normalized) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  const saved = saveFileSessionCatalog(
    mergeAssetCatalogIntoFileSessions({
    ...catalog,
    sessions: catalog.sessions.map((item) => (item.id === id ? normalized : item))
    })
  )
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), session: cloneSession(normalized) })
}

export const deleteFileSession = async (id: string): Promise<FileSessionCatalogResult> => {
  if (id === 'local') return { ok: false, errorCode: 'FILES_SESSION_LOCAL_REQUIRED', errorMessage: 'Local file session cannot be deleted.' }
  const catalog = loadFileSessionCatalog()
  return fileSessionResult(
    cloneFileSessionCatalog(
      saveFileSessionCatalog({
        ...catalog,
        sessions: catalog.sessions.filter((session) => session.id !== id)
      })
    )
  )
}

export const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput): Promise<FileSessionFolderMutationResult> => {
  const catalog = loadFileSessionCatalog()
  const assetFolder = folder.uuid ? findAssetFolder(folder.uuid) : undefined
  const existing = assetFolder || (folder.uuid ? catalog.folders.find((item) => item.uuid === folder.uuid) : undefined)
  const normalized = normalizeFileSessionFolderInput(folder, existing)
  if (!normalized) return { ok: false, errorCode: 'FILES_FOLDER_NAME_REQUIRED', errorMessage: 'Folder name is required.' }
  if (assetFolder || normalized.scope === 'bastion') {
    const result = saveAssetFolder({
      ...(assetFolder ? { uuid: normalized.uuid } : {}),
      name: normalized.name,
      description: normalized.description,
      scope: normalized.scope || assetFolder?.scope || 'bastion',
      parentUuid: normalized.parentUuid || assetFolder?.parentUuid
    })
    if (!result.ok) return { ok: false, errorCode: result.errorCode || 'FILES_FOLDER_SAVE_FAILED', errorMessage: result.errorMessage || 'Folder save failed.' }
    if (!result.data) return { ok: false, errorCode: 'FILES_FOLDER_SAVE_FAILED', errorMessage: 'Folder save failed.' }
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
    saveFileSessionCatalog(merged)
    return fileSessionResult({ ...cloneFileSessionCatalog(merged), folder: cloneFolder(result.data) })
  }
  const saved = saveFileSessionCatalog({
    ...catalog,
    folders: catalog.folders.some((item) => item.uuid === normalized.uuid)
      ? catalog.folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
      : [...catalog.folders, normalized]
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), folder: cloneFolder(normalized) })
}

export const deleteFileSessionFolder = async (uuid: string): Promise<FileSessionFolderDeleteResult> => {
  const folderUuid = String(uuid || '').trim()
  if (!folderUuid) return { ok: false, errorCode: 'FILES_FOLDER_UUID_REQUIRED', errorMessage: 'Folder uuid is required.' }
  if (findAssetFolder(folderUuid)) {
    const result = deleteAssetFolder(folderUuid)
    if (!result.ok) return { ok: false, errorCode: result.errorCode || 'FILES_FOLDER_DELETE_FAILED', errorMessage: result.errorMessage || 'Folder delete failed.' }
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
    saveFileSessionCatalog(merged)
    return fileSessionResult({ ...cloneFileSessionCatalog(merged), folderUuid })
  }
  const catalog = loadFileSessionCatalog()
  const saved = saveFileSessionCatalog({
    folders: catalog.folders.filter((folder) => folder.uuid !== folderUuid),
    sessions: catalog.sessions.map((session) => (session.folderUuid === folderUuid ? { ...session, folderUuid: undefined, group: '最近连接' } : session))
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), folderUuid })
}

export const __dropFileSessionCatalogCacheForTests = () => {
  fileSessionCatalog = null
}

export const __resetFileSessionCatalogForTests = () => {
  fileSessionCatalog = getFileSessionCatalogStore().reset()
  resetFileTransferRuntimeForTests()
  clearRemoteSftpPool()
}

export const listFiles = async (directory: string, options: FileListOptions = {}): Promise<FileListEntry[]> => {
  if (options.kind !== 'remote') {
    const path = String(directory || '.').trim() || '.'
    const entries = await readdir(path, { withFileTypes: true })
    const result = await Promise.all(
      entries.slice(0, 500).map(async (item) => {
        const fullPath = join(path, item.name)
        const metadata = await lstat(fullPath)
        const type = item.isDirectory() ? ('directory' as const) : item.isSymbolicLink() ? ('link' as const) : ('file' as const)
        const linkTarget = type === 'link' ? await readlink(fullPath).catch(() => '') : ''
        return {
          name: item.name,
          path: fullPath,
          type,
          size: metadata.size,
          modifiedAt: metadata.mtimeMs,
          mode: modeString(type, metadata.mode),
          ...(linkTarget ? { linkTarget } : {})
        }
      })
    )
    return sortEntries(result)
  }

  const path = normalizeRemotePath(directory)
  let sftpRows: FileListEntry[] | null
  try {
    sftpRows = await listRemoteFilesViaSftp(path, options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) throw new Error(error.message)
    throw error
  }
  if (sftpRows) return sftpRows
  throw new Error(sftpUnavailableMessage)
}

export const readFileContent = async (filePath: string, options: FileContentOptions = {}): Promise<FileReadContentResult> => {
  if (options.kind !== 'remote') {
    const path = String(filePath || '').trim()
    if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    try {
      const metadata = await stat(path)
      if (!metadata.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      ensureTextSize(metadata.size)
      return { ok: true, data: { content: await readFile(path, 'utf-8'), action: 'edit', size: metadata.size, mtimeMs: metadata.mtimeMs } }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { ok: true, data: { content: '', action: 'create', size: 0, mtimeMs: Date.now() } }
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
      return { ok: false, errorCode: 'read_failed', errorMessage: (error as Error).message }
    }
  }

  const path = normalizeRemotePath(filePath)
  let sftpRead: FileReadContentResult | null
  try {
    sftpRead = await readRemoteFileViaSftp(path, options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
  if (sftpRead) return sftpRead
  return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
}

export const writeFileContent = async (filePath: string, content: string, options: FileContentOptions = {}): Promise<FileWriteContentResult> => {
  const path = options.kind === 'remote' ? normalizeRemotePath(filePath) : String(filePath || '').trim()
  if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
  const text = typeof content === 'string' ? content : String(content)
  const size = Buffer.byteLength(text, 'utf-8')
  ensureTextSize(size)
  if (options.kind !== 'remote') {
    try {
      const metadata = await stat(path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      const conflict = validateFileContentVersion(
        metadata
          ? {
              exists: true,
              type: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'link',
              size: metadata.size,
              mtimeMs: metadata.mtimeMs
            }
          : { exists: false },
        options
      )
      if (conflict) return conflict
      await mkdir(getLocalDirname(path), { recursive: true })
      await writeFile(path, text, 'utf-8')
      const writtenMetadata = await stat(path)
      return { ok: true, data: { size: writtenMetadata.size, mtimeMs: writtenMetadata.mtimeMs, task: writeContentTask(path, options) } }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
      return { ok: false, errorCode: 'write_failed', errorMessage: (error as Error).message }
    }
  }

  let sftpWrite: FileWriteContentResult | null
  try {
    sftpWrite = await writeRemoteFileViaSftp(path, Buffer.from(text, 'utf-8'), options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
  if (sftpWrite) return sftpWrite
  return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
}

const chmodRecursive = async (path: string, mode: number) => {
  await chmod(path, mode)
  const metadata = await stat(path)
  if (!metadata.isDirectory()) return
  const rows = await readdir(path, { withFileTypes: true })
  await Promise.all(rows.map((item) => chmodRecursive(join(path, item.name), mode)))
}

const mutateLocalFileEntry = async (mutation: FileEntryMutation): Promise<FileEntryMutationResult> => {
  const now = Date.now()
  try {
    if (mutation.kind === 'rename') {
      const oldPath = String(mutation.oldPath || '').trim()
      const newPath = String(mutation.newPath || '').trim()
      if (!oldPath || !newPath) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      await rename(oldPath, newPath)
      const metadata = await stat(newPath)
      return { ok: true, data: { affected: 1, path: newPath, mtimeMs: metadata.mtimeMs } }
    }
    if (mutation.kind === 'delete') {
      const path = String(mutation.path || '').trim()
      if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      await rm(path, { recursive: mutation.recursive ?? true, force: false })
      return { ok: true, data: { affected: 1, path, mtimeMs: now } }
    }
    if (mutation.kind === 'copy' || mutation.kind === 'move') {
      const srcPath = String(mutation.srcPath || '').trim()
      const targetPath = String(mutation.targetPath || '').trim()
      if (!srcPath || !targetPath) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      if (srcPath === targetPath) return { ok: true, data: { affected: 0, path: targetPath, mtimeMs: now } }
      if (mutation.kind === 'copy') {
        await cp(srcPath, targetPath, { recursive: true, force: Boolean(mutation.overwrite), errorOnExist: !mutation.overwrite })
      } else {
        if (mutation.overwrite) await rm(targetPath, { recursive: true, force: true })
        await rename(srcPath, targetPath)
      }
      const metadata = await stat(targetPath)
      return { ok: true, data: { affected: 1, path: targetPath, mtimeMs: metadata.mtimeMs } }
    }
    const path = String(mutation.path || '').trim()
    if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    const mode = Number.parseInt(mutation.mode, 8)
    if (!/^[0-7]{3,4}$/.test(mutation.mode) || Number.isNaN(mode)) {
      return { ok: false, errorCode: 'invalid_mode', errorMessage: 'Permission mode must be octal' }
    }
    if (mutation.recursive) await chmodRecursive(path, mode)
    else await chmod(path, mode)
    const metadata = await stat(path)
    return { ok: true, data: { affected: 1, path, mode: mutation.mode, mtimeMs: metadata.mtimeMs } }
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    if (code === 'EEXIST') return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
    return { ok: false, errorCode: 'mutation_failed', errorMessage: (error as Error).message }
  }
}

export const mutateFileEntry = async (mutation: FileEntryMutation, options: FileListOptions = {}): Promise<FileEntryMutationResult> => {
  let result: FileEntryMutationResult
  try {
    result = options.kind === 'remote' ? (await mutateRemoteFileEntryViaSftp(mutation, options)) || sftpUnavailableError('FILES_SFTP_UNAVAILABLE') : await mutateLocalFileEntry(mutation)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
  if (!result.ok || !result.data?.path) return result
  const task = mutationTask(mutation, result.data.path, options)
  return task ? { ...result, data: { ...result.data, task } } : result
}

export const transferFileEntry = async (operation: FileTransferOperation, options: FileListOptions = {}): Promise<FileTransferOperationResult> => {
  try {
    if (operation.kind === 'copy-remote') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = normalizeRemotePath(operation.targetPath)
      const sftpResult = await copyRemoteTransferViaSftp(source, target, operation.overwrite, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (operation.kind === 'download-file') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localPath || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteFileViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (operation.kind === 'download-directory') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localDirectory || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteDirectoryViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }

    const localPath = String(operation.localPath || '').trim()
    const remoteDirectory = normalizeRemotePath(operation.remoteDirectory)
    if (!localPath || !remoteDirectory) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    const metadata = await stat(localPath)
    const name = localPath.split(/[\\/]/).filter(Boolean).at(-1) || 'upload'
    const target = normalizeRemotePath(`${remoteDirectory}/${name}`)
    const uploadKind = operation.kind === 'upload-path' ? (metadata.isDirectory() ? 'upload-directory' : 'upload-file') : operation.kind
    if (uploadKind === 'upload-directory') {
      if (!metadata.isDirectory()) return { ok: false, errorCode: 'not_directory', errorMessage: 'Source must be a directory' }
      const sftpResult = await uploadRemoteDirectoryViaSftp(localPath, remoteDirectory, name, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (!metadata.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
    const sftpResult = await uploadRemoteFileViaSftp(localPath, remoteDirectory, name, { ...options, kind: 'remote' })
    if (sftpResult) return sftpResult
    return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    return { ok: false, errorCode: 'transfer_failed', errorMessage: (error as Error).message }
  }
}
