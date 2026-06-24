import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexConversationRecord } from '@/services/ai/aiPanelCodexRuntime'
import {
  codexTerminalCopyShortcut,
  createAiPanelCodexTerminalRuntime,
  type AiPanelCodexTerminalConversation,
  type AiPanelCodexTerminalLike,
  type AiPanelCodexResizeObserverLike,
  type AiPanelCodexSessionClient
} from '@/services/ai/aiPanelCodexTerminalRuntime'
import type { CodexSessionDataEvent, CodexSessionExitEvent, CodexSessionLifecycleEvent, CodexSessionTargetContext } from '@shared/contracts/codexSessions'

type TestConversation = AiPanelCodexTerminalConversation<FakeTerminal, FakeFit>

const terminalSettings = {
  terminalType: 'xterm-256color',
  fontFamily: 'JetBrains Mono',
  fontSize: 13,
  lineHeight: 1.1,
  cursorBlink: true,
  cursorStyle: 'bar' as const,
  scrollBack: 2000
}

const target: CodexSessionTargetContext = {
  kind: 'local',
  panelId: 'panel-1',
  sessionId: 'terminal-1',
  label: 'Local terminal',
  cwd: '/repo'
}

class FakeFit {
  fit = vi.fn()
}

class FakeResizeObserver implements AiPanelCodexResizeObserverLike {
  static instances: FakeResizeObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(public readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
}

class FakeTerminal implements AiPanelCodexTerminalLike {
  static instances: FakeTerminal[] = []
  cols = 120
  rows = 40
  options: AiPanelCodexTerminalLike['options'] = {}
  loadAddon = vi.fn()
  open = vi.fn()
  focus = vi.fn()
  clear = vi.fn()
  dispose = vi.fn()
  output = ''
  write = vi.fn((data: string, callback?: () => void) => {
    this.output += data
    callback?.()
  })
  getSelection = vi.fn(() => '')
  attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
    this.keyHandler = handler
  })
  onData = vi.fn((handler: (data: string) => void) => {
    this.dataHandler = handler
  })
  onResize = vi.fn((handler: (size: { cols: number; rows: number }) => unknown) => {
    this.resizeHandler = handler
  })
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  dataHandler: ((data: string) => void) | null = null
  resizeHandler: ((size: { cols: number; rows: number }) => unknown) | null = null
  constructor(public readonly initialOptions: ConstructorParameters<typeof import('@xterm/xterm').Terminal>[0]) {
    FakeTerminal.instances.push(this)
    Object.assign(this.options, initialOptions)
  }
}

const createConversation = (boundTarget: CodexSessionTargetContext | null = target): TestConversation =>
  createCodexConversationRecord<TestConversation>('codex-1', boundTarget, {
    host: null,
    terminal: null,
    fit: null,
    resizeObserver: null
  })

const createClient = () => {
  let dataHandler: ((event: CodexSessionDataEvent) => void) | undefined
  let lifecycleHandler: ((event: CodexSessionLifecycleEvent) => void) | undefined
  let exitHandler: ((event: CodexSessionExitEvent) => void) | undefined
  const createCodexSessionBridge = vi.fn(async () => ({
    id: 'codex-session-1',
    cwd: '/repo',
    codexHome: '/tmp/codex',
    runtimeKind: 'pty' as const,
    binaryPath: '/usr/bin/codex',
    lifecycle: {
      id: 'codex-session-1',
      stage: 'ready' as const,
      at: 1
    }
  }))
  const setCodexSessionTargetBridge = vi.fn(async () => ({ ok: true, data: { registered: true } }))
  const setCodexSessionPendingContextBridge = vi.fn(async (id: string, text = '') => ({
    ok: true,
    data: { id, bytes: text.length, cleared: !text }
  }))
  const writeCodexSessionBridge = vi.fn(async (id: string, data: string) => ({
    ok: true,
    data: { id, bytes: data.length }
  }))
  const resizeCodexSessionBridge = vi.fn(async () => undefined)
  const killCodexSessionBridge = vi.fn(async (id: string) => ({
    ok: true,
    data: { id }
  }))
  const onDataBridge = vi.fn((handler) => {
    dataHandler = handler
    return vi.fn()
  })
  const onLifecycleBridge = vi.fn((handler) => {
    lifecycleHandler = handler
    return vi.fn()
  })
  const onExitBridge = vi.fn((handler) => {
    exitHandler = handler
    return vi.fn()
  })
  const client: AiPanelCodexSessionClient = {
    createCodexSession: vi.fn(() => createCodexSessionBridge),
    setCodexSessionTarget: vi.fn(() => setCodexSessionTargetBridge),
    setCodexSessionPendingContext: vi.fn(() => setCodexSessionPendingContextBridge),
    writeCodexSession: vi.fn(() => writeCodexSessionBridge),
    resizeCodexSession: vi.fn(() => resizeCodexSessionBridge),
    killCodexSession: vi.fn(() => killCodexSessionBridge),
    onCodexSessionData: vi.fn(() => onDataBridge),
    onCodexSessionLifecycle: vi.fn(() => onLifecycleBridge),
    onCodexSessionExit: vi.fn(() => onExitBridge)
  }
  return {
    client,
    bridges: {
      createCodexSessionBridge,
      setCodexSessionTargetBridge,
      setCodexSessionPendingContextBridge,
      writeCodexSessionBridge,
      resizeCodexSessionBridge,
      killCodexSessionBridge,
      onDataBridge,
      onLifecycleBridge,
      onExitBridge
    },
    emitData: (event: CodexSessionDataEvent) => dataHandler?.(event),
    emitLifecycle: (event: CodexSessionLifecycleEvent) => lifecycleHandler?.(event),
    emitExit: (event: CodexSessionExitEvent) => exitHandler?.(event)
  }
}

const createRuntime = (conversation = createConversation(), clientBundle = createClient()) => {
  const conversations = [conversation]
  let activeConversationId = conversation.id
  const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = []
  const notices: string[] = []
  const attention = vi.fn()
  const runtime = createAiPanelCodexTerminalRuntime<TestConversation>({
    conversations: () => conversations,
    activeConversation: () => conversations.find((item) => item.id === activeConversationId) || null,
    activeConversationId: () => activeConversationId,
    terminalSettings: () => terminalSettings,
    currentBoundTarget: (item) => item.boundTarget,
    isConversationVisible: (item) => item.id === activeConversationId,
    syncAttentionState: attention,
    labels: {
      error: () => 'Codex error',
      bridgeMissing: () => 'Bridge missing',
      startFailed: () => 'Start failed',
      copyEmpty: () => 'Select content first',
      copySuccess: () => 'Copied',
      copyFailure: () => 'Copy failed'
    },
    notify: (message) => notices.push(message),
    afterDomUpdate: () => Promise.resolve(),
    copyText: vi.fn(async () => true),
    log: (level, event, fields) => logs.push({ level, event, fields }),
    client: clientBundle.client,
    requestFrame: (callback) => callback(),
    terminalConstructor: FakeTerminal,
    fitConstructor: FakeFit,
    resizeObserverFactory: (callback) => new FakeResizeObserver(callback)
  })
  return {
    runtime,
    conversation,
    conversations,
    clientBundle,
    logs,
    notices,
    attention,
    setActiveConversationId: (id: string) => {
      activeConversationId = id
    }
  }
}

const flushAsyncHandlers = () => new Promise((resolve) => window.setTimeout(resolve, 0))

afterEach(() => {
  document.body.replaceChildren()
  FakeTerminal.instances = []
  FakeResizeObserver.instances = []
  vi.restoreAllMocks()
})

describe('aiPanelCodexTerminalRuntime', () => {
  it('recognizes Codex terminal copy shortcuts', () => {
    expect(codexTerminalCopyShortcut({ key: 'c', shiftKey: true, ctrlKey: true, metaKey: false, altKey: false })).toBe(true)
    expect(codexTerminalCopyShortcut({ key: 'c', shiftKey: true, ctrlKey: false, metaKey: true, altKey: false })).toBe(true)
    expect(codexTerminalCopyShortcut({ key: 'c', shiftKey: false, ctrlKey: false, metaKey: true, altKey: false })).toBe(true)
    expect(codexTerminalCopyShortcut({ key: 'c', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false })).toBe(false)
    expect(codexTerminalCopyShortcut({ key: 'x', shiftKey: true, ctrlKey: true, metaKey: false, altKey: false })).toBe(false)
  })

  it('creates a terminal, applies settings, copies selections, writes input, and resizes through injected bridges', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { runtime, conversation, clientBundle, notices, logs } = createRuntime()
    runtime.setHostElement(conversation, host)
    const terminal = conversation.terminal
    if (!terminal) throw new Error('terminal was not created')

    expect(terminal.open).toHaveBeenCalledWith(host)
    expect(terminal.loadAddon).toHaveBeenCalledWith(conversation.fit)
    expect(terminal.options).toMatchObject({
      termName: 'xterm-256color',
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 2000
    })
    expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledWith(host)

    expect(await runtime.copySelection('contextmenu')).toBe(false)
    expect(notices.at(-1)).toBe('Select content first')
    terminal.getSelection = vi.fn(() => 'selected output')
    expect(await runtime.copySelection('contextmenu')).toBe(true)
    expect(notices.at(-1)).toBe('Copied')

    const keyEvent = new KeyboardEvent('keydown', { key: 'C', shiftKey: true, ctrlKey: true })
    const preventDefault = vi.spyOn(keyEvent, 'preventDefault')
    const stopPropagation = vi.spyOn(keyEvent, 'stopPropagation')
    expect(terminal.keyHandler?.(keyEvent)).toBe(false)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()

    conversation.sessionId = 'codex-session-1'
    terminal.dataHandler?.('ls\n')
    await flushAsyncHandlers()
    expect(clientBundle.bridges.setCodexSessionTargetBridge).toHaveBeenCalledWith(target)
    expect(clientBundle.bridges.writeCodexSessionBridge).toHaveBeenCalledWith('codex-session-1', 'ls\n')

    terminal.resizeHandler?.({ cols: 100, rows: 24 })
    expect(conversation.lastFitCols).toBe(100)
    expect(conversation.lastFitRows).toBe(24)
    expect(clientBundle.bridges.resizeCodexSessionBridge).toHaveBeenCalledWith('codex-session-1', 100, 24)
    expect(logs.some((entry) => entry.event === 'renderer.codex-terminal.created')).toBe(true)
  })

  it('starts, subscribes, syncs, stops, and disposes Codex sessions through one runtime boundary', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { runtime, conversation, clientBundle, attention } = createRuntime()
    runtime.setHostElement(conversation, host)

    await runtime.startSession(conversation)
    expect(conversation).toMatchObject({
      sessionId: 'codex-session-1',
      status: 'ready',
      pendingTargetSignature: ''
    })
    expect(clientBundle.bridges.createCodexSessionBridge).toHaveBeenCalledWith({ cols: 120, rows: 40, target })
    expect(clientBundle.client.onCodexSessionData).toHaveBeenCalledTimes(1)
    expect(clientBundle.client.onCodexSessionLifecycle).toHaveBeenCalledTimes(1)
    expect(clientBundle.client.onCodexSessionExit).toHaveBeenCalledTimes(1)
    expect(conversation.terminal?.focus).toHaveBeenCalled()

    clientBundle.emitData({ id: 'codex-session-1', data: 'hello' })
    await flushAsyncHandlers()
    expect(conversation.terminal?.write).toHaveBeenCalledWith('hello', expect.any(Function))

    clientBundle.emitLifecycle({ id: 'codex-session-1', stage: 'error', at: 2, errorMessage: 'failed' })
    expect(conversation).toMatchObject({ status: 'error', error: 'failed' })
    expect(attention).toHaveBeenCalledWith(conversation)

    clientBundle.emitExit({ id: 'codex-session-1', code: 1, errorCode: 'EFAIL', errorMessage: 'exit failed' })
    expect(conversation).toMatchObject({ status: 'error', error: 'exit failed' })

    const nextTarget: CodexSessionTargetContext = { ...target, sessionId: 'terminal-2', label: 'Next terminal' }
    await runtime.setPendingTargetContext(conversation, 'changed', nextTarget)
    expect(clientBundle.bridges.setCodexSessionPendingContextBridge).toHaveBeenCalledWith(
      'codex-session-1',
      expect.stringContaining('[aiopsterm target changed]')
    )
    await runtime.syncActiveBridgeTarget()
    expect(clientBundle.bridges.setCodexSessionTargetBridge).toHaveBeenCalledWith(target)

    await runtime.clearSessionTarget(conversation)
    expect(clientBundle.bridges.setCodexSessionTargetBridge).toHaveBeenCalledWith(undefined)

    await runtime.stopSession(conversation)
    expect(clientBundle.bridges.killCodexSessionBridge).toHaveBeenCalledWith('codex-session-1')

    runtime.disposeConversation(conversation)
    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalled()
    expect(conversation.terminal).toBeNull()
    expect(conversation.fit).toBeNull()
  })

  it('coalesces Codex session output and waits for xterm write callbacks', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { runtime, conversation, clientBundle } = createRuntime()
    runtime.setHostElement(conversation, host)
    await runtime.startSession(conversation)
    const terminal = conversation.terminal
    if (!terminal) throw new Error('terminal was not created')
    const callbacks: Array<() => void> = []
    terminal.write.mockImplementation((data: string, callback?: () => void) => {
      terminal.output += data
      if (callback) callbacks.push(callback)
    })
    terminal.write.mockClear()

    clientBundle.emitData({ id: 'codex-session-1', data: 'one' })
    clientBundle.emitData({ id: 'codex-session-1', data: 'two' })
    await flushAsyncHandlers()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('onetwo', expect.any(Function))
    expect(callbacks).toHaveLength(1)

    clientBundle.emitData({ id: 'codex-session-1', data: 'three' })
    await flushAsyncHandlers()
    expect(terminal.write).toHaveBeenCalledTimes(1)

    callbacks.shift()?.()
    await flushAsyncHandlers()

    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write).toHaveBeenLastCalledWith('three', expect.any(Function))
  })

  it('defers hidden Codex conversation output until the conversation is visible again', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const first = createConversation()
    const second = createConversation({ ...target, sessionId: 'terminal-2', panelId: 'panel-2', label: 'Second terminal' })
    second.id = 'codex-2'
    const clientBundle = createClient()
    const harness = createRuntime(first, clientBundle)
    harness.conversations.push(second)
    harness.runtime.setHostElement(first, host)
    await harness.runtime.startSession(first)
    first.sessionId = 'codex-session-1'
    second.sessionId = 'codex-session-2'
    const terminal = first.terminal
    if (!terminal) throw new Error('terminal was not created')
    terminal.write.mockClear()

    harness.setActiveConversationId(second.id)
    clientBundle.emitData({ id: 'codex-session-1', data: 'hidden output' })
    await flushAsyncHandlers()

    expect(terminal.write).not.toHaveBeenCalled()

    harness.setActiveConversationId(first.id)
    harness.runtime.syncConversationOutput(first)
    await flushAsyncHandlers()

    expect(terminal.write).toHaveBeenCalledWith('hidden output', expect.any(Function))
  })
})
