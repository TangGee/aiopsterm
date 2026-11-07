import { createHash, randomUUID } from 'crypto'
import { setTimeout as delay } from 'timers/promises'
import { Client, WSClient, EventDispatcher, Domain, AppType, defaultHttpInstance, type EventHandles } from '@larksuiteoapi/node-sdk'
import type { GatewayAdapterFactory, GatewayCard, GatewayMessage, GatewayReply } from './gatewayTypes'

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

export const feishuGatewayCard = (card: GatewayCard) => ({
  config: { wide_screen_mode: true },
  header: { title: { tag: 'plain_text', content: card.title } },
  elements: [
    { tag: 'div', text: { tag: 'plain_text', content: card.text } },
    ...card.buttons.map(button => ({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: button.label }, value: { gateway_token: button.token }, type: 'default' }] }))
  ]
})
export const feishuTerminalScreenCard = (text: string) => ({
  config: { wide_screen_mode: true, update_multi: true },
  header: { title: { tag: 'plain_text', content: '终端输出' } },
  elements: [{ tag: 'div', text: { tag: 'plain_text', content: text } }]
})
type CardAction = {
  app_id?: string
  operator?: { open_id?: string; tenant_key?: string }
  context?: { open_message_id?: string; open_chat_id?: string }
  action?: { value?: { gateway_token?: string } }
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
  const cards = new Map<string, { message: GatewayMessage; expires: number }>()
  const send = (message: GatewayMessage, content: GatewayReply, push = false, previousMessageId?: string, requireMessageId = false) => {
    const uuid = push ? randomUUID().replace(/-/g, '') : createHash('sha256').update(`${accountId}:${message.messageId}`).digest('hex').slice(0, 32)
    if (typeof content !== 'string') {
      for (const [token, card] of cards) if (card.expires < Date.now()) cards.delete(token)
      while (cards.size + content.buttons.length > 2000) cards.delete(cards.keys().next().value!)
      for (const button of content.buttons) cards.set(button.token, { message, expires: Date.now() + 600000 })
    }
    const data = { msg_type: requireMessageId || typeof content !== 'string' ? 'interactive' : 'text', content: JSON.stringify(requireMessageId ? feishuTerminalScreenCard(content as string) : typeof content === 'string' ? { text: content } : feishuGatewayCard(content)), uuid }
    const sending = replyQueue.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await delay(Math.max(0, 250 - (Date.now() - lastReplyAt)), undefined, { signal: abort.signal })
        lastReplyAt = Date.now()
        try {
          const result = previousMessageId
            ? await client.im.message.patch({ path: { message_id: previousMessageId }, data: { content: data.content } })
            : push
              ? await client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { ...data, receive_id: message.conversationId } })
              : await client.im.message.reply({ path: { message_id: message.replyToMessageId || message.messageId }, data })
          if (result.code !== 0) throw new Error('FEISHU_REPLY_FAILED')
          const messageId = previousMessageId || (result.data && 'message_id' in result.data ? result.data.message_id : undefined)
          if (requireMessageId && (typeof messageId !== 'string' || !messageId)) throw new Error('FEISHU_REPLY_FAILED')
          return typeof messageId === 'string' ? messageId : undefined
        } catch {
          if (abort.signal.aborted || attempt === 2) throw new Error('FEISHU_REPLY_FAILED')
          await delay(500 * (attempt + 1), undefined, { signal: abort.signal })
        }
      }
    })
    replyQueue = sending.then(() => {}, () => {})
    return sending
  }
  return {
    start: async receive => {
      connection('connecting')
      const identity = await client.request<{ code: number; bot?: { open_id?: string } }>({ method: 'GET', url: '/open-apis/bot/v3/info' })
      if (abort.signal.aborted) return
      if (identity.code !== 0 || !identity.bot?.open_id) throw new Error('FEISHU_BOT_UNAVAILABLE')
      const botOpenId = identity.bot.open_id
      await ws.start({ eventDispatcher: new EventDispatcher({ logger: quietLogger }).register({
        'card.action.trigger': async (event: CardAction) => {
          const token = event.action?.value?.gateway_token
          const card = typeof token === 'string' ? cards.get(token) : undefined
          if (abort.signal.aborted || !card || card.expires < Date.now() || event.app_id && event.app_id !== accountId ||
            event.operator?.open_id !== card.message.senderId || event.context?.open_chat_id !== card.message.conversationId ||
            event.operator?.tenant_key && event.operator.tenant_key !== card.message.tenantId || !event.context?.open_message_id) {
            return { toast: { type: 'error', content: '卡片已过期或不属于你，请发送 /sessions。' } }
          }
          await receive({ ...card.message, messageId: `card:${token}`, replyToMessageId: event.context.open_message_id, createdAt: Date.now(), text: '', actionToken: token })
          return { toast: { type: 'info', content: '已接收，请查看机器人回复。' } }
        },
        'im.message.receive_v1': async event => {
          if (abort.signal.aborted) return
          const message = normalizeFeishuMessage(event, accountId, botOpenId)
          if (message) await receive(message)
        }
      }) })
    },
    stop: () => { abort.abort(); cards.clear(); ws.close({ force: true }) },
    reply: async (message, content) => { await send(message, content) },
    send: async (message, text) => { await send(message, text, true) },
    sendScreen: async (message, text, previousMessageId) => {
      const messageId = await send(message, text, true, previousMessageId, true)
      if (!messageId) throw new Error('FEISHU_REPLY_FAILED')
      return messageId
    }
  }
}
