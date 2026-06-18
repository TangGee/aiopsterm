import { describe, expect, it, vi } from 'vitest'

type AgentSessionsBackend = {
  normalizeAiAgentSessionEventInput: (input: unknown, now?: number) => unknown
  publishAiAgentSessionEvent: (input: Record<string, unknown>, emit?: ((event: unknown) => void) | null) => unknown
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/agentSessions'
  return (await import(modulePath)) as AgentSessionsBackend
}

describe('agent session backend', () => {
  it('normalizes Codex hook payloads into managed AI session events', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'codex',
          hookEventName: 'PermissionRequest',
          session_id: 'codex-session-1',
          surface_id: 'panel-1',
          terminal_id: 'terminal-1',
          cwd: '/work/project',
          message: 'Approve shell command'
        },
        100
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'codex',
        event: 'permission_request',
        sessionId: 'codex-session-1',
        title: 'Codex · project',
        panelId: 'panel-1',
        terminalSessionId: 'terminal-1',
        cwd: '/work/project',
        summary: 'Approve shell command',
        receivedAt: 100
      })
    })
  })

  it('rejects unsupported sources before publishing', async () => {
    const { publishAiAgentSessionEvent } = await loadBackend()
    const emit = vi.fn()
    expect(
      publishAiAgentSessionEvent(
        {
          source: 'external',
          event: 'Notification',
          sessionId: 'session-1'
        },
        emit
      )
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'AI_AGENT_EVENT_SOURCE_INVALID'
      })
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('derives question summaries and project titles when hook payloads omit display titles', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'claude-code',
          hookEventName: 'AskUserQuestion',
          session_id: 'claude-session-1',
          project_dir: '/work/release-api',
          transcript_path: '/tmp/claude.jsonl',
          tool_input: {
            questions: [{ question: 'Deploy to staging or production?', options: [{ label: 'staging' }, { label: 'production' }] }]
          }
        },
        200
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'claude-code',
        event: 'question',
        sessionId: 'claude-session-1',
        title: 'Claude Code · release-api',
        summary: 'Deploy to staging or production?',
        cwd: '/work/release-api',
        transcriptPath: '/tmp/claude.jsonl',
        receivedAt: 200
      })
    })
  })
})
