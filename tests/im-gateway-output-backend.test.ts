import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayOutputRelay, GatewayTextDecoder } from '../src/main/backend/imGateway/gatewayOutputRelay'
import { GatewayCore } from '../src/main/backend/imGateway/gatewayCore'
import { GatewayStateStore } from '../src/main/backend/imGateway/gatewayState'
import { publishTerminalOutput, subscribeTerminalOutput } from '../src/main/backend/terminal/terminalOutputEvents'
import type { GatewayCard, GatewayMessage, GatewayPolicy, GatewayReply, GatewayScreenSender, GatewayTerminalPort } from '../src/main/backend/imGateway/gatewayTypes'

const message: GatewayMessage = { provider: 'feishu', accountId: 'app', tenantId: 'tenant', senderId: 'user', conversationId: 'chat', conversationType: 'direct', messageId: 'bind', createdAt: 1800000000000, text: '/bind session' }
const binding = { panelId: 'panel', sessionId: 'session' }
let relay: GatewayOutputRelay | undefined
let core: GatewayCore | undefined
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(message.createdAt) })
afterEach(async () => { relay?.stop(); core?.stop(); await relay?.drain(); await core?.drain(); vi.useRealTimers() })
const fixture = (sendScreen?: GatewayScreenSender) => {
  const terminal: GatewayTerminalPort = {
    list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
    read: vi.fn(async () => '$ prompt'), write: vi.fn(async () => {}),
    subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
  }
  const send = vi.fn(async (_message: GatewayMessage, _text: string) => {}); const valid = vi.fn(async () => true); const failed = vi.fn()
  relay = new GatewayOutputRelay({ terminal, binding, message, send, sendScreen, valid, failed })
  return { terminal, send, valid, failed }
}
describe('gateway terminal output', () => {
  it('waits for redraw silence on channels without editable messages, retaining the final screen', async () => {
    const terminal: GatewayTerminalPort = {
      list: async () => [], write: async () => {}, read: vi.fn(async () => 'final answer'),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const send = vi.fn(async () => {})
    relay = new GatewayOutputRelay({ terminal, binding, message, send, screenQuietMs: 4000, valid: async () => true, failed: vi.fn() })
    for (let i = 0; i < 8; i++) {
      publishTerminalOutput('session', '\x1b[2J\x1b[HWorking')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4000)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(message, 'final answer')
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledOnce()
  })
  it.each(['disconnected', 'closed', 'replaced', 'notification failure'])('notifies once on a %s terminal without requiring further output', async reason => {
    let terminals = [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]
    const send = vi.fn(async () => {})
    if (reason === 'notification failure') send.mockRejectedValue(new Error('offline'))
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => terminals), read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      terminal, state: new GatewayStateStore(), reply: vi.fn(async () => {}), send, audit: vi.fn() })
    await core.receive(message); await core.drain()
    if (reason === 'closed') terminals = []
    else if (reason === 'replaced') terminals[0].sessionId = 'replacement'
    else terminals[0].connected = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(message, expect.stringContaining('终端已断开或关闭'))
    publishTerminalOutput('session', 'late output'); await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledOnce()
    expect(terminal.write).not.toHaveBeenCalled()
  })
  it.each(['stop', 'unbind', 'user', 'asset'])('does not send a disconnect notification after %s', async action => {
    const target = { ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }
    const policy: GatewayPolicy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }
    const send = vi.fn(async () => {})
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [target]), read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      subscribe: (bound, receive) => subscribeTerminalOutput(bound.sessionId, receive)
    }
    core = new GatewayCore({ policy: () => policy, terminal, state: new GatewayStateStore(), reply: vi.fn(async () => {}), send, audit: vi.fn() })
    await core.receive(message); await core.drain()
    if (action === 'stop') core.stop()
    else if (action === 'unbind') { await core.receive({ ...message, messageId: 'unbind', text: '/unbind' }); await core.drain() }
    else if (action === 'user') policy.allowedUserIds = []
    else policy.allowedAssetIds = []
    target.connected = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).not.toHaveBeenCalled()
  })
  it('does not let a late disconnect check notify after rebinding another terminal', async () => {
    const first = { ...binding, title: 'First', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }
    const second = { ...first, panelId: 'second-panel', sessionId: 'second-session', title: 'Second' }
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [first, second]), read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      subscribe: (bound, receive) => subscribeTerminalOutput(bound.sessionId, receive)
    }
    const send = vi.fn(async () => {})
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      terminal, state: new GatewayStateStore(), reply: vi.fn(async () => {}), send, audit: vi.fn() })
    await core.receive(message); await core.drain()
    let finish!: (terminals: typeof first[]) => void
    vi.mocked(terminal.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(1000)
    await core.receive({ ...message, messageId: 'switch', text: '/bind second-session' })
    await vi.advanceTimersByTimeAsync(0)
    expect(terminal.list).toHaveBeenCalledTimes(3)
    finish([]); await core.drain(); await vi.advanceTimersByTimeAsync(1000)
    expect(send).not.toHaveBeenCalled()
    await core.receive({ ...message, messageId: 'input-after-switch', text: 'hello' }); await core.drain()
    expect(terminal.write).toHaveBeenNthCalledWith(1, { panelId: 'second-panel', sessionId: 'second-session' }, 'hello')
    expect(terminal.write).toHaveBeenNthCalledWith(2, { panelId: 'second-panel', sessionId: 'second-session' }, '\r')
  })
  it('reports a disconnect during a failing screen read and does not resend input', async () => {
    const target = { ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }
    const send = vi.fn(async () => {})
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [target]), read: vi.fn(async () => { target.connected = false; throw new Error('closed') }), write: vi.fn(async () => {}),
      subscribe: (bound, receive) => subscribeTerminalOutput(bound.sessionId, receive)
    }
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      terminal, state: new GatewayStateStore(), reply: vi.fn(async () => {}), send, audit: vi.fn() })
    await core.receive(message); await core.drain()
    await core.receive({ ...message, messageId: 'input', text: 'hello' }); await core.drain()
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(message, expect.stringContaining('此前输入是否执行完成'))
    expect(terminal.write).toHaveBeenCalledTimes(2)
  })
  it('starts a new output card after chat input and key acknowledgements', async () => {
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => 'ready'), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const screen = vi.fn<GatewayScreenSender>(async (_message, _text, id): Promise<string> => id || `card-${screen.mock.calls.length}`)
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      state: new GatewayStateStore(), terminal, reply: vi.fn(async () => {}), send: vi.fn(async () => {}), sendScreen: screen, audit: vi.fn() })
    await core.receive(message); await core.drain()
    publishTerminalOutput('session', '\x1b[Hready'); await vi.advanceTimersByTimeAsync(1000)
    await core.receive({ ...message, messageId: 'input', text: 'question' }); await core.drain()
    vi.mocked(terminal.read).mockResolvedValue('answer'); publishTerminalOutput('session', '\x1b[Hanswer')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen.mock.calls[1][2]).toBeUndefined()
    await core.receive({ ...message, messageId: 'escape', text: '/key esc' }); await core.drain()
    vi.mocked(terminal.read).mockResolvedValue('menu closed'); publishTerminalOutput('session', '\x1b[Hmenu')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen.mock.calls[2][2]).toBeUndefined()
    await core.receive({ ...message, messageId: 'enter', text: '/key enter' }); await core.drain()
    vi.mocked(terminal.read).mockResolvedValue('next answer'); publishTerminalOutput('session', '\x1b[Hnext')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen.mock.calls[3][2]).toBeUndefined()
  })
  it.each(['/help', '/sessions', '/read', '/status', '/key esc', '/send draft'])('places a fresh screen below the %s reply even when the screen is unchanged', async text => {
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => 'current answer'), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const delivered: string[] = []
    let releaseReply: (() => void) | undefined
    const reply = vi.fn(async (_message: GatewayMessage, _text: GatewayReply) => {})
    const screen = vi.fn<GatewayScreenSender>(async (_message, body, id): Promise<string> => {
      delivered.push('screen:' + body)
      return id || `card-${screen.mock.calls.length}`
    })
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      state: new GatewayStateStore(), terminal, reply, send: vi.fn(async () => {}), sendScreen: screen, audit: vi.fn() })
    await core.receive(message); await core.drain()
    publishTerminalOutput('session', '\x1b[Hcurrent answer'); await vi.advanceTimersByTimeAsync(1000)
    expect(screen).toHaveBeenCalledOnce()
    reply.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseReply = resolve })
      delivered.push('reply')
    })
    try {
      await core.receive({ ...message, messageId: 'interaction', text })
      await vi.advanceTimersByTimeAsync(5000)
      expect(reply).toHaveBeenCalledTimes(2)
      expect(screen).toHaveBeenCalledOnce()
    } finally {
      releaseReply?.(); await core.drain()
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen).toHaveBeenCalledTimes(2)
    expect(screen.mock.calls[1][2]).toBeUndefined()
    expect(delivered).toEqual(['screen:current answer', 'reply', 'screen:current answer'])
    vi.mocked(terminal.read).mockResolvedValue('next animation')
    publishTerminalOutput('session', '\x1b[Hnext animation'); await vi.advanceTimersByTimeAsync(3000)
    expect(screen.mock.calls.at(-1)?.[2]).toBe('card-2')
  })
  it('finishes an in-flight old card before replying, then creates the next card at the bottom', async () => {
    let finishSend: (() => void) | undefined
    const delivered: string[] = []
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => 'answer'), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const screen = vi.fn<GatewayScreenSender>().mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishSend = resolve })
      delivered.push('old screen'); return 'old-card'
    }).mockImplementation(async (_message, _text, id) => { delivered.push('new screen'); return id || 'new-card' })
    const reply = vi.fn(async (_message: GatewayMessage, _text: GatewayReply) => { delivered.push('reply') })
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      state: new GatewayStateStore(), terminal, reply, send: vi.fn(async () => {}), sendScreen: screen, audit: vi.fn() })
    await core.receive(message); await core.drain(); delivered.length = 0
    publishTerminalOutput('session', '\x1b[Hanswer'); await vi.advanceTimersByTimeAsync(1000)
    try {
      await core.receive({ ...message, messageId: 'help', text: '/help' }); await vi.advanceTimersByTimeAsync(0)
      expect(reply).toHaveBeenCalledOnce()
    } finally { finishSend?.(); await core.drain() }
    await vi.advanceTimersByTimeAsync(3000)
    expect(delivered).toEqual(['old screen', 'reply', 'new screen'])
    expect(screen.mock.calls.at(-1)?.[2]).toBeUndefined()
  })
  it.each(['bind', 'card', 'create'] as const)('holds the replacement screen until the %s acknowledgement is delivered', async mode => {
    const second = { panelId: 'second-panel', sessionId: 'second-session' }
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [binding, second].map(target => ({ ...target, title: target.panelId, kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }))),
      read: vi.fn(async target => target.sessionId === 'session' ? 'old answer' : 'new answer'), write: vi.fn(async () => {}),
      create: vi.fn(async () => ({ ...second, title: second.panelId, kind: 'ssh' as const, connected: true, assetId: 'asset', active: false })),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const delivered: string[] = []
    let releaseReply: (() => void) | undefined
    const reply = vi.fn(async (_message: GatewayMessage, _text: GatewayReply) => {})
    const screen = vi.fn<GatewayScreenSender>(async (_message, text, id): Promise<string> => { delivered.push(text); return id || `card-${screen.mock.calls.length}` })
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      state: new GatewayStateStore(), terminal, reply, send: vi.fn(async () => {}), sendScreen: screen, audit: vi.fn() })
    await core.receive(message); await core.drain()
    publishTerminalOutput('session', '\x1b[Hold answer'); await vi.advanceTimersByTimeAsync(1000)
    const switchMessage = { ...message, messageId: 'switch', text: mode === 'create' ? '/new open:asset:asset' : '/bind second-session' }
    if (mode === 'card') {
      await core.receive({ ...message, messageId: 'list', text: '/sessions' }); await core.drain()
      const card = reply.mock.calls.at(-1)![1] as GatewayCard
      Object.assign(switchMessage, { text: '', actionToken: card.buttons[1].token })
    }
    reply.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseReply = resolve }); delivered.push('bound')
    })
    try {
      await core.receive(switchMessage)
      await vi.advanceTimersByTimeAsync(0)
      publishTerminalOutput('session', '\x1b[Hold late output')
      publishTerminalOutput('second-session', '\x1b[Hnew answer')
      await vi.advanceTimersByTimeAsync(5000)
      expect(screen).toHaveBeenCalledOnce()
    } finally { releaseReply?.(); await core.drain() }
    await vi.advanceTimersByTimeAsync(1000)
    expect(delivered).toEqual(['old answer', 'bound', 'new answer'])
    expect(screen.mock.calls.at(-1)?.[2]).toBeUndefined()
  })
  it('replies without waiting for a stale screen read and discards that read after the reply', async () => {
    let finishRead: ((text: string) => void) | undefined
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => 'current answer'), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const reply = vi.fn(async () => {})
    const screen = vi.fn<GatewayScreenSender>(async (_message, _text, id): Promise<string> => id || `card-${screen.mock.calls.length}`)
    core = new GatewayCore({ policy: () => ({ allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }),
      state: new GatewayStateStore(), terminal, reply, send: vi.fn(async () => {}), sendScreen: screen, audit: vi.fn() })
    await core.receive(message); await core.drain()
    publishTerminalOutput('session', '\x1b[Hanswer'); await vi.advanceTimersByTimeAsync(1000)
    vi.mocked(terminal.read).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    publishTerminalOutput('session', '\x1b[Hanimation'); await vi.advanceTimersByTimeAsync(3000)
    try {
      await core.receive({ ...message, messageId: 'help', text: '/help' }); await vi.advanceTimersByTimeAsync(0)
      expect(reply).toHaveBeenCalledTimes(2)
    } finally { finishRead?.('stale answer'); await core.drain() }
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen.mock.calls.map(call => call[1])).toEqual(['current answer', 'current answer'])
    expect(screen.mock.calls[1][2]).toBeUndefined()
  })
  it.each(['reply-failed', 'stopped', 'revoked'] as const)('settles a paused reply safely when %s', async outcome => {
    const policy: GatewayPolicy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => 'answer'), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    let releaseReply: (() => void) | undefined
    const reply = vi.fn(async () => {})
    const screen = vi.fn<GatewayScreenSender>(async (_message, _text, id): Promise<string> => id || `card-${screen.mock.calls.length}`)
    const audit = vi.fn()
    core = new GatewayCore({ policy: () => policy, state: new GatewayStateStore(), terminal, reply, send: vi.fn(async () => {}), sendScreen: screen, audit })
    await core.receive(message); await core.drain()
    publishTerminalOutput('session', '\x1b[Hanswer'); await vi.advanceTimersByTimeAsync(1000)
    reply.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseReply = resolve })
      if (outcome === 'reply-failed') throw new Error('delivery failed')
    })
    try {
      await core.receive({ ...message, messageId: 'help', text: '/help' }); await vi.advanceTimersByTimeAsync(0)
      if (outcome === 'stopped') core.stop()
      if (outcome === 'revoked') policy.allowedUserIds = []
    } finally { releaseReply?.(); await core.drain() }
    await vi.advanceTimersByTimeAsync(5000)
    expect(screen).toHaveBeenCalledTimes(outcome === 'reply-failed' ? 2 : 1)
    expect(terminal.write).not.toHaveBeenCalled()
    if (outcome === 'reply-failed') {
      expect(audit).toHaveBeenCalledWith('reply_failed', expect.objectContaining({ messageId: 'help' }))
      expect(screen.mock.calls[1][2]).toBeUndefined()
    }
  })
  it('coalesces animated TUI screens into one message instead of posting repeated snapshots', async () => {
    const screen = vi.fn<GatewayScreenSender>(async () => 'output-card')
    const { terminal, send } = fixture(screen)
    for (let second = 0; second < 12; second++) {
      vi.mocked(terminal.read).mockResolvedValue(`Answer\nWorking ${second}s`)
      publishTerminalOutput('session', '\x1b[Hredraw')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(send).not.toHaveBeenCalled()
    expect(screen).toHaveBeenCalledTimes(4)
    expect(screen.mock.calls[0]).toEqual([message, 'Answer\nWorking 0s', undefined])
    expect(screen.mock.calls.slice(1).every(call => call[2] === 'output-card')).toBe(true)
    vi.mocked(terminal.read).mockResolvedValue('Answer\nFinished')
    publishTerminalOutput('session', '\x1b[Hfinal')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen).toHaveBeenLastCalledWith(message, 'Answer\nFinished', 'output-card')
    const sent = screen.mock.calls.length
    vi.mocked(terminal.read).mockResolvedValue('Answer   \nFinished  \n\n')
    publishTerminalOutput('session', '\x1b[Hpadding only')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen).toHaveBeenCalledTimes(sent)
  })
  it('serializes slow screen reads while new output continues arriving', async () => {
    let finish!: (text: string) => void
    const screen = vi.fn<GatewayScreenSender>(async () => 'output-card')
    const { terminal } = fixture(screen)
    vi.mocked(terminal.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    publishTerminalOutput('session', '\x1b[Hfirst')
    await vi.advanceTimersByTimeAsync(1000)
    for (let second = 0; second < 5; second++) {
      publishTerminalOutput('session', '\x1b[Hmore')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(terminal.read).toHaveBeenCalledOnce()
    finish('Answer'); await relay!.drain()
    expect(screen).toHaveBeenCalledOnce()
    vi.mocked(terminal.read).mockResolvedValue('Answer complete')
    await vi.advanceTimersByTimeAsync(3000)
    expect(screen).toHaveBeenLastCalledWith(message, 'Answer complete', 'output-card')
  })
  it('waits for a slow card creation before sending the latest screen to the same card', async () => {
    let finish!: (id: string) => void
    const screen = vi.fn<GatewayScreenSender>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue('output-card')
    const { terminal } = fixture(screen)
    publishTerminalOutput('session', '\x1b[Hfirst'); await vi.advanceTimersByTimeAsync(1000)
    vi.mocked(terminal.read).mockResolvedValue('Final screen')
    for (let second = 0; second < 5; second++) {
      publishTerminalOutput('session', '\x1b[Hanimation'); await vi.advanceTimersByTimeAsync(1000)
    }
    expect(screen).toHaveBeenCalledOnce()
    expect(terminal.read).toHaveBeenCalledOnce()
    finish('output-card'); await relay!.drain(); await vi.advanceTimersByTimeAsync(3000)
    expect(screen).toHaveBeenCalledTimes(2)
    expect(screen).toHaveBeenLastCalledWith(message, 'Final screen', 'output-card')
  })
  it('does not reuse an in-flight old output card after a new input', async () => {
    let finish!: (id: string) => void
    const screen = vi.fn<GatewayScreenSender>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue('new-card')
    const { terminal } = fixture(screen)
    vi.mocked(terminal.read).mockResolvedValue('old answer')
    publishTerminalOutput('session', '\x1b[Hold'); await vi.advanceTimersByTimeAsync(1000)
    relay!.beginInput()
    vi.mocked(terminal.read).mockResolvedValue('new answer'); publishTerminalOutput('session', '\x1b[Hnew')
    finish('old-card'); await relay!.drain(); await vi.advanceTimersByTimeAsync(3000)
    expect(screen).toHaveBeenLastCalledWith(message, 'new answer', undefined)
  })
  it('stops after screen updates fail rather than falling back to repeated new messages', async () => {
    const screen = vi.fn<GatewayScreenSender>().mockResolvedValueOnce('output-card').mockRejectedValue(new Error('deleted card'))
    const { terminal, send, failed } = fixture(screen)
    vi.mocked(terminal.read).mockResolvedValue('first')
    publishTerminalOutput('session', '\x1b[Hfirst'); await vi.advanceTimersByTimeAsync(1000)
    vi.mocked(terminal.read).mockResolvedValue('second')
    publishTerminalOutput('session', '\x1b[Hsecond'); await vi.advanceTimersByTimeAsync(3000)
    expect(failed).toHaveBeenCalledOnce()
    publishTerminalOutput('session', '\x1b[Hthird'); await vi.advanceTimersByTimeAsync(5000)
    expect(screen).toHaveBeenCalledTimes(2); expect(send).not.toHaveBeenCalled()
  })
  it('retries a stale one-shot menu read without another output event and then stops reading', async () => {
    const sendScreen = vi.fn(async () => 'menu-card')
    const { terminal, send } = fixture(sendScreen)
    vi.mocked(terminal.read).mockResolvedValueOnce('').mockResolvedValue('Update available\n1. Update now\n2. Skip\nenter / esc')
    publishTerminalOutput('session', '\x1b[HUpdate available')
    await vi.advanceTimersByTimeAsync(1000)
    expect(sendScreen).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sendScreen).toHaveBeenCalledOnce()
    expect(sendScreen).toHaveBeenCalledWith(message, expect.stringContaining('2. Skip'), undefined)
    await vi.advanceTimersByTimeAsync(10000)
    expect(sendScreen).toHaveBeenCalledOnce()
    expect(terminal.read).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
  })
  it('sends an initial screen then batches exact-session output without requiring /read', async () => {
    const { send } = fixture()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenLastCalledWith(message, '$ prompt')
    publishTerminalOutput('other-session', 'private')
    publishTerminalOutput('session', 'hello '); publishTerminalOutput('session', 'world\r\n')
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenLastCalledWith(message, 'hello world\n')
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(2)
    relay!.stop(); publishTerminalOutput('session', 'after stop')
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2)
  })
  it('decodes split ANSI sequences and uses changed screens for cursor-addressed TUI output', async () => {
    const decoder = new GatewayTextDecoder()
    expect(decoder.push('a\x1b[')).toBe('a')
    expect(decoder.push('31mb\x1b]52;secret')).toBe('b')
    expect(decoder.push('clipboard\x1b')).toBe('')
    expect(decoder.push('\\<at user_id="all">')).toBe('< at user_id="all">')
    expect(decoder.push('\x1b(Btext\x9dprivate\x9c')).toBe('text')
    const { send, terminal } = fixture()
    await vi.advanceTimersByTimeAsync(1000)
    vi.mocked(terminal.read).mockResolvedValue('model\nresponse')
    publishTerminalOutput('session', '\x1b[2J\x1b[Hraw redraw')
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenLastCalledWith(message, 'model\nresponse')
    publishTerminalOutput('session', '\x1b[Hsame redraw')
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2)
  })
  it('splits ordinary output into bounded batches and reports overflow', async () => {
    const { send } = fixture()
    await vi.advanceTimersByTimeAsync(1000)
    publishTerminalOutput('session', 'a'.repeat(7000))
    await vi.advanceTimersByTimeAsync(2000)
    expect(send.mock.calls.slice(1).map(call => call[1]).join('')).toBe('a'.repeat(7000))
    publishTerminalOutput('session', 'x'.repeat(70000))
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenLastCalledWith(message, expect.stringContaining('部分内容已省略'))
  })
  it('stops output when authorization is revoked or delivery fails', async () => {
    const { send, valid, failed } = fixture()
    valid.mockResolvedValue(false)
    publishTerminalOutput('session', 'private')
    await vi.advanceTimersByTimeAsync(1000); expect(send).not.toHaveBeenCalled()
    relay!.stop()
    const next = fixture(); next.send.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(next.failed).toHaveBeenCalledOnce()
    publishTerminalOutput('session', 'not retried'); await vi.advanceTimersByTimeAsync(2000)
    expect(next.send).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled()
  })
  it('rechecks identity and permission after a slow read before sending', async () => {
    const { terminal, send, valid } = fixture()
    let finish!: (text: string) => void
    vi.mocked(terminal.read).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(1000)
    valid.mockResolvedValue(false); finish('secret screen')
    await relay!.drain(); expect(send).not.toHaveBeenCalled()
  })
  it.each(['bind', 'card', 'create'] as const)('implicitly replaces the old binding through %s without requiring unbind', async mode => {
    const second = { panelId: 'panel-b', sessionId: 'session-b' }
    const terminals = [binding, second].map(target => ({ ...target, title: target.panelId, kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }))
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => terminals), read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      create: vi.fn(async () => terminals[1]),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const policy: GatewayPolicy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }
    const state = new GatewayStateStore()
    const send = vi.fn(async (_message: GatewayMessage, _text: string) => {})
    const replies: GatewayReply[] = []
    core = new GatewayCore({ policy: () => policy, terminal, state, send, reply: async (_message, reply) => { replies.push(reply) }, audit: vi.fn() })
    await core.receive(message); await core.drain(); await vi.advanceTimersByTimeAsync(1000)
    publishTerminalOutput('session', 'old buffered output')
    if (mode === 'card') {
      await core.receive({ ...message, messageId: 'choices', text: '/sessions' }); await core.drain()
      const card = replies.at(-1) as GatewayCard
      await core.receive({ ...message, messageId: 'switch', text: '', actionToken: card.buttons[1].token })
    } else {
      await core.receive({ ...message, messageId: 'switch', text: mode === 'bind' ? '/bind session-b' : '/new open:asset:asset' })
    }
    await core.drain(); await vi.advanceTimersByTimeAsync(1000)
    expect(state.bindingCount).toBe(1)
    expect(send).not.toHaveBeenCalled()
    await core.receive({ ...message, messageId: 'new-input', text: 'pwd' }); await core.drain()
    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write).toHaveBeenNthCalledWith(1, second, 'pwd')
    expect(terminal.write).toHaveBeenNthCalledWith(2, second, '\r')
    publishTerminalOutput('session', 'old late output')
    publishTerminalOutput('session-b', 'new output')
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat' }), 'new output')
  })
  it('retains the current binding and output when the requested replacement is unavailable', async () => {
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const policy: GatewayPolicy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }
    const send = vi.fn(async (_message: GatewayMessage, _text: string) => {})
    core = new GatewayCore({ policy: () => policy, terminal, state: new GatewayStateStore(), send, reply: vi.fn(async () => {}), audit: vi.fn() })
    await core.receive(message); await core.drain(); await vi.advanceTimersByTimeAsync(1000)
    await core.receive({ ...message, messageId: 'invalid-switch', text: '/bind unavailable' }); await core.drain()
    await core.receive({ ...message, messageId: 'still-input', text: 'pwd' }); await core.drain()
    expect(terminal.write).toHaveBeenNthCalledWith(1, binding, 'pwd')
    expect(terminal.write).toHaveBeenNthCalledWith(2, binding, '\r')
    publishTerminalOutput('session', 'still connected'); await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledWith(message, 'still connected')
  })
  it('integrates binding, input and output, then stops on unbind, rebind and terminal restart', async () => {
    const terminal: GatewayTerminalPort = {
      list: vi.fn(async () => [{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }]),
      read: vi.fn(async () => ''), write: vi.fn(async () => {}),
      subscribe: (target, receive) => subscribeTerminalOutput(target.sessionId, receive)
    }
    const policy: GatewayPolicy = { allowedUserIds: ['user'], allowedGroupIds: [], allowedAssetIds: ['asset'], allowLocalTerminal: false }
    const send = vi.fn(async (_message: GatewayMessage, _text: string) => {})
    core = new GatewayCore({ policy: () => policy, terminal, state: new GatewayStateStore(), send, reply: vi.fn(async () => {}), audit: vi.fn() })
    await core.receive(message); await core.drain(); await vi.advanceTimersByTimeAsync(1000)
    await core.receive({ ...message, messageId: 'input', text: 'pwd' }); await core.drain()
    expect(terminal.write).toHaveBeenNthCalledWith(1, binding, 'pwd')
    expect(terminal.write).toHaveBeenNthCalledWith(2, binding, '\r')
    publishTerminalOutput('session', '/home/user\n'); await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenLastCalledWith(message, '/home/user\n')
    await core.receive({ ...message, messageId: 'unbind', text: '/unbind' }); await core.drain()
    publishTerminalOutput('session', 'after unbind'); await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledOnce()
    await core.receive({ ...message, messageId: 'rebind' }); await core.drain()
    vi.mocked(terminal.list).mockResolvedValue([{ ...binding, sessionId: 'restarted', title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }])
    publishTerminalOutput('session', 'late'); await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(2)
    vi.mocked(terminal.list).mockResolvedValue([{ ...binding, title: 'Host', kind: 'ssh' as const, connected: true, assetId: 'asset', active: false }])
    await core.receive({ ...message, messageId: 'bind-after-restart' }); await core.drain()
    policy.allowedAssetIds = []
    publishTerminalOutput('session', 'revoked'); await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
