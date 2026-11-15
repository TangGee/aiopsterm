import { Client, Logger, type EventCallback } from '@core-workspace/infoflow-sdk-nodejs'
import { createHash } from 'node:crypto'
import { createInfoflowSocket } from './infoflowSocket'
import type { GatewayAdapter, GatewayAdapterFactory, GatewayMessage } from './gatewayTypes'
import { AdapterQueue, gatewayId, pngBytes, textChunks } from './adapterUtils'

const timestamp = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number < 1e12 ? number * 1000 : number : 0
}

export const normalizeInfoflowMessage = (event: Parameters<EventCallback>[0], accountId: string): GatewayMessage | undefined => {
  const data = event?.data
  if (!data || !('msgType' in data) || !['text', 'mixed'].includes(data.msgType)) return
  const raw = data.raw
  if (!raw || typeof raw !== 'object') return
  const direct = data.chatType === 'private'
  if (!direct && data.chatType !== 'group') return
  if (raw.agentid !== undefined && gatewayId(raw.agentid) !== accountId || raw.AgentID !== undefined && gatewayId(raw.AgentID) !== accountId) return
  let senderId: string; let conversationId: string; let messageId: string; let createdAt: number; let text: string
  if (direct) {
    if (data.msgType !== 'text') return
    senderId = gatewayId(raw.FromUserId ?? raw.fromUserId)
    conversationId = gatewayId(raw.FromUserName ?? raw.fromUserName)
    messageId = gatewayId(raw.MsgId ?? raw.msgId)
    createdAt = timestamp(raw.CreateTime ?? raw.createTime)
    text = raw.Content ?? raw.content
    // The documented private text payload may omit MsgId. Prefer its real ID;
    // otherwise conservatively deduplicate identical sender/time/content tuples.
    if (raw.MsgId === undefined && raw.msgId === undefined && typeof text === 'string') {
      messageId = 'hash:' + createHash('sha256').update(JSON.stringify([accountId, senderId, conversationId, createdAt, text])).digest('hex')
    }
  } else {
    if ((raw.eventtype ?? raw.eventType) !== 'MESSAGE_RECEIVE') return
    const header = raw.message?.header; const body = raw.message?.body
    if (!header || !Array.isArray(body) || body.length > 100 || header.role === 'robot') return
    // Only explicit mentions of this robot may control a group-bound terminal.
    if (!body.some(item => item?.type === 'AT' && gatewayId(item.robotid) === accountId)) return
    if (body.some(item => !item || !['TEXT', 'AT'].includes(item.type) || item.type === 'TEXT' && typeof item.content !== 'string')) return
    senderId = gatewayId(header.fromuserid ?? header.fromUserId)
    conversationId = gatewayId(raw.groupid ?? raw.groupId)
    if (!/^\d+$/.test(conversationId) || !Number.isSafeInteger(Number(conversationId))) return
    messageId = gatewayId(header.messageid)
    createdAt = timestamp(header.servertime ?? raw.time)
    text = body.filter(item => item.type === 'TEXT').map(item => item.content).join('').trim()
  }
  if (!senderId || !conversationId || !messageId || !createdAt || typeof text !== 'string') return
  const selection = /^\/select ([a-f0-9]{36})$/.exec(text.trim())
  return { provider: 'infoflow', accountId, tenantId: gatewayId(raw.corpid ?? raw.CorpId) || accountId, senderId, conversationId, conversationType: direct ? 'direct' : 'group', messageId: `${direct ? 'private' : 'group'}:${conversationId}:${messageId}`, createdAt, text, ...(selection ? { actionToken: selection[1] } : {}) }
}

class QuietLogger extends Logger {
  override error() {} override warn() {} override info() {} override debug() {} override trace() {}
}

export const createInfoflowAdapter: GatewayAdapterFactory = context => {
  const queue = new AdapterQueue(500)
  const logger = new QuietLogger()
  const client = new Client({ appId: context.appKey || '', appSecret: context.secret, agentId: context.accountId, timeout: 15000, logger })
  const ws = createInfoflowSocket({ appId: context.appKey || '', appSecret: context.secret, logger, endpointTimeout: 15000, wsGateway: 'infoflow-open-gateway.baidu.com' }, queue.abort.signal)
  let reconnect: ReturnType<typeof setInterval> | undefined
  const send = async (message: GatewayMessage, text: string) => {
    for (const chunk of textChunks(text, 1800)) await queue.run(async () => {
      try {
        if (message.conversationType === 'direct') await client.im.message.sendToUser(message.conversationId, chunk)
        else await client.im.message.sendToGroup(message.conversationId, chunk)
      } catch { throw new Error('IM_GATEWAY_INFOFLOW_SEND_FAILED') }
    }, message.conversationType === 'group' ? 3100 : 500)
  }
  const adapter: GatewayAdapter = {
    screenQuietMs: 4000,
    async start(receive) {
      context.connection('connecting')
      ws.on('connected', () => { if (queue.stopped) ws.disconnect(); else context.connection('connected') })
      ws.on('disconnected', () => { if (!queue.stopped) context.connection('reconnecting') })
      ws.on('error', () => { if (!queue.stopped) context.connection('error', 'IM_GATEWAY_INFOFLOW_CONNECTION_FAILED') })
      const handle = async (event: Parameters<EventCallback>[0]) => {
        if (queue.stopped) return
        const message = normalizeInfoflowMessage(event, context.accountId)
        if (message) {
          try { await receive(message) }
          catch { if (!queue.stopped) context.connection('error', 'IM_GATEWAY_INFOFLOW_RECEIVE_FAILED') }
        }
      }
      ws.on('private.text', handle); ws.on('group.text', handle); ws.on('group.mixed', handle)
      try {
        await ws.connect()
        if (queue.stopped) return
        // SDK endpoint failures during reconnect do not schedule another attempt.
        reconnect = setInterval(() => {
          if (queue.stopped || ws.getState() !== 'disconnected') return
          context.connection('reconnecting')
          void ws.connect().catch(() => { if (!queue.stopped) context.connection('reconnecting', 'IM_GATEWAY_INFOFLOW_CONNECTION_FAILED') })
        }, 5000)
        reconnect.unref?.()
      } catch { throw new Error('IM_GATEWAY_INFOFLOW_CONNECTION_FAILED') }
    },
    stop() { queue.stop(); if (reconnect) clearInterval(reconnect); ws.disconnect() },
    send,
    async reply(message, value) {
      if (typeof value === 'string') return send(message, value)
      if ('image' in value) {
        try {
          await queue.run(async () => {
            if (value.valid && !await value.valid()) return
            const content = pngBytes(value.image, 1024 * 1024 - 1).toString('base64')
            if (queue.stopped || value.valid && !await value.valid()) return
            if (message.conversationType === 'direct') await client.im.message.sendToUser(message.conversationId, { content }, 'image')
            else await client.im.message.sendToGroup(message.conversationId, content, 'IMAGE')
          }, message.conversationType === 'group' ? 3100 : 500)
        } catch {
          if (!queue.stopped && (!value.valid || await value.valid())) await send(message, '截图发送失败。请检查图片权限、网络及图片大小（小于 1 MB），或使用 /read。')
        }
        return
      }
      await send(message, `${value.title}\n${value.text}\n如流请选择对应命令并发送：\n${value.buttons.map(button => `${button.label}\n/select ${button.token}`).join('\n')}`)
    }
  }
  return adapter
}
