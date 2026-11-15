import { setTimeout as delay } from 'node:timers/promises'
import type { GatewayAdapter, GatewayAdapterFactory, GatewayMessage, GatewayReply } from './gatewayTypes'
import { AdapterQueue, gatewayId, pngBytes, textChunks } from './adapterUtils'

type TelegramMessage = {
  message_id?: number; date?: number; text?: string
  chat?: { id?: number; type?: string }
  from?: { id?: number; is_bot?: boolean }
  sender_chat?: unknown; message_thread_id?: number
}
type TelegramUpdate = {
  update_id: number; message?: TelegramMessage
  callback_query?: { id: string; data?: string; from?: { id?: number; is_bot?: boolean }; message?: TelegramMessage }
}

export const normalizeTelegramMessage = (raw: TelegramMessage, accountId: string, username: string): GatewayMessage | undefined => {
  const senderId = gatewayId(raw.from?.id); const chatId = gatewayId(raw.chat?.id)
  if (!senderId || !chatId || raw.from?.is_bot !== false || raw.sender_chat || raw.message_thread_id || !Number.isSafeInteger(raw.message_id) || !Number.isFinite(raw.date) || typeof raw.text !== 'string') return
  const direct = raw.chat?.type === 'private'
  if (!direct && !['group', 'supergroup'].includes(raw.chat?.type || '')) return
  let text = raw.text
  const command = /^(\/[a-z]+)@([a-z0-9_]+)(?=\s|$)/i.exec(text)
  if (command) {
    if (command[2].toLowerCase() !== username.toLowerCase()) return
    text = command[1] + text.slice(command[0].length)
  } else if (!direct) {
    const mention = /^@([a-z0-9_]+)\s+/i.exec(text)
    if (!mention || mention[1].toLowerCase() !== username.toLowerCase()) return
    text = text.slice(mention[0].length)
  }
  return { provider: 'telegram', accountId, tenantId: accountId, senderId, conversationId: chatId, conversationType: direct ? 'direct' : 'group', messageId: `${chatId}:${raw.message_id}`, createdAt: raw.date! * 1000, text }
}

type Context = Parameters<GatewayAdapterFactory>[0]
type ApiResult = { ok: boolean; result?: any; error_code?: number; description?: string }

export const createTelegramAdapter = (context: Context, request: typeof fetch = fetch): GatewayAdapter => {
  const queue = new AdapterQueue(1000)
  const cards = new Map<string, { message: GatewayMessage; expires: number; cardId: string }>()
  let username = ''; let offset = 0
  const api = async (method: string, body: Record<string, unknown> | FormData): Promise<any> => {
    if (queue.stopped) throw new Error('IM_GATEWAY_STOPPED')
    try {
      const multipart = body instanceof FormData
      const response = await request(`https://api.telegram.org/bot${context.secret}/${method}`, {
        method: 'POST', redirect: 'error',
        headers: multipart ? undefined : { 'Content-Type': 'application/json' },
        body: multipart ? body : JSON.stringify(body),
        signal: AbortSignal.any([queue.abort.signal, AbortSignal.timeout(method === 'getUpdates' ? 35000 : 15000)])
      })
      const value = await response.json() as ApiResult
      if (!value.ok) {
        if (method === 'editMessageText' && value.error_code === 400 && value.description?.includes('message is not modified')) return true
        throw new Error('IM_GATEWAY_TELEGRAM_REQUEST_FAILED')
      }
      return value.result
    } catch { throw new Error('IM_GATEWAY_TELEGRAM_REQUEST_FAILED') }
  }
  const sendText = async (message: GatewayMessage, text: string) => {
    for (const chunk of textChunks(text, 4000)) await queue.run(() => api('sendMessage', { chat_id: message.conversationId, text: chunk, link_preview_options: { is_disabled: true } }))
  }
  const receiveUpdate = async (update: TelegramUpdate, receive: (message: GatewayMessage) => Promise<void>) => {
    if (queue.stopped) return
    if (update.message) {
      const message = normalizeTelegramMessage(update.message, context.accountId, username)
      if (message) await receive(message)
    }
    const action = update.callback_query
    if (!action) return
    const saved = cards.get(action.data || '')
    const valid = saved && saved.expires > Date.now() && action.from?.is_bot === false && gatewayId(action.from.id) === saved.message.senderId && gatewayId(action.message?.chat?.id) === saved.message.conversationId && String(action.message?.message_id) === saved.cardId
    if (valid) {
      cards.delete(action.data!)
      await receive({ ...saved.message, messageId: `card:${action.data}`, createdAt: Date.now(), actionToken: action.data, text: '' })
    }
    await api('answerCallbackQuery', { callback_query_id: action.id, ...(valid ? {} : { text: '选择已失效或不属于当前用户，请重新发送 /sessions。' }) })
  }
  const poll = async (receive: (message: GatewayMessage) => Promise<void>) => {
    while (!queue.stopped) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, limit: 50, allowed_updates: ['message', 'callback_query'] }) as TelegramUpdate[]
        if (queue.stopped) return
        if (!Array.isArray(updates)) throw new Error('IM_GATEWAY_TELEGRAM_RESPONSE_INVALID')
        context.connection('connected')
        for (const update of updates) {
          if (!Number.isSafeInteger(update.update_id) || update.update_id < offset) continue
          await receiveUpdate(update, receive)
          offset = update.update_id + 1
        }
      } catch {
        if (queue.stopped) return
        context.connection('reconnecting', 'IM_GATEWAY_TELEGRAM_CONNECTION_FAILED')
        await delay(3000, undefined, { signal: queue.abort.signal }).catch(() => {})
      }
    }
  }
  const reply = async (message: GatewayMessage, value: GatewayReply) => {
    if (typeof value === 'string') return sendText(message, value)
    if ('image' in value) {
      try {
        await queue.run(async () => {
          if (value.valid && !await value.valid()) return
          const bytes = pngBytes(value.image)
          const form = new FormData()
          form.set('chat_id', message.conversationId)
          form.set('document', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'terminal.png')
          if (queue.stopped || value.valid && !await value.valid()) return
          // A PNG document preserves terminal text and avoids photo aspect-ratio limits.
          await api('sendDocument', form)
        })
      } catch {
        if (!queue.stopped && (!value.valid || await value.valid())) await sendText(message, '截图发送失败，请检查机器人发送文件权限和网络，或使用 /read。')
      }
      return
    }
    await queue.run(async () => {
      for (const [token, item] of cards) if (item.expires <= Date.now()) cards.delete(token)
      while (cards.size + value.buttons.length > 2000) cards.delete(cards.keys().next().value!)
      const result = await api('sendMessage', { chat_id: message.conversationId, text: `${value.title}\n${value.text}`.slice(0, 4000), reply_markup: { inline_keyboard: value.buttons.map(button => [{ text: button.label, callback_data: button.token }]) } })
      if (queue.stopped) return
      for (const button of value.buttons) cards.set(button.token, { message, cardId: String(result.message_id), expires: Date.now() + 600000 })
    })
  }
  return {
    async start(receive) {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(context.secret) || context.secret.split(':')[0] !== context.accountId) throw new Error('IM_GATEWAY_TELEGRAM_TOKEN_INVALID')
      context.connection('connecting')
      const bot = await api('getMe', {})
      if (queue.stopped) return
      if (String(bot.id) !== context.accountId || !bot.is_bot || !/^[a-z0-9_]+$/i.test(bot.username)) throw new Error('IM_GATEWAY_TELEGRAM_ACCOUNT_INVALID')
      username = bot.username
      const webhook = await api('getWebhookInfo', {})
      if (queue.stopped) return
      if (webhook.url) throw new Error('IM_GATEWAY_TELEGRAM_WEBHOOK_CONFLICT')
      context.connection('connected')
      void poll(receive)
    },
    stop() { queue.stop(); cards.clear() },
    reply, send: sendText,
    async sendScreen(message, text, previousMessageId) {
      const visible = text.length > 4000 ? '[仅显示末尾屏幕内容]\n' + text.slice(-3960) : text
      return queue.run(async () => {
        if (previousMessageId) {
          await api('editMessageText', { chat_id: message.conversationId, message_id: Number(previousMessageId), text: visible, link_preview_options: { is_disabled: true } })
          return previousMessageId
        }
        const result = await api('sendMessage', { chat_id: message.conversationId, text: visible, link_preview_options: { is_disabled: true } })
        return String(result.message_id)
      })
    }
  }
}
