import { basename, isAbsolute } from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import type { Client, ConnectConfig } from 'ssh2'
import type {
  AiopsAssetConnectionTestInfo,
  AiopsAssetConnectionTestInput,
  AiopsAssetConnectionTestResult,
  AiopsAssetExportInput,
  AiopsAssetExportPayload,
  AiopsAssetExportResult,
  AiopsAssetEditableSecret,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRecord,
  AiopsAssetGroupRenameInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType,
  AiopsOrganizationAssetRefreshInput,
  AiopsOrganizationAssetRefreshResult
} from '@shared/contracts/assets'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { AiopsMutationResult } from '@shared/contracts/common'
import type { SshAgentKeychainOption } from '@shared/contracts/appRuntime'
import { parseAssetImportContent, type ImportedAssetDraft } from '@shared/assetImport'
import { createConfiguredSshAgentAuth } from './sshAgent'
import { loadSsh2 } from './ssh2Runtime'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'
import { diagnoseSshConnectionError } from './terminal'
import {
  LOCAL_SHELL_ASSET_ID,
  assetGroupName,
  configureAssetStoreRuntime,
  getAssetStore,
  keychainToSshAgentOption,
  listAssetGroupsFromAssets,
  shouldIncludeAssetGroup,
  type AssetSecret,
  type AssetStoreRuntimeConfig
} from './assetsStoreRuntime'


type AssetSshTestClient = Pick<Client, 'connect' | 'end' | 'on' | 'off' | 'once'>

type AssetConnectionRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  ssh2Runtime?: { Client: new () => AssetSshTestClient } | null
  now?: () => number
  timeoutMs?: number
}

type AssetBackendRuntimeConfig = AssetConnectionRuntimeConfig & AssetStoreRuntimeConfig

type AssetExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (
    filePath: string,
    content: string,
    encoding: 'utf-8'
  ) => Promise<
    | void
    | {
        filePath?: string
        bytes?: number
      }
  >
  now?: () => Date
}

type ResolvedAssetConnectionTarget = {
  assetId?: string
  host: string
  port: number
  username: string
  authType: AiopsAssetRecord['auth_type']
  password?: string
  privateKey?: string
  passphrase?: string
  authSource: AiopsAssetConnectionTestInfo['authSource']
  needProxy?: boolean
  proxyName?: string
  agent?: ConnectConfig['agent']
  agentKeyCount?: number
}

class AssetConnectionTestError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetConnectionTestError'
  }
}

class AssetExportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetExportError'
  }
}


const assetConnectionRuntime: AssetConnectionRuntimeConfig = {}

export const configureAssetConnectionRuntime = (config: AssetConnectionRuntimeConfig = {}) => {
  assetConnectionRuntime.getConfig = config.getConfig
  assetConnectionRuntime.ssh2Runtime = config.ssh2Runtime
  assetConnectionRuntime.now = config.now
  assetConnectionRuntime.timeoutMs = config.timeoutMs
}

export const configureAssetBackendRuntime = (config: AssetBackendRuntimeConfig = {}) => {
  configureAssetStoreRuntime(config)
  configureAssetConnectionRuntime(config)
}

const getStore = getAssetStore

const assetConnectionNow = () => assetConnectionRuntime.now?.() ?? Date.now()

const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

const assetConnectionTimeoutMs = (input?: AiopsAssetConnectionTestInput) => {
  const candidate = Number(input?.timeoutMs || assetConnectionRuntime.timeoutMs || defaultSshReadyTimeoutMs)
  if (!Number.isFinite(candidate)) return defaultSshReadyTimeoutMs
  return Math.max(1000, Math.min(defaultSshReadyTimeoutMs, Math.trunc(candidate)))
}

const getAssetConnectionSsh2Runtime = () =>
  assetConnectionRuntime.ssh2Runtime === undefined ? loadSsh2() : assetConnectionRuntime.ssh2Runtime

const getAssetConnectionRuntimeConfig = () => {
  const config = assetConnectionRuntime.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys,
    sshProxyConfigs: config?.sshProxyConfigs || []
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const validPort = (value: unknown) => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

const usablePrivateKey = (value: unknown) => {
  const privateKey = text(value)
  if (!privateKey.includes('PRIVATE KEY')) return ''
  const body = privateKey
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('BEGIN') && !line.includes('END'))
    .join('')
  return body.length >= 32 ? privateKey : ''
}

const assetDraftText = <K extends keyof AiopsAssetInput>(
  draft: AiopsAssetInput | undefined,
  key: K,
  fallback: unknown = ''
) => (draft && hasOwn(draft, key) ? text(draft[key]) : text(fallback))

const assetDraftPort = (draft: AiopsAssetInput | undefined, fallback: unknown) =>
  draft && hasOwn(draft, 'port') ? Number(draft.port) : Number(fallback || 22)

const assetDraftBoolean = <K extends keyof AiopsAssetInput>(
  draft: AiopsAssetInput | undefined,
  key: K,
  fallback: unknown = false
) => (draft && hasOwn(draft, key) ? Boolean(draft[key]) : Boolean(fallback))

const resolveAssetConnectionTarget = (input: AiopsAssetConnectionTestInput = {}): ResolvedAssetConnectionTarget => {
  const draft = input.asset
  const assetId = text(input.assetId || draft?.id)
  const existing = assetId ? getStore().getAsset(assetId) : null
  if (assetId && !existing && !draft) {
    throw new AssetConnectionTestError('ASSET_SSH_TARGET_NOT_FOUND', '资产不存在或已被删除')
  }
  if (existing?.isLocalShell) {
    throw new AssetConnectionTestError('ASSET_SSH_UNSUPPORTED_TARGET', '本地连接不支持 SSH 连通性测试')
  }

  const host = assetDraftText(draft, 'host', existing?.host || existing?.ip)
  const username = assetDraftText(draft, 'username', existing?.username)
  const port = assetDraftPort(draft, existing?.port || 22)
  const authType = ((draft && hasOwn(draft, 'auth_type') ? draft.auth_type : existing?.auth_type) || 'password') as AiopsAssetRecord['auth_type']
  const keychainId = assetDraftText(draft, 'keychainId', existing?.keychainId)
  const needProxy = assetDraftBoolean(draft, 'needProxy', existing?.needProxy)
  const proxyName = assetDraftText(draft, 'proxyName', existing?.proxyName)

  if (!host || !username || !validPort(port)) {
    throw new AssetConnectionTestError('ASSET_SSH_TARGET_REQUIRED', 'SSH 测试需要地址、用户名和 1-65535 的端口')
  }

  const savedSecret = existing?.id ? getStore().getSecret(existing.id) : {}
  const keychainSecret = keychainId ? getStore().getKeychainSecret(keychainId) : {}
  if (authType === 'password') {
    const password = draft && hasOwn(draft, 'password') ? text(draft.password) : text(savedSecret.password)
    if (!password) throw new AssetConnectionTestError('ASSET_SSH_AUTH_REQUIRED', 'SSH 密码不能为空')
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      password,
      authSource: 'password',
      needProxy,
      proxyName
    }
  }

  const draftPrivateKey = usablePrivateKey(draft?.privateKey)
  const savedPrivateKey = usablePrivateKey(savedSecret.privateKey)
  const keychainPrivateKey = usablePrivateKey(keychainSecret.privateKey)
  const privateKey = draftPrivateKey || savedPrivateKey || keychainPrivateKey
  const passphrase = text(draft?.passphrase) || text(savedSecret.passphrase) || text(keychainSecret.passphrase)
  if (privateKey) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      privateKey,
      ...(passphrase ? { passphrase } : {}),
      authSource: keychainPrivateKey && privateKey === keychainPrivateKey ? 'keychain' : 'privateKey',
      needProxy,
      proxyName
    }
  }

  const configuredAgentAuth = createConfiguredSshAgentAuth(getAssetConnectionRuntimeConfig(), (keyChainId) => getStore().getKeychainSecret(keyChainId))
  if (configuredAgentAuth?.agent) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      agent: configuredAgentAuth.agent,
      agentKeyCount: configuredAgentAuth.keyCount,
      authSource: 'sshAgent',
      needProxy,
      proxyName
    }
  }
  if (process.env.SSH_AUTH_SOCK) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      agent: process.env.SSH_AUTH_SOCK,
      authSource: 'sshAgent',
      needProxy,
      proxyName
    }
  }
  throw new AssetConnectionTestError('ASSET_SSH_AUTH_REQUIRED', 'SSH 测试需要密码、私钥、KeyChain 或 SSH Agent')
}

const connectAssetSshClient = (client: AssetSshTestClient, connectConfig: ConnectConfig, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      client.off('ready', handleReady)
      client.off('error', handleError)
      client.off('close', handleClose)
    }
    const handleReady = () => settle(resolve)
    const handleError = (error: Error) => settle(() => reject(error))
    const handleClose = () => settle(() => reject(new Error('SSH connection closed before ready')))

    timer = setTimeout(() => {
      try {
        client.end()
      } catch {}
      settle(() => reject(new Error(`SSH connection timeout after ${timeoutMs}ms`)))
    }, timeoutMs)
    client.once('ready', handleReady)
    client.once('error', handleError)
    client.once('close', handleClose)
    try {
      client.connect(connectConfig)
    } catch (error) {
      settle(() => reject(error))
    }
  })



const asResult = <T>(fn: () => T): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'ASSET_BACKEND_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

class AssetImportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetImportError'
  }
}

const assetImportFileName = (filePath: string) => basename(filePath.replace(/\\/g, '/')) || filePath

const assetImportErrorResult = <T>(error: unknown, fallbackCode = 'ASSET_IMPORT_FAILED', fallbackMessage = '资产导入失败。'): AiopsMutationResult<T> => {
  if (error instanceof AssetImportError) {
    return { ok: false, errorCode: error.errorCode, errorMessage: error.message }
  }
  return {
    ok: false,
    errorCode: fallbackCode,
    errorMessage: error instanceof Error ? error.message : String(error || fallbackMessage)
  }
}

const readAssetImportDrafts = async (input: AiopsAssetImportPreviewInput) => {
  const filePath = text(input?.filePath)
  if (!filePath) throw new AssetImportError('ASSET_IMPORT_FILE_REQUIRED', '导入文件路径不能为空。')
  const fileName = assetImportFileName(filePath)
  let content = ''
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    throw new AssetImportError('ASSET_IMPORT_READ_FAILED', error instanceof Error ? error.message : '导入文件读取失败。')
  }
  let drafts: ImportedAssetDraft[] = []
  try {
    drafts = parseAssetImportContent(content, fileName)
  } catch {
    throw new AssetImportError('ASSET_IMPORT_PARSE_FAILED', '导入文件解析失败。')
  }
  if (!drafts.length) throw new AssetImportError('ASSET_IMPORT_EMPTY', '导入文件没有可识别的主机。')
  return { filePath, fileName, drafts }
}

const findAssetImportDuplicate = (assets: AiopsAssetRecord[], draft: ImportedAssetDraft) =>
  assets.find((asset) => !asset.isLocalShell && asset.host === draft.host && asset.username === draft.username && Number(asset.port) === Number(draft.port))

const assetImportPreviewRecord = (draft: ImportedAssetDraft, index: number, assets: AiopsAssetRecord[]): AiopsAssetImportPreviewRecord => {
  const duplicate = findAssetImportDuplicate(assets, draft)
  return {
    previewId: `import-${index}-${draft.host}-${draft.port}`,
    duplicateId: duplicate?.id,
    duplicateTitle: duplicate?.title,
    title: draft.title,
    host: draft.host,
    username: draft.username,
    group: draft.group,
    port: draft.port,
    auth_type: draft.auth_type,
    asset_type: draft.asset_type,
    comment: draft.comment,
    needProxy: draft.needProxy,
    proxyName: draft.proxyName
  }
}

const assetImportInput = (draft: ImportedAssetDraft, existing?: AiopsAssetRecord): AiopsAssetInput => ({
  ...(existing ? { id: existing.id } : {}),
  name: draft.title,
  title: draft.title,
  host: draft.host,
  ip: draft.host,
  group: draft.group,
  group_name: draft.group,
  status: 'online',
  tags: ['imported'],
  username: draft.username,
  port: draft.port,
  asset_type: draft.asset_type,
  auth_type: draft.auth_type,
  comment: draft.comment,
  password: draft.password,
  needProxy: draft.needProxy,
  proxyName: draft.proxyName,
  data_source: existing?.data_source || 'manual'
})

const assetExportErrorResult = (error: unknown): AiopsAssetExportResult => ({
  ok: false,
  errorCode: error instanceof AssetExportError ? error.errorCode : 'ASSET_EXPORT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || '导出文件失败。')
})

type AssetExportWriteResult = Awaited<ReturnType<NonNullable<AssetExportRuntime['writeFile']>>>

const isAssetExportWriteMetadata = (value: AssetExportWriteResult): value is Exclude<AssetExportWriteResult, void> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const assetExportFileName = (now = new Date()) => `external-reference-assets-${now.toISOString().slice(0, 10)}.json`

const assetExportPayload = (asset: AiopsAssetRecord): AiopsAssetExportPayload => ({
  username: asset.username,
  password: '',
  ip: asset.host || asset.ip,
  label: asset.title || asset.name || asset.host,
  group_name: asset.group_name || asset.group || '',
  auth_type: asset.auth_type || 'password',
  ...(asset.keychainId ? { keyChain: asset.keychainId } : {}),
  port: asset.port || 22,
  asset_type: asset.asset_type || 'person',
  needProxy: Boolean(asset.needProxy),
  proxyName: asset.proxyName || '',
  ...(asset.comment ? { comment: asset.comment } : {})
})

const resolveAssetExportSelection = (input: AiopsAssetExportInput): AiopsAssetRecord[] => {
  const selectedIds = Array.from(new Set((Array.isArray(input?.assetIds) ? input.assetIds : []).map(text).filter(Boolean)))
  if (!selectedIds.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '请选择要导出的主机。')
  const selectedSet = new Set(selectedIds)
  const assets = getStore()
    .list()
    .assets.filter((asset) => selectedSet.has(asset.id) && !asset.isLocalShell && asset.asset_type !== 'organization' && asset.host && asset.username)
  if (!assets.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '没有可导出的主机。')
  return assets
}

const assertUserEditableAsset = (id?: string) => {
  if (id === LOCAL_SHELL_ASSET_ID) throw new Error('本地连接是系统资产，不能编辑或删除')
}

const refreshedAssetForOrganization = (organization: AiopsAssetRecord, index: number): AiopsAssetInput => {
  const baseName = organization.title || organization.name || organization.host || 'organization'
  const hostOctet = 15 + index
  return {
    id: `${organization.id}-synced`,
    name: `${baseName}-synced-asset`,
    title: `${baseName}-synced-asset`,
    host: `10.90.0.${hostOctet}`,
    ip: `10.90.0.${hostOctet}`,
    group: organization.group || organization.group_name || '企业',
    group_name: organization.group_name || organization.group || '企业',
    status: 'online',
    tags: ['jumpserver', 'synced'],
    username: 'jump',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '刷新来源资产',
    data_source: 'refresh',
    organizationId: organization.uuid || organization.id,
    keychainId: organization.keychainId
  }
}

export const listAssets = (): AiopsAssetSnapshot => getStore().list()
export const listAssetGroups = (input: AiopsAssetGroupListInput = {}): AiopsAssetGroupRecord[] => listAssetGroupsFromAssets(getStore().list().assets, input)
export const getAsset = (id: string): AiopsAssetRecord | null => getStore().getAsset(id)
export const getAssetSecret = (id: string): AssetSecret => getStore().getSecret(id)
export const getAssetEditableSecret = (id: string): AiopsMutationResult<AiopsAssetEditableSecret> =>
  asResult(() => {
    const assetId = text(id)
    if (!assetId) throw new Error('资产 id 不能为空')
    const asset = getStore().getAsset(assetId)
    if (!asset || asset.isLocalShell) throw new Error('资产不存在或不可编辑')
    const secret = getStore().getSecret(assetId)
    return {
      assetId,
      ...(typeof secret.password === 'string' && secret.password ? { password: secret.password } : {})
    }
  })
export const getKeychainSecret = (id: string): AssetSecret => getStore().getKeychainSecret(id)
export const saveAsset = (input: AiopsAssetInput): AiopsMutationResult<AiopsAssetRecord> =>
  asResult(() => {
    assertUserEditableAsset(input.id)
    return getStore().save(input)
  })
export const testAssetConnection = async (input: AiopsAssetConnectionTestInput = {}): Promise<AiopsAssetConnectionTestResult> => {
  const start = assetConnectionNow()
  let client: AssetSshTestClient | null = null
  let proxySocket: SshProxySocket | null = null
  let target: ResolvedAssetConnectionTarget | null = null
  try {
    target = resolveAssetConnectionTarget(input)
    const ssh2 = getAssetConnectionSsh2Runtime()
    if (!ssh2) {
      return {
        ok: false,
        errorCode: 'ASSET_SSH_RUNTIME_UNAVAILABLE',
        errorMessage: 'ssh2 runtime is not available'
      }
    }

    const timeoutMs = assetConnectionTimeoutMs(input)
    const connectConfig: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: timeoutMs,
      keepaliveInterval: defaultSshKeepaliveIntervalMs
    }
    if (target.password) connectConfig.password = target.password
    if (target.privateKey) connectConfig.privateKey = target.privateKey
    if (target.passphrase) connectConfig.passphrase = target.passphrase
    if (target.agent) connectConfig.agent = target.agent

    const runtimeConfig = getAssetConnectionRuntimeConfig()
    const proxy = await createSshProxySocketForAsset(
      { needProxy: Boolean(target.needProxy), proxyName: target.proxyName },
      runtimeConfig.sshProxyConfigs,
      target.host,
      target.port,
      { timeoutMs }
    )
    if (proxy) {
      proxySocket = proxy.socket
      connectConfig.sock = proxy.socket
      delete connectConfig.host
      delete connectConfig.port
    }

    client = new ssh2.Client()
    await connectAssetSshClient(client, connectConfig, timeoutMs)
    const durationMs = Math.max(0, assetConnectionNow() - start)
    return {
      ok: true,
      data: {
        assetId: target.assetId,
        endpoint: `${target.username}@${target.host}:${target.port}`,
        host: target.host,
        port: target.port,
        username: target.username,
        authType: target.authType,
        authSource: target.authSource,
        durationMs,
        ...(proxy ? { proxyName: proxy.config.name } : target.needProxy && target.proxyName ? { proxyName: target.proxyName } : {}),
        ...(target.agentKeyCount ? { agentKeyCount: target.agentKeyCount } : {})
      }
    }
  } catch (error) {
    if (error instanceof AssetConnectionTestError) {
      return { ok: false, errorCode: error.errorCode, errorMessage: error.message }
    }
    if (target) {
      const diagnosis = diagnoseSshConnectionError(error, {
        authType: target.authType,
        hasPassword: Boolean(target.password),
        hasPrivateKey: Boolean(target.privateKey),
        hasAgent: Boolean(target.agent),
        username: target.username,
        host: target.host,
        port: target.port
      })
      return {
        ok: false,
        errorCode: diagnosis.errorCode,
        errorMessage: diagnosis.errorMessage
      }
    }
    return {
      ok: false,
      errorCode: 'ASSET_SSH_CONNECT_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  } finally {
    try {
      client?.end()
    } catch {}
    try {
      proxySocket?.destroy()
    } catch {}
  }
}
export const deleteAsset = (id: string): AiopsMutationResult<{ id: string }> =>
  asResult(() => {
    assertUserEditableAsset(id)
    getStore().delete(id)
    return { id }
  })
export const renameAssetGroup = (input: AiopsAssetGroupRenameInput): AiopsMutationResult<AiopsAssetSnapshot> =>
  asResult(() => {
    const oldName = input.oldName.trim()
    const newName = input.newName.trim()
    if (!oldName || !newName) throw new Error('Asset group name is required')
    const store = getStore()
    const snapshot = store.list()
    let updated = 0
    snapshot.assets
      .filter((asset) => shouldIncludeAssetGroup(asset, input) && assetGroupName(asset) === oldName)
      .forEach((asset) => {
        assertUserEditableAsset(asset.id)
        store.save({ ...asset, group: newName, group_name: newName })
        updated += 1
      })
    if (!updated) throw new Error(`Asset group not found: ${oldName}`)
    return store.list()
  })
export const deleteAssetGroup = (input: AiopsAssetGroupDeleteInput): AiopsMutationResult<AiopsAssetSnapshot> =>
  asResult(() => {
    const name = input.name.trim()
    const fallbackName = (input.fallbackName || '未分组').trim() || '未分组'
    if (!name) throw new Error('Asset group name is required')
    const store = getStore()
    const snapshot = store.list()
    let updated = 0
    snapshot.assets
      .filter((asset) => shouldIncludeAssetGroup(asset, input) && assetGroupName(asset) === name)
      .forEach((asset) => {
        assertUserEditableAsset(asset.id)
        store.save({ ...asset, group: fallbackName, group_name: fallbackName })
        updated += 1
      })
    if (!updated) throw new Error(`Asset group not found: ${name}`)
    return store.list()
  })
export const refreshOrganizationAssets = (input: AiopsOrganizationAssetRefreshInput = {}): AiopsOrganizationAssetRefreshResult =>
  asResult(() => {
    const store = getStore()
    const snapshot = store.list()
    const organizations = snapshot.assets.filter(
      (asset) =>
        asset.asset_type === 'organization' &&
        (!input.organizationId || asset.id === input.organizationId || asset.uuid === input.organizationId)
    )
    if (input.organizationId && organizations.length === 0) {
      throw new Error(`Organization asset not found: ${input.organizationId}`)
    }
    let created = 0
    let updated = 0

    organizations.forEach((organization, index) => {
      const draft = refreshedAssetForOrganization(organization, index)
      const existing = store.getAsset(draft.id!)
      store.save(draft)
      if (existing) updated += 1
      else created += 1
    })

    return {
      ...store.list(),
      ...(input.organizationId && organizations[0] ? { organizationId: organizations[0].uuid || organizations[0].id } : {}),
      refreshed: created + updated,
      created,
      updated
    }
  })
export const previewAssetImport = async (input: AiopsAssetImportPreviewInput): Promise<AiopsAssetImportPreviewResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input)
    const snapshot = getStore().list()
    const assets = drafts.map((draft, index) => assetImportPreviewRecord(draft, index, snapshot.assets))
    return {
      ok: true,
      data: {
        filePath,
        fileName,
        assets,
        duplicateCount: assets.filter((asset) => asset.duplicateId).length
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}
export const confirmAssetImport = async (input: AiopsAssetImportConfirmInput): Promise<AiopsAssetImportConfirmResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input)
    const store = getStore()
    let imported = 0
    let skipped = 0
    let created = 0
    let updated = 0

    for (const draft of drafts) {
      const existing = findAssetImportDuplicate(store.list().assets, draft)
      if (existing && !input.overwrite) {
        skipped += 1
        continue
      }
      store.save(assetImportInput(draft, existing))
      imported += 1
      if (existing) updated += 1
      else created += 1
    }

    return {
      ok: true,
      data: {
        ...store.list(),
        imported,
        skipped,
        created,
        updated,
        filePath,
        fileName
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}
export const exportAssets = async (input: AiopsAssetExportInput, runtime: AssetExportRuntime): Promise<AiopsAssetExportResult> => {
  try {
    if (!runtime?.showSaveDialog) throw new AssetExportError('ASSET_EXPORT_SAVE_DIALOG_UNAVAILABLE', '导出保存对话框服务不可用。')
    const assets = resolveAssetExportSelection(input)
    const payload = assets.map(assetExportPayload)
    const fileName = assetExportFileName(runtime.now?.() || new Date())
    const saveResult = await runtime.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    })
    if (saveResult?.canceled) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const filePath = typeof saveResult.filePath === 'string' ? saveResult.filePath : ''
    if (!filePath.trim() || !isAbsolute(filePath)) throw new AssetExportError('ASSET_EXPORT_SAVE_PATH_INVALID', '资产导出保存路径必须是绝对路径。')
    const content = JSON.stringify(payload, null, 2)
    const expectedBytes = Buffer.byteLength(content, 'utf8')
    const writeResult = await (runtime.writeFile || writeFile)(filePath, content, 'utf-8')
    if (isAssetExportWriteMetadata(writeResult)) {
      if (writeResult.filePath !== filePath) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出写入路径确认失败。')
      if (writeResult.bytes !== expectedBytes) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出写入字节数确认失败。')
    }
    let writtenSize = -1
    try {
      writtenSize = (await stat(filePath)).size
    } catch {
      throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出文件写入后无法确认。')
    }
    if (writtenSize !== expectedBytes) throw new AssetExportError('ASSET_EXPORT_WRITE_CONFIRMATION_INVALID', '资产导出文件大小与生成内容不一致。')
    return {
      ok: true,
      data: {
        exported: payload.length,
        fileName,
        filePath,
        bytes: expectedBytes
      }
    }
  } catch (error) {
    return assetExportErrorResult(error)
  }
}
export const listKeychains = (): AiopsKeychainRecord[] => getStore().listKeychains()
export const listSshAgentKeychainOptions = (): SshAgentKeychainOption[] =>
  listKeychains().filter((keychain) => keychain.hasPrivateKey).map(keychainToSshAgentOption)
export const getKeychain = (id: string): AiopsKeychainRecord | null => getStore().getKeychain(id)
export const saveKeychain = (input: AiopsKeychainInput): AiopsMutationResult<AiopsKeychainRecord> => asResult(() => getStore().saveKeychain(input))
export const deleteKeychain = (id: string): AiopsMutationResult<{ id: string }> =>
  asResult(() => {
    getStore().deleteKeychain(id)
    return { id }
  })
export const saveAssetFolder = (folder: AiopsCustomFolderSaveInput): AiopsMutationResult<AiopsCustomFolderRecord> => asResult(() => getStore().saveFolder(folder))
export const deleteAssetFolder = (uuid: string): AiopsMutationResult<{ uuid: string }> =>
  asResult(() => {
    getStore().deleteFolder(uuid)
    return { uuid }
  })
