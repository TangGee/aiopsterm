import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiSessionsPanelRuntime } from '../src/renderer/src/services/ai/aiSessionsPanelRuntime'
import { createManagedAiSessionTerminalSwitchTelemetry } from '../src/renderer/src/services/ai/managedAiSessionTerminalSwitchTelemetry'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('managed AI session terminal switch telemetry', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('correlates the five switch phases and measures frame readiness', async () => {
    const entries: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
    const frames: FrameRequestCallback[] = []
    let now = 100
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (level, event, fields = {}) => entries.push({ level, event, fields }),
      now: () => now,
      afterDomUpdate: () => {
        now = 109
      },
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      }
    })

    const trace = telemetry.requested({ source: 'codex', sessionId: 'session-1', trigger: 'row-double-click' })
    now = 104
    telemetry.targetResolved(trace, { targetPanelId: 'panel-2' })
    now = 106
    telemetry.panelActivated(trace, { activePanelId: 'panel-2', outcome: 'activated-existing' })
    now = 108
    telemetry.terminalFrameReady(trace, { terminalRenderer: 'threaded', frameSeq: 7 })
    telemetry.uiFrameReady(trace, () => ({ activePanelId: 'panel-2', targetActive: true }))

    await flushMicrotasks()
    expect(frames).toHaveLength(1)
    expect(entries.map((entry) => entry.event)).toEqual([
      'renderer.managed-ai-session.terminal-switch.requested',
      'renderer.managed-ai-session.terminal-switch.target-resolved',
      'renderer.managed-ai-session.terminal-switch.panel-activated'
    ])

    now = 116
    frames.shift()!(now)
    await flushMicrotasks()
    expect(frames).toHaveLength(1)
    expect(entries).toHaveLength(3)

    now = 132
    frames.shift()!(now)
    await flushMicrotasks()

    expect(entries.map((entry) => entry.event)).toEqual([
      'renderer.managed-ai-session.terminal-switch.requested',
      'renderer.managed-ai-session.terminal-switch.target-resolved',
      'renderer.managed-ai-session.terminal-switch.panel-activated',
      'renderer.managed-ai-session.terminal-switch.ui-frame-ready',
      'renderer.managed-ai-session.terminal-switch.terminal-frame-ready'
    ])
    expect(new Set(entries.map((entry) => entry.fields.interactionId))).toEqual(new Set([trace.interactionId]))
    expect(entries.at(-2)?.fields).toEqual(expect.objectContaining({
      phaseIndex: 4,
      targetResolveMs: 4,
      panelActivateMs: 2,
      vueCommitMs: 3,
      frameWaitMs: 23,
      uiDurationMs: 32,
      targetActive: true
    }))
    expect(entries.at(-1)?.fields).toEqual(expect.objectContaining({
      phaseIndex: 5,
      terminalRenderer: 'threaded',
      terminalFrameWaitMs: 2,
      durationMs: 32,
      frameSeq: 7
    }))
  })

  it('uses unique ids and supersedes an unfinished rapid switch', () => {
    const entries: Array<{ event: string; fields: Record<string, unknown> }> = []
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (_level, event, fields = {}) => entries.push({ event, fields }),
      now: () => 200
    })

    const first = telemetry.requested({ source: 'codex', sessionId: 'session-a' })
    const second = telemetry.requested({ source: 'codex', sessionId: 'session-b' })

    expect(first.interactionId).not.toBe(second.interactionId)
    expect(entries.map((entry) => entry.event)).toEqual([
      'renderer.managed-ai-session.terminal-switch.requested',
      'renderer.managed-ai-session.terminal-switch.superseded',
      'renderer.managed-ai-session.terminal-switch.requested'
    ])
    expect(entries[1].fields).toEqual(expect.objectContaining({
      interactionId: first.interactionId,
      supersededByInteractionId: second.interactionId,
      outcome: 'superseded'
    }))
    expect(telemetry.targetResolved(first, { targetPanelId: 'panel-a' })).toBe(false)
  })

  it('does not report frame readiness after another path changes the active panel', async () => {
    const entries: Array<{ event: string; fields: Record<string, unknown> }> = []
    const frames: FrameRequestCallback[] = []
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (_level, event, fields = {}) => entries.push({ event, fields }),
      now: () => 300,
      afterDomUpdate: () => Promise.resolve(),
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      }
    })
    const trace = telemetry.requested({ source: 'codex', sessionId: 'session-changed' })
    telemetry.targetResolved(trace, { targetPanelId: 'panel-target' })
    telemetry.panelActivated(trace, { activePanelId: 'panel-target' })
    telemetry.terminalFrameReady(trace, { terminalRenderer: 'threaded', frameSeq: 2 })
    telemetry.uiFrameReady(trace, () => ({ activePanelId: 'panel-other', targetActive: false }))

    await flushMicrotasks()
    frames.shift()!(300)
    await flushMicrotasks()
    frames.shift()!(300)
    await flushMicrotasks()

    expect(entries.at(-1)).toEqual(expect.objectContaining({
      event: 'renderer.managed-ai-session.terminal-switch.superseded',
      fields: expect.objectContaining({ outcome: 'target-changed-before-frame', targetActive: false })
    }))
    expect(entries.some((entry) => entry.event.endsWith('frame-ready'))).toBe(false)
  })

  it('cancels a pending terminal frame after the UI target changes', async () => {
    const entries: Array<{ event: string; fields: Record<string, unknown> }> = []
    const frames: FrameRequestCallback[] = []
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (_level, event, fields = {}) => entries.push({ event, fields }),
      now: () => 350,
      afterDomUpdate: () => Promise.resolve(),
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      }
    })
    const trace = telemetry.requested({ source: 'codex', sessionId: 'session-frame-pending' })
    telemetry.targetResolved(trace, { targetPanelId: 'panel-target' })
    telemetry.panelActivated(trace, { activePanelId: 'panel-target' })
    telemetry.uiFrameReady(trace, () => ({ activePanelId: 'panel-target', targetActive: true }))

    await flushMicrotasks()
    frames.shift()!(350)
    await flushMicrotasks()
    frames.shift()!(350)
    await flushMicrotasks()
    expect(entries.at(-1)?.event).toBe('renderer.managed-ai-session.terminal-switch.ui-frame-ready')

    telemetry.superseded(trace, {
      activePanelId: 'panel-other',
      outcome: 'target-changed-after-ui-frame'
    })
    expect(entries.at(-1)).toEqual(expect.objectContaining({
      event: 'renderer.managed-ai-session.terminal-switch.superseded',
      fields: expect.objectContaining({ outcome: 'target-changed-after-ui-frame' })
    }))
    expect(entries.some((entry) => entry.event.endsWith('terminal-frame-ready'))).toBe(false)
  })

  it('keeps resume telemetry separate from a later live-terminal switch', () => {
    const entries: Array<{ event: string; fields: Record<string, unknown> }> = []
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (_level, event, fields = {}) => entries.push({ event, fields }),
      now: () => 400
    })
    const resume = telemetry.requested({ source: 'codex', sessionId: 'history-session' })
    telemetry.resumeRequested(resume)
    const liveSwitch = telemetry.requested({ source: 'codex', sessionId: 'live-session' })
    telemetry.resumeFinished(resume, { outcome: 'resume-finished', activePanelId: 'panel-history' })

    expect(entries.map((entry) => entry.event)).toEqual([
      'renderer.managed-ai-session.terminal-switch.requested',
      'renderer.managed-ai-session.terminal-switch.resume-requested',
      'renderer.managed-ai-session.terminal-switch.requested',
      'renderer.managed-ai-session.terminal-switch.resume-finished'
    ])
    expect(entries.some((entry) => entry.event.endsWith('superseded'))).toBe(false)
    expect(entries.at(-1)?.fields.interactionId).toBe(resume.interactionId)
    expect(entries[2].fields.interactionId).toBe(liveSwitch.interactionId)
  })

  it('logs only real terminal switches from the panel runtime', async () => {
    const workspace = useWorkspaceStore()
    workspace.applyLocalTerminalSession('panel-main', {
      id: 'terminal-main',
      kind: 'local',
      shell: '/bin/bash',
      cwd: '/work/main'
    })
    const secondaryPanel = workspace.createPanel()
    workspace.applyLocalTerminalSession(secondaryPanel.id, {
      id: 'terminal-secondary',
      kind: 'local',
      shell: '/bin/bash',
      cwd: '/work/secondary'
    })
    workspace.upsertManagedAiSession({
      source: 'gemini',
      event: 'pre_tool_use',
      sessionId: 'gemini-session-1',
      title: 'Secondary task',
      summary: 'Working',
      panelId: secondaryPanel.id,
      terminalSessionId: 'terminal-secondary',
      receivedAt: 100
    })
    const session = workspace.managedAiSessions.find((item) => item.id === 'gemini-session-1')!
    workspace.selectPanelForLifecycle('panel-main')

    const entries: Array<{ event: string; fields: Record<string, unknown> }> = []
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({
      log: (_level, event, fields = {}) => entries.push({ event, fields }),
      afterDomUpdate: () => Promise.resolve(),
      requestFrame: (callback) => {
        queueMicrotask(() => callback(performance.now()))
        return 1
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => useAiSessionsPanelRuntime({ terminalSwitchTelemetry: telemetry }))!

    try {
      runtime.selectSession(session)
      expect(entries).toHaveLength(0)

      runtime.resumeOrFocusSession(session)
      expect(workspace.activePanelId).toBe(secondaryPanel.id)
      expect(workspace.panelFocusRequest).toEqual(expect.objectContaining({
        panelId: secondaryPanel.id,
        cause: 'pointer'
      }))
      const trace = telemetry.activeTraceForPanel(secondaryPanel.id)
      expect(trace).toBeTruthy()
      telemetry.terminalFrameReady(trace!, { terminalRenderer: 'threaded', frameSeq: 1 })
      await vi.waitFor(() => expect(entries.at(-1)?.event).toBe('renderer.managed-ai-session.terminal-switch.terminal-frame-ready'))

      expect(entries.map((entry) => entry.event)).toEqual([
        'renderer.managed-ai-session.terminal-switch.requested',
        'renderer.managed-ai-session.terminal-switch.target-resolved',
        'renderer.managed-ai-session.terminal-switch.panel-activated',
        'renderer.managed-ai-session.terminal-switch.ui-frame-ready',
        'renderer.managed-ai-session.terminal-switch.terminal-frame-ready'
      ])
      expect(new Set(entries.map((entry) => entry.fields.interactionId)).size).toBe(1)
      expect(entries.at(-1)?.fields).toEqual(expect.objectContaining({
        source: 'gemini',
        sessionId: 'gemini-session-1',
        previousPanelId: 'panel-main',
        targetPanelId: secondaryPanel.id,
        targetActive: true,
        outcome: 'activated-existing'
      }))
    } finally {
      scope.stop()
    }
  })

  it('reports an unavailable non-restorable session without scheduling frames', () => {
    const workspace = useWorkspaceStore()
    workspace.upsertManagedAiSession({
      source: 'codex',
      event: 'session_start',
      sessionId: 'child-session-1',
      title: 'Review only',
      summary: 'Imported child session',
      sessionKind: 'subagent',
      restorable: false,
      receivedAt: 100
    })
    const session = workspace.managedAiSessions.find((item) => item.id === 'child-session-1')!
    const log = vi.fn()
    const requestFrame = vi.fn()
    const telemetry = createManagedAiSessionTerminalSwitchTelemetry({ log, requestFrame })
    const scope = effectScope()
    const runtime = scope.run(() => useAiSessionsPanelRuntime({ terminalSwitchTelemetry: telemetry }))!

    try {
      runtime.resumeOrFocusSession(session)
      expect(requestFrame).not.toHaveBeenCalled()
      expect(log).toHaveBeenLastCalledWith(
        'warn',
        'renderer.managed-ai-session.terminal-switch.unavailable',
        expect.objectContaining({
          sessionId: 'child-session-1',
          outcome: 'not-restorable'
        })
      )
    } finally {
      scope.stop()
    }
  })

  it('creates a local Agent session and remembers the last selected Agent', async () => {
    const workspace = useWorkspaceStore()
    workspace.agentHookInstallers = [
      {
        source: 'codex',
        label: 'Codex',
        binaryName: 'codex',
        launchCommand: 'codex',
        binaryPath: '/usr/bin/codex',
        configPath: '/home/test/.codex/hooks.json',
        configExists: true,
        installed: false,
        scriptPath: '/opt/aiopsterm/agent-hook.js',
        warnings: []
      },
      {
        source: 'claude-code',
        label: 'Claude Code',
        binaryName: 'claude',
        launchCommand: 'claude',
        binaryPath: '/usr/bin/claude',
        configPath: '/home/test/.claude/settings.json',
        configExists: true,
        installed: true,
        scriptPath: '/opt/aiopsterm/agent-hook.js',
        warnings: []
      }
    ]
    vi.spyOn(workspace, 'refreshAgentHookInstallers').mockResolvedValue(true)
    vi.mocked(window.aiops.ensureLocalDirectory).mockResolvedValueOnce({
      ok: true,
      data: { directoryPath: '/work/project', created: false }
    })
    const openTerminal = vi.spyOn(workspace, 'openLocalTerminalPanel').mockResolvedValue({ id: 'panel-new' } as any)
    const runCommand = vi.spyOn(workspace, 'runTerminalCommand').mockResolvedValue({
      status: 'allow',
      execution: {
        command: 'claude',
        panelIds: ['panel-new'],
        inputText: 'claude',
        writeToShell: true,
        source: 'agent'
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => useAiSessionsPanelRuntime())!

    try {
      await runtime.openCreateDialog('/work/project')
      expect(runtime.createAgentOptions.value.find((agent) => agent.source === 'codex')).toEqual(
        expect.objectContaining({
          available: false,
          statusKey: 'aiSessions.agentHookMissing'
        })
      )
      expect(runtime.createAgentSource.value).toBe('claude-code')
      await expect(runtime.startCreatedSession()).resolves.toBe(true)
      await flushMicrotasks()

      expect(openTerminal).toHaveBeenCalledWith({
        title: 'Claude Code - project',
        cwd: '/work/project',
        preserveActiveModule: true
      })
      expect(window.aiops.ensureLocalDirectory).toHaveBeenCalledWith({
        directoryPath: '/work/project',
        createIfMissing: true
      })
      expect(runCommand).toHaveBeenCalledWith('panel-new', 'claude', {
        source: 'agent',
        writeToShell: true
      })
      expect(JSON.parse(window.localStorage.getItem('aiopsterm.aiSessionsPanelState') || '{}')).toEqual(
        expect.objectContaining({ lastCreatedAgentSource: 'claude-code' })
      )
    } finally {
      scope.stop()
    }
  })

  it('does not open a terminal when the project directory cannot be created', async () => {
    const workspace = useWorkspaceStore()
    workspace.agentHookInstallers = [
      {
        source: 'codex',
        label: 'Codex',
        binaryName: 'codex',
        launchCommand: 'codex',
        binaryPath: '/usr/bin/codex',
        configPath: '/home/test/.codex/hooks.json',
        configExists: true,
        installed: true,
        scriptPath: '/opt/aiopsterm/agent-hook.js',
        warnings: []
      }
    ]
    vi.spyOn(workspace, 'refreshAgentHookInstallers').mockResolvedValue(true)
    const openTerminal = vi.spyOn(workspace, 'openLocalTerminalPanel')
    vi.mocked(window.aiops.ensureLocalDirectory).mockResolvedValueOnce({
      ok: false,
      errorCode: 'LOCAL_DIRECTORY_PATH_NOT_ABSOLUTE'
    })
    const scope = effectScope()
    const runtime = scope.run(() => useAiSessionsPanelRuntime())!

    try {
      await runtime.openCreateDialog('relative/project')
      await expect(runtime.startCreatedSession()).resolves.toBe(false)
      expect(runtime.createError.value).toBe('请输入绝对路径或 ~/ 路径')
      expect(openTerminal).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })
})
