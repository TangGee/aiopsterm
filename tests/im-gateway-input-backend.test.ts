import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayCore } from '../src/main/backend/imGateway/gatewayCore'
import { GatewayStateStore, gatewayConversationKey } from '../src/main/backend/imGateway/gatewayState'
import type { GatewayMessage, GatewayPolicy, GatewayTerminalPort } from '../src/main/backend/imGateway/gatewayTypes'

vi.mock('node:timers/promises', () => ({ setTimeout: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)) }))

const binding = { panelId: 'panel', sessionId: 'session' }
let nextId = 0
const event = (text: string, id = String(++nextId)): GatewayMessage => ({ provider: 'feishu', accountId: 'app', tenantId: 'tenant', senderId: 'user', conversationId: 'chat', conversationType: 'direct', messageId: id, text, createdAt: Date.now() })
let core: GatewayCore
let state: GatewayStateStore
let policy: GatewayPolicy
let terminal: GatewayTerminalPort
let target: { panelId: string; sessionId: string; title: string; kind: 'local'; connected: boolean; active: boolean }
let reply: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  state = new GatewayStateStore()
  policy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: [], allowLocalTerminal: true }
  target = { ...binding, title: 'Demo', kind: 'local', connected: true, active: false }
  terminal = { list: vi.fn(async () => [target]), write: vi.fn(async () => {}), read: vi.fn(async () => '') }
  reply = vi.fn(async () => {})
  core = new GatewayCore({ state, policy: () => policy, terminal, reply, audit: vi.fn() })
  state.bind(gatewayConversationKey(event('')), binding)
})
afterEach(async () => { core.stop(); await vi.runAllTimersAsync(); await core.drain(); vi.useRealTimers() })
const writes = () => vi.mocked(terminal.write).mock.calls.map(call => call[1])

describe('IM input submission', () => {
  it.each(['请检查服务健康状态', '/run pwd', '/model', 'x'.repeat(4096)])('submits text once after the paste burst has settled (%#)', async text => {
    await core.receive(event(text)); await vi.advanceTimersByTimeAsync(0)
    const input = text.startsWith('/run ') ? text.slice(5) : text
    expect(writes()).toEqual([input])
    await vi.advanceTimersByTimeAsync(199)
    expect(writes()).toEqual([input])
    await vi.advanceTimersByTimeAsync(1); await core.drain()
    expect(writes()).toEqual([input, '\r'])
    expect(vi.mocked(terminal.write).mock.calls.every(call => call[0] === binding)).toBe(true)
  })
  it('preserves multiline paste boundaries before a single independent submit', async () => {
    await core.receive(event('first\r\nsecond\tline')); await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(['\x1b[200~first\nsecond\tline\x1b[201~', '\r'])
  })
  it.each(['/model', '/model example-model high', '  /model  example-model  ', '/review-code --staged', '/custom:task value', '/usr/bin/printf hello', '/helpful', '/MODEL'])('forwards non-gateway slash input unchanged and only once: %s', async text => {
    const incoming = event(text)
    await core.receive(incoming); await core.receive(incoming)
    await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual([text, '\r'])
    expect(vi.mocked(terminal.write).mock.calls.every(call => call[0] === binding)).toBe(true)
    expect(reply).not.toHaveBeenCalled()
  })
  it('keeps multiline slash input in one paste before submitting', async () => {
    await core.receive(event('/custom first\r\nsecond\tline'))
    await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(['\x1b[200~/custom first\nsecond\tline\x1b[201~', '\r'])
    expect(reply).not.toHaveBeenCalled()
  })
  it.each(['unbound', 'user', 'group', 'asset', 'disconnect'] as const)('does not forward slash input when %s blocks terminal access', async reason => {
    const incoming = event('/model')
    if (reason === 'unbound') state.bind(gatewayConversationKey(incoming))
    if (reason === 'user') incoming.senderId = 'unauthorized'
    if (reason === 'group') incoming.conversationType = 'group'
    if (reason === 'asset') policy.allowLocalTerminal = false
    if (reason === 'disconnect') target.connected = false
    await core.receive(incoming); await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(terminal.write).not.toHaveBeenCalled()
    if (reason === 'unbound') expect(reply).toHaveBeenCalledWith(incoming, expect.stringContaining('没有可用的绑定'))
    else if (reason === 'asset' || reason === 'disconnect') expect(reply).toHaveBeenCalledWith(incoming, expect.stringContaining('本条消息未写入终端'))
    else expect(reply).not.toHaveBeenCalled()
  })
  it('uses ordinary input limits and control-character protection for slash input', async () => {
    const maximum = '/custom ' + 'x'.repeat(4088)
    await core.receive(event(maximum)); await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual([maximum, '\r'])
    await core.receive(event(maximum + 'x')); await core.receive(event('/model\x1b[A'))
    await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual([maximum, '\r'])
  })
  it('reserves gateway help while allowing explicit terminal help through /run', async () => {
    await core.receive(event('/help')); await vi.advanceTimersByTimeAsync(0); await core.drain()
    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/sessions'))
    expect(terminal.write).not.toHaveBeenCalled()
    await core.receive(event('/run /help')); await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(['/help', '\r'])
  })
  it.each([['/send hello', 'hello'], ['/key enter', '\r'], ['/key ctrl c', '\x03'], ['/key up', '\x1b[A']])('does not append or delay a submit for %s', async (text, expected) => {
    await core.receive(event(text)); await vi.advanceTimersByTimeAsync(0); await core.drain()
    expect(writes()).toEqual([expected])
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['stop', 'permission', 'binding', 'disconnect', 'restart'] as const)('does not submit when %s changes after text delivery', async change => {
    await core.receive(event('pending')); await vi.advanceTimersByTimeAsync(0)
    expect(writes()).toEqual(['pending'])
    if (change === 'stop') core.stop()
    if (change === 'permission') policy.allowLocalTerminal = false
    if (change === 'binding') state.bind(gatewayConversationKey(event('')), { panelId: 'other', sessionId: 'other' })
    if (change === 'disconnect') target.connected = false
    if (change === 'restart') target.sessionId = 'replacement'
    await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(['pending'])
  })
  it('keeps queued messages ordered across both writes and ignores duplicate delivery', async () => {
    const first = event('first')
    await core.receive(first); await core.receive(first); await core.receive(event('second'))
    await vi.advanceTimersByTimeAsync(200)
    expect(writes()).toEqual(['first', '\r', 'second'])
    await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(['first', '\r', 'second', '\r'])
  })
  it.each([1, 2])('does not retry after write %i fails', async failedWrite => {
    let count = 0
    vi.mocked(terminal.write).mockImplementation(async () => { if (++count === failedWrite) throw new Error('disconnected') })
    const incoming = event('once')
    await core.receive(incoming); await vi.advanceTimersByTimeAsync(200); await core.drain()
    await core.receive(incoming); await vi.advanceTimersByTimeAsync(200); await core.drain()
    expect(writes()).toEqual(failedWrite === 1 ? ['once'] : ['once', '\r'])
    expect(reply).toHaveBeenCalledWith(incoming, expect.stringContaining('操作失败'))
  })
})
