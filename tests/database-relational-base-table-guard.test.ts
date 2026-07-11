import { describe, expect, it } from 'vitest'
import type { DatabaseConnectionInfo, DatabaseEngineCode, DatabaseTableQueryInput } from '../src/shared/contracts/database'
import { configureDatabaseRelationalEngines, relationalQueryTable } from '../src/shared/databaseRelationalEngines'

const connectionFor = (dbType: DatabaseEngineCode): DatabaseConnectionInfo => ({
  id: `conn-${dbType}`,
  name: `guard-${dbType}`,
  dbType,
  env: 'Development',
  groupId: 'group-local',
  host: '127.0.0.1',
  port: null,
  authentication: 'UserAndPassword',
  user: dbType === 'oracle' ? 'OPS' : 'ops',
  database: dbType === 'sqlserver' ? 'opsdb' : 'ops',
  status: 'connected',
  catalogs: []
})

const queryInput = (dbType: DatabaseEngineCode): DatabaseTableQueryInput => ({
  connectionId: `conn-${dbType}`,
  dbType,
  databaseName: dbType === 'sqlserver' ? 'opsdb' : 'ops',
  schemaName: dbType === 'oracle' ? 'OPS' : dbType === 'sqlserver' ? 'dbo' : 'public',
  tableName: 'stale_object',
  page: 1,
  pageSize: 20,
  withTotal: false,
  requireStableBaseTable: true
})

const runtimeBase = {
  connectionInputFromSaved: (connection: DatabaseConnectionInfo) => ({
    dbType: connection.dbType,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: 'secret',
    database: connection.database
  }),
  refreshConnectionCatalog: async () => undefined,
  workspaceCatalogFor: () => undefined
}

describe('relational stable base-table guards', () => {
  it.each(['mysql', 'mariadb', 'oceanbase'] as const)(
    'rejects a stale %s catalog entry after the live object becomes a view',
    async (dbType) => {
      const statements: string[] = []
      configureDatabaseRelationalEngines({
        ...runtimeBase,
        mysqlDriver: {
          async createConnection() {
            return {
              async query<T = unknown>(sql: string): Promise<[T, unknown]> {
                statements.push(sql)
                const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
                if (normalized.includes('from information_schema.columns')) {
                  return [[{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI' }] as T, []]
                }
                if (normalized.includes('from information_schema.tables')) {
                  return [[{ TABLE_TYPE: 'VIEW', ENGINE: null }] as T, []]
                }
                throw new Error(`unexpected MySQL query: ${sql}`)
              },
              async end() {
                return undefined
              }
            }
          }
        }
      })

      const result = await relationalQueryTable(connectionFor(dbType), queryInput(dbType), Date.now())

      expect(result).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
      expect(statements.some((sql) => /^\s*lock\s+tables/i.test(sql))).toBe(false)
      expect(statements.some((sql) => /^\s*select\s+`id`\s+from/i.test(sql))).toBe(false)
    }
  )

  it('uses a read-only PostgreSQL transaction and object lock before a strict base-table SELECT', async () => {
    const statements: string[] = []
    class Client {
      async connect() {
        return undefined
      }

      async end() {
        return undefined
      }

      async query<T = Record<string, unknown>>(sql: string) {
        statements.push(sql)
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        const rowsFor = (rows: Array<Record<string, unknown>>) => ({ rows: rows as T[], fields: [], rowCount: rows.length })
        if (normalized.includes('from information_schema.table_constraints')) return rowsFor([])
        if (normalized.includes('from information_schema.columns')) {
          return rowsFor([{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }])
        }
        if (normalized.startsWith('begin transaction read only')) return rowsFor([])
        if (normalized.includes('from pg_catalog.pg_class')) return rowsFor([{ object_id: '4201', object_type: 'r' }])
        if (normalized.startsWith('lock table')) return rowsFor([])
        if (normalized.startsWith('select "id" from')) return rowsFor([{ id: 1 }])
        if (normalized === 'commit' || normalized === 'rollback') return rowsFor([])
        throw new Error(`unexpected PostgreSQL query: ${sql}`)
      }
    }
    configureDatabaseRelationalEngines({
      ...runtimeBase,
      postgresDriver: { Client }
    })

    const result = await relationalQueryTable(connectionFor('postgresql'), queryInput('postgresql'), Date.now())

    expect(result).toMatchObject({ ok: true, data: { rows: [{ id: 1 }] } })
    const strictStatements = statements.slice(2).map((sql) => sql.replace(/\s+/g, ' ').trim().toLowerCase())
    expect(strictStatements).toEqual([
      'begin transaction read only',
      expect.stringContaining('from pg_catalog.pg_class'),
      'lock table "public"."stale_object" in access share mode',
      expect.stringContaining('from pg_catalog.pg_class'),
      expect.stringMatching(/^select "id" from "public"\."stale_object"/),
      'commit'
    ])
  })

  it.each(['postgresql', 'kingbase'] as const)(
    'rejects a stale %s catalog entry when pg_class reports a materialized view',
    async (dbType) => {
      const statements: string[] = []
      class Client {
        async connect() {
          return undefined
        }

        async end() {
          return undefined
        }

        async query<T = Record<string, unknown>>(sql: string) {
          statements.push(sql)
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
          const rowsFor = (rows: Array<Record<string, unknown>>) => ({ rows: rows as T[], fields: [], rowCount: rows.length })
          if (normalized.includes('from information_schema.table_constraints')) return rowsFor([])
          if (normalized.includes('from information_schema.columns')) {
            return rowsFor([{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }])
          }
          if (normalized.startsWith('begin transaction read only')) return rowsFor([])
          if (normalized.includes('from pg_catalog.pg_class')) return rowsFor([{ object_id: '4202', object_type: 'm' }])
          if (normalized === 'rollback') return rowsFor([])
          throw new Error(`unexpected PostgreSQL query: ${sql}`)
        }
      }
      configureDatabaseRelationalEngines({
        ...runtimeBase,
        postgresDriver: { Client }
      })

      const result = await relationalQueryTable(connectionFor(dbType), queryInput(dbType), Date.now())

      expect(result).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
      expect(statements.some((sql) => /^\s*lock\s+table/i.test(sql))).toBe(false)
      expect(statements.some((sql) => /^\s*select\s+"id"\s+from/i.test(sql))).toBe(false)
    }
  )

  it('rejects an Oracle materialized view even when stale column metadata still exists', async () => {
    const statements: string[] = []
    configureDatabaseRelationalEngines({
      ...runtimeBase,
      oracleDriver: {
        OUT_FORMAT_OBJECT: 4002,
        async getConnection() {
          return {
            async execute(sql: string) {
              statements.push(sql)
              const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
              if (normalized.includes('from all_constraints')) return { rows: [], metaData: [] }
              if (normalized.includes('from all_tab_columns')) {
                return {
                  rows: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N' }],
                  metaData: [{ name: 'COLUMN_NAME' }]
                }
              }
              if (normalized.includes('from all_objects')) {
                return {
                  rows: [
                    { OBJECT_ID: 81, OBJECT_TYPE: 'TABLE' },
                    { OBJECT_ID: 82, OBJECT_TYPE: 'MATERIALIZED VIEW' }
                  ],
                  metaData: [{ name: 'OBJECT_ID' }, { name: 'OBJECT_TYPE' }]
                }
              }
              throw new Error(`unexpected Oracle query: ${sql}`)
            },
            async close() {
              return undefined
            }
          }
        }
      }
    })

    const result = await relationalQueryTable(connectionFor('oracle'), queryInput('oracle'), Date.now())

    expect(result).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
    expect(statements.some((sql) => /^\s*lock\s+table/i.test(sql))).toBe(false)
    expect(statements.some((sql) => /^\s*select\s+"ID"\s+from/i.test(sql))).toBe(false)
  })

  it('rejects a SQL Server view before taking a table lock or issuing the data SELECT', async () => {
    const statements: string[] = []
    const queryFor = async <T = Record<string, unknown>>(sql: string) => {
      statements.push(sql)
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      const rowsFor = (rows: Array<Record<string, unknown>>) => ({ recordset: rows as T[], rowsAffected: [rows.length] })
      if (normalized.includes('from sys.key_constraints')) return rowsFor([])
      if (normalized.includes('from sys.columns')) {
        return rowsFor([{ column_name: 'id', data_type: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: false }])
      }
      if (normalized === 'set transaction isolation level serializable') return rowsFor([])
      if (normalized.includes('from sys.objects')) return rowsFor([{ object_id: 91, object_type: 'V' }])
      throw new Error(`unexpected SQL Server query: ${sql}`)
    }
    class Request {
      input() {
        return this
      }

      query<T = Record<string, unknown>>(sql: string) {
        return queryFor<T>(sql)
      }
    }
    class Transaction {
      async begin() {
        return undefined
      }

      async commit() {
        return undefined
      }

      async rollback() {
        return undefined
      }

      request() {
        return new Request()
      }
    }
    class ConnectionPool {
      async connect() {
        return this
      }

      request() {
        return new Request()
      }

      transaction() {
        return new Transaction()
      }

      async close() {
        return undefined
      }
    }
    configureDatabaseRelationalEngines({
      ...runtimeBase,
      sqlServerDriver: { ConnectionPool }
    })

    const result = await relationalQueryTable(connectionFor('sqlserver'), queryInput('sqlserver'), Date.now())

    expect(result).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
    expect(statements.some((sql) => /top\s*\(0\)/i.test(sql))).toBe(false)
    expect(statements.some((sql) => /^\s*select\s+\[id]\s+from/i.test(sql))).toBe(false)
  })
})
