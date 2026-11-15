import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallback } from '@core-workspace/infoflow-sdk-nodejs'
import type { GatewayAdapter, GatewayMessage } from '../src/main/backend/imGateway/gatewayTypes'

const sdk = vi.hoisted(() => ({ handlers: new Map<string, EventCallback>(), connect: vi.fn(), disconnect: vi.fn(), user: vi.fn(), group: vi.fn(), clientOptions: {} as any, wsOptions: {} as any }))
vi.mock('@core-workspace/infoflow-sdk-nodejs', async () => {
  const { EventEmitter } = await import('node:events')
  return ({
  Logger: class {},
  Client: class { im = { message: { sendToUser: sdk.user, sendToGroup: sdk.group } }; constructor(options: any) { sdk.clientOptions = options } },
  WSClient: class {
    eventDispatcher = new EventEmitter()
    getState() { return 'connected' }
    constructor(options: any) { sdk.wsOptions = options }
    on(name: string, handler: EventCallback) { sdk.handlers.set(name, handler); return this }
    connect() { return sdk.connect() }
    disconnect() { sdk.disconnect() }
  }
})})
import { createInfoflowAdapter, normalizeInfoflowMessage } from '../src/main/backend/imGateway/infoflowAdapter'
const event = (raw: any, chatType: 'private' | 'group' = 'private', msgType = 'text'): Parameters<EventCallback>[0] => ({ type: `${chatType}.${msgType}`, timestamp: Date.now(), data: { chatType, msgType, raw } })
const direct = () => ({ MsgId: '10', FromUserId: 'user-id', FromUserName: 'alice', Content: 'pwd', CreateTime: String(Date.now() / 1000) })
const group = () => ({ agentid: 99, groupid: 44, eventtype: 'MESSAGE_RECEIVE', message: { header: { fromuserid: 'user-id', messageid: '9223372036854775810', servertime: Date.now() }, body: [{ type: 'AT', robotid: 99 }, { type: 'TEXT', content: '/sessions' }] } })
let adapter: GatewayAdapter
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); sdk.handlers.clear(); sdk.connect.mockResolvedValue(undefined) })
afterEach(() => { adapter?.stop(); vi.useRealTimers() })
const fixture = async () => {
  const connection = vi.fn(); const receive = vi.fn(async (_message: GatewayMessage) => {})
  adapter = await createInfoflowAdapter({ accountId: '99', appKey: 'app-key', secret: 'secret', connection })
  return { connection, receive }
}
describe('Infoflow gateway', () => {
  it('deduplicates documented private payloads without MsgId deterministically', () => {
    const raw = { ...direct(), MsgId: undefined }
    const first = normalizeInfoflowMessage(event(raw), '99')!
    expect(first.messageId).toContain('hash:')
    expect(normalizeInfoflowMessage(event(raw), '99')!.messageId).toBe(first.messageId)
    expect(normalizeInfoflowMessage(event({ ...raw, Content: 'ls' }), '99')!.messageId).not.toBe(first.messageId)
    expect(normalizeInfoflowMessage(event({ ...raw, CreateTime: String(Number(raw.CreateTime) + 1) }), '99')!.messageId).not.toBe(first.messageId)
  })
  it('routes group text and images only to the normalized group recipient', async () => {
    await fixture()
    const message = normalizeInfoflowMessage(event(group(), 'group'), '99')!
    const sentAt: number[] = []
    sdk.group.mockImplementation(async () => { sentAt.push(Date.now()) })
    await adapter.send!(message, 'screen')
    expect(sdk.group).toHaveBeenCalledWith('44', 'screen')
    const image = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    const pending = adapter.reply(message, { image, valid: async () => true })
    await vi.advanceTimersByTimeAsync(3100); await pending
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(3100)
    expect(sdk.group).toHaveBeenLastCalledWith('44', image.split(',')[1], 'IMAGE')
    expect(sdk.user).not.toHaveBeenCalled()
  })
  it('surfaces a core receipt failure without logging the event or executing it again', async () => {
    const f = await fixture(); f.receive.mockRejectedValue(new Error('storage failed'))
    await adapter.start(f.receive)
    await sdk.handlers.get('private.text')!(event(direct()))
    expect(f.connection).toHaveBeenLastCalledWith('error', 'IM_GATEWAY_INFOFLOW_RECEIVE_FAILED')
    expect(f.receive).toHaveBeenCalledOnce()
    expect(sdk.user).not.toHaveBeenCalled()
  })
  it('bounds a stalled SDK handshake and closes the socket', async () => {
    const f = await fixture()
    sdk.connect.mockImplementation(() => new Promise(() => {}))
    const pending = adapter.start(f.receive).catch(error => error)
    await vi.advanceTimersByTimeAsync(30000)
    expect((await pending).message).toBe('IM_GATEWAY_INFOFLOW_CONNECTION_FAILED')
    expect(sdk.disconnect).toHaveBeenCalled()
  })
  it('separates the stable sender ID from the private reply username', () => {
    expect(normalizeInfoflowMessage(event(direct()), '99')).toMatchObject({ senderId: 'user-id', conversationId: 'alice', messageId: 'private:alice:10', text: 'pwd' })
  })
  it('requires exact bot mentions and preserves large message IDs as strings', () => {
    expect(normalizeInfoflowMessage(event(group(), 'group'), '99')).toMatchObject({ messageId: 'group:44:9223372036854775810', text: '/sessions' })
    const raw = group(); raw.message.body[0].robotid = 100
    expect(normalizeInfoflowMessage(event(raw, 'group'), '99')).toBeUndefined()
    raw.message.body[0].robotid = 99; raw.eventtype = 'ALL_MESSAGE_FORWARD'
    expect(normalizeInfoflowMessage(event(raw, 'group'), '99')).toBeUndefined()
  })
  it.each([{ FromUserName: 'alice|bob' }, { MsgId: '' }, { CreateTime: '' }, { agentid: 100 }, { FromUserId: '' }, { Content: {} }])('rejects ambiguous recipients and incomplete events %j', patch => {
    expect(normalizeInfoflowMessage(event({ ...direct(), ...patch }), '99')).toBeUndefined()
  })
  it('converts only a valid select command into a core action token', () => {
    const token = 'a'.repeat(36)
    expect(normalizeInfoflowMessage(event({ ...direct(), Content: `/select ${token}` }), '99')?.actionToken).toBe(token)
    expect(normalizeInfoflowMessage(event({ ...direct(), Content: '/select session-id' }), '99')?.actionToken).toBeUndefined()
  })
  it('uses App Key for SDK authentication and Agent ID for message delivery, with quiet logs', async () => {
    const f = await fixture(); await adapter.start(f.receive)
    expect(sdk.clientOptions).toMatchObject({ appId: 'app-key', appSecret: 'secret', agentId: '99', timeout: 15000 })
    expect(sdk.wsOptions).toMatchObject({ appId: 'app-key', wsGateway: 'infoflow-open-gateway.baidu.com' })
    const log = vi.spyOn(console, 'log')
    sdk.wsOptions.logger.info('secret'); sdk.clientOptions.logger.error('secret')
    expect(log).not.toHaveBeenCalled(); log.mockRestore()
    await sdk.handlers.get('private.text')!(event(direct()))
    expect(f.receive).toHaveBeenCalledWith(expect.objectContaining({ provider: 'infoflow', text: 'pwd' }))
    adapter.stop(); await sdk.handlers.get('private.text')!(event(direct()))
    expect(f.receive).toHaveBeenCalledOnce()
  })
  it('sends text selections and bounded private PNGs, and reports invalid images', async () => {
    await fixture()
    const message = normalizeInfoflowMessage(event(direct()), '99')!
    const token = 'a'.repeat(36)
    await adapter.reply(message, { title: 'Select', text: 'Choose', buttons: [{ label: 'Local', token }] })
    expect(sdk.user).toHaveBeenCalledWith('alice', expect.stringContaining(`/select ${token}`))
    const image = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    const pending = adapter.reply(message, { image, valid: async () => true })
    await vi.advanceTimersByTimeAsync(500); await pending
    expect(sdk.user).toHaveBeenLastCalledWith('alice', { content: image.split(',')[1] }, 'image')
    const invalid = adapter.reply(message, { image: 'not a png' })
    await vi.advanceTimersByTimeAsync(1000); await invalid
    expect(sdk.user).toHaveBeenLastCalledWith('alice', expect.stringContaining('截图发送失败'))
  })
  it('never sends an image after its binding authorization expires', async () => {
    await fixture()
    await adapter.reply(normalizeInfoflowMessage(event(direct()), '99')!, { image: 'not needed', valid: async () => false })
    expect(sdk.user).not.toHaveBeenCalled()
  })
  it('closes a connection that finishes after stop and ignores late connection events', async () => {
    const f = await fixture()
    let resolve!: () => void
    sdk.connect.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    const pending = adapter.start(f.receive).catch(error => error)
    adapter.stop(); resolve(); await pending
    await sdk.handlers.get('connected')!({ type: 'connected', data: {} } as any)
    expect(sdk.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(f.connection).toHaveBeenCalledTimes(1)
  })
})
