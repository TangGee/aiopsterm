import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './support/desktop'
import { corpus, transcriptFor, type CorpusAgent } from './support/corpus'

for (const source of Object.keys(corpus) as CorpusAgent[]) {
  test(`${source} parses every record and persists partial edit and deletion across restart @core`, async ({ desktop }) => {
    const sessionId = `regression-${source}`
    const filePath = join(desktop.root, `${source}.jsonl`)
    await writeFile(filePath, transcriptFor(source, 85))
    const published = await desktop.api('publishAiAgentSessionEvent', {
      source, sessionId, event: 'session_start', transcriptPath: filePath,
      cwd: desktop.root, title: sessionId, receivedAt: Date.now()
    })
    expect(published.ok, JSON.stringify(published)).toBe(true)
    const list = async (query = '', offset = 0, limit = 200) => desktop.api('listManagedAiSessionContent', { source, sessionId, query, offset, limit })
    const initial = await list()
    expect(initial.ok, JSON.stringify(initial)).toBe(true)
    // A source line may yield multiple editable fields; it must never disappear.
    const locations = initial.data.records.map((record: any) => Number(record.locationLabel.match(/line (\d+)/)?.[1]))
    expect(new Set(locations).size).toBe(corpus[source].length + 85)
    for (const [marker, role] of [['SYSTEM', 'system'], ['USER', 'user'], ['ASSISTANT', 'assistant'], ['TOOL_RESULT', 'tool']]) {
      if (source === 'claude' && marker === 'SYSTEM') continue
      expect(initial.data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: `REGRESSION_${marker}`, role })]))
    }
    expect((await list('REGRESSION_FALLBACK')).data.records[0].messageType).toBe('raw-json')
    const pageTwo = await list('', 80, 80)
    expect(pageTwo.data.offset).toBe(80)
    expect(pageTwo.data.records.length).toBeGreaterThan(0)
    const record = initial.data.records.find((item: any) => item.content === 'REGRESSION_USER')
    const edited = await desktop.api('updateManagedAiSessionContentRecord', {
      source, sessionId, recordId: record.recordId, sourceRevision: record.sourceRevision, content: 'REGRESSION_EDITED'
    })
    expect(edited.ok, JSON.stringify(edited)).toBe(true)
    // Appending after loading must produce a conflict, not silently lose the append.
    await writeFile(filePath, (await readFile(filePath, 'utf8')) + JSON.stringify({ type: 'future_record', text: 'REGRESSION_APPEND' }) + '\n')
    const stale = await desktop.api('updateManagedAiSessionContentRecord', {
      source, sessionId, recordId: edited.data.record.recordId, sourceRevision: edited.data.sourceRevision, content: 'STALE'
    })
    expect(stale.errorCode).toBe('MANAGED_AI_CONTENT_REVISION_CONFLICT')
    const selected = (await list()).data.records.filter((item: any) => item.content === 'REGRESSION_EDITED' || item.content === 'REGRESSION_ASSISTANT')
    const deleted = await desktop.api('deleteManagedAiSessionContentRecord', {
      source, sessionId, recordId: selected[0].recordId, recordIds: selected.map((item: any) => item.recordId), sourceRevision: selected[0].sourceRevision
    })
    expect(deleted.ok, JSON.stringify(deleted)).toBe(true)
    await desktop.restart()
    expect((await list('REGRESSION_EDITED')).data.matchTotal).toBe(0)
    expect((await list('REGRESSION_ASSISTANT')).data.matchTotal).toBe(0)
    expect((await list('REGRESSION_TOOL_RESULT')).data.matchTotal).toBe(1)
    expect((await list('REGRESSION_APPEND')).data.matchTotal).toBe(1)
    const remaining = await list()
    const pivot = remaining.data.records.find((item: any) => item.content.includes('REGRESSION_PAGE_0'))
    const truncated = await desktop.api('deleteManagedAiSessionContentRecord', {
      source, sessionId, recordId: pivot.recordId, deleteFollowing: true, sourceRevision: pivot.sourceRevision
    })
    expect(truncated.ok, JSON.stringify(truncated)).toBe(true)
    // "Delete following" intentionally retains the selected anchor.
    expect((await list('REGRESSION_PAGE_')).data.matchTotal).toBe(1)
    expect((await list('REGRESSION_TOOL_RESULT')).data.matchTotal).toBe(1)
    expect(await readFile(filePath, 'utf8')).not.toContain('REGRESSION_APPEND')
  })
}

for (const source of Object.keys(corpus) as CorpusAgent[]) {
test(`${source} session viewer exposes search, pagination, edit and multiselect controls @core`, async ({ desktop }) => {
  const sessionId = 'regression-viewer'
  const filePath = join(desktop.root, 'viewer.jsonl')
  await writeFile(filePath, transcriptFor(source, 90))
  await desktop.api('publishAiAgentSessionEvent', {
    source, sessionId, event: 'session_start', transcriptPath: filePath,
    cwd: desktop.root, title: sessionId, receivedAt: Date.now()
  })
  const page = desktop.page
  await page.locator('[data-module-key="aiSessions"]').click()
  await page.locator('.ai-sessions-header-actions button').last().click()
  await page.locator('.ai-sessions-mode-button.mode-library').click()
  const row = page.locator('.ai-session-row').filter({ hasText: sessionId }).first()
  await row.click({ button: 'right' })
  await page.locator('.ai-session-context-menu button').first().click()
  const viewer = page.locator('.managed-ai-session-content')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('.managed-ai-session-record-card')).toHaveCount(20)
  await viewer.locator('.managed-ai-session-content-pagination button').last().click()
  await expect(viewer.locator('.managed-ai-session-content-pagination input')).toHaveValue('5')
  const search = viewer.locator('.managed-ai-session-record-search input')
  await search.fill('REGRESSION_USER')
  await expect(viewer.locator('.managed-ai-session-record-card')).toHaveCount(1)
  const editor = viewer.locator('.managed-ai-session-record-card textarea')
  await editor.fill('REGRESSION_UI_EDITED')
  await writeFile(filePath, (await readFile(filePath, 'utf8')) + JSON.stringify({ type: 'future_record', text: 'REGRESSION_UI_APPEND' }) + '\n')
  // A draft stays put after external append. Cancel a conflict, then explicitly overwrite.
  await expect(editor).toHaveValue('REGRESSION_UI_EDITED')
  page.once('dialog', (dialog) => dialog.dismiss())
  await viewer.locator('.managed-ai-session-record-actions button.primary').click()
  await expect(viewer.locator('.managed-ai-session-content-error')).toBeVisible()
  expect(await readFile(filePath, 'utf8')).toContain('REGRESSION_USER')
  await expect(editor).toHaveValue('REGRESSION_UI_EDITED')
  page.once('dialog', (dialog) => dialog.accept())
  await viewer.locator('.managed-ai-session-record-actions button.primary').click()
  await expect.poll(() => readFile(filePath, 'utf8')).toContain('REGRESSION_UI_EDITED')
  expect(await readFile(filePath, 'utf8')).toContain('REGRESSION_UI_APPEND')
  await search.fill('REGRESSION_PAGE_')
  await viewer.locator('.managed-ai-session-selection-toggle').click()
  await viewer.locator('.managed-ai-session-record-selector input').nth(1).check()
  await viewer.locator('.managed-ai-session-record-selector input').nth(2).check()
  const before = (await desktop.api('listManagedAiSessionContent', { source, sessionId })).data.total
  page.once('dialog', (dialog) => dialog.accept())
  await viewer.locator('.managed-ai-session-selection-action.danger').click()
  await expect.poll(async () => (await desktop.api('listManagedAiSessionContent', { source, sessionId })).data.total).toBe(before - 2)
  await expect(viewer.locator('.managed-ai-session-record-selector input:checked')).toHaveCount(0)
})
}
