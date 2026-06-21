import type {
  DatabaseColumnFilter,
  DatabaseColumnSort,
  DatabaseConnectionInfo,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'
import {
  buildDatabaseMutationStatement,
  databaseMutationTableReference,
  type DatabaseMutationStatement
} from './databaseMutationPlanner'
import {
  columnsForRows,
  configuredDatabaseRelationalRuntime,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  normalizeQueryRows,
  oracleColumnsFromMetadata,
  oracleCommit,
  oracleExec,
  oracleExecuteOptions,
  oracleLookupIdentifier,
  oracleRollback,
  oracleRows,
  oracleRowsFromResult,
  oracleSchemaNameFor,
  parseOrderByRaw,
  parseWhereRaw,
  postgresExec,
  postgresRows,
  relationalErrorCode,
  relationalErrorMessage,
  relationalFallbackCode,
  relationalIdentifier,
  relationalPlaceholder,
  relationalRowCount,
  relationalTableReference,
  rowValue,
  sqlServerColumnType,
  sqlServerExec,
  sqlServerRequestWithParams,
  sqlServerRows,
  trim,
  withMysqlConnection,
  withOracleConnection,
  withPostgresClient,
  withSqlServerPool,
  mysqlExec,
  mysqlRows,
  type DatabaseSqlExecuteRawResult,
  type RelationalDatabaseType
} from './databaseRelationalCore'
import {
  relationalCatalogsForConnection,
  relationalColumnsForTable
} from './databaseRelationalCatalogs'

export {
  configureDatabaseRelationalEngines,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  isRelationalConnection,
  relationalErrorCode,
  relationalErrorMessage,
  relationalFallbackCode,
  resetDatabaseRelationalRuntime,
  testRelationalDatabaseConnection,
  type DatabaseProxySocketResult,
  type MySqlDriver,
  type OracleDriver,
  type PostgresDriver,
  type RelationalDatabaseType,
  type SqlServerDriver
} from './databaseRelationalCore'

export {
  relationalCatalogsForConnection,
  relationalColumnsForTable
} from './databaseRelationalCatalogs'

const relationalWhereForFilters = (dbType: RelationalDatabaseType, filters: DatabaseColumnFilter[], knownColumns: string[]) => {
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const clauses: string[] = []
  const params: unknown[] = []
  filters.forEach((filter) => {
    const column = known.get(trim(filter.column).toLowerCase())
    if (!column) return
    const quoted = relationalIdentifier(column, dbType)
    if (filter.operator === 'isnull') {
      clauses.push(`${quoted} IS NULL`)
      return
    }
    if (filter.operator === 'notnull') {
      clauses.push(`${quoted} IS NOT NULL`)
      return
    }
    if (filter.operator === 'like') {
      params.push(`%${String(filter.value ?? '')}%`)
      clauses.push(`${quoted} LIKE ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    if (filter.operator === 'eq') {
      params.push(String(filter.value ?? ''))
      clauses.push(`${quoted} = ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    if (filter.operator === 'neq') {
      params.push(String(filter.value ?? ''))
      clauses.push(`${quoted} <> ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    const values = (filter.values ?? []).map(String)
    if (!values.length) {
      clauses.push('0 = 1')
      return
    }
    const placeholders = values.map((value) => {
      params.push(value)
      return relationalPlaceholder(dbType, params.length)
    })
    clauses.push(`${quoted} IN (${placeholders.join(', ')})`)
  })
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params
  }
}

const relationalOrderByFor = (dbType: RelationalDatabaseType, sort: DatabaseColumnSort | null | undefined, knownColumns: string[]) => {
  if (!sort) return ''
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const column = known.get(trim(sort.column).toLowerCase())
  if (!column) return ''
  return ` ORDER BY ${relationalIdentifier(column, dbType)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
}

const oracleDdlPermissionError = (error: unknown) => {
  const message = relationalErrorMessage(error, '')
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return /ORA-01031|insufficient privileges|permission/i.test(`${code} ${message}`)
}

export const relationalQueryTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableQueryInput,
  startedAt: number
): Promise<DatabaseTableQueryResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    const columns = await relationalColumnsForTable(connection, input)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = relationalWhereForFilters(dbType, filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = relationalOrderByFor(dbType, sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = relationalTableReference(connection, input)
    const limitPlaceholder = relationalPlaceholder(dbType, where.params.length + (dbType === 'sqlserver' ? 2 : 1))
    const offsetPlaceholder = relationalPlaceholder(dbType, where.params.length + (dbType === 'sqlserver' ? 1 : 2))
    const rowsSql =
      dbType === 'oracle' || dbType === 'sqlserver'
        ? `SELECT * FROM ${tableRef}${where.sql}${orderBy || ' ORDER BY (SELECT 1)'} OFFSET ${offsetPlaceholder} ROWS FETCH NEXT ${limitPlaceholder} ROWS ONLY`
        : `SELECT * FROM ${tableRef}${where.sql}${orderBy} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`
    const countSql = `SELECT COUNT(*) AS total FROM ${tableRef}${where.sql}`
    const params = dbType === 'oracle' || dbType === 'sqlserver' ? [...where.params, offset, pageSize] : [...where.params, pageSize, offset]

    if (isMysqlCompatibleDbType(connection.dbType)) {
      return await withMysqlConnection(connection, async (client) => {
        const rows = await mysqlRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await mysqlRows<{ total?: number | string }>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(count[0]?.total ?? 0) : null,
            knownColumns
          }
        }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const rows = await oracleRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await oracleRows<Record<string, unknown>>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(rowValue(count[0] ?? {}, 'TOTAL', 'total') ?? 0) : null,
            knownColumns
          }
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const rows = await sqlServerRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await sqlServerRows<Record<string, unknown>>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(rowValue(count[0] ?? {}, 'total', 'TOTAL') ?? 0) : null,
            knownColumns
          }
        }
      })
    }

    return await withPostgresClient(connection, async (client) => {
      const rows = await postgresRows<Record<string, unknown>>(client, rowsSql, params)
      const count = input.withTotal ? await postgresRows<{ total?: number | string }>(client, countSql, where.params) : []
      return {
        ok: true,
        data: {
          columns: knownColumns,
          rows,
          rowCount: rows.length,
          durationMs: Math.max(1, Date.now() - startedAt),
          total: input.withTotal ? Number(count[0]?.total ?? 0) : null,
          knownColumns
        }
      }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'QUERY_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database table query failed.')
    }
  }
}

export const relationalExecute = async (connection: DatabaseConnectionInfo, rawSql: string, startedAt: number): Promise<DatabaseSqlExecuteRawResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (isMysqlCompatibleDbType(connection.dbType)) {
      return await withMysqlConnection(connection, async (client) => {
        const [rawRows, rawFields] = await client.query(rawSql)
        const rows = normalizeQueryRows(rawRows)
        const fields = Array.isArray(rawFields) ? (rawFields as Array<{ name?: string }>) : []
        return {
          ok: true,
          data: {
            columns: fields.map((field) => trim(field.name)).filter(Boolean) || columnsForRows(rows),
            rows,
            rowCount: rows.length || relationalRowCount(rawRows),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const result = await client.execute(rawSql, [], oracleExecuteOptions())
        const rows = oracleRowsFromResult<Record<string, unknown>>(result)
        const columns = oracleColumnsFromMetadata(result.metaData)
        return {
          ok: true,
          data: {
            columns: columns.length ? columns : columnsForRows(rows),
            rows,
            rowCount: rows.length || Number(result.rowsAffected ?? 0),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const result = await client.request().query<Record<string, unknown>>(rawSql)
        const rows = normalizeQueryRows(result.recordset)
        return {
          ok: true,
          data: {
            columns: columnsForRows(rows),
            rows,
            rowCount: rows.length || result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) || 0,
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    return await withPostgresClient(connection, async (client) => {
      const result = await client.query<Record<string, unknown>>(rawSql)
      const rows = normalizeQueryRows(result.rows)
      const columns = Array.isArray(result.fields) && result.fields.length ? result.fields.map((field) => trim(field.name)).filter(Boolean) : columnsForRows(rows)
      return {
        ok: true,
        data: {
          columns,
          rows,
          rowCount: rows.length || Number(result.rowCount ?? 0),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'QUERY_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database query failed.')
    }
  }
}

const postgresColumnTypeDdl = (row: {
  data_type?: string
  udt_name?: string
  character_maximum_length?: number | null
  numeric_precision?: number | null
  numeric_scale?: number | null
}) => {
  const dataType = trim(row.data_type)
  if (row.character_maximum_length && dataType.includes('character')) return `${dataType}(${row.character_maximum_length})`
  if (row.numeric_precision && dataType === 'numeric') return row.numeric_scale ? `numeric(${row.numeric_precision}, ${row.numeric_scale})` : `numeric(${row.numeric_precision})`
  return dataType || trim(row.udt_name) || 'text'
}

const sqlServerColumnTypeDdl = (row: Record<string, unknown>) => sqlServerColumnType(row)

export const relationalTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (isMysqlCompatibleDbType(connection.dbType)) {
      return await withMysqlConnection(connection, async (client) => {
        const rows = await mysqlRows<Record<string, unknown>>(
          client,
          `SHOW CREATE TABLE ${relationalTableReference(connection, input)}`
        )
        const values = Object.values(rows[0] ?? {})
        const ddl = values.find((value, index) => index > 0 && typeof value === 'string')
        if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        return { ok: true, data: { ddl: String(ddl) } }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const schemaName = oracleSchemaNameFor(connection, input)
        const tableName = oracleLookupIdentifier(input.tableName)
        const objectRows = await oracleRows<Record<string, unknown>>(
          client,
          "SELECT object_type FROM all_objects WHERE owner = :1 AND object_name = :2 AND object_type IN ('TABLE', 'VIEW') ORDER BY CASE object_type WHEN 'TABLE' THEN 1 ELSE 2 END",
          [schemaName, tableName]
        )
        const objectType = trim(rowValue(objectRows[0] ?? {}, 'OBJECT_TYPE', 'object_type'))
        if (!objectType) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        try {
          const rows = await oracleRows<Record<string, unknown>>(
            client,
            'SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) AS ddl FROM dual',
            [objectType, tableName, schemaName]
          )
          const ddl = trim(rowValue(rows[0] ?? {}, 'DDL', 'ddl'))
          if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
          return { ok: true, data: { ddl } }
        } catch (error) {
          if (oracleDdlPermissionError(error)) {
            return { ok: false, errorCode: 'permission', errorMessage: 'DDL requires elevated catalog permission.' }
          }
          throw error
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const schemaName = trim(input.schemaName) || 'dbo'
        const tableName = trim(input.tableName)
        const objectRows = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT o.type AS object_type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')",
          [schemaName, tableName]
        )
        const objectType = trim(rowValue(objectRows[0] ?? {}, 'object_type', 'OBJECT_TYPE')).toUpperCase()
        if (!objectType) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        if (objectType === 'V') {
          const viewRows = await sqlServerRows<Record<string, unknown>>(
            client,
            "SELECT sm.definition AS ddl FROM sys.sql_modules sm JOIN sys.objects o ON o.object_id = sm.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @p1 AND o.name = @p2 AND o.type = 'V'",
            [schemaName, tableName]
          ).catch(() => [])
          const viewDdl = trim(rowValue(viewRows[0] ?? {}, 'ddl', 'DDL'))
          if (!viewDdl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
          return { ok: true, data: { ddl: viewDdl } }
        }
        const columns = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable, dc.definition AS column_default FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id WHERE s.name = @p1 AND o.name = @p2 AND o.type = 'U' ORDER BY c.column_id",
          [schemaName, tableName]
        )
        if (!columns.length) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const primaryKeys = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' AND s.name = @p1 AND o.name = @p2 ORDER BY ic.key_ordinal",
          [schemaName, tableName]
        )
        const columnLines = columns.map((row) => {
          const pieces = [
            `  ${relationalIdentifier(trim(rowValue(row, 'column_name', 'COLUMN_NAME')), 'sqlserver')} ${sqlServerColumnTypeDdl(row)}`,
            Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')) ? 'NULL' : 'NOT NULL',
            trim(rowValue(row, 'column_default', 'COLUMN_DEFAULT')) ? `DEFAULT ${trim(rowValue(row, 'column_default', 'COLUMN_DEFAULT'))}` : ''
          ].filter(Boolean)
          return pieces.join(' ')
        })
        const pk = primaryKeys.map((row) => trim(rowValue(row, 'column_name', 'COLUMN_NAME'))).filter(Boolean)
        if (pk.length) {
          columnLines.push(`  PRIMARY KEY (${pk.map((column) => relationalIdentifier(column, 'sqlserver')).join(', ')})`)
        }
        return { ok: true, data: { ddl: `CREATE TABLE ${relationalTableReference(connection, input)} (\n${columnLines.join(',\n')}\n);` } }
      })
    }

    return await withPostgresClient(connection, async (client) => {
      const schemaName = trim(input.schemaName) || 'public'
      const tableName = trim(input.tableName)
      const columns = await postgresRows<{
        column_name?: string
        data_type?: string
        udt_name?: string
        character_maximum_length?: number | null
        numeric_precision?: number | null
        numeric_scale?: number | null
        is_nullable?: string
        column_default?: string | null
      }>(
        client,
        'SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [schemaName, tableName]
      )
      if (!columns.length) {
        const viewRows = await postgresRows<{ ddl?: string }>(
          client,
          'SELECT pg_get_viewdef(($1)::regclass, true) AS ddl',
          [`${relationalIdentifier(schemaName, dbType)}.${relationalIdentifier(tableName, dbType)}`]
        ).catch(() => [])
        const viewDdl = trim(viewRows[0]?.ddl)
        if (!viewDdl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        return { ok: true, data: { ddl: `CREATE VIEW ${relationalTableReference(connection, input)} AS\n${viewDdl};` } }
      }
      const primaryKeys = await postgresRows<{ column_name?: string }>(
        client,
        "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position",
        [schemaName, tableName]
      )
      const columnLines = columns.map((row) => {
        const pieces = [
          `  ${relationalIdentifier(trim(row.column_name), dbType)} ${postgresColumnTypeDdl(row)}`,
          trim(row.is_nullable).toUpperCase() === 'NO' ? 'NOT NULL' : '',
          trim(row.column_default) ? `DEFAULT ${trim(row.column_default)}` : ''
        ].filter(Boolean)
        return pieces.join(' ')
      })
      const pk = primaryKeys.map((row) => trim(row.column_name)).filter(Boolean)
      if (pk.length) {
        columnLines.push(`  PRIMARY KEY (${pk.map((column) => relationalIdentifier(column, dbType)).join(', ')})`)
      }
      return { ok: true, data: { ddl: `CREATE TABLE ${relationalTableReference(connection, input)} (\n${columnLines.join(',\n')}\n);` } }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'DDL_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database DDL lookup failed.')
    }
  }
}

export const relationalCreateDatabase = async (connection: DatabaseConnectionInfo, sql: string, name: string) => {
  if (isMysqlCompatibleDbType(connection.dbType)) {
    await withMysqlConnection(connection, async (client) => {
      await mysqlExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, connection.dbType as RelationalDatabaseType)}`)
    })
    return
  }
  if (isPostgresCompatibleDbType(connection.dbType)) {
    await withPostgresClient(connection, async (client) => {
      await postgresExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, connection.dbType as RelationalDatabaseType)}`)
    })
    return
  }
  if (connection.dbType === 'sqlserver') {
    await withSqlServerPool(connection, async (client) => {
      await sqlServerExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, 'sqlserver')}`)
    })
    return
  }
  throw Object.assign(new Error('Create Database is not supported for this relational engine.'), { code: 'DB_CREATE_DATABASE_UNSUPPORTED' })
}

export const relationalMutateTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationInput,
  startedAt: number
): Promise<DatabaseTableMutationResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    const columns = await relationalColumnsForTable(connection, input)
    if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const tableRef = databaseMutationTableReference(connection, input, dbType)
    const statements = input.mutations
      .map((mutation) => buildDatabaseMutationStatement(dbType, tableRef, knownColumns, mutation))
      .filter((statement): statement is DatabaseMutationStatement => !!statement)
    let affected = 0
    if (isMysqlCompatibleDbType(connection.dbType)) {
      await withMysqlConnection(connection, async (client) => {
        await mysqlExec(client, 'BEGIN')
        try {
          for (const statement of statements) affected += await mysqlExec(client, statement.sql, statement.params)
          await mysqlExec(client, 'COMMIT')
        } catch (error) {
          await mysqlExec(client, 'ROLLBACK').catch(() => undefined)
          throw error
        }
      })
    } else {
      if (connection.dbType === 'oracle') {
        await withOracleConnection(connection, async (client) => {
          try {
            for (const statement of statements) affected += await oracleExec(client, statement.sql, statement.params)
            await oracleCommit(client)
          } catch (error) {
            await oracleRollback(client).catch(() => undefined)
            throw error
          }
        })
      } else if (connection.dbType === 'sqlserver') {
        await withSqlServerPool(connection, async (client) => {
          const transaction = client.transaction?.()
          if (transaction) {
            await transaction.begin()
            try {
              for (const statement of statements) {
                const result = await sqlServerRequestWithParams(transaction.request(), statement.params).query(statement.sql)
                affected += result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) ?? 0
              }
              await transaction.commit()
            } catch (error) {
              await transaction.rollback().catch(() => undefined)
              throw error
            }
            return
          }
          await sqlServerExec(client, 'BEGIN TRANSACTION')
          try {
            for (const statement of statements) affected += await sqlServerExec(client, statement.sql, statement.params)
            await sqlServerExec(client, 'COMMIT TRANSACTION')
          } catch (error) {
            await sqlServerExec(client, 'ROLLBACK TRANSACTION').catch(() => undefined)
            throw error
          }
        })
      } else {
        await withPostgresClient(connection, async (client) => {
          await postgresExec(client, 'BEGIN')
          try {
            for (const statement of statements) affected += await postgresExec(client, statement.sql, statement.params)
            await postgresExec(client, 'COMMIT')
          } catch (error) {
            await postgresExec(client, 'ROLLBACK').catch(() => undefined)
            throw error
          }
        })
      }
    }
    await configuredDatabaseRelationalRuntime().refreshConnectionCatalog(connection.id, relationalCatalogsForConnection)
    return {
      ok: true,
      data: {
        affected,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: configuredDatabaseRelationalRuntime().workspaceCatalogFor(input.connectionId)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'MUTATION_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database table mutation failed.')
    }
  }
}
