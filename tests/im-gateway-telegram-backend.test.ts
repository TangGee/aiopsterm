import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pngBytes, textChunks } from '../src/main/backend/imGateway/adapterUtils'
import { createTelegramAdapter, normalizeTelegramMessage } from '../src/main/backend/imGateway/telegramAdapter'
import type { GatewayAdapter, GatewayMessage } from '../src/main/backend/imGateway/gatewayTypes'

const raw = () => ({ message_id: 10, date: Date.now() / 1000, text: '/sessions', chat: { id: 40, type: 'private' }, from: { id: 7, is_bot: false } })
const message = (): GatewayMessage => normalizeTelegramMessage(raw(), '123', 'demo_bot')!
let adapter: GatewayAdapter
beforeEach(() => vi.useFakeTimers())
afterEach(() => { adapter?.stop(); vi.useRealTimers() })
const fixture = (respond?: (method: string, body: any) => any) => {
  const calls: { method: string; body: any }[] = []
  const request = vi.fn(async (url: any, options: any) => {
    const method = String(url).split('/').pop()!
    const body = options.body instanceof FormData ? options.body : JSON.parse(options.body)
    calls.push({ method, body })
    const custom = respond?.(method, body)
    if (custom !== undefined) return { json: async () => custom }
    if (method === 'getUpdates') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    return { json: async () => ({ ok: true, result: method === 'getMe' ? { id: 123, is_bot: true, username: 'demo_bot' } : method === 'getWebhookInfo' ? { url: '' } : { message_id: 99 } }) }
  }) as unknown as typeof fetch
  const connection = vi.fn(); const receive = vi.fn(async (_message: GatewayMessage) => {})
  adapter = createTelegramAdapter({ accountId: '123', secret: '123:token', connection }, request)
  return { calls, connection, receive, request }
}

describe('Telegram gateway', () => {
  it('preserves selection lines and Unicode boundaries when splitting text', () => {
    const line = '/select ' + 'a'.repeat(36)
    const text = 'x'.repeat(1780) + '\n' + line + '\n' + String.fromCodePoint(0x20000).repeat(1000)
    const chunks = textChunks(text, 1800)
    expect(chunks.join('')).toBe(text)
    expect(chunks.some(chunk => chunk.includes(line))).toBe(true)
    expect(chunks.every(chunk => chunk.length <= 1800 && !/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(chunk))).toBe(true)
    expect(() => pngBytes('data:image/png;base64,Zm9v')).toThrow('IMAGE_INVALID')
    const bytes = Buffer.alloc(1024 * 1024); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
    expect(() => pngBytes('data:image/png;base64,' + bytes.toString('base64'), 1024 * 1024 - 1)).toThrow('IMAGE_INVALID')
  })
  it('normalizes direct messages and namespaces message IDs by chat', () => {
    expect(message()).toMatchObject({ provider: 'telegram', senderId: '7', conversationId: '40', messageId: '40:10', text: '/sessions' })
    expect(normalizeTelegramMessage({ ...raw(), chat: { id: 41, type: 'private' } }, '123', 'demo_bot')?.messageId).toBe('41:10')
  })
  it('requires an explicit mention of this bot in groups', () => {
    const group = { ...raw(), chat: { id: -40, type: 'supergroup' } }
    expect(normalizeTelegramMessage(group, '123', 'demo_bot')).toBeUndefined()
    expect(normalizeTelegramMessage({ ...group, text: '/sessions@other_bot' }, '123', 'demo_bot')).toBeUndefined()
    expect(normalizeTelegramMessage({ ...group, text: '/sessions@demo_bot' }, '123', 'demo_bot')?.text).toBe('/sessions')
    expect(normalizeTelegramMessage({ ...group, text: '@demo_bot pwd' }, '123', 'demo_bot')?.text).toBe('pwd')
  })
  it.each([{ from: { id: 7, is_bot: true } }, { sender_chat: {} }, { message_thread_id: 3 }, { date: undefined }, { message_id: NaN }, { from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false } }])('rejects unsupported or invalid sender/message metadata %j', patch => {
    expect(normalizeTelegramMessage({ ...raw(), ...patch }, '123', 'demo_bot')).toBeUndefined()
  })
  it('does not replace an existing webhook', async () => {
    const f = fixture(method => method === 'getWebhookInfo' ? { ok: true, result: { url: 'https://existing.invalid' } } : undefined)
    await expect(adapter.start(f.receive)).rejects.toThrow('WEBHOOK_CONFLICT')
    expect(f.calls.map(call => call.method)).toEqual(['getMe', 'getWebhookInfo'])
  })
  it('rejects a token/account mismatch before any request', async () => {
    const f = fixture()
    adapter = createTelegramAdapter({ accountId: '456', secret: '123:token', connection: f.connection }, f.request)
    await expect(adapter.start(f.receive)).rejects.toThrow('TOKEN_INVALID')
    expect(f.request).not.toHaveBeenCalled()
  })
  it('splits long plain text without interpreting markup, and keeps screen updates on one message', async () => {
    const f = fixture()
    const pending = adapter.reply(message(), '<tag>'.repeat(1200))
    await vi.advanceTimersByTimeAsync(2000); await pending
    const texts = f.calls.filter(call => call.method === 'sendMessage')
    expect(texts.map(call => call.body.text).join('')).toBe('<tag>'.repeat(1200))
    expect(texts.every(call => call.body.text.length <= 4000 && !call.body.parse_mode)).toBe(true)
    const update = adapter.sendScreen!(message(), 'new screen', '99')
    await vi.advanceTimersByTimeAsync(1000); expect(await update).toBe('99')
    expect(f.calls.at(-1)).toMatchObject({ method: 'editMessageText', body: { chat_id: '40', message_id: 99, text: 'new screen' } })
  })
  it('does not create a new screen message if editing fails or leak the token in errors', async () => {
    const f = fixture(method => method === 'editMessageText' ? { ok: false, description: '123:token secret error' } : undefined)
    await expect(adapter.sendScreen!(message(), 'screen', '99')).rejects.toThrow('IM_GATEWAY_TELEGRAM_REQUEST_FAILED')
    expect(f.calls.map(call => call.method)).toEqual(['editMessageText'])
  })
  it('uploads a PNG document and rechecks image authorization before sending', async () => {
    const f = fixture()
    const image = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    await adapter.reply(message(), { image, valid: async () => true })
    expect(f.calls[0].method).toBe('sendDocument')
    expect(f.calls[0].body.get('document').type).toBe('image/png')
    const pending = adapter.reply(message(), { image, valid: async () => false })
    await vi.advanceTimersByTimeAsync(1000); await pending
    expect(f.calls).toHaveLength(1)
  })
  it('polls updates, advances offsets and stops without reconnecting', async () => {
    let first = true
    const f = fixture(method => {
      if (method === 'getUpdates' && first) { first = false; return { ok: true, result: [{ update_id: 4, message: raw() }] } }
    })
    await adapter.start(f.receive); await vi.advanceTimersByTimeAsync(0)
    expect(f.receive).toHaveBeenCalledWith(expect.objectContaining({ text: '/sessions', senderId: '7' }))
    expect(f.calls.at(-1)?.body.offset).toBe(5)
    adapter.stop(); const count = f.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.calls).toHaveLength(count)
  })
  it('checks callback sender, chat and card message before consuming its token', async () => {
    const token = 'a'.repeat(36)
    let batch: any[] | undefined
    const f = fixture(method => {
      if (method === 'getUpdates' && batch) { const result = batch; batch = undefined; return { ok: true, result } }
    })
    await adapter.reply(message(), { title: 'Select', text: 'Terminal', buttons: [{ label: 'Local', token }] })
    const action = { id: 'c', data: token, from: { id: 7, is_bot: false }, message: { ...raw(), message_id: 99 } }
    batch = [
      { update_id: 1, callback_query: { ...action, from: { id: 8, is_bot: false } } },
      { update_id: 2, callback_query: { ...action, message: { ...action.message, message_id: 98 } } },
      { update_id: 3, callback_query: action },
      { update_id: 4, callback_query: action }
    ]
    await adapter.start(f.receive); await vi.advanceTimersByTimeAsync(0)
    expect(f.receive).toHaveBeenCalledOnce()
    expect(f.receive).toHaveBeenCalledWith(expect.objectContaining({ actionToken: token, senderId: '7', messageId: `card:${token}` }))
  })
})
