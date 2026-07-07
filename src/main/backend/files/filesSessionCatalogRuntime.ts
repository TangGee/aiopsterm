import { randomUUID } from 'crypto'
import { app } from 'electron'
import Store from 'electron-store'
import { isAbsolute, join, resolve } from 'path'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type {
  FileSessionCatalog,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionSftpPayload,
  FileSessionTerminalContext
} from '@shared/contracts/files'
import { shouldUseFilesSeedData } from '@shared/runtimeSwitches'

type FileSessionCatalogStoreShape = FileSessionCatalog

export type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}

export type FilesSessionCatalogRuntimeConfig = {
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
}

type FilesSessionCatalogRuntimeState = Required<Pick<FilesSessionCatalogRuntimeConfig, 'databasePath' | 'useSeedData' | 'forceFallbackStore'>> & {
  sqliteFactory?: new (path: string) => SqliteDatabase
}

export type FileSessionCatalogAsset = Pick<
  AiopsAssetRecord,
  | 'id'
  | 'uuid'
  | 'name'
  | 'title'
  | 'host'
  | 'ip'
  | 'group'
  | 'group_name'
  | 'status'
  | 'username'
  | 'asset_type'
  | 'comment'
  | 'favorite'
  | 'folderUuid'
  | 'organizationId'
  | 'jumpHostId'
  | 'isLocalShell'
>

export type FileSessionCatalogAssetSnapshot = {
  assets: FileSessionCatalogAsset[]
  folders: FileSessionFolderRecord[]
}

export type FileSessionBuildResult =
  | { ok: true; session: FileSessionInfo }
  | { ok: false; errorCode: string; errorMessage: string }

const defaultFileSessionSeedMode = shouldUseFilesSeedData

const defaultFileSessionDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_FILES_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

let filesSessionCatalogRuntimeConfig: FilesSessionCatalogRuntimeState = {
  databasePath: defaultFileSessionDatabasePath(),
  useSeedData: defaultFileSessionSeedMode(),
  forceFallbackStore: false
}

export const configureFilesSessionCatalogRuntime = (config: FilesSessionCatalogRuntimeConfig = {}) => {
  filesSessionCatalogRuntimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultFileSessionDatabasePath(),
    useSeedData: config.useSeedData ?? defaultFileSessionSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore),
    ...(config.sqliteFactory ? { sqliteFactory: config.sqliteFactory } : {})
  }
  fileSessionCatalog = null
  fileSessionCatalogStore = null
}

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

export const fileSessionSeedCatalog = (): FileSessionCatalog => ({
  sessions: defaultFileSessions.map((session) => ({ ...session })),
  folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
})

const fileSessionSeedlessCatalog = (): FileSessionCatalog => ({
  sessions: [{ ...defaultFileSessions[0] }],
  folders: []
})

export const defaultFileSessionCatalog = (): FileSessionCatalog =>
  filesSessionCatalogRuntimeConfig.useSeedData ? fileSessionSeedCatalog() : fileSessionSeedlessCatalog()

let fileSessionCatalog: FileSessionCatalog | null = null

export const cloneSession = (session: FileSessionInfo): FileSessionInfo => ({ ...session })
export const cloneFolder = (folder: FileSessionFolderRecord): FileSessionFolderRecord => ({ ...folder })
export const cloneFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => ({
  sessions: catalog.sessions.map(cloneSession),
  folders: catalog.folders.map(cloneFolder)
})

export const fileSessionLocalEntry = () => cloneSession(defaultFileSessions[0])

export const rootPathForAssetUsername = (username: string, fallback = '/') => {
  const name = textSecret(username)
  if (!name || name === 'local') return fallback
  if (name === 'root') return '/root'
  return `/home/${name}`
}

const stableJson = (value: unknown) => JSON.stringify(value)

const seedFileSessionById = new Map(fileSessionSeedCatalog().sessions.filter((session) => session.id !== 'local').map((session) => [session.id, session]))
const seedFileSessionFolderByUuid = new Map(fileSessionSeedCatalog().folders.map((folder) => [folder.uuid, folder]))

const seedFileSessionForField = (session?: FileSessionInfo) => (session?.id ? seedFileSessionById.get(session.id) : undefined)

export const isUserChangedFileSessionField = <K extends keyof FileSessionInfo>(session: FileSessionInfo | undefined, field: K) => {
  if (!session) return false
  const seed = seedFileSessionForField(session)
  return !seed || stableJson(session[field]) !== stableJson(seed[field])
}

export const isUnmodifiedSeedFileSession = (session: FileSessionInfo) => {
  const seed = seedFileSessionById.get(session.id)
  return Boolean(seed && stableJson(session) === stableJson(seed))
}

export const isUnmodifiedSeedFileSessionFolder = (folder: FileSessionFolderRecord) => {
  const seed = seedFileSessionFolderByUuid.get(folder.uuid)
  return Boolean(seed && stableJson(folder) === stableJson(seed))
}

const stripLegacySeedFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => {
  const sessions = catalog.sessions.filter((session) => !isUnmodifiedSeedFileSession(session))
  const referencedFolders = new Set(sessions.map((session) => session.folderUuid).filter((uuid): uuid is string => Boolean(uuid)))
  const folders = catalog.folders.filter((folder) => !isUnmodifiedSeedFileSessionFolder(folder) || referencedFolders.has(folder.uuid))
  return { sessions, folders }
}

export const normalizeSession = (session: FileSessionInfo): FileSessionInfo | null => {
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

export const normalizeFileSessionFolderInput = (folder: FileSessionFolderSaveInput, existing?: FileSessionFolderRecord): FileSessionFolderRecord | null => {
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

export const normalizeFileSessionCatalog = (catalog?: Partial<FileSessionCatalog> | null): FileSessionCatalog => {
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
  return filesSessionCatalogRuntimeConfig.useSeedData ? normalized : stripLegacySeedFileSessionCatalog(normalized)
}

const assetToFileSession = (asset: FileSessionCatalogAsset, existing?: FileSessionInfo): FileSessionInfo | null => {
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

const assetFoldersToFileFolders = (folders: FileSessionFolderRecord[]): FileSessionFolderRecord[] => folders.map(cloneFolder)

export const mergeAssetCatalogIntoFileSessions = (catalog: FileSessionCatalog, assetSnapshot: FileSessionCatalogAssetSnapshot): FileSessionCatalog => {
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

const payloadString = (payload: FileSessionSftpPayload, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

export const fileSessionFromSftpPayload = (payload: FileSessionSftpPayload): FileSessionBuildResult => {
  const id = payloadString(payload, ['uuid', 'id', 'assetId', 'host', 'ip'])
  const host = payloadString(payload, ['host', 'ip']) || id
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_PAYLOAD_INVALID', errorMessage: 'SFTP asset payload requires an id or host.' }
  }
  const username = payloadString(payload, ['username', 'user', 'loginName']) || 'deploy'
  const rootPath = payloadString(payload, ['rootPath', 'homePath', 'cwd']) || rootPathForAssetUsername(username, '/home/deploy')
  const rawAssetType = payloadString(payload, ['asset_type', 'assetType']).toLowerCase()
  return {
    ok: true,
    session: {
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
  }
}

const terminalContextString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const terminalContextStatus = (status: FileSessionTerminalContext['panelStatus']) => (status === 'closed' ? 'idle' : 'active')

const terminalContextAssetType = (assetType?: string): FileSessionInfo['assetType'] => {
  const normalized = terminalContextString(assetType).toLowerCase()
  return normalized.includes('organization') ? 'organization' : 'person'
}

export const terminalContextAssetId = (context: FileSessionTerminalContext) => terminalContextString(context.ssh?.assetId)

export const fileSessionFromTerminalContext = (context: FileSessionTerminalContext, asset?: FileSessionCatalogAsset | null): FileSessionBuildResult => {
  if (context?.kind !== 'ssh') {
    return {
      ok: true,
      session: {
        id: 'local',
        label: 'Local',
        host: '127.0.0.1',
        group: '本地连接',
        kind: 'local',
        rootPath: terminalContextString(context?.cwd) || '/',
        status: terminalContextStatus(context?.panelStatus),
        assetType: 'local'
      }
    }
  }

  const ssh = context.ssh || {}
  const assetId = terminalContextString(ssh.assetId)
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
  return {
    ok: true,
    session: {
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
    }
  }
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
    if (!filesSessionCatalogRuntimeConfig.useSeedData) this.save(catalog)
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
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=5000;
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
  if (filesSessionCatalogRuntimeConfig.sqliteFactory) return new SqliteFileSessionCatalogStore(new filesSessionCatalogRuntimeConfig.sqliteFactory(filesSessionCatalogRuntimeConfig.databasePath))
  try {
    if (filesSessionCatalogRuntimeConfig.forceFallbackStore) throw new Error('force fallback file-session store')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteFileSessionCatalogStore(new Database(filesSessionCatalogRuntimeConfig.databasePath))
  } catch {
    return new FallbackFileSessionCatalogStore()
  }
}

const getFileSessionCatalogStore = () => {
  if (!fileSessionCatalogStore) fileSessionCatalogStore = createFileSessionCatalogStore()
  return fileSessionCatalogStore
}

export const loadFileSessionCatalog = () => {
  if (!fileSessionCatalog) fileSessionCatalog = getFileSessionCatalogStore().load()
  return fileSessionCatalog
}

export const saveFileSessionCatalog = (catalog: FileSessionCatalog) => {
  fileSessionCatalog = getFileSessionCatalogStore().save(catalog)
  return fileSessionCatalog
}

export const dropFileSessionCatalogCacheForTests = () => {
  fileSessionCatalog = null
}

export const resetFileSessionCatalogForTests = () => {
  fileSessionCatalog = getFileSessionCatalogStore().reset()
  return fileSessionCatalog
}
