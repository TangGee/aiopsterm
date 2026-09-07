import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { it, expect } from 'vitest'
import { createAgentSessionContentRuntime } from '../../src/main/backend/agent/agentSessionContentRuntime'
import type { ManagedAiSessionRecord } from '../../src/shared/contracts/managedAiSessions'
import { transcriptFor } from './support/corpus'

it('bounds returned payloads and avoids retaining every page of a long session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-corpus-perf-'))
  try {
    const transcriptPath = join(root, 'long.jsonl')
    await writeFile(transcriptPath, transcriptFor('codex', 10000))
    const session = { id: 'long-session', source: 'codex', title: 'Synthetic long session', transcriptPath,
      state: 'idle', events: [], decisions: [] } as unknown as ManagedAiSessionRecord
    const runtime = createAgentSessionContentRuntime({
      loadStoreIfNeeded: async () => undefined, getSession: () => session,
      getUserDataPath: () => root, getHomeDir: () => root, getEnv: () => ({}), now: Date.now
    })
    const start = performance.now()
    const heap = process.memoryUsage().heapUsed
    for (const offset of [0, 5000, 9980, 0]) {
      const page = await runtime.list({ source: 'codex', sessionId: session.id, offset, limit: 20, maxContentChars: 500 })
      expect(page.ok).toBe(true)
      expect(page.data?.records.length).toBeLessThanOrEqual(20)
      expect(page.data?.total).toBe(10010)
      expect(JSON.stringify(page).length).toBeLessThan(30000)
    }
    const search = await runtime.list({ source: 'codex', sessionId: session.id, query: 'REGRESSION_PAGE_9999', limit: 20 })
    expect(search.data?.matchTotal).toBe(1)
    expect(performance.now() - start).toBeLessThan(10000)
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(128 * 1024 * 1024)
  } finally { await rm(root, { recursive: true, force: true }) }
})
