import { createHash } from 'crypto'
import { setTimeout as delay } from 'timers/promises'
import { Client, WSClient, EventDispatcher, Domain, AppType, defaultHttpInstance, type EventHandles } from '@larksuiteoapi/node-sdk'
import type { GatewayAdapterFactory, GatewayMessage } from './gatewayTypes'

type FeishuEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]
export const normalizeFeishuMessage = (event: FeishuEvent, appId: string, botOpenId?: string): GatewayMessage | null => {
  if (!event || (event.app_id && event.app_id !== appId) || event.sender?.sender_type !== 'user') return null
  const message = event.message
  const senderId = event.sender?.sender_id?.open_id
  const tenantId = event.tenant_key || event.sender?.tenant_key
  if (!message || message.message_type !== 'text' || !['p2p', 'group'].includes(message.chat_type)) return null
  if (![senderId, tenantId, message.chat_id, message.message_id].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512)) return null
  try {
    if (typeof message.content !== 'string' || message.content.length > 16384) return null
    const content = JSON.parse(message.content)
    if (typeof content.text !== 'string') return null
    // Group messages must explicitly mention a bot. Allowlisting the chat is still enforced by the gateway.
    if (message.chat_type === 'group' && (!botOpenId || !message.mentions?.some(mention => mention.id?.open_id === botOpenId))) return null
    let text = content.text as string
    for (const mention of message.mentions || []) {
      if (mention.id?.open_id === botOpenId && text.trimStart().startsWith(mention.key)) text = text.trimStart().slice(mention.key.length).trimStart()
    }
    return { provider: 'feishu', accountId: appId, tenantId: tenantId!, senderId: senderId!, conversationId: message.chat_id, messageId: message.message_id, conversationType: message.chat_type === 'p2p' ? 'direct' : 'group', createdAt: Number(message.create_time), text }
  } catch { return null }
}

// Never pass SDK request/response objects to application logs: they can contain credentials and message bodies.
const quietLogger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }
export const createFeishuAdapter: GatewayAdapterFactory = ({ accountId, secret, connection }) => {
  const abort = new AbortController()
  const http = defaultHttpInstance.create({ timeout: 15000, signal: abort.signal })
  http.interceptors.response.use(response => response.data)
  const config = { appId: accountId, appSecret: secret, domain: Domain.Feishu, logger: quietLogger, httpInstance: http }
  const client = new Client({ ...config, appType: AppType.SelfBuild })
  const ws = new WSClient({ ...config, autoReconnect: true, handshakeTimeoutMs: 15000,
    onReady: () => { if (!abort.signal.aborted) connection('connected') },
    onReconnected: () => { if (!abort.signal.aborted) connection('connected') },
    onReconnecting: () => { if (!abort.signal.aborted) connection('reconnecting') },
    onError: () => { if (!abort.signal.aborted) connection('error', 'FEISHU_CONNECTION_FAILED') }
  })
  let replyQueue = Promise.resolve()
  let lastReplyAt = 0
  return {
    start: async receive => {
      connection('connecting')
      const identity = await client.request<{ code: number; bot?: { open_id?: string } }>({ method: 'GET', url: '/open-apis/bot/v3/info' })
      if (abort.signal.aborted) return
      if (identity.code !== 0 || !identity.bot?.open_id) throw new Error('FEISHU_BOT_UNAVAILABLE')
      const botOpenId = identity.bot.open_id
      await ws.start({ eventDispatcher: new EventDispatcher({ logger: quietLogger }).register({
        'im.message.receive_v1': async event => {
          if (abort.signal.aborted) return
          const message = normalizeFeishuMessage(event, accountId, botOpenId)
          if (message) await receive(message)
        }
      }) })
    },
    stop: () => { abort.abort(); ws.close({ force: true }) },
    reply: (message, text) => {
      const sending = replyQueue.catch(() => {}).then(async () => {
        const uuid = createHash('sha256').update(`${accountId}:${message.messageId}`).digest('hex').slice(0, 32)
        for (let attempt = 0; attempt < 3; attempt++) {
          await delay(Math.max(0, 250 - (Date.now() - lastReplyAt)), undefined, { signal: abort.signal })
          lastReplyAt = Date.now()
          try {
            const result = await client.im.message.reply({ path: { message_id: message.messageId }, data: { msg_type: 'text', content: JSON.stringify({ text }), uuid } })
            if (result.code !== 0) throw new Error('FEISHU_REPLY_FAILED')
            return
          } catch {
            if (abort.signal.aborted || attempt === 2) throw new Error('FEISHU_REPLY_FAILED')
            await delay(500 * (attempt + 1), undefined, { signal: abort.signal })
          }
        }
      })
      replyQueue = sending
      return sending
    }
  }
}
