import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayCore, gatewayOutput } from '../src/main/backend/imGateway/gatewayCore'
import { GatewayStateStore, gatewayConversationKey } from '../src/main/backend/imGateway/gatewayState'
import type { GatewayCard, GatewayMessage, GatewayPolicy, GatewayReply, GatewayTerminalPort } from '../src/main/backend/imGateway/gatewayTypes'
import type { ControlTerminalSummary } from '../src/shared/contracts/control'
import { keyDataForTerminal } from '../src/shared/terminalKeys'

const now = 1800000000000
let nextMessage = 0
const message = (text: string, patch: Partial<GatewayMessage> = {}): GatewayMessage => ({ provider: 'feishu', accountId: 'app', tenantId: 'tenant', senderId: 'user', conversationId: 'chat', conversationType: 'direct', messageId: `id-${++nextMessage}`, createdAt: now, text, ...patch })
let directory: string
let policy: GatewayPolicy
let terminals: ControlTerminalSummary[]
let port: GatewayTerminalPort
let state: GatewayStateStore
let replies: GatewayReply[]
let core: GatewayCore
const create = () => new GatewayCore({ policy: () => policy, state, terminal: port, now: () => now, reply: async (_message, text) => { replies.push(text) }, audit: vi.fn() })
const receive = async (text: string, patch: Partial<GatewayMessage> = {}) => { await core.receive(message(text, patch)); await core.drain(); const reply = replies.at(-1); return typeof reply === 'string' ? reply : JSON.stringify(reply) }
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
  it('formats key help in short plain-text groups with usable single-command lines', async () => {
    const help = await receive('/keymap')
    expect(help.split('\n\n').length).toBeGreaterThanOrEqual(5)
    expect(help.length).toBeLessThanOrEqual(1800)
    expect(help.split('\n').every(line => [...line].length <= 80)).toBe(true)
    expect(help).not.toMatch(/[\t|`]/)
    const commands = help.split('\n').filter(line => /^\/key .+ - /.test(line))
    expect(commands.length).toBeGreaterThanOrEqual(16)
    for (const line of commands) {
      const key = line.slice(5, line.indexOf(' - '))
      expect(keyDataForTerminal(key), line).not.toBeNull()
    }
    for (const key of ['enter', 'esc', 'up', 'down', 'ctrl c', 'shift tab']) {
      expect(commands.some(line => line.startsWith(`/key ${key} - `))).toBe(true)
    }
    expect(port.write).not.toHaveBeenCalled()
  })
  it('provides the key mapping without requiring a binding or sending input', async () => {
    const help = await receive('/help')
    const keyHelp = await receive('/help key')
    for (const name of ['escape', 'return', 'cr', 'tab', 'space', 'backspace', 'bs', 'delete', 'del', 'insert', 'ins', 'arrowup', 'home', 'end', 'pgup', 'pgdn', 'f1-f12', 'ctrl shift c', 'ctrl alt c', 'shift tab', '键盘协议']) {
      expect(help).toContain(name); expect(keyHelp).toContain(name)
    }
    expect(port.write).not.toHaveBeenCalled()
  })
  it.each(['/keymap', '/keymap ctrl c'])('returns the complete mapping for %s without terminal input', async command => {
    const expected = await receive('/help key')
    expect(await receive(command)).toBe(expected)
    await receive('/bind session')
    expect(await receive(command)).toBe(expected)
    terminals[0].connected = false
    expect(await receive(command)).toBe(expected)
    expect(port.write).not.toHaveBeenCalled()
    expect(port.read).not.toHaveBeenCalled()
    const count = replies.length
    await receive(command, { senderId: 'unauthorized' })
    expect(replies).toHaveLength(count)
    expect(await receive('/help')).toContain('/keymap')
  })
  it('captures an authorized bound terminal without writing input', async () => {
    port.screenshot = vi.fn(async () => 'data:image/png;base64,aW1hZ2U=')
    await receive('/screenshot'); expect(port.screenshot).not.toHaveBeenCalled()
    await receive('/bind session')
    await receive('/screenshot')
    expect(replies.at(-1)).toMatchObject({ image: 'data:image/png;base64,aW1hZ2U=' })
    expect(port.screenshot).toHaveBeenCalledWith({ panelId: 'panel', sessionId: 'session' })
    expect(port.write).not.toHaveBeenCalled()
    terminals[0].connected = false
    expect(await receive('/screenshot')).toContain('已断开')
    expect(port.screenshot).toHaveBeenCalledOnce()
  })
  it('does not return an image after asset authorization is revoked during capture', async () => {
    port.screenshot = vi.fn(async () => { policy.allowedAssetIds = []; return 'private' })
    await receive('/bind session')
    expect(await receive('/screenshot')).toContain('截图未发送')
    expect(replies.some(r => typeof r !== 'string' && 'image' in r)).toBe(false)
  })
  it.each([
    ['ctrl c', '\x03'], ['ctrl+c', '\x03'], ['CTRL C', '\x03'], ['esc', '\x1b'], ['escape', '\x1b'],
    ['enter', '\r'], ['tab', '\t'], ['up', '\x1b[A'], ['down', '\x1b[B'], ['ctrl d', '\x04'], ['space', ' '],
    ['ctrl shift c', '\x1b[99;6u'], ['CTRL+SHIFT+C', '\x1b[99;6u'], ['ctrl alt c', '\x1b\x03'],
    ['ctrl shift up', '\x1b[1;6A'], ['alt shift f5', '\x1b[15;4~']
  ])('sends /key %s only to the bound terminal without adding Return', async (key, expected) => {
    await receive('/bind session')
    expect(await receive(`/key ${key}`)).toContain('已发送按键')
    expect(port.write).toHaveBeenCalledOnce()
    expect(port.write).toHaveBeenCalledWith({ sessionId: 'session', panelId: 'panel' }, expected)
  })
  it('rejects missing, unsupported, multiple or literal control keys without writing them as text', async () => {
    await receive('/bind session')
    for (const command of ['/key', '/key ctrl', '/key esc enter', '/key ctrl ctrl c', '/key ctrl alt', '/key ctrl meta c', '/key unknown', '/key constructor', '/key \x1b', '/key ctrl\nc']) {
      expect(await receive(command)).toContain('无效按键')
    }
    expect(port.write).not.toHaveBeenCalled()
  })
  it('requires a connected authorized binding for keys and never falls back to another terminal', async () => {
    await receive('/key esc'); expect(port.write).not.toHaveBeenCalled()
    await receive('/bind session')
    await receive('/key ctrl c', { senderId: 'unknown' })
    await receive('/key esc', { conversationId: 'other' })
    policy.allowedAssetIds = []; await receive('/key esc')
    policy.allowedAssetIds = ['asset']; terminals[0].connected = false; await receive('/key ctrl c')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('deduplicates key delivery and reports write failures without claiming success', async () => {
    await receive('/bind session')
    const input = message('/key ctrl c')
    await core.receive(input); await core.receive(input); await core.drain()
    expect(port.write).toHaveBeenCalledOnce()
    vi.mocked(port.write).mockRejectedValue(new Error('disconnected'))
    expect(await receive('/key esc')).toContain('操作失败')
  })
  it('shows the current binding through /binding and retains /status', async () => {
    expect(await receive('/binding')).toContain('没有可用的绑定')
    await receive('/bind session')
    expect(await receive('/binding')).toContain('当前绑定：Host')
    expect(await receive('/status')).toContain('当前绑定：Host')
    terminals.push({ ...terminals[0], sessionId: 'second', panelId: 'second-panel', title: 'Second' })
    await receive('/bind second')
    expect(await receive('/binding')).toContain('当前绑定：Second')
    await receive('/unbind')
    expect(await receive('/binding')).toContain('没有可用的绑定')
    expect(port.write).not.toHaveBeenCalled()
  })
  it.each(['hello', '/key ctrl shift c', '/read', '/run pwd', '/binding', '/status'])('replies explicitly when the terminal is disconnected for %s', async text => {
    await receive('/bind session')
    terminals[0].connected = false
    expect(await receive(text)).toContain('已断开')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('replies when the original session is gone without falling back to a replacement', async () => {
    await receive('/bind session')
    terminals[0].sessionId = 'replacement'
    expect(await receive('hello')).toContain('已断开')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('replies if a normal chat write fails after the connected-session check', async () => {
    await receive('/bind session')
    vi.mocked(port.write).mockRejectedValue(new Error('connection lost'))
    expect(await receive('hello')).toContain('操作失败或终端已断开')
    expect(port.write).toHaveBeenCalledOnce()
  })
  it('binds an authorized terminal, writes explicit commands, reads and interrupts', async () => {
    expect(await receive('/sessions')).toContain('Host (Local)')
    await receive('/bind session')
    expect(await receive('/run pwd')).toContain('不代表命令执行完成')
    expect(vi.mocked(port.write).mock.calls).toEqual([[{ sessionId: 'session', panelId: 'panel' }, 'pwd'], [{ sessionId: 'session', panelId: 'panel' }, '\r']])
    await receive('/send hello'); expect(port.write).toHaveBeenLastCalledWith(expect.anything(), 'hello')
    expect(await receive('/read')).toBe('output')
    await receive('/interrupt'); expect(port.write).toHaveBeenLastCalledWith(expect.anything(), '\x03')
    await receive('/unbind'); await receive('/run ignored')
    expect(port.write).toHaveBeenCalledTimes(4)
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
    expect(await receive('/sessions')).toContain('Local (Local)')
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
    expect(port.write).toHaveBeenCalledTimes(2)
    core.stop(); state = new GatewayStateStore(join(directory, 'state.json')); core = create()
    await core.receive(event); await core.drain()
    expect(port.write).toHaveBeenCalledTimes(2)
    expect(await readFile(join(directory, 'state.json'), 'utf8')).not.toContain('sensitive-content')
  })
  it('does not replay a terminal write when message delivery fails', async () => {
    await receive('/bind session')
    core = new GatewayCore({ policy: () => policy, state, terminal: port, now: () => now, reply: async () => { throw new Error('offline') }, audit: vi.fn() })
    const event = message('/run pwd', { messageId: 'retry-event' })
    await core.receive(event); await core.drain(); await core.receive(event); await core.drain()
    expect(port.write).toHaveBeenCalledTimes(2)
  })
  it('serializes a binding and command in the same conversation while acknowledging promptly', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.mocked(port.list).mockImplementationOnce(async () => { await gate; return terminals })
    await core.receive(message('/bind session')); await core.receive(message('/run pwd'))
    expect(port.write).not.toHaveBeenCalled()
    release(); await core.drain(); expect(port.write).toHaveBeenCalledTimes(2)
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
  it('rejects multiline/control input without writing it', async () => {
    await receive('/bind session')
    for (const text of ['/run ls\nrm file', '/send hi\x1b[31m', '/run ' + 'x'.repeat(2049)]) await receive(text)
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
    release(); await core.drain(); expect(port.write).toHaveBeenCalledTimes(2)
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
  it('forwards ordinary chat with Return only after binding, including spaces', async () => {
    await receive('pwd'); expect(port.write).not.toHaveBeenCalled()
    await receive('/bind session')
    const before = replies.length
    await receive('  echo hello  ')
    expect(vi.mocked(port.write).mock.calls.map(call => call[1])).toEqual(['  echo hello  ', '\r'])
    expect(replies).toHaveLength(before)
    await receive('/run /model'); expect(vi.mocked(port.write).mock.calls.slice(-2).map(call => call[1])).toEqual(['/model', '\r'])
    await receive('/unbind'); await receive('ignored'); expect(port.write).toHaveBeenCalledTimes(4)
  })
  it('pastes multiline conversation input while rejecting embedded terminal controls', async () => {
    await receive('/bind session')
    await receive('first line\r\nsecond\tline')
    expect(vi.mocked(port.write).mock.calls.map(call => call[1])).toEqual(['\x1b[200~first line\nsecond\tline\x1b[201~', '\r'])
    await receive('text\x1b[201~command'); await receive('text\x03')
    expect(port.write).toHaveBeenCalledTimes(2)
  })
  it('expires choices after ten minutes even if the message itself is fresh', async () => {
    let time = now
    core.stop()
    core = new GatewayCore({ policy: () => policy, state, terminal: port, now: () => time, reply: async (_message, text) => { replies.push(text) }, audit: vi.fn() })
    await receive('/sessions')
    const token = (replies.at(-1) as GatewayCard).buttons[0].token
    time += 600001
    expect(await receive('', { actionToken: token, createdAt: time })).toContain('过期')
    expect(state.bindingCount).toBe(0)
  })
  it('uses private one-use card choices without displaying session IDs and rechecks permissions', async () => {
    await receive('/sessions')
    const card = replies.at(-1) as GatewayCard
    expect(card.title).toBe('选择终端')
    expect(JSON.stringify(card)).not.toContain('session')
    const token = card.buttons[0].token
    await receive('', { actionToken: token, senderId: 'user2' })
    expect(state.binding(gatewayConversationKey(message('', { senderId: 'user2' })))).toBeUndefined()
    await receive('', { actionToken: token })
    expect(await receive('/status')).toContain('Host')
    await receive('/unbind')
    await receive('', { actionToken: token }); await receive('ignored')
    expect(port.write).not.toHaveBeenCalled()
    await receive('/sessions'); const revoked = (replies.at(-1) as GatewayCard).buttons[0].token
    policy.allowedAssetIds = []
    await receive('', { actionToken: revoked }); await receive('ignored')
    expect(port.write).not.toHaveBeenCalled()
  })
  it('paginates choices and rejects stale or cross-conversation cards', async () => {
    terminals = Array.from({ length: 10 }, (_, index) => ({ ...terminals[0], sessionId: `s-${index}`, title: `Host ${index}` }))
    await receive('/sessions')
    const card = replies.at(-1) as GatewayCard
    expect(card.buttons).toHaveLength(10)
    await receive('', { actionToken: card.buttons[0].token, conversationId: 'another' })
    expect(await receive('pwd', { conversationId: 'another' })).toContain('没有可用')
    await receive('', { actionToken: card.buttons.find(button => button.label === '下一页')!.token })
    expect((replies.at(-1) as GatewayCard).buttons[0].label).toContain('Host 8')
    core.stop(); core = create()
    expect(await receive('', { actionToken: card.buttons[0].token })).toContain('过期')
  })
  it('authorizes all local and saved SSH terminals without allowing unknown users or groups', async () => {
    policy.allowedAssetIds = ['all']
    terminals.push({ ...terminals[0], sessionId: 'local', kind: 'local', title: 'Local' }, { ...terminals[0], sessionId: 'new-host', assetId: 'future', title: 'Future' })
    expect(await receive('/sessions')).toContain('Future')
    await receive('/bind local'); await receive('pwd')
    expect(port.write).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionId: 'local' }), 'pwd')
    expect(port.write).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionId: 'local' }), '\r')
    const count = replies.length
    await receive('/sessions', { senderId: 'unknown' }); await receive('/sessions', { conversationType: 'group', conversationId: 'unknown' })
    expect(replies).toHaveLength(count)
  })
  it('creates and automatically binds local or authorized SSH terminals from cards exactly once', async () => {
    policy.allowedAssetIds = ['all']
    port.hosts = vi.fn(async () => [{ id: 'asset', name: 'Host', host: 'server' }])
    port.create = vi.fn(async assetId => ({ ...terminals[0], sessionId: 'new', panelId: 'new-panel', kind: assetId ? 'ssh' as const : 'local' as const, assetId }))
    await receive('/new')
    const card = replies.at(-1) as GatewayCard
    const local = message('', { actionToken: card.buttons[0].token })
    await core.receive(local); await core.receive(local); await core.drain()
    expect(port.create).toHaveBeenCalledOnce(); expect(port.create).toHaveBeenCalledWith(undefined, expect.any(Function))
    expect(state.binding(gatewayConversationKey(local))).toEqual({ sessionId: 'new', panelId: 'new-panel' })
    await receive('', { actionToken: card.buttons[1].token })
    expect(port.create).toHaveBeenLastCalledWith('asset', expect.any(Function))
    expect(port.create).toHaveBeenCalledTimes(2)
    policy.allowedAssetIds = []
    await receive('/new open:asset:asset'); await receive('/new open:local')
    expect(port.create).toHaveBeenCalledTimes(2)
  })
  it('keeps the old binding when creation fails and does not claim a failed connection succeeded', async () => {
    await receive('/bind session'); policy.allowLocalTerminal = true
    port.create = vi.fn(async () => { throw new Error('offline') })
    expect(await receive('/new open:local')).toContain('tab 会保留')
    expect(state.binding(gatewayConversationKey(message('')))?.sessionId).toBe('session')
  })
  it('bounds output and strips terminal controls and mention markup', () => {
    expect(gatewayOutput('\x1b[31mhello\x00 <at user_id="all">all</at>')).toBe('hello < at user_id="all">all</at>')
    expect(gatewayOutput('x'.repeat(8000)).length).toBeLessThan(6100)
  })
})
