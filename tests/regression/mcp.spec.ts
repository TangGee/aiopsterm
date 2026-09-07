import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './support/desktop'
import { mcpClient } from './support/mcp'

for (const [scope, tool] of [['hosts', 'list_hosts'], ['ai-sessions', 'list_ai_sessions'], ['databases', 'list_database_connections']]) {
  test(`export MCP ${scope} CLI config contract, real stdio call and authentication @core`, async ({ desktop }) => {
    const input = { source: 'codex', serverId: scope }
    const installed = await desktop.api('installExportMcp', input)
    expect(installed.ok, JSON.stringify(installed)).toBe(true)
    const status = installed.data.status
    expect(status.configPath.startsWith(join(desktop.root, 'home'))).toBe(true)
    expect(await readFile(status.configPath, 'utf8')).toContain(status.serverName)
    const tokenData = JSON.parse(await readFile(join(desktop.root, 'state', 'external-codex-mcp', 'token.json'), 'utf8'))
    const client = mcpClient(status.scriptPath, status.bridge.socketPath, tokenData.token, scope)
    const denied = mcpClient(status.scriptPath, status.bridge.socketPath, 'invalid-regression-token', scope)
    try {
      const initialized = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'regression', version: '1' } })
      expect(initialized.error).toBeUndefined()
      const tools = await client.request('tools/list')
      expect(tools.result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: tool })]))
      const result = await client.request('tools/call', { name: tool, arguments: {} })
      expect(result.error, JSON.stringify(result)).toBeUndefined()
      if (scope === 'databases') {
        expect(result.result.structuredContent.errorCode).toBe('DB_MCP_DATABASE_READ_DISABLED')
        const config = await desktop.api('getConfig')
        await desktop.api('saveConfig', { exportMcp: { ...config.exportMcp, allowDatabaseRead: true } })
        const allowed = await client.request('tools/call', { name: tool, arguments: {} })
        expect(allowed.result.isError, JSON.stringify(allowed)).not.toBe(true)
      } else expect(result.result.isError, JSON.stringify(result)).not.toBe(true)
      const rejected = await denied.request('tools/call', { name: tool, arguments: {} })
      expect(Boolean(rejected.error || rejected.result?.isError), JSON.stringify(rejected)).toBe(true)
    } finally { await client.close(); await denied.close() }
    const removed = await desktop.api('uninstallExportMcp', input)
    expect(removed.ok, JSON.stringify(removed)).toBe(true)
    expect(removed.data.status.installed).toBe(false)
  })
}
