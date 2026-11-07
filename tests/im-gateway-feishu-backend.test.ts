import { beforeEach, describe, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({
  options: null as any, dispatcher: null as any, httpOptions: null as any,
  image: vi.fn(), request: vi.fn(), create: vi.fn(), patch: vi.fn(), reply: vi.fn(), close: vi.fn(), start: vi.fn()
}))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 0 }, AppType: { SelfBuild: 0 },
  defaultHttpInstance: { create: (options: any) => { sdk.httpOptions = options; return { interceptors: { response: { use: vi.fn() } } } } },
  Client: class { request = sdk.request; im = { image: { create: sdk.image }, message: { reply: sdk.reply, create: sdk.create, patch: sdk.patch } } },
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
beforeEach(() => { vi.clearAllMocks(); sdk.request.mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } }); sdk.reply.mockResolvedValue({ code: 0 }); sdk.create.mockResolvedValue({ code: 0, data: { message_id: 'output-card' } }); sdk.patch.mockResolvedValue({ code: 0 }) })
describe('Feishu adapter', () => {
  it('uploads a PNG then replies with its image key, reusing the reply ID on retry', async () => {
    sdk.image.mockResolvedValue({ image_key: 'image-key' })
    sdk.reply.mockRejectedValueOnce(new Error('network'))
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await adapter.reply(normalizeFeishuMessage(event(), appId)!, { image: 'data:image/png;base64,aW1hZ2U=' })
    expect(sdk.image).toHaveBeenCalledOnce()
    expect(sdk.image.mock.calls[0][0].data).toEqual({ image_type: 'message', image: Buffer.from('image') })
    expect(sdk.reply).toHaveBeenCalledTimes(2)
    expect(sdk.reply.mock.calls[0][0]).toEqual(sdk.reply.mock.calls[1][0])
    expect(sdk.reply.mock.calls[0][0].data).toMatchObject({ msg_type: 'image', content: '{"image_key":"image-key"}' })
    adapter.stop()
  })
  it('replies with a useful error when image upload fails and sends no invalid image', async () => {
    sdk.image.mockResolvedValue(null)
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await adapter.reply(normalizeFeishuMessage(event(), appId)!, { image: 'data:image/png;base64,aW1hZ2U=' })
    expect(sdk.reply.mock.calls[0][0].data.msg_type).toBe('text')
    expect(sdk.reply.mock.calls[0][0].data.content).toContain('截图上传失败')
    adapter.stop()
  })
  it('discards an uploaded screenshot when authorization changes during upload', async () => {
    let valid = true
    sdk.image.mockImplementation(async () => { valid = false; return { image_key: 'private-image' } })
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await adapter.reply(normalizeFeishuMessage(event(), appId)!, { image: 'data:image/png;base64,aW1hZ2U=', valid: async () => valid })
    expect(sdk.image).toHaveBeenCalledOnce(); expect(sdk.reply).not.toHaveBeenCalled()
    adapter.stop()
  })
  it('does not upload or send a screenshot after binding authorization changes', async () => {
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await adapter.reply(normalizeFeishuMessage(event(), appId)!, { image: 'data:image/png;base64,aW1hZ2U=', valid: async () => false })
    expect(sdk.image).not.toHaveBeenCalled(); expect(sdk.reply).not.toHaveBeenCalled()
    adapter.stop()
  })
  it('creates a plain-text output card and patches its exact message ID on subsequent screens', async () => {
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    const message = normalizeFeishuMessage(event(), appId)!
    const id = await adapter.sendScreen!(message, 'First <at user_id="all"> literal')
    expect(id).toBe('output-card')
    const data = sdk.create.mock.calls[0][0].data
    expect(data).toMatchObject({ msg_type: 'interactive', receive_id: 'oc_chat' })
    expect(JSON.parse(data.content)).toMatchObject({ config: { update_multi: true }, elements: [{ tag: 'div', text: { tag: 'plain_text', content: 'First <at user_id="all"> literal' } }] })
    sdk.patch.mockRejectedValueOnce(new Error('network'))
    expect(await adapter.sendScreen!(message, 'Final answer', id)).toBe(id)
    expect(sdk.create).toHaveBeenCalledOnce()
    expect(sdk.patch).toHaveBeenCalledTimes(2)
    expect(sdk.patch.mock.calls[0][0]).toEqual(sdk.patch.mock.calls[1][0])
    expect(sdk.patch.mock.calls[0][0].path).toEqual({ message_id: id })
    expect(JSON.parse(sdk.patch.mock.calls[0][0].data.content).elements[0].text.content).toBe('Final answer')
    adapter.stop()
  })
  it('does not recreate output messages when card updates are rejected', async () => {
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    sdk.patch.mockResolvedValue({ code: 230001 })
    await expect(adapter.sendScreen!(normalizeFeishuMessage(event(), appId)!, 'answer', 'old-card')).rejects.toThrow('FEISHU_REPLY_FAILED')
    expect(sdk.patch).toHaveBeenCalledTimes(3); expect(sdk.create).not.toHaveBeenCalled()
    adapter.stop()
  })
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
    const connection = vi.fn(); const receive = vi.fn(async (_message: any) => {})
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
  it('sends interactive choices and scopes callbacks to the original user, tenant and chat', async () => {
    const receive = vi.fn(async (_message: any) => {})
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    await adapter.start(receive)
    const message = normalizeFeishuMessage(event(), appId)!
    await adapter.reply(message, { title: '选择终端', text: '请选择', buttons: [{ label: 'Server', token: 'choice' }] })
    const sent = sdk.reply.mock.calls[0][0]
    expect(sent.data.msg_type).toBe('interactive')
    expect(JSON.parse(sent.data.content).elements[1].actions[0]).toMatchObject({ text: { content: 'Server' }, value: { gateway_token: 'choice' } })
    const callback = { operator: { open_id: 'ou_user', tenant_key: 'tenant' }, context: { open_chat_id: 'oc_chat', open_message_id: 'om_card' }, action: { value: { gateway_token: 'choice' } } }
    for (const patch of [{ operator: { open_id: 'intruder' } }, { context: { open_chat_id: 'other', open_message_id: 'om_card' } }, { operator: { open_id: 'ou_user', tenant_key: 'other' } }, { action: { value: { gateway_token: 'forged' } } }]) {
      expect(await sdk.dispatcher.handles['card.action.trigger']({ ...callback, ...patch })).toMatchObject({ toast: { type: 'error' } })
    }
    expect(receive).not.toHaveBeenCalled()
    await sdk.dispatcher.handles['card.action.trigger'](callback)
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'ou_user', conversationType: 'direct', actionToken: 'choice', messageId: 'card:choice', replyToMessageId: 'om_card' }))
    await adapter.reply(receive.mock.calls[0][0], '已绑定')
    expect(sdk.reply).toHaveBeenLastCalledWith(expect.objectContaining({ path: { message_id: 'om_card' } }))
    adapter.stop()
    expect(await sdk.dispatcher.handles['card.action.trigger'](callback)).toMatchObject({ toast: { type: 'error' } })
  })
  it('pushes successive output batches to the bound chat with separate stable retry IDs', async () => {
    const adapter = await createFeishuAdapter({ accountId: appId, secret: 'secret', connection: vi.fn() })
    sdk.create.mockRejectedValueOnce(new Error('offline'))
    const message = normalizeFeishuMessage(event(), appId)!
    await adapter.send!(message, 'output'); await adapter.send!(message, 'output')
    expect(sdk.create).toHaveBeenCalledTimes(3)
    expect(sdk.create.mock.calls[0][0]).toEqual(sdk.create.mock.calls[1][0])
    expect(sdk.create.mock.calls[2][0].data.uuid).not.toBe(sdk.create.mock.calls[0][0].data.uuid)
    expect(sdk.create.mock.calls[0][0]).toMatchObject({ params: { receive_id_type: 'chat_id' }, data: { receive_id: 'oc_chat', content: '{"text":"output"}' } })
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
