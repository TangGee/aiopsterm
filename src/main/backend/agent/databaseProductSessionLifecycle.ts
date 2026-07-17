import type { ProductSessionRegistry } from './productSessionRegistry'
import type { DatabaseAiPaneStateSnapshot } from '@shared/contracts/database'

type DatabaseProductSessionRegistry = Pick<
  ProductSessionRegistry,
  'create' | 'get' | 'update' | 'listProjectionMessages' | 'replaceProjectionMessages' | 'upsertProjectionMessages'
>

const syncProjection = (
  registry: DatabaseProductSessionRegistry,
  conversationId: string,
  messages: DatabaseAiPaneStateSnapshot['messages']
) => {
  if (!messages.length) return
  const projection = messages.map((message) => ({ messageId: message.id, payload: message }))
  const stored = registry.listProjectionMessages(conversationId, { limit: 1 })
  if (stored.totalMessages === 0) registry.replaceProjectionMessages(conversationId, projection)
  else registry.upsertProjectionMessages(conversationId, projection)
}

const databaseForContext = (context: DatabaseAiPaneStateSnapshot['context']) => context?.connectionId
  ? {
      connectionId: context.connectionId,
      ...(context.catalogName ? { databaseName: context.catalogName } : {}),
      ...(context.schemaName ? { schemaName: context.schemaName } : {})
    }
  : undefined

type DatabaseProductSessionBinding = NonNullable<ReturnType<typeof databaseForContext>>

const sameDatabaseBinding = (
  left: DatabaseProductSessionBinding,
  right: DatabaseProductSessionBinding
) => left.connectionId === right.connectionId &&
  left.databaseName === right.databaseName &&
  left.schemaName === right.schemaName

const databaseBindingCanSync = (
  registry: DatabaseProductSessionRegistry,
  conversationId: string,
  existing: DatabaseProductSessionBinding | undefined,
  incoming: DatabaseProductSessionBinding | undefined
) => {
  if (existing) return Boolean(incoming && sameDatabaseBinding(existing, incoming))
  if (!incoming) return true
  return registry.listProjectionMessages(conversationId, { limit: 1 }).totalMessages === 0
}

export const syncDatabaseProductSessionState = (input: {
  registry: DatabaseProductSessionRegistry
  state: DatabaseAiPaneStateSnapshot
  isMutationBlocked?: (id: string) => boolean
  logFailure?: (event: string, fields: Record<string, unknown>) => void
}) => {
  const productSessionId = String(input.state.conversationId || '').trim()
  if (!productSessionId || input.isMutationBlocked?.(productSessionId)) return false
  const context = input.state.context
  const database = databaseForContext(context)
  const title = database
    ? [database.databaseName, database.schemaName].filter(Boolean).join(' / ') || 'DB AI'
    : 'DB AI'
  try {
    let synced = false
    const existing = input.registry.get(productSessionId)
    if (existing) {
      if (!databaseBindingCanSync(input.registry, productSessionId, existing.database, database)) {
        input.logFailure?.('product-session.database-binding-mismatch', {
          productSessionId,
          existingConnectionId: existing.database?.connectionId || '',
          incomingConnectionId: database?.connectionId || ''
        })
        return false
      }
      synced = Boolean(input.registry.update({
        id: productSessionId,
        title,
        isOpen: input.state.open === true,
        ...(!existing.database && database ? { database } : {})
      }))
      syncProjection(input.registry, productSessionId, input.state.messages)
    } else if (input.state.open === true) {
      input.registry.create({
        id: productSessionId,
        surface: 'database',
        title,
        isOpen: true,
        ...(database ? { database } : {})
      })
      syncProjection(input.registry, productSessionId, input.state.messages)
      synced = true
    }
    for (const archived of input.state.archivedSessions || []) {
      if (!archived.conversationId || input.isMutationBlocked?.(archived.conversationId)) continue
      const archivedDatabase = databaseForContext(archived.context)
      const existingArchived = input.registry.get(archived.conversationId)
      if (existingArchived && !databaseBindingCanSync(
        input.registry,
        archived.conversationId,
        existingArchived.database,
        archivedDatabase
      )) {
        input.logFailure?.('product-session.database-binding-mismatch', {
          productSessionId: archived.conversationId,
          existingConnectionId: existingArchived.database?.connectionId || '',
          incomingConnectionId: archivedDatabase?.connectionId || ''
        })
        continue
      }
      if (!existingArchived) {
        input.registry.create({
          id: archived.conversationId,
          surface: 'database',
          title: archivedDatabase
            ? [archivedDatabase.databaseName, archivedDatabase.schemaName].filter(Boolean).join(' / ') || 'DB AI'
            : 'DB AI',
          isOpen: false,
          ...(archivedDatabase ? { database: archivedDatabase } : {})
        })
      }
      syncProjection(input.registry, archived.conversationId, archived.messages)
      synced = true
    }
    return synced
  } catch (error) {
    input.logFailure?.('product-session.database-state-sync-failed', {
      productSessionId,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
