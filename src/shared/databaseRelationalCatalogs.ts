import type {
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseSchemaInfo,
  DatabaseTableQueryInput
} from './contracts/database'
import {
  databaseColumnId,
  isMysqlCompatibleDbType,
  oracleColumnType,
  oracleConnectStringFromInput,
  oracleLookupIdentifier,
  oracleRows,
  oracleSchemaNameFor,
  rowValue,
  schemaHasObjects,
  sqlitePrimaryKeyForColumns,
  sqlServerColumnType,
  sqlServerRows,
  trim,
  withMysqlConnection,
  withOracleConnection,
  withPostgresClient,
  withSqlServerPool,
  mysqlRows,
  postgresRows
} from './databaseRelationalCore'

const mysqlCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withMysqlConnection(connection, async (client) => {
    const schemaRows = await mysqlRows<{ SCHEMA_NAME?: string; schema_name?: string }>(
      client,
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY SCHEMA_NAME"
    )
    const catalogNames = schemaRows.map((row) => trim(row.SCHEMA_NAME || row.schema_name)).filter(Boolean)
    const selected = trim(connection.database)
    const orderedCatalogs = Array.from(new Set([selected, ...catalogNames].filter(Boolean)))
    const catalogs: DatabaseCatalogInfo[] = []

    for (const catalogName of orderedCatalogs) {
      const tableRows = await mysqlRows<{ TABLE_NAME?: string; table_name?: string; TABLE_TYPE?: string; table_type?: string }>(
        client,
        'SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
        [catalogName]
      )
      const columnRows = await mysqlRows<{
        TABLE_NAME?: string
        table_name?: string
        COLUMN_NAME?: string
        column_name?: string
        COLUMN_TYPE?: string
        column_type?: string
        DATA_TYPE?: string
        data_type?: string
        IS_NULLABLE?: string
        is_nullable?: string
        COLUMN_KEY?: string
        column_key?: string
      }>(
        client,
        'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
        [catalogName]
      )
      const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
      columnRows.forEach((row) => {
        const tableName = trim(row.TABLE_NAME || row.table_name)
        const name = trim(row.COLUMN_NAME || row.column_name)
        if (!tableName || !name) return
        const column: DatabaseColumnInfo = {
          name,
          type: trim(row.COLUMN_TYPE || row.column_type || row.DATA_TYPE || row.data_type) || 'unknown',
          nullable: trim(row.IS_NULLABLE || row.is_nullable).toUpperCase() !== 'NO',
          ...(trim(row.COLUMN_KEY || row.column_key).toUpperCase() === 'PRI' ? { key: 'PK' as const } : {})
        }
        columnsByTable.set(tableName, [...(columnsByTable.get(tableName) ?? []), column])
      })
      catalogs.push({
        name: catalogName,
        tables: tableRows
          .filter((row) => trim(row.TABLE_TYPE || row.table_type).toUpperCase() !== 'VIEW')
          .map((row) => {
            const name = trim(row.TABLE_NAME || row.table_name)
            const columns = columnsByTable.get(name) ?? []
            return {
              id: databaseColumnId(connection.id, `${catalogName}-${name}`),
              name,
              columns,
              primaryKey: sqlitePrimaryKeyForColumns(columns)
            }
          })
          .filter((table) => table.name)
      })
    }

    return catalogs
  })

const postgresCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withPostgresClient(connection, async (client) => {
    const databaseName = trim(connection.database)
    const schemaRows = await postgresRows<{ schema_name?: string }>(
      client,
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' ORDER BY schema_name"
    )
    const objectRows = await postgresRows<{ table_schema?: string; table_name?: string; table_type?: string }>(
      client,
      "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_catalog = current_database() AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp_%' ORDER BY table_schema, table_name"
    )
    const columnRows = await postgresRows<{
      table_schema?: string
      table_name?: string
      column_name?: string
      data_type?: string
      udt_name?: string
      character_maximum_length?: number | null
      is_nullable?: string
    }>(
      client,
      "SELECT table_schema, table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_catalog = current_database() AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp_%' ORDER BY table_schema, table_name, ordinal_position"
    )
    const primaryKeyRows = await postgresRows<{ table_schema?: string; table_name?: string; column_name?: string }>(
      client,
      "SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_catalog = current_database() ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position"
    )
    const routineRows = await postgresRows<{ routine_schema?: string; routine_name?: string; routine_type?: string }>(
      client,
      "SELECT routine_schema, routine_name, routine_type FROM information_schema.routines WHERE specific_catalog = current_database() AND routine_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY routine_schema, routine_name"
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const key = `${trim(row.table_schema)}.${trim(row.table_name)}`
      const column = trim(row.column_name)
      if (key !== '.' && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })
    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const key = `${trim(row.table_schema)}.${trim(row.table_name)}`
      const name = trim(row.column_name)
      if (key === '.' || !name) return
      const primaryKey = pkByTable.get(key) ?? []
      const type = trim(row.character_maximum_length) && trim(row.data_type).includes('character') ? `${trim(row.data_type)}(${row.character_maximum_length})` : trim(row.data_type || row.udt_name) || 'unknown'
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type,
          nullable: trim(row.is_nullable).toUpperCase() !== 'NO',
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const schemas = schemaRows
      .map((row) => trim(row.schema_name))
      .filter(Boolean)
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(row.table_schema) === schemaName)
        const functions = routineRows
          .filter((row) => trim(row.routine_schema) === schemaName && trim(row.routine_type).toUpperCase() === 'FUNCTION')
          .map((row) => trim(row.routine_name))
          .filter(Boolean)
        const procedures = routineRows
          .filter((row) => trim(row.routine_schema) === schemaName && trim(row.routine_type).toUpperCase() === 'PROCEDURE')
          .map((row) => trim(row.routine_name))
          .filter(Boolean)
        const tableFor = (row: { table_name?: string }) => {
          const name = trim(row.table_name)
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(row.table_type).toUpperCase() === 'BASE TABLE')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(row.table_type).toUpperCase() === 'VIEW')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

const oracleSystemSchemas = [
  'ANONYMOUS',
  'APEX_PUBLIC_USER',
  'APPQOSSYS',
  'AUDSYS',
  'CTXSYS',
  'DBSFWUSER',
  'DBSNMP',
  'DIP',
  'DVF',
  'DVSYS',
  'GGSYS',
  'GSMADMIN_INTERNAL',
  'GSMCATUSER',
  'GSMUSER',
  'LBACSYS',
  'MDSYS',
  'OJVMSYS',
  'OLAPSYS',
  'ORACLE_OCM',
  'ORDDATA',
  'ORDPLUGINS',
  'ORDSYS',
  'OUTLN',
  'REMOTE_SCHEDULER_AGENT',
  'SI_INFORMTN_SCHEMA',
  'SYS',
  'SYS$UMF',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSRAC',
  'SYSTEM',
  'WMSYS',
  'XDB',
  'XS$NULL'
]
const oracleSystemSchemaListSql = oracleSystemSchemas.map((schema) => `'${schema}'`).join(', ')

const oracleCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withOracleConnection(connection, async (client) => {
    const contextRows = await oracleRows<Record<string, unknown>>(
      client,
      "SELECT SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV', 'DB_NAME') AS db_name FROM DUAL"
    ).catch(() => [])
    const databaseName =
      trim(connection.database) ||
      trim(rowValue(contextRows[0] ?? {}, 'SERVICE_NAME', 'service_name')) ||
      trim(rowValue(contextRows[0] ?? {}, 'DB_NAME', 'db_name')) ||
      oracleConnectStringFromInput(connection)
    const schemaRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT DISTINCT owner FROM all_objects WHERE owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY owner`
    )
    const objectRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT owner, object_name, object_type FROM all_objects WHERE owner NOT IN (${oracleSystemSchemaListSql}) AND object_type IN ('TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE') ORDER BY owner, object_type, object_name`
    )
    const columnRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT owner, table_name, column_name, data_type, data_length, data_precision, data_scale, nullable FROM all_tab_columns WHERE owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY owner, table_name, column_id`
    )
    const primaryKeyRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT c.owner, c.table_name, cc.column_name FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name WHERE c.constraint_type = 'P' AND c.owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY c.owner, c.table_name, cc.position`
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const owner = trim(rowValue(row, 'OWNER', 'owner'))
      const tableName = trim(rowValue(row, 'TABLE_NAME', 'table_name'))
      const column = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
      const key = `${owner}.${tableName}`
      if (owner && tableName && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })

    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const owner = trim(rowValue(row, 'OWNER', 'owner'))
      const tableName = trim(rowValue(row, 'TABLE_NAME', 'table_name'))
      const name = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
      if (!owner || !tableName || !name) return
      const key = `${owner}.${tableName}`
      const primaryKey = pkByTable.get(key) ?? []
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type: oracleColumnType(row),
          nullable: trim(rowValue(row, 'NULLABLE', 'nullable')).toUpperCase() !== 'N',
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const objectOwners = new Set(objectRows.map((row) => trim(rowValue(row, 'OWNER', 'owner'))).filter(Boolean))
    const orderedSchemas = Array.from(
      new Set([...schemaRows.map((row) => trim(rowValue(row, 'OWNER', 'owner'))).filter(Boolean), ...Array.from(objectOwners)])
    ).sort((first, second) => first.localeCompare(second))
    const schemas = orderedSchemas
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(rowValue(row, 'OWNER', 'owner')) === schemaName)
        const functions = schemaObjects
          .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'FUNCTION')
          .map((row) => trim(rowValue(row, 'OBJECT_NAME', 'object_name')))
          .filter(Boolean)
        const procedures = schemaObjects
          .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'PROCEDURE')
          .map((row) => trim(rowValue(row, 'OBJECT_NAME', 'object_name')))
          .filter(Boolean)
        const tableFor = (row: Record<string, unknown>) => {
          const name = trim(rowValue(row, 'OBJECT_NAME', 'object_name'))
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'TABLE')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'VIEW')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

const sqlServerCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withSqlServerPool(connection, async (client) => {
    const databaseRows = await sqlServerRows<Record<string, unknown>>(client, 'SELECT DB_NAME() AS database_name').catch(() => [])
    const databaseName = trim(rowValue(databaseRows[0] ?? {}, 'database_name', 'DATABASE_NAME')) || trim(connection.database)
    const schemaRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT name AS schema_name FROM sys.schemas WHERE name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY name"
    )
    const objectRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS object_name, o.type AS object_type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('U', 'V', 'FN', 'IF', 'TF', 'P', 'PC') AND s.name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY s.name, o.type, o.name"
    )
    const columnRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS table_name, c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE o.type IN ('U', 'V') AND s.name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY s.name, o.name, c.column_id"
    )
    const primaryKeyRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS table_name, c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' ORDER BY s.name, o.name, ic.key_ordinal"
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      const column = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      const key = `${schemaName}.${tableName}`
      if (schemaName && tableName && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })

    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      const name = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      if (!schemaName || !tableName || !name) return
      const key = `${schemaName}.${tableName}`
      const primaryKey = pkByTable.get(key) ?? []
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type: sqlServerColumnType(row),
          nullable: Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')),
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const objectSchemas = new Set(objectRows.map((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))).filter(Boolean))
    const orderedSchemas = Array.from(
      new Set([...schemaRows.map((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))).filter(Boolean), ...Array.from(objectSchemas)])
    ).sort((first, second) => first.localeCompare(second))
    const schemas = orderedSchemas
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME')) === schemaName)
        const functions = schemaObjects
          .filter((row) => ['FN', 'IF', 'TF'].includes(trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase()))
          .map((row) => trim(rowValue(row, 'object_name', 'OBJECT_NAME')))
          .filter(Boolean)
        const procedures = schemaObjects
          .filter((row) => ['P', 'PC'].includes(trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase()))
          .map((row) => trim(rowValue(row, 'object_name', 'OBJECT_NAME')))
          .filter(Boolean)
        const tableFor = (row: Record<string, unknown>) => {
          const name = trim(rowValue(row, 'object_name', 'OBJECT_NAME'))
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase() === 'U')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase() === 'V')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

export const relationalCatalogsForConnection = (connection: DatabaseConnectionInfo) =>
  isMysqlCompatibleDbType(connection.dbType)
    ? mysqlCatalogsForConnection(connection)
    : connection.dbType === 'oracle'
      ? oracleCatalogsForConnection(connection)
      : connection.dbType === 'sqlserver'
        ? sqlServerCatalogsForConnection(connection)
        : postgresCatalogsForConnection(connection)

export const relationalColumnsForTable = async (
  connection: DatabaseConnectionInfo,
  input: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName' | 'tableName'>
): Promise<DatabaseColumnInfo[]> => {
  if (isMysqlCompatibleDbType(connection.dbType)) {
    return withMysqlConnection(connection, async (client) =>
      mysqlRows<{
        COLUMN_NAME?: string
        COLUMN_TYPE?: string
        DATA_TYPE?: string
        IS_NULLABLE?: string
        COLUMN_KEY?: string
      }>(
        client,
        'SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [trim(input.databaseName), trim(input.tableName)]
      ).then((rows) =>
        rows.map((row) => ({
          name: trim(row.COLUMN_NAME),
          type: trim(row.COLUMN_TYPE || row.DATA_TYPE) || 'unknown',
          nullable: trim(row.IS_NULLABLE).toUpperCase() !== 'NO',
          ...(trim(row.COLUMN_KEY).toUpperCase() === 'PRI' ? { key: 'PK' as const } : {})
        }))
      )
    )
  }
  if (connection.dbType === 'oracle') {
    return withOracleConnection(connection, async (client) => {
      const schemaName = oracleSchemaNameFor(connection, input)
      const tableName = oracleLookupIdentifier(input.tableName)
      const primaryKeys = await oracleRows<Record<string, unknown>>(
        client,
        "SELECT cc.column_name FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name WHERE c.constraint_type = 'P' AND c.owner = :1 AND c.table_name = :2 ORDER BY cc.position",
        [schemaName, tableName]
      )
      const pk = primaryKeys.map((row) => trim(rowValue(row, 'COLUMN_NAME', 'column_name'))).filter(Boolean)
      const rows = await oracleRows<Record<string, unknown>>(
        client,
        'SELECT column_name, data_type, data_length, data_precision, data_scale, nullable FROM all_tab_columns WHERE owner = :1 AND table_name = :2 ORDER BY column_id',
        [schemaName, tableName]
      )
      return rows.map((row) => {
        const name = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
        return {
          name,
          type: oracleColumnType(row),
          nullable: trim(rowValue(row, 'NULLABLE', 'nullable')).toUpperCase() !== 'N',
          ...(pk.includes(name) ? { key: 'PK' as const } : {})
        }
      })
    })
  }
  if (connection.dbType === 'sqlserver') {
    return withSqlServerPool(connection, async (client) => {
      const schemaName = trim(input.schemaName) || 'dbo'
      const primaryKeys = await sqlServerRows<Record<string, unknown>>(
        client,
        "SELECT c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' AND s.name = @p1 AND o.name = @p2 ORDER BY ic.key_ordinal",
        [schemaName, trim(input.tableName)]
      )
      const pk = primaryKeys.map((row) => trim(rowValue(row, 'column_name', 'COLUMN_NAME'))).filter(Boolean)
      const rows = await sqlServerRows<Record<string, unknown>>(
        client,
        "SELECT c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE s.name = @p1 AND o.name = @p2 ORDER BY c.column_id",
        [schemaName, trim(input.tableName)]
      )
      return rows.map((row) => {
        const name = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
        return {
          name,
          type: sqlServerColumnType(row),
          nullable: Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')),
          ...(pk.includes(name) ? { key: 'PK' as const } : {})
        }
      })
    })
  }
  return withPostgresClient(connection, async (client) => {
    const schemaName = trim(input.schemaName) || 'public'
    const primaryKeys = await postgresRows<{ column_name?: string }>(
      client,
      "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position",
      [schemaName, trim(input.tableName)]
    )
    const pk = primaryKeys.map((row) => trim(row.column_name)).filter(Boolean)
    const rows = await postgresRows<{
      column_name?: string
      data_type?: string
      udt_name?: string
      character_maximum_length?: number | null
      is_nullable?: string
    }>(
      client,
      'SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      [schemaName, trim(input.tableName)]
    )
    return rows.map((row) => {
      const name = trim(row.column_name)
      const type = trim(row.character_maximum_length) && trim(row.data_type).includes('character') ? `${trim(row.data_type)}(${row.character_maximum_length})` : trim(row.data_type || row.udt_name) || 'unknown'
      return {
        name,
        type,
        nullable: trim(row.is_nullable).toUpperCase() !== 'NO',
        ...(pk.includes(name) ? { key: 'PK' as const } : {})
      }
    })
  })
}
