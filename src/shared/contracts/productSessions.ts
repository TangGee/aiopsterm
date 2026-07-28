import type { AiopsMutationResult } from './common'

export const productSessionSurfaces = ['classic', 'database', 'codex'] as const

export type ProductSessionSurface = (typeof productSessionSurfaces)[number]

export type ProductSessionTargetKind = 'local' | 'ssh' | 'unknown'

export type ProductSessionTarget = {
  kind: ProductSessionTargetKind
  panelId?: string
  terminalSessionId?: string
  assetId?: string
  connectionId?: string
  label?: string
  host?: string
  port?: number
  username?: string
  assetName?: string
}

export type ProductSessionDatabaseContext = {
  connectionId: string
  databaseName?: string
  schemaName?: string
}

export type ProductSessionNativeBinding = {
  engine: string
  nativeSessionId: string
  profile?: string
  scopeKey?: string
}

export type ProductSessionContextRef = {
  id: string
  kind: 'hosts' | 'docs' | 'images' | 'skills' | 'chats'
  label: string
  detail?: string
  assetId?: string
  connectionId?: string
  panelId?: string
  terminalSessionId?: string
  host?: string
  port?: number
  username?: string
  relPath?: string
  contextType?: 'file' | 'dir' | 'doc' | 'image'
  mediaType?: string
  skillName?: string
  chatSessionId?: string
}

export type ProductSessionClassicContext = {
  contexts: ProductSessionContextRef[]
  terminalBindings?: ProductSessionContextRef[]
  autoFollowActiveHost?: boolean
}

export type ProductSessionRecord = {
  id: string
  surface: ProductSessionSurface
  title: string
  isOpen: boolean
  projectRoot?: string
  lastKnownCwd?: string
  target?: ProductSessionTarget
  database?: ProductSessionDatabaseContext
  nativeBinding?: ProductSessionNativeBinding
  classicContext?: ProductSessionClassicContext
  createdAt: number
  updatedAt: number
}

export type ProductSessionCreateInput = {
  id?: string
  surface: ProductSessionSurface
  title?: string
  isOpen?: boolean
  projectRoot?: string
  lastKnownCwd?: string
  target?: ProductSessionTarget
  database?: ProductSessionDatabaseContext
  nativeBinding?: ProductSessionNativeBinding
  classicContext?: ProductSessionClassicContext
}

export type ProductSessionUpdateInput = {
  id: string
  title?: string
  isOpen?: boolean
  projectRoot?: string | null
  lastKnownCwd?: string | null
  target?: ProductSessionTarget | null
  database?: ProductSessionDatabaseContext | null
  nativeBinding?: ProductSessionNativeBinding | null
  classicContext?: ProductSessionClassicContext | null
}

export type ProductSessionListInput = {
  surface?: ProductSessionSurface
  isOpen?: boolean
  projectRoot?: string
  targetAssetId?: string
  targetConnectionId?: string
  databaseConnectionId?: string
  nativeEngine?: string
  limit?: number
  offset?: number
}

export type ProductSessionNativeBindingSelector = Pick<ProductSessionNativeBinding, 'engine' | 'nativeSessionId'>

export type ProductSessionRecordResult = AiopsMutationResult<{
  session: ProductSessionRecord
}>

export type ProductSessionOptionalRecordResult = AiopsMutationResult<{
  session: ProductSessionRecord | null
}>

export type ProductSessionListResult = AiopsMutationResult<{
  sessions: ProductSessionRecord[]
}>

export type ProductSessionDeleteResult = AiopsMutationResult<{
  id: string
  deleted: boolean
}>

export type ProductSessionProjectionMessageInput = {
  messageId: string
  payload: unknown
}

export type ProductSessionProjectionPageInput = {
  beforeOrdinal?: number
  limit?: number
}

export type ProductSessionProjectionMessage = {
  messageId: string
  ordinal: number
  payload: unknown
  createdAt: number
  updatedAt: number
}

export type ProductSessionProjectionPage = {
  messages: ProductSessionProjectionMessage[]
  hasMore: boolean
  nextBeforeOrdinal: number | null
  totalMessages: number
}

export type ProductSessionProjectionRevisionInput = {
  fromMessageId: string
  replacementMessages: ProductSessionProjectionMessageInput[]
}

export type ProductSessionProjectionRevision = {
  deletedMessages: number
  appendedMessages: number
  totalMessages: number
  seedMessages: ProductSessionProjectionMessage[]
  seedTotalMessages: number
  seedOmittedMessages: number
  seedPayloadBytes: number
}

export type ProductSessionProjectionMutationResult = AiopsMutationResult<{
  count: number
}>

export type ProductSessionProjectionPageResult = AiopsMutationResult<ProductSessionProjectionPage>

export type ProductSessionProjectionRevisionResult = AiopsMutationResult<ProductSessionProjectionRevision>

export type ProductSessionCloseResult = AiopsMutationResult<{
  id: string
  stopped: boolean
}>

export type ProductSessionChangeEvent =
  | {
      type: 'created' | 'updated'
      id: string
      session: ProductSessionRecord
    }
  | {
      type: 'deleted'
      id: string
    }
