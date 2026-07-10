import type { AiopsMutationResult } from './common'
import type { AiAgentSessionSource, ManagedAiSessionState } from './managedAiSessions'

export type ManagedAiSessionContentFormat = 'jsonl' | 'opencode-sqlite' | 'events' | 'unsupported'

export type ManagedAiSessionContentRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool' | 'unknown'

export type ManagedAiSessionContentRecord = {
  source: AiAgentSessionSource
  sessionId: string
  format: ManagedAiSessionContentFormat
  recordId: string
  ordinal: number
  locationLabel: string
  role: ManagedAiSessionContentRole
  messageType: string
  content: string
  contentTruncated: boolean
  fullLength: number
  editable: boolean
  editBlockedReason?: string
  sourceRevision: string
  createdAt?: number
}

export type ManagedAiSessionContentListInput = {
  source: AiAgentSessionSource
  sessionId: string
  offset?: number
  limit?: number
  maxContentChars?: number
}

export type ManagedAiSessionContentRecordInput = {
  source: AiAgentSessionSource
  sessionId: string
  recordId: string
  maxContentChars?: number
}

export type ManagedAiSessionContentUpdateInput = {
  source: AiAgentSessionSource
  sessionId: string
  recordId: string
  content: string
  sourceRevision: string
}

export type ManagedAiSessionContentDeleteInput = {
  source: AiAgentSessionSource
  sessionId: string
  recordId: string
  sourceRevision: string
}

export type ManagedAiSessionContentSnapshot = {
  source: AiAgentSessionSource
  sessionId: string
  title: string
  format: ManagedAiSessionContentFormat
  sourceRevision: string
  total: number
  offset: number
  limit: number
  editable: boolean
  editBlockedReason?: string
  sessionState?: ManagedAiSessionState
  storagePath?: string
  unsupportedReason?: string
  records: ManagedAiSessionContentRecord[]
}

export type ManagedAiSessionContentRecordResult = AiopsMutationResult<{
  record: ManagedAiSessionContentRecord
}>

export type ManagedAiSessionContentListResult = AiopsMutationResult<ManagedAiSessionContentSnapshot>

export type ManagedAiSessionContentUpdateResult = AiopsMutationResult<{
  record: ManagedAiSessionContentRecord
  sourceRevision: string
  backupPath?: string
}>

export type ManagedAiSessionContentDeleteResult = AiopsMutationResult<{
  recordId: string
  sourceRevision: string
  backupPath?: string
}>
