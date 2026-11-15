import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayManager, normalizeGatewayConfig, type GatewaySavedSettings } from '../src/main/backend/imGateway/gatewayManager'
import { GatewayStateStore } from '../src/main/backend/imGateway/gatewayState'
import type { GatewayAdapterFactory, GatewayMessage } from '../src/main/backend/imGateway/gatewayTypes'
import { defaultImGatewayConfig } from '../src/shared/contracts/imGateway'

let saved: GatewaySavedSettings
let contexts: Parameters<GatewayAdapterFactory>[0][]
let stops: ReturnType<typeof vi.fn>[]
let receive: (message: GatewayMessage) => Promise<void>
let factory: GatewayAdapterFactory
let write: ReturnType<typeof vi.fn>
let encrypt: ReturnType<typeof vi.fn>
let manager: GatewayManager
const config = () => ({ ...defaultImGatewayConfig, accountId: 'cli_1234567890abcdef', allowedUserIds: ['ou_user'], allowedAssetIds: ['host'] })
const make = () => new GatewayManager({ read: () => saved, write, encrypt, decrypt: value => value.slice(4), state: new GatewayStateStore(), terminal: { list: async () => [], read: async () => '', write: async () => {} }, adapters: new Map([['feishu', factory], ['another-im', factory], ['infoflow', factory], ['telegram', factory]]), audit: vi.fn() })
beforeEach(() => {
  saved = { config: config(), encryptedSecret: 'enc:original-secret' }; contexts = []; stops = []
  write = vi.fn((value: GatewaySavedSettings) => { saved = value })
  encrypt = vi.fn((value: string) => `enc:${value}`)
  factory = context => {
    contexts.push(context); const stop = vi.fn(); stops.push(stop)
    return { start: async handler => { receive = handler; context.connection('connected') }, stop, reply: async () => {} }
  }
  manager = make()
})
describe('gateway lifecycle and credentials', () => {
  it('keeps safe platform startup error codes available for diagnosis', async () => {
    await manager.initialize()
    factory = () => { throw new Error('IM_GATEWAY_TELEGRAM_WEBHOOK_CONFLICT') }
    manager = make()
    const status = await manager.save({ config: { ...config(), provider: 'telegram', accountId: '123', allowedUserIds: ['7'], enabled: true }, appSecret: '123:token' })
    expect(status).toMatchObject({ connection: 'error', error: 'IM_GATEWAY_TELEGRAM_WEBHOOK_CONFLICT' })
    expect(JSON.stringify(status)).not.toContain('123:token')
    manager.shutdown()
  })
  it('requires Infoflow App Key and does not reuse a secret when the key changes', async () => {
    const next = { ...config(), provider: 'infoflow', accountId: '99', appKey: 'key-a', enabled: true }
    expect(() => normalizeGatewayConfig({ ...next, appKey: '' })).toThrow('APP_KEY_REQUIRED')
    expect(() => normalizeGatewayConfig({ ...next, appKey: 42 as any })).toThrow('APP_ID_INVALID')
    await manager.initialize()
    await manager.save({ config: next, appSecret: 'infoflow-secret' })
    expect(contexts.at(-1)).toMatchObject({ accountId: '99', appKey: 'key-a', secret: 'infoflow-secret' })
    await expect(manager.save({ config: { ...next, appKey: 'key-b' } })).rejects.toThrow('SECRET_REQUIRED')
    expect(manager.status().config.appKey).toBe('key-a')
    manager.shutdown()
  })
  it('validates platform-specific account IDs', () => {
    expect(() => normalizeGatewayConfig({ ...config(), provider: 'telegram', accountId: 'demo_bot' })).toThrow('APP_ID_INVALID')
    expect(normalizeGatewayConfig({ ...config(), provider: 'telegram', accountId: '123', allowedUserIds: ['7'] }).accountId).toBe('123')
    expect(() => normalizeGatewayConfig({ ...config(), provider: 'infoflow', accountId: '999999999999999999999' })).toThrow('APP_ID_INVALID')
  })
  it('starts disabled, encrypts new secrets, and never returns credentials in status', async () => {
    await manager.initialize(); expect(contexts).toHaveLength(0)
    const status = await manager.save({ config: { ...config(), enabled: true }, appSecret: 'new-secret' })
    expect(encrypt).toHaveBeenCalledWith('new-secret')
    expect(saved.encryptedSecret).toBe('enc:new-secret')
    expect(status.connection).toBe('connected')
    expect(JSON.stringify(status)).not.toContain('new-secret')
    expect(contexts[0].secret).toBe('new-secret')
    manager.shutdown(); expect(stops[0]).toHaveBeenCalledOnce()
  })
  it('revokes the running channel when disabled and ignores old connection callbacks', async () => {
    await manager.initialize()
    await manager.save({ config: { ...config(), enabled: true } })
    const old = contexts[0]
    await manager.save({ config: config() })
    expect(stops[0]).toHaveBeenCalledOnce()
    old.connection('connected')
    expect(manager.status().connection).toBe('disabled')
  })
  it('does not reuse a secret when account or provider changes', async () => {
    await manager.initialize()
    await expect(manager.save({ config: { ...config(), accountId: 'cli_abcdef1234567890', enabled: true } })).rejects.toThrow('SECRET_REQUIRED')
    await expect(manager.save({ config: { ...config(), provider: 'another-im', enabled: true } })).rejects.toThrow('SECRET_REQUIRED')
    expect(write).not.toHaveBeenCalled()
  })
  it('supports a registered alternative adapter without changing terminal routing', async () => {
    await manager.initialize()
    const status = await manager.save({ config: { ...config(), provider: 'another-im', accountId: 'account', enabled: true }, appSecret: 'provider-secret' })
    expect(status.connection).toBe('connected'); expect(contexts[0].accountId).toBe('account')
    manager.shutdown()
  })
  it('requires explicit user and terminal authorization before enabling', () => {
    expect(() => normalizeGatewayConfig({ ...config(), allowedUserIds: [], enabled: true })).toThrow('AUTHORIZATION_REQUIRED')
    expect(() => normalizeGatewayConfig({ ...config(), allowedAssetIds: [], enabled: true })).toThrow('AUTHORIZATION_REQUIRED')
    expect(() => normalizeGatewayConfig({ ...config(), accountId: 'wrong' })).toThrow('APP_ID_INVALID')
    expect(() => normalizeGatewayConfig({ ...config(), allowedUserIds: ['*', 'bad\nvalue'] })).toThrow('ALLOWLIST_INVALID')
  })
  it('rejects encryption failures without saving or opening a connection', async () => {
    await manager.initialize(); encrypt.mockImplementation(() => { throw new Error('IM_GATEWAY_KEYCHAIN_UNAVAILABLE') })
    await expect(manager.save({ config: { ...config(), enabled: true }, appSecret: 'secret' })).rejects.toThrow('KEYCHAIN_UNAVAILABLE')
    expect(write).not.toHaveBeenCalled(); expect(contexts).toHaveLength(0)
  })
  it('cleans up a failed start and permits a later retry', async () => {
    const failedStop = vi.fn()
    factory = () => ({ start: async () => { throw new Error('credentials') }, stop: failedStop, reply: async () => {} })
    manager = make(); await manager.initialize()
    expect((await manager.save({ config: { ...config(), enabled: true } })).connection).toBe('error')
    expect(failedStop).toHaveBeenCalledOnce()
    manager.shutdown()
  })
  it('stays stopped when persistence fails while applying a change', async () => {
    await manager.initialize(); await manager.save({ config: { ...config(), enabled: true } })
    write.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(manager.save({ config: config() })).rejects.toThrow('disk full')
    expect(manager.status().connection).toBe('disabled')
    expect(stops[0]).toHaveBeenCalledOnce(); manager.shutdown()
  })
  it('ignores events from an adapter with the wrong provider/account identity', async () => {
    await manager.initialize(); await manager.save({ config: { ...config(), enabled: true } })
    await receive({ provider: 'wrong', accountId: 'other', tenantId: 't', senderId: 'ou_user', conversationId: 'chat', conversationType: 'direct', messageId: 'id', createdAt: Date.now(), text: '/bind anything' })
    expect(manager.status().pending).toBe(0); expect(manager.status().lastMessageAt).toBeUndefined()
    manager.shutdown()
  })
  it('closes an adapter whose asynchronous creation finishes after shutdown', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }); const stop = vi.fn(); const start = vi.fn()
    let entered!: () => void
    const creating = new Promise<void>(resolve => { entered = resolve })
    factory = async () => { entered(); await gate; return { start, stop, reply: async () => {} } }
    manager = make(); await manager.initialize()
    const saving = manager.save({ config: { ...config(), enabled: true } })
    await creating; manager.shutdown(); release(); await saving
    expect(stop).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled()
  })
})
