import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { KubernetesAgentProxyConfig, KubernetesAgentProxyConfigInput } from './contracts/kubernetes'
import { isRecord } from './kubernetesCatalogPersistence'

const kubernetesProxyTypes: KubernetesAgentProxyConfig['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

export const defaultKubernetesAgentProxyConfig: KubernetesAgentProxyConfig = {
  enabled: false,
  type: 'SOCKS5',
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: ''
}

const cloneAgentProxyConfig = (config: KubernetesAgentProxyConfig): KubernetesAgentProxyConfig => ({ ...config })

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback

const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

export const normalizeKubernetesAgentProxyConfig = (
  input: unknown,
  base: KubernetesAgentProxyConfig = defaultKubernetesAgentProxyConfig
): { config: KubernetesAgentProxyConfig; changed: boolean } => {
  const source = isRecord(input) ? input : {}
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : base.enabled
  const enableProxyIdentity = typeof source.enableProxyIdentity === 'boolean' ? source.enableProxyIdentity : base.enableProxyIdentity
  const config: KubernetesAgentProxyConfig = {
    enabled,
    type: stringFromOptions(source.type, kubernetesProxyTypes, base.type),
    host: typeof source.host === 'string' ? source.host.trim() : base.host,
    port: numberInRange(source.port, base.port, 1, 65535),
    enableProxyIdentity,
    username: enableProxyIdentity && typeof source.username === 'string' ? source.username : '',
    password: enableProxyIdentity && typeof source.password === 'string' ? source.password : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : base.updatedAt
  }
  const allowedKeys = new Set(['enabled', 'type', 'host', 'port', 'enableProxyIdentity', 'username', 'password', 'updatedAt'])
  const changed =
    !isRecord(input) ||
    source.enabled !== config.enabled ||
    source.type !== config.type ||
    source.host !== config.host ||
    source.port !== config.port ||
    source.enableProxyIdentity !== config.enableProxyIdentity ||
    source.username !== config.username ||
    source.password !== config.password ||
    source.updatedAt !== config.updatedAt ||
    Object.keys(source).some((key) => !allowedKeys.has(key))

  return { config, changed }
}

export const validateKubernetesAgentProxyConfig = (config: KubernetesAgentProxyConfig) => {
  if (!config.enabled) return
  if (!config.host.trim()) {
    throw Object.assign(new Error('Kubernetes Agent proxy host is required.'), { code: 'K8S_AGENT_PROXY_HOST_REQUIRED' })
  }
  if (config.port < 1 || config.port > 65535) {
    throw Object.assign(new Error('Kubernetes Agent proxy port must be between 1 and 65535.'), { code: 'K8S_AGENT_PROXY_PORT_INVALID' })
  }
  if (!config.enableProxyIdentity) return
  if (config.type === 'SOCKS4' && !config.username.trim()) {
    throw Object.assign(new Error('SOCKS4 proxy authentication requires username.'), { code: 'K8S_AGENT_PROXY_USERNAME_REQUIRED' })
  }
  if (config.type !== 'SOCKS4' && (!config.username.trim() || !config.password)) {
    throw Object.assign(new Error('Proxy authentication requires username and password.'), { code: 'K8S_AGENT_PROXY_CREDENTIALS_REQUIRED' })
  }
}

export const createKubernetesAgentProxyRuntime = (options: { stateDir: () => string; nowLabel: () => string }) => {
  let agentProxyConfigCache: KubernetesAgentProxyConfig | null = null

  const agentProxyConfigPath = () => join(options.stateDir(), 'agent-proxy.json')

  const load = (): KubernetesAgentProxyConfig => {
    if (agentProxyConfigCache) return cloneAgentProxyConfig(agentProxyConfigCache)
    try {
      const filePath = agentProxyConfigPath()
      if (!existsSync(filePath)) {
        agentProxyConfigCache = { ...defaultKubernetesAgentProxyConfig }
        return cloneAgentProxyConfig(agentProxyConfigCache)
      }
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
      const { config } = normalizeKubernetesAgentProxyConfig(parsed)
      validateKubernetesAgentProxyConfig(config)
      agentProxyConfigCache = config
      return cloneAgentProxyConfig(agentProxyConfigCache)
    } catch {
      agentProxyConfigCache = { ...defaultKubernetesAgentProxyConfig }
      return cloneAgentProxyConfig(agentProxyConfigCache)
    }
  }

  const write = (config: KubernetesAgentProxyConfig) => {
    mkdirSync(options.stateDir(), { recursive: true })
    writeFileSync(agentProxyConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    agentProxyConfigCache = cloneAgentProxyConfig(config)
    return cloneAgentProxyConfig(agentProxyConfigCache)
  }

  const save = (input: KubernetesAgentProxyConfigInput) => {
    const current = load()
    const { config } = normalizeKubernetesAgentProxyConfig(
      {
        ...current,
        ...(isRecord(input) ? input : {}),
        updatedAt: options.nowLabel()
      },
      current
    )
    validateKubernetesAgentProxyConfig(config)
    return write(config)
  }

  const reset = () => {
    agentProxyConfigCache = null
  }

  return { load, save, reset }
}
