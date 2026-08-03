import { createHash } from 'crypto'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import { cleanText, getEnv, getRuntimeConfig } from './sshTerminalRuntimeConfig'
import type { SshTerminalClient, SshTerminalTarget } from './sshTerminalTypes'

export type PooledSshClient = {
  key: string
  client: SshTerminalClient
  createdAt: number
  lastUsedAt: number
  dispose?: () => void
}

const pooledTargetClients = new Map<string, PooledSshClient>()
const pooledJumpClients = new Map<string, PooledSshClient>()
const jumpForwardUnsupportedKeys = new Set<string>()

const clearPool = (pool: Map<string, PooledSshClient>) => {
  for (const entry of new Set(pool.values())) {
    try {
      entry.client.end()
    } catch {}
    try {
      entry.dispose?.()
    } catch {}
  }
  pool.clear()
}

export const clearSshConnectionPools = () => {
  clearPool(pooledTargetClients)
  clearPool(pooledJumpClients)
  jumpForwardUnsupportedKeys.clear()
}

export const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24)

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const secretFingerprint = (value: unknown) => {
  const text = typeof value === 'string' ? value : ''
  return text ? shortHash(text) : ''
}

export const authPoolIdentity = (target: SshTerminalTarget) => {
  const env = getEnv()
  const config = getRuntimeConfig()
  const sshAgentKeys = Array.isArray(config.sshAgentKeys)
    ? config.sshAgentKeys
        .map((item) => (typeof item === 'object' && item ? cleanText((item as Record<string, unknown>).id || (item as Record<string, unknown>).key) : ''))
        .filter(Boolean)
        .sort()
    : []
  return {
    assetId: cleanText(target.asset?.id),
    authType: cleanText(target.asset?.auth_type),
    keychainId: cleanText(target.asset?.keychainId),
    password: secretFingerprint(target.password),
    privateKey: secretFingerprint(target.privateKey),
    passphrase: secretFingerprint(target.passphrase),
    agentEnabled: config.terminal?.sshAgentsStatus === true,
    sshAgentKeys,
    envAgent: cleanText(env.SSH_AUTH_SOCK)
  }
}

export const targetEndpointIdentity = (target: Pick<SshTerminalTarget, 'host' | 'port' | 'username'>) => ({
  host: cleanText(target.host).toLowerCase(),
  port: Number(target.port || 22),
  username: cleanText(target.username)
})

export const proxyPoolIdentity = (proxy: SshProxyConfig | undefined | null) =>
  proxy
    ? {
        name: cleanText(proxy.name),
        type: cleanText(proxy.type),
        host: cleanText(proxy.host).toLowerCase(),
        port: Number(proxy.port || 0),
        enableProxyIdentity: proxy.enableProxyIdentity === true,
        username: cleanText(proxy.username),
        password: secretFingerprint(proxy.password)
      }
    : null

export const targetPoolKey = (transport: 'direct' | 'proxy' | 'jump', authTarget: SshTerminalTarget, context: { proxy?: SshProxyConfig | null; jump?: SshTerminalTarget | null }) =>
  shortHash(
    stableJson({
      kind: 'target',
      transport,
      target: targetEndpointIdentity(authTarget),
      auth: authPoolIdentity(authTarget),
      proxy: proxyPoolIdentity(context.proxy),
      jump: context.jump
        ? {
            endpoint: targetEndpointIdentity(context.jump),
            auth: authPoolIdentity(context.jump)
          }
        : null
    })
  )

export const authenticatedTargetPoolKey = (
  transport: 'direct' | 'proxy' | 'jump',
  authTarget: SshTerminalTarget,
  context: { proxy?: SshProxyConfig | null; jump?: SshTerminalTarget | null }
) =>
  shortHash(
    stableJson({
      kind: 'authenticated-target',
      transport,
      target: {
        assetId: cleanText(authTarget.asset?.id),
        endpoint: targetEndpointIdentity(authTarget)
      },
      proxy: proxyPoolIdentity(context.proxy),
      jump: context.jump
        ? {
            assetId: cleanText(context.jump.asset?.id),
            endpoint: targetEndpointIdentity(context.jump)
          }
        : null
    })
  )

export const jumpPoolKey = (jumpTarget: SshTerminalTarget) =>
  shortHash(
    stableJson({
      kind: 'jump',
      endpoint: targetEndpointIdentity(jumpTarget),
      auth: authPoolIdentity(jumpTarget)
    })
  )

export const removePooledClient = (pool: Map<string, PooledSshClient>, key: string, client?: SshTerminalClient) => {
  const entry = pool.get(key)
  if (!entry || (client && entry.client !== client)) return
  pool.delete(key)
  try {
    entry.dispose?.()
  } catch {}
}

export const removePooledClientAliases = (pool: Map<string, PooledSshClient>, client: SshTerminalClient) => {
  const removed = new Set<PooledSshClient>()
  for (const [entryKey, entry] of pool) {
    if (entry.client !== client) continue
    pool.delete(entryKey)
    removed.add(entry)
  }
  for (const entry of removed) {
    try {
      entry.dispose?.()
    } catch {}
  }
}

export const findPooledClientEntry = (pool: Map<string, PooledSshClient>, client: SshTerminalClient) => {
  for (const entry of pool.values()) {
    if (entry.client === client) return entry
  }
  return null
}

export const rememberPooledClient = (pool: Map<string, PooledSshClient>, key: string, client: SshTerminalClient, dispose?: () => void) => {
  const now = Date.now()
  const existing = pool.get(key)
  if (existing?.client === client) {
    existing.lastUsedAt = now
    if (dispose && !existing.dispose) existing.dispose = dispose
    return existing
  }
  if (existing) {
    try {
      existing.client.end()
    } catch {}
    removePooledClientAliases(pool, existing.client)
  }
  const clientEntry = findPooledClientEntry(pool, client)
  if (clientEntry) {
    clientEntry.lastUsedAt = now
    if (dispose && !clientEntry.dispose) clientEntry.dispose = dispose
    pool.set(key, clientEntry)
    return clientEntry
  }
  const entry = { key, client, createdAt: now, lastUsedAt: now, dispose }
  pool.set(key, entry)
  client.on('close', () => removePooledClientAliases(pool, client))
  client.on('end', () => removePooledClientAliases(pool, client))
  client.on('error', () => removePooledClientAliases(pool, client))
  return entry
}

export const rememberPooledClientAliases = (pool: Map<string, PooledSshClient>, keys: string[], client: SshTerminalClient, dispose?: () => void) => {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))
  if (!uniqueKeys.length) throw new Error('At least one SSH connection pool key is required.')
  const primary = rememberPooledClient(pool, uniqueKeys[0], client, dispose)
  for (const key of uniqueKeys.slice(1)) {
    const existing = pool.get(key)
    if (existing?.client === client) {
      existing.lastUsedAt = Date.now()
      continue
    }
    if (existing) {
      try {
        existing.client.end()
      } catch {}
      removePooledClientAliases(pool, existing.client)
    }
    pool.set(key, primary)
  }
  return primary
}

export const getPooledClient = (pool: Map<string, PooledSshClient>, key: string) => {
  const entry = pool.get(key)
  if (!entry) return null
  entry.lastUsedAt = Date.now()
  return entry.client
}

export const getPooledClientByKeys = (pool: Map<string, PooledSshClient>, keys: string[]) => {
  for (const key of keys) {
    const client = getPooledClient(pool, key)
    if (client) return client
  }
  return null
}

export const isPooledClient = (pool: Map<string, PooledSshClient>, key: string, client: SshTerminalClient) => pool.get(key)?.client === client

export const isPooledClientByKeys = (pool: Map<string, PooledSshClient>, keys: string[], client: SshTerminalClient) => keys.some((key) => isPooledClient(pool, key, client))

export const sshConnectionPoolRegistry = {
  target: {
    getByKeys: (keys: string[]) => getPooledClientByKeys(pooledTargetClients, keys),
    isByKeys: (keys: string[], client: SshTerminalClient) => isPooledClientByKeys(pooledTargetClients, keys, client),
    rememberAliases: (keys: string[], client: SshTerminalClient, dispose?: () => void) =>
      rememberPooledClientAliases(pooledTargetClients, keys, client, dispose),
    removeAliases: (client: SshTerminalClient) => removePooledClientAliases(pooledTargetClients, client)
  },
  jump: {
    get: (key: string) => getPooledClient(pooledJumpClients, key),
    remember: (key: string, client: SshTerminalClient, dispose?: () => void) =>
      rememberPooledClient(pooledJumpClients, key, client, dispose),
    remove: (key: string, client?: SshTerminalClient) => removePooledClient(pooledJumpClients, key, client),
    isForwardUnsupported: (key: string) => jumpForwardUnsupportedKeys.has(key),
    markForwardUnsupported: (key: string) => jumpForwardUnsupportedKeys.add(key)
  }
}
