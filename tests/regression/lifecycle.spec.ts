import { test, expect } from './support/desktop'
import { startRegressionProvider } from './support/provider'
import { mcpClient } from './support/mcp'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transcriptFor } from './support/corpus'

test('AI streaming, long-session viewers and MCP lifecycle stay bounded @lifecycle', async ({ desktop }, info) => {
  const duration = Number(process.env.AIOPSTERM_LIFECYCLE_DURATION_MS || 600000)
  if (!Number.isFinite(duration) || duration < 30000) throw new Error('Lifecycle duration must be at least 30 seconds.')
  test.setTimeout(duration + 180000)
  const provider = await startRegressionProvider()
  try {
    const config = await desktop.api('getConfig')
    await desktop.api('saveConfig', { modelProvider: 'ollama', modelName: 'regression-model', modelSettings: {
      ...config.modelSettings, providers: { ...config.modelSettings.providers, ollama: { baseUrl: provider.baseUrl, modelId: 'regression-model' } },
      options: [{ name: 'regression-model', checked: true, locked: false, type: 'custom', apiProvider: 'ollama' }]
    } })
    await desktop.page.reload()
    await desktop.localTerminal()
    const path = join(desktop.root, 'lifecycle.jsonl')
    await writeFile(path, transcriptFor('codex', 10000))
    await desktop.api('publishAiAgentSessionEvent', { source: 'codex', sessionId: 'lifecycle', event: 'session_start', transcriptPath: path, title: 'REGRESSION_LIFECYCLE', receivedAt: Date.now() })
    const installed = await desktop.api('installExportMcp', { source: 'codex', serverId: 'ai-sessions' })
    expect(installed.ok).toBe(true)
    const status = installed.data.status
    const token = JSON.parse(await readFile(join(desktop.root, 'state', 'external-codex-mcp', 'token.json'), 'utf8')).token
    const samples: any[] = []
    const sample = async (cycle: number) => {
      const session = await desktop.app.context().newCDPSession(desktop.page)
      await session.send('HeapProfiler.collectGarbage')
      const heap = await session.send('Runtime.getHeapUsage')
      await session.detach()
      const processes = await desktop.app.evaluate(({ app }) => app.getAppMetrics().map((item) => ({ type: item.type, pid: item.pid, memory: item.memory.workingSetSize })))
      const value = { cycle, at: Date.now(), heap: heap.usedSize, processes, workingSetKb: processes.reduce((sum, item) => sum + item.memory, 0) }
      samples.push(value)
      if (samples.length > 1) {
        expect(value.heap - samples[0].heap).toBeLessThan(96 * 1024 * 1024)
        expect(value.workingSetKb - samples[0].workingSetKb).toBeLessThan(512 * 1024)
        expect(value.processes.length - samples[0].processes.length).toBeLessThanOrEqual(2)
      }
      return value
    }
    const started = Date.now()
    let cycle = 0
    while (Date.now() - started < duration || cycle < 10) {
      await desktop.page.locator('[data-module-key="workspace"]').click()
      await desktop.page.getByTestId('ai-panel-mode-open').click()
      await desktop.page.getByTestId('ai-mode-classic').click()
      await desktop.page.getByTestId('ai-new-chat').click()
      await desktop.page.locator('.chat-editable').fill(`REGRESSION_LIFECYCLE_${cycle}`)
      await desktop.page.locator('.chat-input button[type="submit"]').click()
      await expect(desktop.page.locator('.ai-panel')).toContainText('REGRESSION_ANSWER_COMPLETE')
      await desktop.page.locator('.ai-conversation-tab.active .ai-conversation-tab-close').click()
      await desktop.page.locator('[data-module-key="aiSessions"]').click()
      await desktop.page.locator('.ai-sessions-header-actions button').last().click()
      await desktop.page.locator('.ai-sessions-mode-button.mode-library').click()
      await desktop.page.locator('.ai-session-row').filter({ hasText: 'REGRESSION_LIFECYCLE' }).first().click({ button: 'right' })
      await desktop.page.locator('.ai-session-context-menu button').first().click()
      const viewer = desktop.page.locator('.managed-ai-session-content')
      await expect(viewer.locator('.managed-ai-session-record-card')).toHaveCount(20)
      await viewer.locator('.managed-ai-session-record-search input').fill('REGRESSION_PAGE_9999')
      await expect(viewer.locator('.managed-ai-session-record-card')).toHaveCount(1)
      await desktop.page.locator('.terminal-tab.active .terminal-tab-close').click()
      const client = mcpClient(status.scriptPath, status.bridge.socketPath, token, 'ai-sessions')
      try {
        const result = await client.request('tools/call', { name: 'list_ai_sessions', arguments: {} })
        expect(result.result.isError).not.toBe(true)
      } finally { await client.close() }
      provider.requests.splice(0)
      cycle++
      if (cycle === 5 || cycle % 10 === 0) {
        const measured = await sample(cycle)
        console.log(`[lifecycle] cycles=${cycle} elapsed=${Math.round((Date.now() - started) / 1000)}s heapMiB=${Math.round(measured.heap / 1024 / 1024)}`)
      }
    }
    await sample(cycle)
    await info.attach('lifecycle-samples', { body: JSON.stringify({ duration, cycles: cycle, samples }), contentType: 'application/json' })
    expect(desktop.errors).toEqual([])
  } finally { await provider.close() }
})
