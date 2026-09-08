import { test, expect } from './support/desktop'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { mcpClient } from './support/mcp'

const { DatabaseSync } = createRequire(join(process.cwd(), 'package.json'))('node:sqlite')
test('real MCP queries SQLite data and reads isolated session events @core', async ({ desktop }) => {
  const path = join(desktop.root, 'mcp.sqlite')
  const db = new DatabaseSync(path)
  try {
    db.exec('CREATE TABLE regression_rows (id INTEGER PRIMARY KEY, label VARCHAR(128), unbounded TEXT)')
    db.prepare('INSERT INTO regression_rows (id, label) VALUES (?, ?)').run(1, 'REGRESSION_DATABASE_VALUE')
    db.prepare('INSERT INTO regression_rows (id, label) VALUES (?, ?)').run(2, 'REGRESSION_OTHER_VALUE')
  } finally { db.close() }
  const saved = await desktop.api('saveDatabaseConnection', { mode: 'create', connection: { dbType: 'sqlite', name: 'REGRESSION_MCP_DB', filePath: path } })
  expect(saved.ok, JSON.stringify(saved)).toBe(true)
  const config = await desktop.api('getConfig')
  await desktop.api('saveConfig', { exportMcp: { ...config.exportMcp, allowDatabaseRead: true } })
  await desktop.api('publishAiAgentSessionEvent', { source: 'codex', sessionId: 'mcp-business', event: 'session_start', title: 'REGRESSION_MCP_SESSION', summary: 'REGRESSION_EVENT_CONTENT', receivedAt: Date.now() })
  for (const scope of ['databases', 'ai-sessions']) {
    const installed = await desktop.api('installExportMcp', { source: 'codex', serverId: scope })
    expect(installed.ok, JSON.stringify(installed)).toBe(true)
    const status = installed.data.status
    const token = JSON.parse(await readFile(join(desktop.root, 'state', 'external-codex-mcp', 'token.json'), 'utf8')).token
    const client = mcpClient(status.scriptPath, status.bridge.socketPath, token, scope)
    const call = async (name: string, args: object) => {
      const result = await client.request('tools/call', { name, arguments: args })
      expect(result.error, JSON.stringify(result)).toBeUndefined()
      expect(result.result.isError, JSON.stringify(result)).not.toBe(true)
      return result.result.structuredContent
    }
    try {
      if (scope === 'databases') {
        const listed = await call('list_database_connections', {})
        const rows = listed.data?.connections || listed.connections
        expect(rows).toHaveLength(1)
        const connection = rows.find((item: any) => item.dbType === 'sqlite')
        expect(connection, JSON.stringify(listed)).toBeTruthy()
        const queried = await call('query_database_table', { connectionId: connection.connectionId, databaseName: saved.data.connection.catalogs[0].name, tableName: 'regression_rows', columns: ['id', 'label'], filters: [{ column: 'id', operator: 'eq', value: '1' }], page: 1, pageSize: 10 })
        expect(JSON.stringify(queried)).toContain('REGRESSION_DATABASE_VALUE')
        expect(JSON.stringify(queried)).not.toContain('REGRESSION_OTHER_VALUE')
        const unbounded = await client.request('tools/call', { name: 'query_database_table', arguments: { connectionId: connection.connectionId, databaseName: saved.data.connection.catalogs[0].name, tableName: 'regression_rows', columns: ['unbounded'] } })
        expect(unbounded.result.structuredContent.errorCode).toBe('DB_MCP_UNBOUNDED_COLUMN_UNSUPPORTED')
        const forbidden = await client.request('tools/call', { name: 'list_hosts', arguments: {} })
        expect(Boolean(forbidden.error || forbidden.result?.isError)).toBe(true)
      } else {
        const session = await call('get_ai_session', { source: 'codex', sessionId: 'mcp-business', includeEvents: true })
        expect(JSON.stringify(session)).toContain('REGRESSION_EVENT_CONTENT')
        const events = await call('list_ai_session_events', { source: 'codex', sessionId: 'mcp-business' })
        expect(JSON.stringify(events)).toContain('mcp-business')
        const missing = await client.request('tools/call', { name: 'get_ai_session', arguments: { source: 'codex', sessionId: 'missing' } })
        expect(missing.result.isError).toBe(true)
      }
    } finally { await client.close() }
  }
})
