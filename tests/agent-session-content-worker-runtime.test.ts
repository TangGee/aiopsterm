import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isMainThread, threadId } from 'worker_threads'
import { afterAll, describe, expect, it } from 'vitest'
import type { ManagedAiSessionContentRecord } from '../src/shared/contracts/managedAiSessionContent'

let workerRuntime: any

const loadWorkerRuntime = async () => {
  const workerModulePath = '../src/main/backend/agent/agentSessionContentWorkerRuntime'
  workerRuntime ||= await import(workerModulePath)
  return workerRuntime
}

const pageInput = (path: string, sessionId: string, offset = 0, limit = 80) => ({
  path,
  source: 'codex' as const,
  sessionId,
  sessionEditable: true,
  maxContentChars: 16_000,
  offset,
  limit
})

afterAll(async () => {
  await workerRuntime?.disposeAgentSessionContentWorker()
})

describe('agentSessionContentWorkerRuntime', () => {
  it('parses and paginates JSONL outside the main thread', async () => {
    const { listJsonlSessionContentInWorker } = await loadWorkerRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-worker-page-'))
    try {
      const path = join(root, 'session.jsonl')
      await writeFile(
        path,
        [
          JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'question' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call', call_id: 'call-1', name: 'exec_command', arguments: '{"cmd":"pwd"}' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'tool output' } })
        ].join('\n') + '\n',
        'utf-8'
      )

      const result = await listJsonlSessionContentInWorker(pageInput(path, 'session-1', 2, 1))

      expect(isMainThread).toBe(true)
      expect(result.workerIsMainThread).toBe(false)
      expect(result.workerThreadId).not.toBe(threadId)
      expect(result.total).toBe(3)
      expect(result.matchTotal).toBe(3)
      expect(result.records).toEqual([
        expect.objectContaining({
          ordinal: 2,
          content: 'tool output',
          messageType: 'tool result: exec_command',
          locationLabel: 'line 3 /payload/output'
        })
      ])

      const searched = await listJsonlSessionContentInWorker({
        ...pageInput(path, 'session-1', 0, 1),
        query: 'tool'
      })
      expect(searched.total).toBe(3)
      expect(searched.matchTotal).toBe(2)
      expect(searched.records).toEqual([
        expect.objectContaining({ ordinal: 1, messageType: 'tool call: exec_command' })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('routes concurrent requests and recovers after a task failure', async () => {
    const { listJsonlSessionContentInWorker } = await loadWorkerRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-worker-concurrent-'))
    try {
      const firstPath = join(root, 'first.jsonl')
      const secondPath = join(root, 'second.jsonl')
      await Promise.all([
        writeFile(firstPath, `${JSON.stringify({ message: 'first result' })}\n`, 'utf-8'),
        writeFile(secondPath, `${JSON.stringify({ message: 'second result' })}\n`, 'utf-8')
      ])

      await expect(listJsonlSessionContentInWorker(pageInput(join(root, 'missing.jsonl'), 'missing'))).rejects.toThrow()

      const [first, second] = await Promise.all([
        listJsonlSessionContentInWorker(pageInput(firstPath, 'first')),
        listJsonlSessionContentInWorker(pageInput(secondPath, 'second'))
      ])
      expect(first.records[0]).toEqual(expect.objectContaining({ sessionId: 'first', content: 'first result' }))
      expect(second.records[0]).toEqual(expect.objectContaining({ sessionId: 'second', content: 'second result' }))
      expect(first.workerThreadId).toBe(second.workerThreadId)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('gets and rewrites a record without returning the full transcript', async () => {
    const {
      getJsonlSessionContentRecordInWorker,
      listJsonlSessionContentInWorker,
      rewriteJsonlSessionContentInWorker
    } = await loadWorkerRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-worker-rewrite-'))
    try {
      const path = join(root, 'session.jsonl')
      const tempPath = join(root, '.session.tmp')
      await writeFile(
        path,
        [
          JSON.stringify({ payload: { message: 'keep me', summary: 'remove me' } }),
          JSON.stringify({ payload: { message: 'second line' } })
        ].join('\n') + '\n',
        'utf-8'
      )
      const page = await listJsonlSessionContentInWorker(pageInput(path, 'rewrite'))
      const summary = page.records.find((record: ManagedAiSessionContentRecord) => record.content === 'remove me')
      expect(summary).toBeTruthy()

      const record = await getJsonlSessionContentRecordInWorker({
        ...pageInput(path, 'rewrite'),
        recordId: summary!.recordId
      })
      expect(record.record).toEqual(expect.objectContaining({ content: 'remove me' }))
      expect(record.workerIsMainThread).toBe(false)

      await rewriteJsonlSessionContentInWorker({
        path,
        tempPath,
        sourceRevision: page.sourceRevision,
        lineNumber: 1,
        pointer: '/payload/summary',
        operation: 'delete'
      })
      const rewritten = await readFile(tempPath, 'utf-8')
      expect(rewritten.endsWith('\n')).toBe(true)
      expect(rewritten).toContain('keep me')
      expect(rewritten).not.toContain('remove me')
      expect(rewritten).toContain('second line')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
