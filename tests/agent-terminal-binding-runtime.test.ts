import { describe, expect, it } from 'vitest'

const loadBindingRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentTerminalBindingRuntime'
  return import(modulePath) as Promise<{
    createAgentTerminalBindingRuntime: () => {
      apply: (input: Record<string, unknown>) => any
      releaseTerminal: (terminalSessionId: string) => any
      getByTerminal: (terminalSessionId: string) => any
    }
  }>
}

const loadAdapters = async () => {
  const modulePath = '../src/main/backend/agent/agentIntegrationAdapters'
  return import(modulePath) as Promise<{
    listAgentIntegrationAdapters: () => Array<{ id: string }>
    normalizeAgentIntegrationSource: (value: unknown) => string | null
    projectFileTrackingForAgent: (value: unknown) => string
  }>
}

describe('agent terminal binding runtime', () => {
  it('atomically moves a terminal from one agent session to another', async () => {
    const { createAgentTerminalBindingRuntime } = await loadBindingRuntime()
    const runtime = createAgentTerminalBindingRuntime()
    const first = runtime.apply({
      kind: 'activate',
      agentId: 'future-agent',
      sessionId: 'session-a',
      terminalSessionId: 'terminal-1',
      panelId: 'panel-1',
      at: 100
    })
    expect(first).toMatchObject({
      changed: true,
      previous: null,
      current: {
        agentId: 'future-agent',
        sessionId: 'session-a',
        terminalSessionId: 'terminal-1'
      }
    })

    const second = runtime.apply({
      kind: 'activate',
      agentId: 'future-agent',
      sessionId: 'session-b',
      terminalSessionId: 'terminal-1',
      panelId: 'panel-1',
      at: 200
    })
    expect(second.previous).toMatchObject({ sessionId: 'session-a' })
    expect(runtime.getByTerminal('terminal-1')).toMatchObject({ sessionId: 'session-b' })

    expect(runtime.apply({
      kind: 'end',
      agentId: 'future-agent',
      sessionId: 'session-a',
      terminalSessionId: 'terminal-1',
      at: 300
    }).changed).toBe(false)
    expect(runtime.getByTerminal('terminal-1')).toMatchObject({ sessionId: 'session-b' })

    expect(runtime.releaseTerminal('terminal-1').changed).toBe(true)
    expect(runtime.getByTerminal('terminal-1')).toBeNull()
  })
})

describe('agent integration adapters', () => {
  it('normalizes supported agent aliases through one registry', async () => {
    const {
      listAgentIntegrationAdapters,
      normalizeAgentIntegrationSource,
      projectFileTrackingForAgent
    } = await loadAdapters()
    expect(normalizeAgentIntegrationSource('claude_code_cli')).toBe('claude-code')
    expect(normalizeAgentIntegrationSource('cursor-agent')).toBe('cursor')
    expect(normalizeAgentIntegrationSource('hermes')).toBe('hermes-agent')
    expect(normalizeAgentIntegrationSource('unknown-agent')).toBeNull()
    expect(projectFileTrackingForAgent('cursor')).toBe('adapter')
    expect(projectFileTrackingForAgent('rovodev')).toBe('limited')
    expect(listAgentIntegrationAdapters().map((adapter) => adapter.id)).toEqual(
      expect.arrayContaining(['codex', 'claude-code', 'cursor', 'gemini', 'opencode', 'antigravity', 'hermes-agent'])
    )
  })
})
