import { describe, expect, it, vi } from 'vitest'
import { databaseAiSqlTableReferences } from '../src/shared/databaseAiSqlRuntime'

const databaseMcpModulePath = '../src/main/backend/database/databaseMcp'

describe('DB AI database context loading', () => {
  it('extracts catalog candidates from regular FROM and JOIN references while ignoring comments, strings, and CTE names', () => {
    const sql = `
      WITH selected_metrics AS (
        SELECT *
        FROM "public"."chart_demo_metrics"
        WHERE note = 'JOIN private.injected_table'
      )
      SELECT metrics.id, sources.name
      FROM selected_metrics AS metrics
      JOIN [ops].[metric_sources] AS sources ON sources.id = metrics.source_id
      JOIN generate_series(1, 2) AS series(value) ON true
      -- JOIN ignored.comment_table ON true
      # JOIN ignored.mysql_comment_table ON true
    `

    expect(databaseAiSqlTableReferences(sql)).toEqual([
      { parts: ['public', 'chart_demo_metrics'], tableName: 'chart_demo_metrics' },
      { parts: ['ops', 'metric_sources'], tableName: 'metric_sources' }
    ])
  })

  it('loads describe and redacted DDL context for catalog-validated SQL table references when tableName is absent', async () => {
    const { createDatabaseAiMcpContextLoader } = await import(databaseMcpModulePath)
    const callTool = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      if (name === 'search_database_objects') {
        const query = String(args.query || '')
        const objects = query === 'chart_demo_metrics'
          ? [
              { databaseName: 'analytics', schemaName: 'public', kind: 'table', name: 'chart_demo_metrics' },
              { databaseName: 'analytics', schemaName: 'archive', kind: 'table', name: 'chart_demo_metrics' },
              { databaseName: 'analytics', schemaName: 'public', kind: 'table', name: 'chart_demo_metrics_archive' }
            ]
          : [{ databaseName: 'analytics', schemaName: 'ops', kind: 'table', name: 'metric_sources' }]
        return { ok: true as const, data: { objects, count: objects.length, truncated: false } }
      }
      if (name === 'describe_database_table') {
        return {
          ok: true as const,
          data: {
            table: {
              connectionId: 'db-process-scoped-handle',
              kind: 'table',
              path: `${args.databaseName}.${args.schemaName}.${args.tableName}`,
              columns: [{ name: 'id', type: 'bigint', nullable: false }],
              primaryKey: ['id']
            }
          }
        }
      }
      if (name === 'get_database_table_ddl') {
        return {
          ok: true as const,
          data: {
            ddl: `CREATE TABLE "${args.schemaName}"."${args.tableName}" (id bigint PRIMARY KEY);`,
            redacted: true,
            truncated: false
          }
        }
      }
      return null
    })
    const loadContext = createDatabaseAiMcpContextLoader({ callTool })

    const context = await loadContext({
      surface: 'pane',
      action: 'explain',
      context: {
        connectionId: 'connection-private-id',
        dbType: 'postgresql',
        databaseName: 'analytics',
        schemaName: 'public'
      },
      sql: `SELECT metrics.id
            FROM chart_demo_metrics AS metrics
            JOIN ops.metric_sources AS sources ON sources.id = metrics.source_id`
    })

    expect(JSON.parse(context)).toEqual({
      tables: [
        {
          table: {
            kind: 'table',
            path: 'analytics.public.chart_demo_metrics',
            columns: [{ name: 'id', type: 'bigint', nullable: false }],
            primaryKey: ['id']
          },
          ddl: 'CREATE TABLE "public"."chart_demo_metrics" (id bigint PRIMARY KEY);',
          ddlTruncated: false
        },
        {
          table: {
            kind: 'table',
            path: 'analytics.ops.metric_sources',
            columns: [{ name: 'id', type: 'bigint', nullable: false }],
            primaryKey: ['id']
          },
          ddl: 'CREATE TABLE "ops"."metric_sources" (id bigint PRIMARY KEY);',
          ddlTruncated: false
        }
      ]
    })
    expect(callTool).toHaveBeenCalledWith('describe_database_table', {
      connectionId: 'connection-private-id',
      databaseName: 'analytics',
      schemaName: 'public',
      tableName: 'chart_demo_metrics'
    })
    expect(callTool).toHaveBeenCalledWith('describe_database_table', {
      connectionId: 'connection-private-id',
      databaseName: 'analytics',
      schemaName: 'ops',
      tableName: 'metric_sources'
    })
    expect(callTool).not.toHaveBeenCalledWith(
      'describe_database_table',
      expect.objectContaining({ tableName: 'chart_demo_metrics_archive' })
    )
  })

  it('does not describe an ambiguous unqualified SQL table reference', async () => {
    const { createDatabaseAiMcpContextLoader } = await import(databaseMcpModulePath)
    const callTool = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      if (name !== 'search_database_objects') return null
      if (args.query === 'chart_demo_metrics') {
        return {
          ok: true as const,
          data: {
            objects: [
              { databaseName: 'analytics', schemaName: 'public', kind: 'table', name: 'chart_demo_metrics' },
              { databaseName: 'analytics', schemaName: 'archive', kind: 'table', name: 'chart_demo_metrics' }
            ],
            truncated: false
          }
        }
      }
      return { ok: true as const, data: { objects: [], truncated: false } }
    })
    const loadContext = createDatabaseAiMcpContextLoader({ callTool })

    await loadContext({
      surface: 'pane',
      action: 'explain',
      context: { connectionId: 'connection-private-id', databaseName: 'analytics' },
      sql: 'SELECT * FROM chart_demo_metrics'
    })

    expect(callTool).not.toHaveBeenCalledWith('describe_database_table', expect.anything())
    expect(callTool).not.toHaveBeenCalledWith('get_database_table_ddl', expect.anything())
  })
})
