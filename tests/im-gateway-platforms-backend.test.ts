import { WSClient, Logger, type EventDispatcher } from '@core-workspace/infoflow-sdk-nodejs'
import { guardInfoflowSocketErrors } from '../src/main/backend/imGateway/infoflowSocket'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayCore } from '../src/main/backend/imGateway/gatewayCore'
import { GatewayStateStore } from '../src/main/backend/imGateway/gatewayState'
import { normalizeInfoflowMessage } from '../src/main/backend/imGateway/infoflowAdapter'
import { normalizeTelegramMessage } from '../src/main/backend/imGateway/telegramAdapter'
import type { GatewayCard, GatewayMessage, GatewayReply } from '../src/main/backend/imGateway/gatewayTypes'

let core: GatewayCore
afterEach(() => core?.stop())
describe('new platform terminal integration', () => {
  it('handles the real SDK second error emission without an unhandled rejection', async () => {
    class QuietLogger extends Logger { error() {} warn() {} info() {} debug() {} trace() {} }
    const socket = new WSClient({ appId: 'test-app-key', appSecret: 'test-secret', logger: new QuietLogger() })
    const handler = vi.fn()
    socket.on('error', handler)
    const dispatcher = Reflect.get(socket, 'eventDispatcher') as EventDispatcher
    await expect(dispatcher.dispatch('error', { error: new Error('offline') })).rejects.toThrow()
    guardInfoflowSocketErrors(socket)
    await expect(dispatcher.dispatch('error', { error: new Error('offline') })).resolves.toBeUndefined()
    expect(handler).toHaveBeenCalledTimes(2)
    socket.disconnect()
  })
  it.each(['telegram', 'infoflow'])('%s retains binding, key, deduplication and disconnect checks', async provider => {
    let id = 0; let connected = true
    const replies: GatewayReply[] = []
    const write = vi.fn(async () => {})
    const fromText = (text: string): GatewayMessage => provider === 'telegram'
      ? normalizeTelegramMessage({ message_id: ++id, date: Date.now() / 1000, text, chat: { id: 7, type: 'private' }, from: { id: 7, is_bot: false } }, '99', 'demo_bot')!
      : normalizeInfoflowMessage({ type: 'private.text', timestamp: Date.now(), data: { chatType: 'private', msgType: 'text', raw: { MsgId: String(++id), CreateTime: Date.now() / 1000, FromUserId: '7', FromUserName: 'alice', Content: text } } }, '99')!
    core = new GatewayCore({
      policy: () => ({ allowedUserIds: ['7', '8'], allowedGroupIds: [], allowedAssetIds: [], allowLocalTerminal: true }),
      state: new GatewayStateStore(),
      terminal: { list: async () => [{ sessionId: 'session', panelId: 'panel', title: 'Local', kind: 'local', active: true, connected }], read: async () => 'screen', write },
      reply: async (_message, reply) => { replies.push(reply) }, audit: vi.fn()
    })
    const receive = async (message: GatewayMessage) => { await core.receive(message); await core.drain() }
    await receive(fromText('/sessions'))
    const card = replies.at(-1) as GatewayCard
    const token = card.buttons[0].token
    const choice = fromText(`/select ${token}`)
    choice.actionToken = token
    await receive({ ...choice, messageId: 'wrong-user', senderId: '8' })
    expect(replies.at(-1)).toContain('过期')
    await receive(choice)
    expect(replies.at(-1)).toContain('已绑定')
    const command = fromText('pwd')
    await receive(command); await receive(command)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenLastCalledWith({ sessionId: 'session', panelId: 'panel' }, 'pwd\r')
    await receive(fromText('/key ctrl c'))
    expect(write).toHaveBeenLastCalledWith({ sessionId: 'session', panelId: 'panel' }, '\x03')
    await receive(fromText('/key ctrl alt c'))
    expect(write).toHaveBeenLastCalledWith({ sessionId: 'session', panelId: 'panel' }, '\x1b\x03')
    connected = false
    await receive(fromText('ls'))
    expect(write).toHaveBeenCalledTimes(3)
    expect(replies.at(-1)).toContain('已断开')
    expect(replies.at(-1)).toContain('本条消息未写入终端')
  })
})
