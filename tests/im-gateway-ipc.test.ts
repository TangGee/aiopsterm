import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImGatewayConfig } from '../src/shared/contracts/imGateway'
const env = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), saved: null as any, encryption: true, stopped: vi.fn(), quit: null as null | (() => void), receive: null as null | ((message: any) => Promise<void>) }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/unused-im-gateway-test', once: (_event: string, handler: () => void) => { env.quit = handler } },
  safeStorage: { isEncryptionAvailable: () => env.encryption, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (value: string) => Buffer.from(`encrypted:${value}`), decryptString: (value: Buffer) => value.toString().slice(10) }
}))
vi.mock('electron-store', () => ({ default: class {
  constructor(options: any) { env.saved ||= structuredClone(options.defaults) }
  get(key: string) { return env.saved[key] }
  set(value: any) { Object.assign(env.saved, value) }
} }))
vi.mock('../src/main/backend/imGateway/gatewayState', async original => {
  const real = await original<typeof import('../src/main/backend/imGateway/gatewayState')>()
  return { ...real, GatewayStateStore: class extends real.GatewayStateStore { constructor() { super() } } }
})
vi.mock('../src/main/backend/imGateway/feishuAdapter.js', () => ({ createFeishuAdapter: (context: any) => ({ start: async (handler: any) => { env.receive = handler; context.connection('connected') }, stop: env.stopped, reply: async () => {} }) }))
vi.mock('../src/main/backend/control/controlSocket', () => ({ invokeControlSocketMethod: vi.fn(async () => ({ ok: true, data: { terminals: [{ panelId: 'p', sessionId: 's', title: 'Host', kind: 'ssh', assetId: 'asset', connected: true }] } })) }))
vi.mock('../src/main/backend/app/runtimeLog', () => ({ logRuntimeEvent: vi.fn() }))
import { registerImGatewayIpc } from '../src/main/ipc/imGateway'
import { invokeControlSocketMethod } from '../src/main/backend/control/controlSocket'
import { logRuntimeEvent } from '../src/main/backend/app/runtimeLog'
beforeEach(() => { env.handlers.clear(); env.saved = null; env.encryption = true; vi.clearAllMocks() })
const call = (name: string, value?: unknown) => env.handlers.get(`im-gateway:${name}`)!({}, value)
const config = () => ({ ...defaultImGatewayConfig, enabled: true, accountId: 'cli_1234567890abcdef', allowedUserIds: ['ou_user'], allowedAssetIds: ['asset'] })
describe('IM gateway IPC', () => {
  it('registers desktop settings, persists only encrypted credentials and stops on exit', async () => {
    registerImGatewayIpc({ handle: (name: string, handler: any) => env.handlers.set(name, handler) } as any)
    expect(await call('status')).toMatchObject({ connection: 'disabled', hasAppSecret: false })
    expect(await call('save', { config: config(), appSecret: 'test-secret' })).toMatchObject({ ok: true, status: { connection: 'connected', hasAppSecret: true } })
    expect(JSON.stringify(env.saved)).not.toContain('test-secret')
    expect(JSON.stringify(await call('status'))).not.toContain(env.saved.encryptedSecret)
    expect(await call('terminals')).toMatchObject({ ok: true, terminals: [{ sessionId: 's', assetId: 'asset' }] })
    const incoming = { provider: 'feishu', accountId: config().accountId, tenantId: 'tenant', conversationId: 'chat', senderId: 'ou_user', conversationType: 'direct', createdAt: Date.now() }
    await env.receive!({ ...incoming, messageId: 'bind', text: '/bind s' })
    await vi.waitFor(async () => expect((await call('status')).pending).toBe(0))
    await env.receive!({ ...incoming, messageId: 'command', text: '/run echo private-content' })
    await vi.waitFor(async () => expect((await call('status')).pending).toBe(0))
    expect(invokeControlSocketMethod).toHaveBeenCalledWith('terminal.send_text', { sessionId: 's', text: 'echo private-content\r' })
    expect(logRuntimeEvent).toHaveBeenCalledWith('info', 'im.gateway.accepted', expect.objectContaining({ action: '/run', messageId: 'command' }))
    expect(JSON.stringify(vi.mocked(logRuntimeEvent).mock.calls)).not.toContain('private-content')
    expect(JSON.stringify(vi.mocked(logRuntimeEvent).mock.calls)).not.toContain('test-secret')
    env.quit?.(); expect(env.stopped).toHaveBeenCalledOnce()
  })
  it('rejects unavailable encryption and malformed settings without leaking raw errors', async () => {
    registerImGatewayIpc({ handle: (name: string, handler: any) => env.handlers.set(name, handler) } as any)
    env.encryption = false
    expect(await call('save', { config: config(), appSecret: 'secret' })).toEqual({ ok: false, error: 'IM_GATEWAY_KEYCHAIN_UNAVAILABLE' })
    expect(await call('save', {})).toEqual({ ok: false, error: 'IM_GATEWAY_CONFIG_INVALID' })
    expect((await call('status')).connection).toBe('disabled')
    env.quit?.()
  })
})
