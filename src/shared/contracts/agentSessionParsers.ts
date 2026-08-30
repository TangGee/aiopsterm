import type { AiopsMutationResult } from './common'
import type { AiAgentSessionSource } from './managedAiSessions'
import type { ManagedAiSessionContentRole } from './managedAiSessionContent'

export type AgentSessionParserStorageKind = 'jsonl' | 'json' | 'opencode-sqlite' | 'events'

export type AgentSessionParserValueMatch = string | string[] | boolean | number

export type AgentSessionParserRule = {
  id: string
  scopePointer?: string
  match?: Record<string, AgentSessionParserValueMatch>
  kind: string
  role?: ManagedAiSessionContentRole
  rolePointer?: string
  contentPointers: string[]
  label?: string
  labelPointer?: string
  editable?: boolean
}

export type AgentSessionParserStorage = {
  kind: AgentSessionParserStorageKind
  paths?: string[]
  discover?: boolean
  sessionIdPointer?: string
  titlePointer?: string
  summaryPointer?: string
  cwdPointer?: string
  timestampPointer?: string
}

export type AgentSessionParserDefinition = {
  schemaVersion: 1
  id: string
  source: AiAgentSessionSource
  displayName: string
  storage: AgentSessionParserStorage
  rules: AgentSessionParserRule[]
  fallback: 'raw-json'
}

export type AgentSessionParserOrigin = 'builtin' | 'user'

export type AgentSessionParserProfile = {
  id: string
  source: AiAgentSessionSource
  displayName: string
  storageKind: AgentSessionParserStorageKind
  origin: AgentSessionParserOrigin
  ruleCount: number
  fallback: 'raw-json'
  filePath?: string
}

export type AgentSessionParserSnapshot = {
  parsers: AgentSessionParserProfile[]
}

export type AgentSessionParserImportInput = {
  filePath: string
  expectedSource?: AiAgentSessionSource
}

export type AgentSessionParserRemoveInput = {
  source: AiAgentSessionSource
}

export type AgentSessionParserListResult = AiopsMutationResult<AgentSessionParserSnapshot>

export type AgentSessionParserImportResult = AiopsMutationResult<{
  parser: AgentSessionParserProfile
  snapshot: AgentSessionParserSnapshot
}>

export type AgentSessionParserRemoveResult = AiopsMutationResult<{
  source: AiAgentSessionSource
  snapshot: AgentSessionParserSnapshot
}>
