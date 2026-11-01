import { defaultImGatewayConfig, type ImGatewayConfig, type ImGatewaySaveInput, type ImGatewayStatus } from '@shared/contracts/imGateway'
import { GatewayCore } from './gatewayCore'
import { GatewayStateStore } from './gatewayState'
import type { GatewayAdapter, GatewayAdapterFactory, GatewayMessage, GatewayTerminalPort } from './gatewayTypes'

export type GatewaySavedSettings = { config: ImGatewayConfig; encryptedSecret: string }
export const normalizeGatewayConfig = (input: ImGatewayConfig): ImGatewayConfig => {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.allowLocalTerminal !== 'boolean' || typeof input.accountId !== 'string' || typeof input.provider !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(input.provider)) throw new Error('IM_GATEWAY_CONFIG_INVALID')
  const config = { ...defaultImGatewayConfig, provider: input.provider, enabled: input.enabled, allowLocalTerminal: input.allowLocalTerminal, accountId: input.accountId.trim() }
  if (config.accountId.length > 200 || /[\s\x00-\x1f]/.test(config.accountId) || (config.provider === 'feishu' && config.accountId && !/^cli_[a-f0-9]{16}$/i.test(config.accountId))) throw new Error('IM_GATEWAY_APP_ID_INVALID')
  for (const field of ['allowedUserIds', 'allowedGroupIds', 'allowedAssetIds'] as const) {
    const values = input[field]
    if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 200 || /[\s\x00-\x1f]/.test(value))) throw new Error('IM_GATEWAY_ALLOWLIST_INVALID')
    config[field] = [...new Set(values)]
  }
  if (config.enabled && (!config.accountId || !config.allowedUserIds.length || (!config.allowedAssetIds.length && !config.allowLocalTerminal))) throw new Error('IM_GATEWAY_AUTHORIZATION_REQUIRED')
  return config
}
export class GatewayManager {
  private config = { ...defaultImGatewayConfig }
  private encryptedSecret = ''
  private connection: ImGatewayStatus['connection'] = 'disabled'
  private error = ''
  private adapter?: GatewayAdapter
  private core?: GatewayCore
  private revision = 0
  private mutations = Promise.resolve()
  private closed = false
  constructor(private options: {
    read: () => GatewaySavedSettings
    write: (value: GatewaySavedSettings) => void
    encrypt: (secret: string) => string
    decrypt: (encrypted: string) => string
    state: GatewayStateStore
    terminal: GatewayTerminalPort
    adapters: ReadonlyMap<string, GatewayAdapterFactory>
    audit: (event: string, message: GatewayMessage, action?: string) => void
  }) {}
  status(): ImGatewayStatus { return { config: structuredClone(this.config), hasAppSecret: Boolean(this.encryptedSecret), connection: this.connection, error: this.error, pending: this.core?.status.pending || 0, bindings: this.options.state.bindingCount, lastMessageAt: this.core?.status.lastMessageAt } }
  async initialize() {
    try {
      const value = this.options.read()
      this.config = normalizeGatewayConfig(value.config)
      this.encryptedSecret = value.encryptedSecret || ''
      await this.start()
    } catch { await this.stop(); this.connection = 'error'; this.error = 'IM_GATEWAY_START_FAILED' }
  }
  private async stop() {
    this.revision += 1
    this.core?.stop()
    this.adapter?.stop()
    this.adapter = undefined
    this.connection = 'disabled'
    await this.core?.drain()
    this.core = undefined
  }
  shutdown() { this.closed = true; this.revision += 1; this.core?.stop(); this.adapter?.stop(); this.connection = 'disabled' }
  private async start() {
    if (!this.config.enabled || this.closed) return
    const secret = this.options.decrypt(this.encryptedSecret)
    if (!secret) throw new Error('IM_GATEWAY_SECRET_REQUIRED')
    const factory = this.options.adapters.get(this.config.provider)
    if (!factory) throw new Error('IM_GATEWAY_ADAPTER_UNAVAILABLE')
    const revision = ++this.revision
    const adapter = await factory({ accountId: this.config.accountId, secret, connection: (state, error = '') => {
      if (revision === this.revision && !this.closed) { this.connection = state; this.error = error }
    } })
    if (revision !== this.revision || this.closed) { adapter.stop(); return }
    this.adapter = adapter
    this.core = new GatewayCore({ policy: () => this.config, state: this.options.state, terminal: this.options.terminal, reply: (message, text) => adapter.reply(message, text), audit: this.options.audit })
    const core = this.core
    await adapter.start(message => message.provider === this.config.provider && message.accountId === this.config.accountId ? core.receive(message) : Promise.resolve())
  }
  save(input: ImGatewaySaveInput): Promise<ImGatewayStatus> {
    const mutation = this.mutations.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('IM_GATEWAY_STOPPED')
      const config = normalizeGatewayConfig(input?.config)
      if (!this.options.adapters.has(config.provider)) throw new Error('IM_GATEWAY_ADAPTER_UNAVAILABLE')
      let encryptedSecret = config.provider === this.config.provider && config.accountId === this.config.accountId ? this.encryptedSecret : ''
      if (input.appSecret !== undefined) {
        if (typeof input.appSecret !== 'string' || input.appSecret.length > 4096 || /[\r\n]/.test(input.appSecret)) throw new Error('IM_GATEWAY_SECRET_INVALID')
        encryptedSecret = input.appSecret ? this.options.encrypt(input.appSecret) : ''
      }
      if (config.enabled && !encryptedSecret) throw new Error('IM_GATEWAY_SECRET_REQUIRED')
      // Stop receiving and discard queued actions before changing permissions or account credentials.
      await this.stop()
      this.options.write({ config, encryptedSecret })
      this.config = config; this.encryptedSecret = encryptedSecret; this.error = ''
      try { await this.start() } catch { await this.stop(); this.connection = 'error'; this.error = 'IM_GATEWAY_START_FAILED' }
      return this.status()
    })
    this.mutations = mutation.then(() => {}, () => {})
    return mutation
  }
}
