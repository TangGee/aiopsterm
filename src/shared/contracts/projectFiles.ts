import type { AiopsMutationResult } from './common'
import type { AiAgentSessionSource } from './managedAiSessions'

export const projectFileChangeProtocolVersion = 1 as const

export type ProjectFileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed'

export type ProjectFileChangeInput = {
  path: string
  kind: ProjectFileChangeKind
  previousPath?: string
}

export type ProjectFileChangeV1 = {
  protocolVersion: typeof projectFileChangeProtocolVersion
  eventId: string
  source: string
  sessionId: string
  cwd?: string
  changes: ProjectFileChangeInput[]
}

export type ProjectFileChangeOrigin = 'native' | 'adapter' | 'editor' | 'watcher'

export type ProjectFileRecentEntry = {
  path: string
  kind: ProjectFileChangeKind
  previousPath?: string
  changedAt: number
  source: string
  origin: ProjectFileChangeOrigin
}

export type ProjectFileTrackingCapability = 'native' | 'adapter' | 'limited'

export type ProjectFileContextInput = {
  source: AiAgentSessionSource
  sessionId: string
}

export type ProjectFileContext = {
  source: AiAgentSessionSource
  sessionId: string
  projectRoot: string
  capability: ProjectFileTrackingCapability
  recent: ProjectFileRecentEntry[]
}

export type ProjectFileContextResult = AiopsMutationResult<ProjectFileContext>

export type ProjectFileChangeRecordResult = AiopsMutationResult<{
  projectRoot: string
  accepted: number
  rejected: number
  duplicate: number
  recent: ProjectFileRecentEntry[]
}>

export type ProjectDirectoryListInput = ProjectFileContextInput & {
  relativeDirectory?: string
  offset?: number
  limit?: number
}

export type ProjectDirectoryEntry = {
  name: string
  relativePath: string
  type: 'file' | 'directory' | 'link'
  size: number
  modifiedAt: number
}

export type ProjectDirectoryListResult = AiopsMutationResult<{
  projectRoot: string
  relativeDirectory: string
  entries: ProjectDirectoryEntry[]
  nextOffset?: number
}>

export type ProjectFileReadInput = ProjectFileContextInput & {
  relativePath: string
}

export type ProjectFileReadResult = AiopsMutationResult<{
  projectRoot: string
  relativePath: string
  content: string
  contentHash: string
  size: number
  mtimeMs: number
}>

export type ProjectFileWriteInput = ProjectFileReadInput & {
  content: string
  expectedMtimeMs?: number
  expectedSize?: number
  expectedContentHash?: string
  overwrite?: boolean
}

export type ProjectFileWriteResult = AiopsMutationResult<{
  projectRoot: string
  relativePath: string
  contentHash: string
  size: number
  mtimeMs: number
  created: boolean
}>

export type ProjectFileWatchInput = ProjectFileContextInput & {
  relativePath: string
  watchId: string
}

export type ProjectFileWatchResult = AiopsMutationResult<{
  watchId: string
  watched: boolean
  fallback: boolean
}>

export type ProjectFileWatchEvent = {
  watchId: string
  projectRoot: string
  relativePath: string
  kind: 'modified' | 'deleted'
  changedAt: number
}
