import { dirname } from 'path'
import { appendFile, mkdir } from 'fs/promises'
import type {
  AiAgentSessionEventName,
  AiAgentSessionSource,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionBulkInput,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionState
} from '@shared/contracts/managedAiSessions'

export type ManagedAiSessionAuditKind =
  | 'event.received'
  | 'event.socket.completed'
  | 'decision.created'
  | 'decision.resolved'
  | 'decision.timeout'
  | 'session.renamed'
  | 'session.auto_named'
  | 'session.auto_name_skipped'
  | 'session.cleared'
  | 'session.hibernated'
  | 'session.woke'
  | 'sessions.imported'
  | 'sessions.bulk'
  | 'notification.dismissed'
  | 'notification.opened'
  | 'notification.mark_read'

export type ManagedAiSessionAuditEntry = {
  at: number
  kind: ManagedAiSessionAuditKind
  source?: AiAgentSessionSource
  sessionId?: string
  notificationId?: string
  event?: AiAgentSessionEventName
  state?: ManagedAiSessionState
  title?: string
  summary?: string
  requestId?: string
  requestKind?: ManagedAiRequestKind
  decisionMode?: ManagedAiDecisionMode
  waitTimeoutMs?: number
  toolName?: string
  actionable?: boolean
  decisionKind?: ManagedAiSessionDecisionKind
  decisionId?: string
  status?: string
  operation?: ManagedAiSessionBulkInput['operation']
  changed?: number
  errorCode?: string
  reason?: string
}

export type AgentSessionAuditRuntime = {
  configure: (auditPath: string) => void
  appendManagedAiSessionAudit: (entry: ManagedAiSessionAuditEntry) => void
  flush: () => Promise<void>
}

type AgentSessionAuditRuntimeOptions = {
  compactString: (value: unknown, maxLength?: number) => string | undefined
}

export const createAgentSessionAuditRuntime = ({ compactString }: AgentSessionAuditRuntimeOptions): AgentSessionAuditRuntime => {
  let auditPath = ''
  let auditQueue: Promise<void> = Promise.resolve()

  return {
    configure: (nextAuditPath) => {
      auditPath = nextAuditPath
    },
    appendManagedAiSessionAudit: (entry) => {
      if (!auditPath) return
      const targetAuditPath = auditPath
      const line = {
        ...entry,
        at: entry.at || Date.now(),
        title: compactString(entry.title, 120),
        summary: compactString(entry.summary, 240)
      }
      auditQueue = auditQueue
        .catch(() => undefined)
        .then(async () => {
          await mkdir(dirname(targetAuditPath), { recursive: true })
          await appendFile(targetAuditPath, `${JSON.stringify(line)}\n`, 'utf-8')
        })
        .catch(() => undefined)
    },
    flush: async () => {
      await auditQueue
    }
  }
}
