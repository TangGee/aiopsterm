import type {
  DatabaseConnectionInfo,
  DatabaseSqlExecuteInput,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'
import {
  databaseMutationPlanData,
  databaseMutationPlanErrorCode,
  databaseMutationPlanErrorMessage,
  inputKnownColumns
} from './databaseMutationPlanner'
import {
  databaseSeedQueryRows,
  databaseSeedTableDdl,
  type DatabaseSeedTableDdlEntry
} from './databaseSeedData'
import { normalizeSql } from './databaseSqlExecution'
import {
  applySeedTableMutation,
  cloneDdlEntries,
  cloneRows,
  columnsByTableRows,
  columnsForRows,
  filterRows,
  hasOwn,
  parseOrderByRaw,
  parseWhereRaw,
  sortRows,
  trim
} from './databaseTableRuntime'

const tableRows = cloneRows(databaseSeedQueryRows)
const tableColumns = columnsByTableRows(databaseSeedQueryRows)
const tableDdlEntries: Record<string, DatabaseSeedTableDdlEntry> = cloneDdlEntries(databaseSeedTableDdl)

export const resetDatabaseSeedTableRuntime = () => {
  Object.keys(tableRows).forEach((key) => {
    delete tableRows[key]
  })
  Object.keys(tableColumns).forEach((key) => {
    delete tableColumns[key]
  })
  Object.assign(tableRows, cloneRows(databaseSeedQueryRows))
  Object.assign(tableColumns, columnsByTableRows(databaseSeedQueryRows))
  Object.keys(tableDdlEntries).forEach((key) => {
    delete tableDdlEntries[key]
  })
  Object.assign(tableDdlEntries, cloneDdlEntries(databaseSeedTableDdl))
}

export const databaseSeedTableExistsInBackend = (input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) => {
  const key = `${input.connectionId}:${input.databaseName}:${input.schemaName || ''}:${input.tableName}`
  return hasOwn(tableRows, key) || hasOwn(tableDdlEntries, key)
}

const tableKeyParts = (key: string) => {
  const [connectionId, databaseName, schemaName, tableName] = key.split(':')
  return { connectionId, databaseName, schemaName, tableName }
}

export const databaseSeedTableKeysForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  Object.keys(tableRows).filter((key) => {
    const parts = tableKeyParts(key)
    if (parts.connectionId !== input.connectionId) return false
    if (input.databaseName && parts.databaseName !== input.databaseName) return false
    if (input.schemaName && parts.schemaName !== input.schemaName) return false
    return true
  })

export const databaseSeedColumnsForTableKey = (key: string) => tableColumns[key]?.slice() ?? columnsForRows(tableRows[key] ?? [])

const unquoteIdentifier = (value: string) => value.replace(/^[`"\[]|[`"\]]$/g, '').replace(/""/g, '"').replace(/``/g, '`').replace(/]]/g, ']')

const tableNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w.-]+[`"\]]?)?)/i)
  if (!match) return ''
  const parts = match[1]
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean)
  return parts.at(-1) || ''
}

const schemaNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteIdentifier(match[1].trim()) : ''
}

const tableRowsForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  const found = candidates.map((key) => tableRows[key]).find(Boolean)
  return found?.map((row) => ({ ...row })) ?? null
}

export const databaseSeedTableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  return candidates.find((key) => tableRows[key]) || ''
}

const findRowsForSql = (input: DatabaseSqlExecuteInput, sql: string) => {
  const tableName = tableNameFromSql(sql)
  const explicitSchema = schemaNameFromSql(sql)
  return tableRowsForContext({
    connectionId: input.connectionId,
    databaseName: input.databaseName,
    schemaName: explicitSchema || input.schemaName || '',
    tableName
  })
}

const constantRowsForSql = (sql: string) => {
  const normalized = normalizeSql(sql).replace(/;$/, '')
  const match = normalized.match(/^select\s+1(?:\s+as\s+([A-Za-z_][\w$]*))?$/i)
  if (!match) return null
  return [{ [match[1] || 'result']: 1 }]
}

export const resolveDatabaseSeedSqlRows = (input: DatabaseSqlExecuteInput, sql: string) => {
  const explained = /^explain\b/i.test(sql)
  const tableName = tableNameFromSql(sql)
  const tableRows = tableName ? findRowsForSql(input, sql) : null
  if (explained) {
    if (tableName && !tableRows) {
      return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName}` }
    }
    return {
      ok: true as const,
      rows: [
        { step: 1, operation: tableName ? 'Seq Scan' : 'Result', relation: tableName || 'derived', cost: '0.00..12.40', rows: tableRows?.length ?? 1 },
        { step: 2, operation: 'Limit', relation: 'result', cost: '0.00..1.00', rows: 1 }
      ]
    }
  }
  if (tableRows) return { ok: true as const, rows: tableRows }
  const constantRows = constantRowsForSql(sql)
  if (constantRows) return { ok: true as const, rows: constantRows }
  if (/\bfrom\b/i.test(sql)) {
    return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName || 'unknown'}` }
  }
  return {
    ok: false as const,
    errorCode: 'DB_SQL_UNSUPPORTED',
    errorMessage: 'Seed database SQL execution supports backend-known tables or SELECT 1 only.'
  }
}

export const getDatabaseSeedTableDdl = (input: DatabaseTableDdlInput): DatabaseTableDdlResult => {
  const key = databaseSeedTableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const entry = tableDdlEntries[key]
  if (!entry?.ddl.trim()) {
    return { ok: false, errorCode: 'other', errorMessage: 'DDL is empty.' }
  }
  if (entry.error) {
    return { ok: false, errorCode: entry.error.code, errorMessage: entry.error.message }
  }
  return { ok: true, data: { ddl: entry.ddl } }
}

export const queryDatabaseSeedTable = (input: DatabaseTableQueryInput, startedAt: number): DatabaseTableQueryResult => {
  const tableKey = databaseSeedTableKeyForContext(input)
  if (!tableKey) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const sourceRows = tableRows[tableKey].map((row) => ({ ...row }))

  const knownColumns = tableColumns[tableKey]?.slice() ?? columnsForRows(sourceRows)
  const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
  const filteredRows = filterRows(sourceRows, filters)
  const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
  const rows = sortRows(filteredRows, sort)
  const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const start = (page - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize).map((row) => ({ ...row }))

  return {
    ok: true,
    data: {
      columns: knownColumns,
      rows: pageRows,
      rowCount: pageRows.length,
      durationMs: Math.max(1, Date.now() - startedAt),
      total: input.withTotal ? rows.length : null,
      knownColumns
    }
  }
}

export const planDatabaseSeedTableMutation = (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationPlanInput
): DatabaseTableMutationPlanResult => {
  const key = databaseSeedTableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const knownColumns = tableColumns[key]?.slice() ?? inputKnownColumns(input) ?? columnsForRows(tableRows[key])
  try {
    return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns) }
  } catch (error) {
    return {
      ok: false,
      errorCode: databaseMutationPlanErrorCode(error, 'DB_MUTATION_PLAN_FAILED'),
      errorMessage: databaseMutationPlanErrorMessage(error, 'Database table mutation planning failed.')
    }
  }
}

export const mutateDatabaseSeedTable = (input: DatabaseTableMutationInput) => {
  const key = databaseSeedTableKeyForContext(input)
  if (!key) {
    return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  return {
    ok: true as const,
    affected: applySeedTableMutation(tableRows, tableColumns, tableDdlEntries, key, input.mutations)
  }
}
