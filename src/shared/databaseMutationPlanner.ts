import type {
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationPlanStatement
} from './contracts/database'

export type DatabaseMutationDialect = Exclude<DatabaseEngineCode, 'clickhouse' | 'presto'>
export type DatabaseMutationStatement = Omit<DatabaseTableMutationPlanStatement, 'preview'>

type DatabaseRowMutation = Extract<DatabaseTableMutationInput['mutations'][number], { kind: 'delete' | 'update' }>

const SQLITE_MAIN_SCHEMA = 'main'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'

const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | '') => dbType === 'postgresql' || dbType === 'kingbase'

const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1).replace(/]]/g, ']')
  return token
}

const oracleLookupIdentifier = (value: string) => {
  const raw = trim(value)
  if (!raw) return ''
  const unquoted = unquoteDatabaseIdentifier(raw)
  return raw.startsWith('"') && raw.endsWith('"') ? unquoted : unquoted.toUpperCase()
}

const sqliteSchemaNameFor = (connection: Pick<DatabaseConnectionInfo, 'database'>, databaseName?: string) => {
  const requested = trim(databaseName)
  if (!requested || requested === connection.database) return SQLITE_MAIN_SCHEMA
  return requested
}

const databaseMutationIdentifier = (value: string, dialect: DatabaseMutationDialect) =>
  isMysqlCompatibleDbType(dialect)
    ? `\`${String(value || '').replace(/`/g, '``')}\``
    : dialect === 'sqlserver'
      ? `[${String(value || '').replace(/]/g, ']]')}]`
      : `"${String(value || '').replace(/"/g, '""')}"`

const databaseMutationPlaceholder = (dialect: DatabaseMutationDialect, index: number) => {
  if (isPostgresCompatibleDbType(dialect)) return `$${index}`
  if (dialect === 'oracle') return `:${index}`
  if (dialect === 'sqlserver') return `@p${index}`
  return '?'
}

export const databaseMutationTableReference = (
  connection: Pick<DatabaseConnectionInfo, 'dbType' | 'database' | 'user'> | null,
  input: Pick<DatabaseTableMutationInput, 'databaseName' | 'schemaName' | 'tableName'>,
  dialect: DatabaseMutationDialect
) => {
  const tableName = dialect === 'oracle' ? oracleLookupIdentifier(input.tableName) : trim(input.tableName)
  const table = databaseMutationIdentifier(tableName, dialect)
  if (isMysqlCompatibleDbType(dialect)) return `${databaseMutationIdentifier(trim(input.databaseName), dialect)}.${table}`
  if (dialect === 'sqlserver') return `${databaseMutationIdentifier(trim(input.schemaName) || 'dbo', dialect)}.${table}`
  if (dialect === 'sqlite') {
    const schemaName = connection && connection.dbType === 'sqlite' ? sqliteSchemaNameFor(connection, input.databaseName) : trim(input.databaseName) || SQLITE_MAIN_SCHEMA
    return `${databaseMutationIdentifier(schemaName, dialect)}.${table}`
  }
  if (dialect === 'oracle') {
    const schemaName = oracleLookupIdentifier(trim(input.schemaName) || trim(connection?.user))
    return schemaName ? `${databaseMutationIdentifier(schemaName, dialect)}.${table}` : table
  }
  return `${databaseMutationIdentifier(trim(input.schemaName) || 'public', dialect)}.${table}`
}

export const decodeDatabaseMutationPrimaryKeyRowKey = (rowKey: string, primaryKey: string[]) => {
  if (!primaryKey.length) return null
  try {
    const parsed = JSON.parse(rowKey)
    return Array.isArray(parsed) && parsed.length === primaryKey.length ? parsed : null
  } catch {
    return null
  }
}

const pushDatabaseMutationComparison = (clauses: string[], params: unknown[], dialect: DatabaseMutationDialect, column: string, value: unknown) => {
  const quoted = databaseMutationIdentifier(column, dialect)
  if (value === null || value === undefined) {
    clauses.push(`${quoted} IS NULL`)
    return
  }
  params.push(value)
  clauses.push(`${quoted} = ${databaseMutationPlaceholder(dialect, params.length)}`)
}

const databaseMutationWhereForRow = (
  dialect: DatabaseMutationDialect,
  knownColumns: string[],
  mutation: DatabaseRowMutation,
  params: unknown[]
) => {
  const primaryKey = mutation.primaryKey.map(trim).filter(Boolean)
  const values = decodeDatabaseMutationPrimaryKeyRowKey(mutation.rowKey, primaryKey)
  if (primaryKey.length && values) {
    const clauses: string[] = []
    primaryKey.forEach((column, index) => pushDatabaseMutationComparison(clauses, params, dialect, column, values[index]))
    return { sql: clauses.join(' AND '), usesPrimaryKey: true }
  }

  if (dialect === 'oracle') {
    throw Object.assign(new Error('Oracle table editing requires a primary key in this version.'), { code: 'DB_PRIMARY_KEY_REQUIRED' })
  }
  if (!mutation.originalRow) {
    throw Object.assign(new Error('Original row snapshot is required for table mutations without a primary key.'), {
      code: dialect === 'sqlite' ? 'DB_SQLITE_PRIMARY_KEY_REQUIRED' : 'DB_PRIMARY_KEY_REQUIRED'
    })
  }

  const clauses: string[] = []
  knownColumns.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(mutation.originalRow, column)) {
      pushDatabaseMutationComparison(clauses, params, dialect, column, mutation.originalRow?.[column])
    }
  })
  if (!clauses.length) {
    throw Object.assign(new Error('Original row snapshot does not contain known table columns.'), { code: 'DB_ROW_SNAPSHOT_REQUIRED' })
  }
  return { sql: clauses.join(' AND '), usesPrimaryKey: false }
}

const applyDatabaseMutationSingleRowGuard = (
  dialect: DatabaseMutationDialect,
  tableRef: string,
  sql: string,
  whereSql: string,
  usesPrimaryKey: boolean
) => {
  if (usesPrimaryKey) return sql
  if (isMysqlCompatibleDbType(dialect)) return `${sql} LIMIT 1`
  if (dialect === 'sqlserver') return sql.replace(/^DELETE FROM /i, 'DELETE TOP (1) FROM ').replace(/^UPDATE /i, 'UPDATE TOP (1) ')
  if (dialect === 'sqlite') return sql.replace(`WHERE ${whereSql}`, `WHERE rowid = (SELECT rowid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  if (isPostgresCompatibleDbType(dialect)) return sql.replace(`WHERE ${whereSql}`, `WHERE ctid = (SELECT ctid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  return sql
}

export const buildDatabaseMutationStatement = (
  dialect: DatabaseMutationDialect,
  tableRef: string,
  knownColumns: string[],
  mutation: DatabaseTableMutationInput['mutations'][number]
): DatabaseMutationStatement | null => {
  const knownColumnSet = new Set(knownColumns.map((column) => column.toLowerCase()))
  const params: unknown[] = []
  if (mutation.kind === 'drop') return { kind: mutation.kind, sql: `DROP TABLE ${tableRef}`, params }
  if (mutation.kind === 'truncate') {
    return { kind: mutation.kind, sql: dialect === 'sqlite' ? `DELETE FROM ${tableRef}` : `TRUNCATE TABLE ${tableRef}`, params }
  }
  if (mutation.kind === 'insert') {
    const columns = Object.keys(mutation.values).filter((column) => knownColumnSet.has(column.toLowerCase()) && mutation.values[column] !== null && mutation.values[column] !== undefined)
    if (!columns.length) return null
    columns.forEach((column) => params.push(mutation.values[column]))
    return {
      kind: mutation.kind,
      sql: `INSERT INTO ${tableRef} (${columns.map((column) => databaseMutationIdentifier(column, dialect)).join(', ')}) VALUES (${columns.map((_column, index) => databaseMutationPlaceholder(dialect, index + 1)).join(', ')})`,
      params
    }
  }
  if (mutation.kind === 'delete') {
    const where = databaseMutationWhereForRow(dialect, knownColumns, mutation, params)
    const sql = `DELETE FROM ${tableRef} WHERE ${where.sql}`
    return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuard(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
  }

  const columns = Object.keys(mutation.patch).filter((column) => knownColumnSet.has(column.toLowerCase()))
  if (!columns.length) return null
  columns.forEach((column) => params.push(mutation.patch[column]))
  const assignments = columns.map((column, index) => `${databaseMutationIdentifier(column, dialect)} = ${databaseMutationPlaceholder(dialect, index + 1)}`).join(', ')
  const where = databaseMutationWhereForRow(dialect, knownColumns, mutation, params)
  const sql = `UPDATE ${tableRef} SET ${assignments} WHERE ${where.sql}`
  return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuard(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
}

const formatDatabaseMutationSqlLiteral = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

const formatDatabaseMutationStatementPreview = (statement: DatabaseMutationStatement) => {
  let paramIndex = 0
  const sql = statement.sql.replace(/\$(\d+)|:(\d+)|@p(\d+)|\?/g, (match) => {
    if (match === '?') {
      const value = statement.params[paramIndex]
      paramIndex += 1
      return formatDatabaseMutationSqlLiteral(value)
    }
    const index = Number(match.replace(/^\$|^:|^@p/i, '') || paramIndex + 1)
    return formatDatabaseMutationSqlLiteral(statement.params[index - 1])
  })
  return `${sql};`
}

export const addDatabaseMutationPreview = (statement: DatabaseMutationStatement): DatabaseTableMutationPlanStatement => ({
  ...statement,
  preview: formatDatabaseMutationStatementPreview(statement)
})

const databaseMutationWarning = (dialect: DatabaseMutationDialect, input: Pick<DatabaseTableMutationInput, 'mutations'>) => {
  const hasNoPrimaryKeyRowMutation = input.mutations.some((mutation) => {
    if (mutation.kind !== 'delete' && mutation.kind !== 'update') return false
    return mutation.primaryKey.map(trim).filter(Boolean).length === 0
  })
  if (!hasNoPrimaryKeyRowMutation) return ''
  if (dialect === 'oracle') return 'Oracle table editing requires a primary key in this version.'
  return 'No primary key detected. UPDATE and DELETE previews use the original row snapshot with a single-row guard.'
}

export const inputKnownColumns = (input: DatabaseTableMutationPlanInput) => {
  const columns = [...(input.knownColumns ?? []), ...(input.columns ?? [])].map(trim).filter(Boolean)
  return Array.from(new Set(columns))
}

export const databaseMutationPlanData = (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationPlanInput,
  knownColumns: string[]
): DatabaseTableMutationPlanResult['data'] => {
  if (connection.dbType === 'clickhouse') {
    throw Object.assign(new Error('ClickHouse table editing must be planned by the HTTP engine runtime.'), {
      code: 'DB_CLICKHOUSE_MUTATION_PLAN_FAILED'
    })
  }
  if (connection.dbType === 'presto') {
    throw Object.assign(new Error('Presto table editing is not supported by this aiopsterm backend.'), {
      code: 'DB_PRESTO_MUTATION_UNSUPPORTED'
    })
  }
  const dialect: DatabaseMutationDialect = connection.dbType
  const tableRef = databaseMutationTableReference(connection, input, dialect)
  const statements = input.mutations
    .map((mutation) => buildDatabaseMutationStatement(dialect, tableRef, knownColumns, mutation))
    .filter((statement): statement is DatabaseMutationStatement => !!statement)
    .map(addDatabaseMutationPreview)
  return {
    statements,
    statementCount: statements.length,
    preview: statements.map((statement) => statement.preview).join('\n'),
    warning: databaseMutationWarning(dialect, input)
  }
}

export const databaseMutationPlanErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

export const databaseMutationPlanErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))
