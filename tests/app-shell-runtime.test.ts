import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createAppShellRuntime, type AppShellRuntimeOptions } from '@/services/app/appShellRuntime'
import type { I18nKey, SupportedLocale } from '@/i18n'
import type {
  AiAgentSessionEvent,
  ManagedAiSessionEvent,
  ManagedAiSessionFocusRequest
} from '@shared/contracts/managedAiSessions'
import type { TerminalKeyboardInteractiveRequest, TerminalKeyboardInteractiveResult } from '@shared/contracts/terminalSessions'
import type { AiopstermDeepLinkPayload } from '@shared/deepLink'

const terminalMfaRequest = (input: Partial<TerminalKeyboardInteractiveRequest> = {}): TerminalKeyboardInteractiveRequest => ({
  id: 'ssh-mfa-1',
  connectionId: 'ssh-session-1',
  host: '203.0.113.10',
  port: 2222,
  username: 'root',
  purpose: 'keyboard-interactive',
  prompts: [{ prompt: 'Verification code:', echo: false }],
  attempts: 1,
  maxAttempts: 1,
  timeoutMs: 180000,
  ...input
})

const deepLinkPayload = (input: Partial<AiopstermDeepLinkPayload> = {}): AiopstermDeepLinkPayload => ({
  url: 'aiopsterm://open/settings',
  action: 'open',
  target: 'settings',
  module: 'settings',
  settingsSection: 'general',
  acceptedAt: 1780490000000,
  ...input
})

const aiAgentEvent = (input: Partial<AiAgentSessionEvent> = {}): AiAgentSessionEvent => ({
  source: 'codex',
  event: 'notification',
  sessionId: 'session-1',
  title: 'Agent session',
  summary: 'Needs attention',
  receivedAt: 1780490000000,
  ...input
})

const createWindowHarness = () => {
  const listeners = new Map<string, EventListener[]>()
  return {
    windowRef: {
      innerWidth: 1200,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), listener])
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener))
      })
    },
    emit: (type: string, event: Event) => {
      listeners.get(type)?.forEach((listener) => listener(event))
    },
    listenerCount: (type: string) => listeners.get(type)?.length || 0
  }
}

const createHarness = (overrides: Partial<AppShellRuntimeOptions> = {}, workspaceOverrides: Record<string, unknown> = {}) => {
  const locale = ref<SupportedLocale>('zh-CN')
  const win = createWindowHarness()
  const bodyClassList = {
    add: vi.fn(),
    remove: vi.fn()
  }
  const listeners = {
    deepLink: undefined as ((payload: AiopstermDeepLinkPayload) => void) | undefined,
    terminalRequest: undefined as ((request: TerminalKeyboardInteractiveRequest) => void) | undefined,
    terminalResult: undefined as ((result: TerminalKeyboardInteractiveResult) => void) | undefined,
    aiAgentEvent: undefined as ((event: AiAgentSessionEvent) => void) | undefined,
    managedEvent: undefined as ((event: ManagedAiSessionEvent) => void) | undefined,
    managedFocus: undefined as ((request: ManagedAiSessionFocusRequest) => void) | undefined
  }
  const stops = {
    deepLink: vi.fn(),
    terminalRequest: vi.fn(),
    terminalResult: vi.fn(),
    aiAgentEvent: vi.fn(),
    managedEvent: vi.fn(),
    managedFocus: vi.fn()
  }
  const workspace = {
    activeModule: 'workspace',
    activeCenterSurface: 'main-workspace',
    agentsLeftOpen: true,
    agentsLeftWidth: 286,
    config: {
      background: { mode: 'none' },
      language: 'zh-CN'
    },
    mode: 'terminal',
    isLeftVisible: true,
    isRightVisible: true,
    leftPanelWidth: 286,
    rightPanelWidth: 360,
    installShortcutRuntime: vi.fn(),
    uninstallShortcutRuntime: vi.fn(),
    hydrateConfig: vi.fn(),
    refreshManagedAiSessions: vi.fn(async () => true),
    refreshManagedAiSessionsDebounced: vi.fn(),
    upsertManagedAiSession: vi.fn(),
    focusManagedAiSessionRequest: vi.fn(async () => null),
    handleDeepLink: vi.fn((payload) => Boolean(payload && typeof payload === 'object' && (payload as { module?: string }).module)),
    resizeLeftPanel: vi.fn(async (width: number) => {
      workspace.leftPanelWidth = width
    }),
    resizeRightPanel: vi.fn(async (width: number) => {
      workspace.rightPanelWidth = width
    }),
    quickCloseLeftPanel: vi.fn(async () => {
      workspace.isLeftVisible = false
    }),
    quickCloseRightPanel: vi.fn(async () => {
      workspace.isRightVisible = false
    }),
    ...workspaceOverrides
  }
  const messages: Partial<Record<I18nKey, string>> = {
    'terminal.mfaTitle': 'MFA',
    'terminal.passwordTitle': 'SSH Password',
    'terminal.mfaRequired': 'Required',
    'terminal.passwordRequired': 'Password Required',
    'terminal.mfaPromptFallback': 'Code',
    'terminal.passwordPromptFallback': 'Password',
    'terminal.mfaDescription': 'MFA for {target}',
    'terminal.passwordDescription': 'Password for {target}',
    'terminal.passwordRejectedDescription': 'Rejected password for {target}',
    'terminal.mfaEmpty': 'Empty auth',
    'terminal.mfaFailed': 'Auth failed'
  }
  const clients: AppShellRuntimeOptions['clients'] = {
    appRuntime: {
      consumeDeepLinks: vi.fn(() => vi.fn(async () => [])),
      onDeepLink: vi.fn(() => (listener: (payload: AiopstermDeepLinkPayload) => void) => {
        listeners.deepLink = listener
        return stops.deepLink
      })
    },
    terminal: {
      respondTerminalKeyboardInteractive: vi.fn(() => vi.fn()),
      cancelTerminalKeyboardInteractive: vi.fn(() => vi.fn()),
      onTerminalKeyboardInteractiveRequest: vi.fn(() => (listener: (request: TerminalKeyboardInteractiveRequest) => void) => {
        listeners.terminalRequest = listener
        return stops.terminalRequest
      }),
      onTerminalKeyboardInteractiveResult: vi.fn(() => (listener: (result: TerminalKeyboardInteractiveResult) => void) => {
        listeners.terminalResult = listener
        return stops.terminalResult
      })
    },
    managedAi: {
      onAiAgentSessionEvent: vi.fn(() => (listener: (event: AiAgentSessionEvent) => void) => {
        listeners.aiAgentEvent = listener
        return stops.aiAgentEvent
      }),
      onManagedAiSessionEvent: vi.fn(() => (listener: (event: ManagedAiSessionEvent) => void) => {
        listeners.managedEvent = listener
        return stops.managedEvent
      }),
      onManagedAiSessionFocusRequest: vi.fn(() => (listener: (request: ManagedAiSessionFocusRequest) => void) => {
        listeners.managedFocus = listener
        return stops.managedFocus
      })
    }
  }
  const options: AppShellRuntimeOptions = {
    workspace: workspace as unknown as AppShellRuntimeOptions['workspace'],
    t: (key) => messages[key] || key,
    applyLocale: vi.fn(),
    clients,
    afterDomUpdate: nextTick,
    windowRef: win.windowRef as unknown as AppShellRuntimeOptions['windowRef'],
    bodyClassList,
    ...overrides
  }
  const runtime = createAppShellRuntime(options)
  return {
    bodyClassList,
    clients,
    listeners,
    locale,
    options,
    runtime,
    stops,
    win,
    workspace
  }
}

describe('appShellRuntime', () => {
  it('owns layout pane visibility, draft widths, persistence, and quick close behavior', async () => {
    const { bodyClassList, runtime, win, workspace } = createHarness()

    expect(runtime.showTerminalLeftPane.value).toBe(true)
    expect(runtime.showTerminalRightPane.value).toBe(true)
    expect(runtime.showRightPane.value).toBe(true)
    expect(runtime.showTerminalWorkspace.value).toBe(true)
    runtime.startResize('left', new MouseEvent('mousedown', { clientX: 286 }))
    expect(bodyClassList.add).toHaveBeenCalledWith('layout-resizing')
    win.emit('mousemove', new MouseEvent('mousemove', { clientX: 336 }))
    expect(runtime.displayLeftPanelWidth.value).toBe(336)
    win.emit('mouseup', new MouseEvent('mouseup'))
    await Promise.resolve()
    expect(workspace.resizeLeftPanel).toHaveBeenCalledWith(336)
    expect(bodyClassList.remove).toHaveBeenCalledWith('layout-resizing')

    runtime.startResize('right', new MouseEvent('mousedown', { clientX: 840 }))
    win.emit('mousemove', new MouseEvent('mousemove', { clientX: 1170 }))
    await Promise.resolve()
    expect(workspace.quickCloseRightPanel).toHaveBeenCalled()
    expect(workspace.resizeRightPanel).not.toHaveBeenCalled()
    expect(runtime.draggingSide.value).toBeNull()
  })

  it('keeps the terminal workspace visible for terminal modules and throughout Agents mode', () => {
    ;(['workspace', 'aiSessions', 'snippets', 'knowledge'] as const).forEach((module) => {
      const { runtime } = createHarness({}, { activeModule: module, activeCenterSurface: 'main-workspace' })
      expect(runtime.showTerminalWorkspace.value).toBe(true)
    })
    ;(['assets', 'files', 'extensions', 'kubernetes', 'settings', 'database', 'user'] as const).forEach((module) => {
      const { runtime } = createHarness({}, { activeModule: module, activeCenterSurface: module })
      expect(runtime.showTerminalWorkspace.value).toBe(false)
    })

    ;(['workspace', 'assets', 'files', 'database', 'user'] as const).forEach((module) => {
      const { runtime } = createHarness({}, { mode: 'agents', activeModule: module, activeCenterSurface: module === 'workspace' ? 'main-workspace' : module })
      expect(runtime.showTerminalWorkspace.value).toBe(true)
    })
  })

  it('never renders Assets as a terminal left pane', () => {
    const { runtime } = createHarness({}, {
      activeModule: 'assets',
      activeCenterSurface: 'main-workspace',
      isLeftVisible: true
    })

    expect(runtime.showTerminalLeftPane.value).toBe(false)
    expect(runtime.hasLeftPane.value).toBe(false)
    expect(runtime.showTerminalWorkspace.value).toBe(true)
  })

  it('keeps the Agents terminal and right AI pane visible without allowing a drag-to-close', async () => {
    const { runtime, win, workspace } = createHarness({}, {
      mode: 'agents',
      activeModule: 'database',
      isRightVisible: false
    })

    expect(runtime.showAgentsLeftPane.value).toBe(true)
    expect(runtime.showTerminalLeftPane.value).toBe(false)
    expect(runtime.showTerminalRightPane.value).toBe(false)
    expect(runtime.showRightPane.value).toBe(true)
    expect(runtime.showTerminalWorkspace.value).toBe(true)
    expect(runtime.hasLeftPane.value).toBe(true)
    expect(runtime.hasRightPane.value).toBe(true)

    runtime.startResize('right', new MouseEvent('mousedown', { clientX: 840 }))
    win.emit('mousemove', new MouseEvent('mousemove', { clientX: 1170 }))
    expect(runtime.displayRightPanelWidth.value).toBe(220)
    expect(workspace.quickCloseRightPanel).not.toHaveBeenCalled()
    expect(runtime.draggingSide.value).toBe('right')
    win.emit('mouseup', new MouseEvent('mouseup'))
    await Promise.resolve()
    expect(workspace.resizeRightPanel).toHaveBeenCalledWith(220)
  })

  it('owns terminal authentication dialog state and response routing', async () => {
    const { clients, runtime } = createHarness()
    const respond = vi.fn()
    vi.mocked(clients.terminal.respondTerminalKeyboardInteractive).mockReturnValue(respond)

    runtime.handleTerminalMfaRequest(terminalMfaRequest())
    await nextTick()
    expect(runtime.terminalMfaDialog.value.open).toBe(true)
    expect(runtime.terminalAuthDescription.value).toBe('MFA for root@203.0.113.10:2222')
    runtime.submitTerminalMfa()
    expect(runtime.terminalMfaDialog.value.error).toBe('Empty auth')

    runtime.terminalMfaDialog.value.responses[0] = '654321'
    runtime.submitTerminalMfa()
    expect(respond).toHaveBeenCalledWith('ssh-mfa-1', ['654321'])

    runtime.handleTerminalMfaResult({ id: 'ssh-mfa-1', status: 'failed', attempts: 1, errorMessage: 'try again' })
    expect(runtime.terminalMfaDialog.value.submitting).toBe(false)
    expect(runtime.terminalMfaDialog.value.error).toBe('try again')

    runtime.terminalMfaDialog.value.responses[0] = '654321'
    runtime.submitTerminalMfa()
    runtime.handleTerminalMfaResult({ id: 'ssh-mfa-1', status: 'success', attempts: 2, final: true })
    expect(runtime.terminalMfaDialog.value.open).toBe(false)
  })

  it('routes password prompts with remember-password payloads and cancellation', () => {
    const { clients, runtime } = createHarness()
    const respond = vi.fn()
    const cancel = vi.fn()
    vi.mocked(clients.terminal.respondTerminalKeyboardInteractive).mockReturnValue(respond)
    vi.mocked(clients.terminal.cancelTerminalKeyboardInteractive).mockReturnValue(cancel)

    runtime.handleTerminalMfaRequest(
      terminalMfaRequest({
        id: 'ssh-password-1',
        purpose: 'password',
        canRememberPassword: true,
        attempts: 2
      })
    )
    expect(runtime.showTerminalPasswordRemember.value).toBe(true)
    expect(runtime.terminalAuthDescription.value).toBe('Rejected password for root@203.0.113.10:2222')
    runtime.terminalMfaDialog.value.responses[0] = 'typed-password'
    runtime.terminalMfaDialog.value.rememberPassword = true
    runtime.submitTerminalMfa()
    expect(respond).toHaveBeenCalledWith('ssh-password-1', {
      responses: ['typed-password'],
      rememberPassword: true
    })

    runtime.cancelTerminalMfa()
    expect(cancel).toHaveBeenCalledWith('ssh-password-1')
    expect(runtime.terminalMfaDialog.value.open).toBe(false)
  })

  it('owns shell mount listeners, deep link consumption, locale application, and cleanup', async () => {
    const { listeners, options, runtime, stops, workspace } = createHarness()
    const settingsLink = deepLinkPayload()
    const databaseLink = deepLinkPayload({
      url: 'aiopsterm://open/database',
      target: 'database',
      module: 'database',
      settingsSection: undefined
    })
    const consume = vi.fn(async () => [settingsLink])
    vi.mocked(options.clients.appRuntime.consumeDeepLinks).mockReturnValue(consume)

    runtime.mount()
    await Promise.resolve()
    expect(workspace.installShortcutRuntime).toHaveBeenCalled()
    expect(workspace.hydrateConfig).toHaveBeenCalled()
    expect(workspace.refreshManagedAiSessions).toHaveBeenCalledWith({ silent: true })
    expect(consume).toHaveBeenCalled()
    expect(workspace.handleDeepLink).toHaveBeenCalledWith(settingsLink)

    listeners.deepLink?.(databaseLink)
    expect(workspace.handleDeepLink).toHaveBeenCalledWith(databaseLink)
    const agentEvent = aiAgentEvent()
    listeners.aiAgentEvent?.(agentEvent)
    expect(workspace.upsertManagedAiSession).toHaveBeenCalledWith(agentEvent)
    listeners.managedEvent?.({ name: 'session.updated', category: 'managed-ai', source: 'codex', payload: {} })
    expect(workspace.refreshManagedAiSessionsDebounced).toHaveBeenCalled()
    listeners.managedFocus?.({ sessionId: 'session-1' })
    expect(workspace.focusManagedAiSessionRequest).toHaveBeenCalledWith({ sessionId: 'session-1' })

    runtime.applyCurrentLocale('en-US')
    expect(options.applyLocale).toHaveBeenCalledWith('en-US')

    runtime.dispose()
    expect(stops.deepLink).toHaveBeenCalled()
    expect(stops.terminalRequest).toHaveBeenCalled()
    expect(stops.terminalResult).toHaveBeenCalled()
    expect(stops.aiAgentEvent).toHaveBeenCalled()
    expect(stops.managedEvent).toHaveBeenCalled()
    expect(stops.managedFocus).toHaveBeenCalled()
    expect(workspace.uninstallShortcutRuntime).toHaveBeenCalled()
  })
})
