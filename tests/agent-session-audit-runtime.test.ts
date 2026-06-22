import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

type ManagedAiSessionAuditEntry = {
  at: number
  kind: string
  source?: string
  sessionId?: string
  title?: string
  summary?: string
}

type AgentSessionAuditRuntime = {
  configure: (auditPath: string) => void
  appendManagedAiSessionAudit: (entry: ManagedAiSessionAuditEntry) => void
  flush: () => Promise<void>
}

type CreateAgentSessionAuditRuntime = (options: {
  compactString: (value: unknown, maxLength?: number) => string | undefined
}) => AgentSessionAuditRuntime

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agentSessionAuditRuntime'
  return (await import(modulePath)) as { createAgentSessionAuditRuntime: CreateAgentSessionAuditRuntime }
}

describe('agentSessionAuditRuntime', () => {
  it('queues managed AI audit entries as compacted jsonl records', async () => {
    const { createAgentSessionAuditRuntime } = await loadRuntime()
    const compactString = vi.fn((value: unknown, maxLength = 80) => (typeof value === 'string' ? value.slice(0, maxLength) : undefined))
    const runtime = createAgentSessionAuditRuntime({ compactString })
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-audit-runtime-'))
    const auditPath = join(userDataPath, 'agent-sessions', 'managed-ai-sessions.audit.jsonl')

    runtime.configure(auditPath)
    runtime.appendManagedAiSessionAudit({
      at: 100,
      kind: 'session.renamed',
      source: 'codex',
      sessionId: 'session-1',
      title: 'T'.repeat(140),
      summary: 'S'.repeat(260)
    })
    runtime.appendManagedAiSessionAudit({
      at: 200,
      kind: 'notification.opened',
      source: 'codex',
      sessionId: 'session-1',
      title: 'Opened',
      summary: 'Notification body'
    })
    await runtime.flush()

    const entries = String(await readFile(auditPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(entries).toEqual([
      expect.objectContaining({
        at: 100,
        kind: 'session.renamed',
        source: 'codex',
        sessionId: 'session-1',
        title: 'T'.repeat(120),
        summary: 'S'.repeat(240)
      }),
      expect.objectContaining({
        at: 200,
        kind: 'notification.opened',
        title: 'Opened',
        summary: 'Notification body'
      })
    ])
    expect(compactString).toHaveBeenCalledWith('T'.repeat(140), 120)
    expect(compactString).toHaveBeenCalledWith('S'.repeat(260), 240)
  })
})
