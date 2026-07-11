import {
  getDatabaseTableDdl,
  listDatabaseCatalog,
  queryDatabaseTable
} from '@shared/databaseRuntime'
import {
  createDatabaseMcpToolRuntime,
  DATABASE_MCP_TOOL_DEFINITIONS,
  sanitizeDatabaseMcpSensitiveText,
  type DatabaseMcpToolResult
} from '@shared/databaseMcpRuntime'
import type { DatabaseAiContextLoadInput } from '@shared/databaseRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import {
  databaseAiSqlTableReferences,
  type DatabaseAiSqlTableReference
} from '@shared/databaseAiSqlRuntime'

const databaseMcpToolRuntime = createDatabaseMcpToolRuntime({
  listCatalog: listDatabaseCatalog,
  getTableDdl: getDatabaseTableDdl,
  queryTable: queryDatabaseTable
})

const databaseAiMcpToolRuntime = {
  callTool: (name: string, args: Record<string, unknown> = {}) =>
    databaseMcpToolRuntime.callTool(name, args, { allowInternalConnectionId: true })
}

const MAX_DATABASE_AI_DDL_CHARS = 16_000
const MAX_DATABASE_AI_MCP_CONTEXT_CHARS = 24_000
const MAX_DATABASE_AI_SQL_TABLES = 4

type DatabaseAiMcpContextToolRuntime = {
  callTool: (name: string, args?: Record<string, unknown>) => Promise<DatabaseMcpToolResult | null>
}

type DatabaseAiCatalogObject = {
  databaseName: string
  schemaName?: string
  kind: 'table' | 'view'
  name: string
}

type DatabaseAiTableSelector = {
  connectionId: string
  databaseName: string
  schemaName?: string
  tableName: string
}

const cleanText = (value: unknown) => String(value || '').trim()
const sameName = (left: unknown, right: unknown) => cleanText(left).toLocaleLowerCase() === cleanText(right).toLocaleLowerCase()

const databaseAiMcpObjectData = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const { connectionId: _connectionId, ...data } = value as Record<string, unknown>
  return data
}

export const listDatabaseMcpToolDefinitions = () => DATABASE_MCP_TOOL_DEFINITIONS.map((tool) => ({ ...tool }))

export const callDatabaseMcpTool = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<DatabaseMcpToolResult | null> => {
  try {
    return await databaseMcpToolRuntime.callTool(name, args)
  } catch {
    return {
      ok: false,
      errorCode: 'DB_MCP_REQUEST_FAILED',
      errorMessage: 'Database MCP request failed.'
    }
  }
}

export const callBoundDatabaseAiMcpTool = async (
  name: string,
  args: Record<string, unknown>,
  binding: { connectionId: string; databaseName?: string; schemaName?: string }
): Promise<DatabaseMcpToolResult | null> => {
  const connectionId = cleanText(binding.connectionId)
  if (!connectionId) {
    return {
      ok: false,
      errorCode: 'DB_MCP_CONNECTION_REQUIRED',
      errorMessage: 'The DB AI session has no bound database connection.'
    }
  }
  const requestedDatabase = cleanText(args.databaseName)
  const requestedSchema = cleanText(args.schemaName)
  const databaseName = cleanText(binding.databaseName)
  const schemaName = cleanText(binding.schemaName)
  if (databaseName && requestedDatabase && !sameName(databaseName, requestedDatabase)) {
    return {
      ok: false,
      errorCode: 'DB_MCP_DATABASE_SCOPE_MISMATCH',
      errorMessage: 'The requested database is outside the DB AI session scope.'
    }
  }
  if (schemaName && requestedSchema && !sameName(schemaName, requestedSchema)) {
    return {
      ok: false,
      errorCode: 'DB_MCP_SCHEMA_SCOPE_MISMATCH',
      errorMessage: 'The requested schema is outside the DB AI session scope.'
    }
  }
  return databaseMcpToolRuntime.callTool(
    name,
    {
      ...args,
      connectionId,
      ...(databaseName ? { databaseName } : {}),
      ...(schemaName ? { schemaName } : {})
    },
    { allowInternalConnectionId: true }
  )
}

export const redactDatabaseAiProviderError = async (
  errorMessage: unknown,
  connectionIdValue: unknown,
  userConfig?: UserConfig
) => {
  const connectionId = cleanText(connectionIdValue)
  const sensitiveValues = [connectionId]
  try {
    const catalog = await listDatabaseCatalog()
    const connection = catalog.ok && catalog.data
      ? catalog.data.connections.find((item) => item.id === connectionId)
      : undefined
    if (connection) {
      sensitiveValues.push(
        connection.name,
        connection.host,
        String(connection.port || ''),
        connection.user,
        connection.url || '',
        connection.filePath || '',
        connection.proxyName || ''
      )
      const proxy = (userConfig?.sshProxyConfigs || []).find((item) => cleanText(item.name) === cleanText(connection.proxyName))
      if (proxy) sensitiveValues.push(proxy.name, proxy.host, String(proxy.port || ''), proxy.username, proxy.password)
    }
  } catch {
    // Generic credential and IP redaction still applies when catalog lookup fails.
  }
  return sanitizeDatabaseMcpSensitiveText(errorMessage, sensitiveValues)
}

const includeDdlForDatabaseAi = (input: DatabaseAiContextLoadInput) =>
  input.action === 'explain' || input.action === 'optimize' || input.action === 'diagnose'

const boundedDatabaseAiContext = (value: Record<string, unknown>) => {
  const text = JSON.stringify(value, null, 2)
  return text.length > MAX_DATABASE_AI_MCP_CONTEXT_CHARS
    ? `${text.slice(0, MAX_DATABASE_AI_MCP_CONTEXT_CHARS)}\n[database MCP context truncated]`
    : text
}

const databaseAiCatalogObjects = (result: DatabaseMcpToolResult | null): DatabaseAiCatalogObject[] => {
  const objects = result?.ok && Array.isArray(result.data?.objects) ? result.data.objects : []
  return objects.flatMap((value): DatabaseAiCatalogObject[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const object = value as Record<string, unknown>
    const kind = cleanText(object.kind)
    const databaseName = cleanText(object.databaseName)
    const schemaName = cleanText(object.schemaName)
    const name = cleanText(object.name)
    if ((kind !== 'table' && kind !== 'view') || !databaseName || !name) return []
    return [{ databaseName, ...(schemaName ? { schemaName } : {}), kind, name }]
  })
}

const matchingDatabaseAiCatalogObjects = (
  objects: DatabaseAiCatalogObject[],
  reference: DatabaseAiSqlTableReference,
  databaseName: string,
  schemaName: string
) => {
  const exactName = objects.filter((object) => sameName(object.name, reference.tableName))
  if (reference.parts.length >= 3) {
    const [referencedDatabase, referencedSchema] = reference.parts.slice(-3, -1)
    return exactName.filter(
      (object) => sameName(object.databaseName, referencedDatabase) && sameName(object.schemaName, referencedSchema)
    )
  }
  if (reference.parts.length === 2) {
    const qualifier = reference.parts[0]
    return exactName.filter((object) =>
      (sameName(object.databaseName, databaseName) && sameName(object.schemaName, qualifier)) ||
      (sameName(object.databaseName, qualifier) && (!object.schemaName || !schemaName || sameName(object.schemaName, schemaName)))
    )
  }
  const currentDatabaseMatches = exactName.filter((object) => sameName(object.databaseName, databaseName))
  return schemaName
    ? currentDatabaseMatches.filter((object) => sameName(object.schemaName, schemaName))
    : currentDatabaseMatches
}

const databaseAiSqlTableSelectors = async (
  runtime: DatabaseAiMcpContextToolRuntime,
  input: DatabaseAiContextLoadInput,
  connectionId: string,
  databaseName: string,
  schemaName: string
): Promise<DatabaseAiTableSelector[]> => {
  const selectors: DatabaseAiTableSelector[] = []
  const seen = new Set<string>()
  for (const reference of databaseAiSqlTableReferences(cleanText(input.sql)).slice(0, MAX_DATABASE_AI_SQL_TABLES)) {
    const searched = await runtime.callTool('search_database_objects', {
      connectionId,
      query: reference.tableName,
      kinds: ['table', 'view'],
      limit: 200
    })
    const matches = matchingDatabaseAiCatalogObjects(databaseAiCatalogObjects(searched), reference, databaseName, schemaName)
    const truncated = searched?.data?.truncated === true
    if (matches.length !== 1 || (truncated && reference.parts.length === 1)) continue
    const match = matches[0]
    const selector: DatabaseAiTableSelector = {
      connectionId,
      databaseName: match.databaseName,
      ...(match.schemaName ? { schemaName: match.schemaName } : {}),
      tableName: match.name
    }
    const key = [selector.databaseName, selector.schemaName, selector.tableName].map((part) => cleanText(part).toLocaleLowerCase()).join('.')
    if (seen.has(key)) continue
    seen.add(key)
    selectors.push(selector)
  }
  return selectors
}

const databaseAiObjectSummary = async (
  runtime: DatabaseAiMcpContextToolRuntime,
  connectionId: string,
  databaseName: string,
  schemaName: string
) => {
  const objects = await runtime.callTool('search_database_objects', {
    connectionId,
    databaseName,
    ...(schemaName ? { schemaName } : {}),
    kinds: ['table', 'view'],
    limit: 50
  })
  return objects?.ok
    ? boundedDatabaseAiContext({
        objects: (Array.isArray(objects.data?.objects) ? objects.data.objects : []).map(databaseAiMcpObjectData)
      })
    : ''
}

export const createDatabaseAiMcpContextLoader = (runtime: DatabaseAiMcpContextToolRuntime) => async (
  input: DatabaseAiContextLoadInput
): Promise<string> => {
  const connectionId = String(input.context.connectionId || '').trim()
  const databaseName = String(input.context.databaseName || '').trim()
  const schemaName = String(input.context.schemaName || '').trim()
  const tableName = String(input.context.tableName || '').trim()
  if (!connectionId || !databaseName) return ''

  const selectors: DatabaseAiTableSelector[] = tableName
    ? [{ connectionId, databaseName, ...(schemaName ? { schemaName } : {}), tableName }]
    : await databaseAiSqlTableSelectors(runtime, input, connectionId, databaseName, schemaName)
  if (!selectors.length) return databaseAiObjectSummary(runtime, connectionId, databaseName, schemaName)

  const loadedTables: Record<string, unknown>[] = []
  for (const selector of selectors) {
    const described = await runtime.callTool('describe_database_table', selector)
    if (!described?.ok) continue
    const tableContext: Record<string, unknown> = {
      table: databaseAiMcpObjectData(described.data?.table ?? null)
    }
    if (includeDdlForDatabaseAi(input)) {
      const ddl = await runtime.callTool('get_database_table_ddl', selector)
      if (ddl?.ok) {
        const rawDdl = String(ddl.data?.ddl || '')
        tableContext.ddl = rawDdl.slice(0, MAX_DATABASE_AI_DDL_CHARS)
        tableContext.ddlTruncated = ddl.data?.truncated === true || rawDdl.length > MAX_DATABASE_AI_DDL_CHARS
      } else if (ddl) {
        tableContext.ddlUnavailable = ddl.errorCode || 'DB_MCP_DDL_FAILED'
      }
    }
    loadedTables.push(tableContext)
  }
  if (!loadedTables.length) return databaseAiObjectSummary(runtime, connectionId, databaseName, schemaName)
  return boundedDatabaseAiContext(loadedTables.length === 1 ? loadedTables[0] : { tables: loadedTables })
}

export const loadDatabaseAiMcpContext = createDatabaseAiMcpContextLoader(databaseAiMcpToolRuntime)
