import type { Client, ConnectConfig } from 'ssh2'
import type {
  AiopsAssetConnectionTestInfo,
  AiopsAssetConnectionTestInput,
  AiopsAssetConnectionTestResult,
  AiopsAssetExportInput,
  AiopsAssetExportResult,
  AiopsAssetEditableSecret,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
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
import { createConfiguredSshAgentAuth } from '../ssh/sshAgent'
import { loadSsh2 } from '../ssh/ssh2Runtime'
import { defaultSshKeepaliveCountMax, defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from '../ssh/sshDefaults'
import { createSshProxySocketForAsset, type SshProxySocket } from '../ssh/sshProxy'
import { diagnoseSshConnectionError } from '../terminal/terminal'
import {
  confirmAssetImportRuntime,
  exportAssetsRuntime,
  previewAssetImportRuntime,
  type AssetExportRuntime
} from './assetsImportExportRuntime'
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
import {
  fetchJumpserverHosts,
  jumpserverHostToAssetInput,
  type JumpserverFetch
} from '@shared/jumpserverClient'


type AssetSshTestClient = Pick<Client, 'connect' | 'end' | 'on' | 'off' | 'once'>

type AssetConnectionRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  ssh2Runtime?: { Client: new () => AssetSshTestClient } | null
  now?: () => number
  timeoutMs?: number
}

type AssetBackendRuntimeConfig = AssetConnectionRuntimeConfig & AssetStoreRuntimeConfig & {
  jumpserverFetch?: JumpserverFetch
  refreshBastionAssets?: (type: string, organization: AiopsAssetRecord) => Promise<AiopsAssetInput[]>
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

const assetConnectionRuntime: AssetConnectionRuntimeConfig = {}
let jumpserverFetchRuntime: JumpserverFetch = globalThis.fetch
let refreshBastionAssetsRuntime: AssetBackendRuntimeConfig['refreshBastionAssets']

export const configureAssetConnectionRuntime = (config: AssetConnectionRuntimeConfig = {}) => {
  assetConnectionRuntime.getConfig = config.getConfig
  assetConnectionRuntime.ssh2Runtime = config.ssh2Runtime
  assetConnectionRuntime.now = config.now
  assetConnectionRuntime.timeoutMs = config.timeoutMs
}

export const configureAssetBackendRuntime = (config: AssetBackendRuntimeConfig = {}) => {
  configureAssetStoreRuntime(config)
  configureAssetConnectionRuntime(config)
  jumpserverFetchRuntime = config.jumpserverFetch || globalThis.fetch
  refreshBastionAssetsRuntime = config.refreshBastionAssets
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

const asAsyncResult = async <T>(fn: () => Promise<T>): Promise<AiopsMutationResult<T>> => {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    const errorCode =
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : 'ASSET_BACKEND_ERROR'
    return {
      ok: false,
      errorCode,
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

const assertUserEditableAsset = (id?: string) => {
  if (id === LOCAL_SHELL_ASSET_ID) throw new Error('本地连接是系统资产，不能编辑或删除')
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
      ...(typeof secret.password === 'string' && secret.password ? { password: secret.password } : {}),
      ...(typeof secret.jumpserverToken === 'string' && secret.jumpserverToken ? { jumpserverToken: secret.jumpserverToken } : {})
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
      keepaliveInterval: defaultSshKeepaliveIntervalMs,
      keepaliveCountMax: defaultSshKeepaliveCountMax
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
export const refreshOrganizationAssets = (
  input: AiopsOrganizationAssetRefreshInput = {}
): Promise<AiopsOrganizationAssetRefreshResult> =>
  asAsyncResult(async () => {
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
    let deleted = 0

    for (const organization of organizations) {
      const isJumpserver =
        organization.bastionType === 'jumpserver' ||
        (!organization.bastionType && organization.tags.some((tag) => tag.trim().toLowerCase() === 'jumpserver'))
      const organizationId = organization.uuid || organization.id
      const sourceType = isJumpserver ? 'jumpserver' : String(organization.bastionType || '').trim()
      let drafts: AiopsAssetInput[]
      if (isJumpserver) {
        const apiUrl = organization.jumpserverApiUrl || (/^https?:\/\//i.test(organization.host) ? organization.host : `https://${organization.host}`)
        const remoteHosts = await fetchJumpserverHosts(jumpserverFetchRuntime, {
          apiUrl,
          privateToken: store.getSecret(organization.id).jumpserverToken || '',
          organizationId: organization.jumpserverOrgId
        })
        drafts = remoteHosts
          .map((host) => jumpserverHostToAssetInput(organization, host))
          .filter((draft): draft is AiopsAssetInput => Boolean(draft))
        if (drafts.length !== remoteHosts.length) {
          throw Object.assign(new Error('JumpServer 返回的资产缺少 ID 或地址，本次刷新未写入。'), {
            code: 'JUMPSERVER_API_MALFORMED'
          })
        }
      } else {
        if (!sourceType || !refreshBastionAssetsRuntime) {
          if (input.organizationId) {
            throw Object.assign(new Error('当前堡垒机没有可用的数据源 Provider。'), { code: 'BASTION_PROVIDER_UNAVAILABLE' })
          }
          continue
        }
        drafts = await refreshBastionAssetsRuntime(sourceType, organization)
      }
      drafts = drafts.map((draft) => ({
        ...draft,
        organizationId,
        data_source: 'refresh',
        tags: [...new Set([...(draft.tags || []), sourceType, 'synced'])]
      }))
      if (drafts.some((draft) => !draft.id || !draft.name || !draft.host)) {
        throw Object.assign(new Error('堡垒机 Provider 返回的资产缺少 ID、名称或地址，本次刷新未写入。'), {
          code: 'BASTION_PROVIDER_MALFORMED'
        })
      }
      const remoteIds = new Set(drafts.map((draft) => draft.id!))
      const staleIds = store
        .list()
        .assets.filter(
          (asset) =>
            asset.asset_type !== 'organization' &&
            asset.organizationId === organizationId &&
            asset.data_source === 'refresh' &&
            asset.tags.includes(sourceType) &&
            asset.tags.includes('synced') &&
            !remoteIds.has(asset.id)
        )
        .map((asset) => asset.id)
      for (const id of staleIds) {
        store.delete(id)
        deleted += 1
      }
      for (const draft of drafts) {
        const existing = store.getAsset(draft.id!)
        store.save(draft)
        if (existing) updated += 1
        else created += 1
      }
    }

    return {
      ...store.list(),
      ...(input.organizationId && organizations[0] ? { organizationId: organizations[0].uuid || organizations[0].id } : {}),
      refreshed: created + updated,
      created,
      updated,
      deleted
    }
  })

const createAssetImportExportRuntime = () => ({
  listAssets: () => getStore().list(),
  saveAsset: (input: AiopsAssetInput) => getStore().save(input),
  saveAssets: (inputs: AiopsAssetInput[]) => {
    inputs.forEach((input) => assertUserEditableAsset(input.id))
    return getStore().saveMany(inputs)
  }
})

export const previewAssetImport = async (input: AiopsAssetImportPreviewInput): Promise<AiopsAssetImportPreviewResult> => {
  return previewAssetImportRuntime(input, createAssetImportExportRuntime())
}
export const confirmAssetImport = async (input: AiopsAssetImportConfirmInput): Promise<AiopsAssetImportConfirmResult> => {
  return confirmAssetImportRuntime(input, createAssetImportExportRuntime())
}
export const exportAssets = async (input: AiopsAssetExportInput, runtime: AssetExportRuntime): Promise<AiopsAssetExportResult> => {
  return exportAssetsRuntime(input, runtime, createAssetImportExportRuntime())
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
