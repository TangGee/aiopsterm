import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayCore, gatewayOutput } from '../src/main/backend/imGateway/gatewayCore'
import { GatewayStateStore, gatewayConversationKey } from '../src/main/backend/imGateway/gatewayState'
import type { GatewayMessage, GatewayPolicy, GatewayTerminalPort } from '../src/main/backend/imGateway/gatewayTypes'
import type { ControlTerminalSummary } from '../src/shared/contracts/control'

const now = 1800000000000
let nextMessage = 0
const message = (text: string, patch: Partial<GatewayMessage> = {}): GatewayMessage => ({ provider: 'feishu', accountId: 'app', tenantId: 'tenant', senderId: 'user', conversationId: 'chat', conversationType: 'direct', messageId: `id-${++nextMessage}`, createdAt: now, text, ...patch })
let directory: string
let policy: GatewayPolicy
let terminals: ControlTerminalSummary[]
let port: GatewayTerminalPort
let state: GatewayStateStore
let replies: string[]
let core: GatewayCore
const create = () => new GatewayCore({ policy: () => policy, state, terminal: port, now: () => now, reply: async (_message, text) => { replies.push(text) }, audit: vi.fn() })
const receive = async (text: string, patch: Partial<GatewayMessage> = {}) => { await core.receive(message(text, patch)); await core.drain(); return replies.at(-1) }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'im-gateway-test-'))
  state = new GatewayStateStore(join(directory, 'state.json'))
  policy = { allowedUserIds: ['user', 'user2'], allowedGroupIds: ['group'], allowedAssetIds: ['asset'], allowLocalTerminal: false }
  terminals = [{ panelId: 'panel', sessionId: 'session', title: 'Host', assetId: 'asset', kind: 'ssh', connected: true, active: false }]
  port = { list: vi.fn(async () => terminals), write: vi.fn(async () => {}), read: vi.fn(async () => 'output') }
  replies = []; core = create()
})
afterEach(async () => { core.stop(); await core.drain(); await rm(directory, { recursive: true, force: true }) })
describe('IM gateway core', () => {
  it('binds an authorized terminal, writes explicit commands, reads and interrupts', async () => {
    expect(await receive('/sessions')).toContain('session | Host')
    await receive('/bind session')
    expect(await receive('/run pwd')).toContain('不代表命令执行完成')
    expect(port.write).toHaveBeenCalledWith({ sessionId: 'session', panelId: 'panel' }, 'pwd\r')
    await receive('/send hello'); expect(port.write).toHaveBeenLastCalledWith(expect.anything(), 'hello')
    expect(await receive('/read')).toBe('output')
    await receive('/interrupt'); expect(port.write).toHaveBeenLastCalledWith(expect.anything(), '\x03')
    await receive('/unbind'); await receive('/run ignored')
    expect(port.write).toHaveBeenCalledTimes(3)
  })
  it('ignores unauthorized identities, unapproved groups, old events, and future timestamps', async () => {
    for (const patch of [{ senderId: 'unknown' }, { conversationType: 'group' as const, conversationId: 'unknown' }, { createdAt: now - 300001 }, { createdAt: now + 60001 }, { text: 'x'.repeat(4097) }]) await receive('/sessions', patch)
    expect(port.list).not.toHaveBeenCalled(); expect(replies).toEqual([])
  })
  it('does not expose or bind unapproved assets or local terminals', async () => {
    terminals.push({ ...terminals[0], sessionId: 'hidden', assetId: 'other', title: 'Secret host' }, { ...terminals[0], sessionId: 'local', kind: 'local', title: 'Local' })
    expect(await receive('/sessions')).not.toContain('Secret host')
    await receive('/bind hidden'); await receive('/run ls')
    expect(port.write).not.toHaveBeenCalled()
    policy.allowLocalTerminal = true
    expect(await receive('/sessions')).toContain('local | Local')
  })
  it('isolates bindings by provider, account, tenant, conversation and sender', async () => {
    await receive('/bind session')
    for (const patch of [{ senderId: 'user2' }, { conversationId: 'chat2' }, { tenantId: 'tenant2' }, { accountId: 'app2' }, { provider: 'second-im' }]) await receive('/run forbidden', patch)
    expect(port.write).not.toHaveBeenCalled()
  })
  it('rejects a restarted terminal instead of following its reused panel', async () => {
    await receive('/bind session'); terminals[0].sessionId = 'new-session'
    await receive('/run forbidden'); expect(port.write).not.toHaveBeenCalled()
  })
  it('deduplicates by message id, including after restart, without storing command text', async () => {
    await receive('/bind session')
    const event = message('/run sensitive-content', { messageId: 'same' })
    await core.receive(event); await core.receive(event); await core.drain()
    expect(port.write).toHaveBeenCalledTimes(1)
    core.stop(); state = new GatewayStateStore(join(directory, 'state.json')); core = create()
    await core.receive(event); await core.drain()
    expect(port.write).toHaveBeenCalledTimes(1)
    expect(await readFile(join(directory, 'state.json'), 'utf8')).not.toContain('sensitive-content')
  })
  it('does not replay a terminal write when message delivery fails', async () => {
    await receive('/bind session')
    core = new GatewayCore({ policy: () => policy, state, terminal: port, now: () => now, reply: async () => { throw new Error('offline') }, audit: vi.fn() })
    const event = message('/run pwd', { messageId: 'retry-event' })
    await core.receive(event); await core.drain(); await core.receive(event); await core.drain()
    expect(port.write).toHaveBeenCalledTimes(1)
  })
  it('serializes a binding and command in the same conversation while acknowledging promptly', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.mocked(port.list).mockImplementationOnce(async () => { await gate; return terminals })
    await core.receive(message('/bind session')); await core.receive(message('/run pwd'))
    expect(port.write).not.toHaveBeenCalled()
    release(); await core.drain(); expect(port.write).toHaveBeenCalledTimes(1)
  })
  it('does not perform queued writes after stop or permission revocation', async () => {
    await receive('/bind session')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.mocked(port.list).mockImplementationOnce(async () => { await gate; return terminals })
    await core.receive(message('/run blocked')); await core.receive(message('/run queued'))
    core.stop(); release(); await core.drain(); expect(port.write).not.toHaveBeenCalled()
    core = create(); policy.allowedAssetIds = []
    await receive('/run revoked'); expect(port.write).not.toHaveBeenCalled()
  })
  it('rejects multiline/control input and treats ordinary chat as help', async () => {
    await receive('/bind session')
    for (const text of ['delete files', '/run ls\nrm file', '/send hi\x1b[31m', '/run ' + 'x'.repeat(2049)]) await receive(text)
    expect(port.write).not.toHaveBeenCalled()
  })
  it('limits pending messages and serializes shared terminal access', async () => {
    await receive('/bind session')
    state.bind(gatewayConversationKey(message('', { senderId: 'user2' })), { sessionId: 'session', panelId: 'panel' })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.mocked(port.write).mockImplementationOnce(async () => { await gate })
    await core.receive(message('/run first'))
    await vi.waitFor(() => expect(port.write).toHaveBeenCalledTimes(1))
    await core.receive(message('/run second', { senderId: 'user2' }))
    await vi.waitFor(() => expect(replies.at(-1)).toContain('另一条网关请求'))
    for (let index = 0; index < 31; index++) await core.receive(message('/status'))
    await expect(core.receive(message('/status'))).rejects.toThrow('IM_GATEWAY_BUSY')
    release(); await core.drain(); expect(port.write).toHaveBeenCalledTimes(1)
  })
  it('fails closed on corrupt state and does not execute when receipt persistence fails', async () => {
    await writeFile(join(directory, 'broken'), '{broken')
    expect(() => new GatewayStateStore(join(directory, 'broken'))).toThrow()
    vi.spyOn(state, 'claim').mockImplementation(() => { throw new Error('disk full') })
    await expect(core.receive(message('/run pwd'))).rejects.toThrow('disk full')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('records only known operation names, never an unknown command token as an action', async () => {
    const audit = vi.fn()
    core = new GatewayCore({ policy: () => policy, state, terminal: port, now: () => now, reply: async () => {}, audit })
    await receive('/confidentialtoken')
    expect(audit).toHaveBeenCalledWith('accepted', expect.anything(), 'unknown')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('bounds output and strips terminal controls and mention markup', () => {
    expect(gatewayOutput('\x1b[31mhello\x00 <at user_id="all">all</at>')).toBe('hello < at user_id="all">all</at>')
    expect(gatewayOutput('x'.repeat(8000)).length).toBeLessThan(6100)
  })
})
