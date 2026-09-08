import { test, expect } from './support/desktop'
import { startSshTarget } from './support/ssh-server'
import { startRegressionProvider } from './support/provider'
import { mcpClient } from './support/mcp'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('host Agent approval executes on real SSH and exported MCP connects, executes and disconnects @core', async ({ desktop }) => {
  const target = await startSshTarget(desktop.root)
  const provider = await startRegressionProvider()
  try {
    const saved = await desktop.api('saveAsset', { name: 'REGRESSION_REMOTE_TARGET', host: '127.0.0.1', port: target.port, username: 'regression', password: 'regression-only', auth_type: 'password', asset_type: 'person', group_name: 'Regression' })
    expect(saved.ok, JSON.stringify(saved)).toBe(true)
    const assetId = saved.data.id
    const config = await desktop.api('getConfig')
    await desktop.api('saveConfig', { modelProvider: 'ollama', modelName: 'regression-model',
      modelSettings: { ...config.modelSettings, providers: { ...config.modelSettings.providers, ollama: { baseUrl: provider.baseUrl, modelId: 'regression-model' } },
        options: [{ name: 'regression-model', checked: true, locked: false, type: 'custom', apiProvider: 'ollama' }] } })
    await desktop.page.reload()
    await desktop.page.locator('.workspace-search input').fill('REGRESSION_REMOTE_TARGET')
    await desktop.page.locator('.workspace-host-row').filter({ hasText: 'REGRESSION_REMOTE_TARGET' }).dblclick()
    await expect.poll(async () => (await desktop.api('invokeControlRequest', 'terminal.list', {})).data.terminals.some((item: any) => item.connected)).toBe(true)
    provider.setScenario('tool')
    await desktop.page.getByTestId('ai-panel-mode-open').click()
    await desktop.page.getByTestId('ai-mode-classic').click()
    await desktop.page.locator('.chat-editable').fill('REGRESSION_REMOTE_COMMAND')
    await desktop.page.locator('.chat-input button[type="submit"]').click()
    await expect(desktop.page.getByTestId('ai-message-command-approval-badge')).toBeVisible()
    expect(target.commands.join('')).not.toContain('REGRESSION_TOOL_OK')
    await desktop.page.getByTestId('ai-message-command-run').click()
    await expect(desktop.page.getByTestId('ai-message-command-status')).toHaveClass(/succeeded/)
    expect(target.commands.join('')).toContain('REGRESSION_TOOL_OK')
    const installed = await desktop.api('installExportMcp', { source: 'codex', serverId: 'hosts' })
    expect(installed.ok, JSON.stringify(installed)).toBe(true)
    const status = installed.data.status
    const token = JSON.parse(await readFile(join(desktop.root, 'state', 'external-codex-mcp', 'token.json'), 'utf8')).token
    const client = mcpClient(status.scriptPath, status.bridge.socketPath, token, 'hosts')
    const call = async (name: string, args: object) => {
      const response = await client.request('tools/call', { name, arguments: args })
      expect(response.error, JSON.stringify(response)).toBeUndefined()
      expect(response.result.isError, JSON.stringify(response)).not.toBe(true)
      expect(response.result.structuredContent.ok, JSON.stringify(response)).not.toBe(false)
      return response.result.structuredContent.data || response.result.structuredContent
    }
    try {
      const connection = await call('connect_host', { assetId })
      const connectionId = connection.connectionId || connection.connection?.connectionId || connection.connection?.id
      expect(connectionId, JSON.stringify(connection)).toBeTruthy()
      const ran = await call('run_command', { connectionId, command: 'echo REGRESSION_MCP_REMOTE', timeoutMs: 10000 })
      expect(JSON.stringify(ran)).toContain('REGRESSION_MCP_REMOTE')
      await call('disconnect_host', { connectionId })
      expect(JSON.stringify(await call('list_connections', {}))).not.toContain(connectionId)
      expect((await desktop.api('invokeControlRequest', 'terminal.list', {})).data.terminals.some((item: any) => item.connected)).toBe(true)
    } finally { await client.close() }
  } finally { await provider.close(); await target.close() }
})
