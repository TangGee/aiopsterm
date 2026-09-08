import { test, expect } from './support/desktop'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { builtinAgentSessionParserDefinitions } from '../../src/shared/agentSessionParserConfigRuntime'
import { createRequire } from 'node:module'

const { DatabaseSync } = createRequire(join(process.cwd(), 'package.json'))('node:sqlite')

test('OpenCode SQLite records survive edit, tool deletion and restart @core', async ({ desktop }) => {
  await desktop.restart({ OPENCODE_CONFIG_DIR: desktop.root })
  const db = new DatabaseSync(join(desktop.root, 'opencode.db'))
  try {
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT)')
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('m1', 'open-1', JSON.stringify({ role: 'assistant' }), 1)
    for (const [id, data] of [['p1', { type: 'text', text: 'REGRESSION_SQLITE_TEXT' }], ['p2', { type: 'tool', state: { output: 'REGRESSION_SQLITE_TOOL' } }]] as const) {
      db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run(id, 'm1', 'open-1', JSON.stringify(data))
    }
  } finally { db.close() }
  await desktop.api('publishAiAgentSessionEvent', { source: 'opencode', sessionId: 'open-1', event: 'session_start', receivedAt: Date.now() })
  const list = () => desktop.api('listManagedAiSessionContent', { source: 'opencode', sessionId: 'open-1' })
  const initial = await list()
  expect(initial.data.records).toHaveLength(2)
  const record = initial.data.records.find((item: any) => item.content === 'REGRESSION_SQLITE_TEXT')
  expect(record.role).toBe('assistant')
  expect((await desktop.api('updateManagedAiSessionContentRecord', { source: 'opencode', sessionId: 'open-1', recordId: record.recordId, sourceRevision: record.sourceRevision, content: 'REGRESSION_SQLITE_EDITED' })).ok).toBe(true)
  const tool = (await list()).data.records.find((item: any) => item.content.includes('REGRESSION_SQLITE_TOOL'))
  expect((await desktop.api('deleteManagedAiSessionContentRecord', { source: 'opencode', sessionId: 'open-1', recordId: tool.recordId, sourceRevision: tool.sourceRevision })).ok).toBe(true)
  await desktop.restart()
  const restored = await list()
  expect(restored.data.records).toHaveLength(1)
  expect(restored.data.records[0].content).toBe('REGRESSION_SQLITE_EDITED')
})

test('every event-backed builtin preserves imported events @core', async ({ desktop }) => {
  const registry = await desktop.api('listAgentSessionParsers')
  expect(registry.data.parsers.length).toBe(builtinAgentSessionParserDefinitions.length)
  for (const parser of builtinAgentSessionParserDefinitions.filter((item) => item.storage.kind === 'events')) {
    const sessionId = `regression-${parser.source}`
    const published = await desktop.api('publishAiAgentSessionEvent', { source: parser.source, sessionId, event: 'session_start', title: `REGRESSION_${parser.source}`, receivedAt: Date.now(), cwd: desktop.root })
    expect(published.ok, `${parser.source}: ${JSON.stringify(published)}`).toBe(true)
    const result = await desktop.api('listManagedAiSessionContent', { source: parser.source, sessionId })
    expect(result.ok, `${parser.source}: ${JSON.stringify(result)}`).toBe(true)
    expect(result.data.records.length, parser.source).toBeGreaterThan(0)
    expect(JSON.stringify(result.data.records)).toContain(`REGRESSION_${parser.source}`)
    const first = result.data.records[0]
    const mutation = { source: parser.source, sessionId, recordId: first.recordId, sourceRevision: first.sourceRevision }
    // Event-only adapters must reject unsupported mutations, never pretend to save.
    expect((await desktop.api('updateManagedAiSessionContentRecord', { ...mutation, content: 'REGRESSION_MUST_NOT_SAVE' })).errorCode).toBe('MANAGED_AI_CONTENT_READ_ONLY')
    expect((await desktop.api('deleteManagedAiSessionContentRecord', mutation)).errorCode).toBe('MANAGED_AI_CONTENT_READ_ONLY')
    expect(JSON.stringify((await desktop.api('listManagedAiSessionContent', { source: parser.source, sessionId })).data.records)).not.toContain('REGRESSION_MUST_NOT_SAVE')
  }
  await desktop.restart()
  for (const parser of builtinAgentSessionParserDefinitions.filter((item) => item.storage.kind === 'events')) {
    const restored = await desktop.api('listManagedAiSessionContent', { source: parser.source, sessionId: `regression-${parser.source}` })
    expect(restored.ok, parser.source).toBe(true)
    expect(JSON.stringify(restored.data.records), parser.source).toContain(`REGRESSION_${parser.source}`)
  }
})

test('settings imports, replaces, rejects invalid rules and restores defaults across restart @core', async ({ desktop }) => {
  const filePath = join(desktop.root, 'parser.json')
  const transcriptPath = join(desktop.root, 'custom.jsonl')
  const rule = { schemaVersion: 1, id: 'regression-custom', source: 'regression-custom', displayName: 'Regression custom Agent',
    storage: { kind: 'jsonl', paths: [transcriptPath] }, fallback: 'raw-json',
    rules: [{ id: 'message', kind: 'message', rolePointer: '/speaker', contentPointers: ['/body'] }] }
  const openSettings = async () => {
    await desktop.page.locator('[data-module-key="settings"]').click()
    await desktop.page.locator('.settings-nav-item').filter({ hasText: 'AI 通知' }).click()
    await expect(desktop.page.locator('.agent-hook-installer-card')).toBeVisible()
    // Only the OS file picker is replaced; parsing and persistence use production IPC.
    await desktop.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, filePath)
  }
  await writeFile(filePath, JSON.stringify(rule))
  await writeFile(transcriptPath, JSON.stringify({ speaker: 'assistant', body: 'REGRESSION_CUSTOM_BODY' }) + '\n' + JSON.stringify({ future: 'REGRESSION_UNKNOWN' }) + '\n')
  await openSettings()
  await desktop.page.locator('.agent-hook-card-header button.primary').click()
  await expect(desktop.page.locator('.agent-hook-installer-row').filter({ hasText: rule.displayName })).toBeVisible()
  await desktop.api('publishAiAgentSessionEvent', { source: 'custom:regression-custom', sessionId: 'custom-1', event: 'session_start', transcriptPath, receivedAt: Date.now() })
  const list = () => desktop.api('listManagedAiSessionContent', { source: 'custom:regression-custom', sessionId: 'custom-1' })
  expect((await list()).data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'REGRESSION_CUSTOM_BODY', role: 'assistant' }), expect.objectContaining({ messageType: 'raw-json' })]))
  await desktop.restart()
  expect((await list()).data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'REGRESSION_CUSTOM_BODY' })]))
  await openSettings()
  const customRow = desktop.page.locator('.agent-hook-installer-row').filter({ hasText: rule.displayName })
  await writeFile(filePath, '{ invalid json')
  await customRow.getByRole('button', { name: '替换解析规则' }).click()
  expect((await list()).data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'REGRESSION_CUSTOM_BODY' })]))
  const codex = builtinAgentSessionParserDefinitions.find((item) => item.source === 'codex')!
  await writeFile(filePath, JSON.stringify({ ...codex, rules: [{ id: 'replacement', kind: 'message', role: 'system', contentPointers: ['/override'] }] }))
  const codexRow = desktop.page.locator('.agent-hook-installer-row').filter({ has: desktop.page.locator('strong', { hasText: /^Codex$/ }) })
  await codexRow.getByRole('button', { name: '导入会话解析规则' }).click()
  await expect.poll(async () => (await desktop.api('listAgentSessionParsers')).data.parsers.find((item: any) => item.source === 'codex').origin).toBe('user')
  await codexRow.getByRole('button', { name: '恢复默认规则' }).click()
  await expect.poll(async () => (await desktop.api('listAgentSessionParsers')).data.parsers.find((item: any) => item.source === 'codex').origin).toBe('builtin')
  await customRow.getByRole('button', { name: '删除', exact: true }).click()
  await expect(customRow).toHaveCount(0)
})
