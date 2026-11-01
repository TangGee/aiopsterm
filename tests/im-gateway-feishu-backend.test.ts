import { beforeEach, describe, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({
  options: null as any, dispatcher: null as any, httpOptions: null as any,
  request: vi.fn(), reply: vi.fn(), close: vi.fn(), start: vi.fn()
}))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 0 }, AppType: { SelfBuild: 0 },
  defaultHttpInstance: { create: (options: any) => { sdk.httpOptions = options; return { interceptors: { response: { use: vi.fn() } } } } },
  Client: class { request = sdk.request; im = { message: { reply: sdk.reply } } },
  WSClient: class {
    constructor(options: any) { sdk.options = options }
    start = async (options: any) => { sdk.dispatcher = options.eventDispatcher; sdk.start() }
    close = sdk.close
  },
  EventDispatcher: class {
    handles: any
    register(handlers: any) { this.handles = handlers; return this }
  }
}))
import { createFeishuAdapter, normalizeFeishuMessage } from '../src/main/backend/imGateway/feishuAdapter'
const appId = 'cli_1234567890abcdef'
const event = (patch: any = {}) => ({ app_id: appId, tenant_key: 'tenant', sender: { sender_type: 'user', sender_id: { open_id: 'ou_user' } }, message: { chat_id: 'oc_chat', message_id: 'om_message', message_type: 'text', chat_type: 'p2p', create_time: '1800000000000', content: '{"text":"/sessions"}' }, ...patch })
beforeEach(() => { vi.clearAllMocks(); sdk.request.mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } }); sdk.reply.mockResolvedValue({ code: 0 }) })
describe('Feishu adapter', () => {
  it('normalizes text identity and ignores bot, other-app and malformed messages', () => {
    expect(normalizeFeishuMessage(event(), appId)).toMatchObject({ provider: 'feishu', accountId: appId, tenantId: 'tenant', senderId: 'ou_user', conversationId: 'oc_chat', messageId: 'om_message', text: '/sessions' })
    expect(normalizeFeishuMessage(event({ app_id: 'another-app' }), appId)).toBeNull()
    expect(normalizeFeishuMessage(event({ sender: { sender_type: 'app' } }), appId)).toBeNull()
    expect(normalizeFeishuMessage(event({ message: { ...event().message, content: '{broken' } }), appId)).toBeNull()
    expect(normalizeFeishuMessage(event({ message: { ...event().message, message_type: 'image' } }), appId)).toBeNull()
  })
  it('requires mention of this exact bot in groups and strips only its prefix', () => {
    const data = event({ message: { ...event().message, chat_type: 'group', content: '{"text":"@_user_1 /run pwd"}', mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' } }] } })
    expect(normalizeFeishuMessage(data, appId, 'ou_bot')?.text).toBe('/run pwd')
    expect(normalizeFeishuMessage(data, appId, 'another-bot')).toBeNull()
    expect(normalizeFeishuMessage(data, appId)).toBeNull()
    data.message.content = '{"text":"/send keep @_user_1"}'
    expect(normalizeFeishuMessage(data, appId, 'ou_bot')?.text).toBe('/send keep @_user_1')
  })
  it('waits for a real SDK readiness callback and cleans up on stop', async () => {
    const connection = vi.fn(); const receive = vi.fn(async () => {})
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'private-secret', connection })
    await adapter.start(receive)
    expect(connection).toHaveBeenLastCalledWith('connecting')
    expect(sdk.request).toHaveBeenCalledWith({ method: 'GET', url: '/open-apis/bot/v3/info' })
    sdk.options.onReady(); expect(connection).toHaveBeenLastCalledWith('connected')
    await sdk.dispatcher.handles['im.message.receive_v1'](event())
    expect(receive).toHaveBeenCalledOnce()
    sdk.options.onReconnecting(); expect(connection).toHaveBeenLastCalledWith('reconnecting')
    adapter.stop(); sdk.options.onReconnected()
    expect(connection).toHaveBeenLastCalledWith('reconnecting')
    expect(sdk.close).toHaveBeenCalledWith({ force: true })
    expect(sdk.httpOptions.signal.aborted).toBe(true)
    expect(sdk.httpOptions.timeout).toBe(15000)
  })
  it('retries reply delivery with the same idempotency key without invoking a terminal', async () => {
    sdk.reply.mockRejectedValueOnce(new Error('network'))
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    const message = normalizeFeishuMessage(event(), appId)!
    await adapter.reply(message, 'reply text')
    expect(sdk.reply).toHaveBeenCalledTimes(2)
    expect(sdk.reply.mock.calls[0][0]).toEqual(sdk.reply.mock.calls[1][0])
    expect(sdk.reply.mock.calls[0][0]).toMatchObject({ path: { message_id: 'om_message' }, data: { content: '{"text":"reply text"}', msg_type: 'text' } })
    adapter.stop()
  })
  it('rejects bot identity lookup failures and suppresses credential-bearing SDK logs', async () => {
    sdk.request.mockResolvedValue({ code: 100, msg: 'secret-value' })
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await expect(adapter.start(vi.fn())).rejects.toThrow('FEISHU_BOT_UNAVAILABLE')
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    sdk.options.logger.error({ appSecret: 'secret' })
    expect(output).not.toHaveBeenCalled(); output.mockRestore(); adapter.stop()
  })
})
