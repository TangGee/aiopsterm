import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isMainThread, threadId } from 'worker_threads'
import { afterAll, describe, expect, it } from 'vitest'
import type { ManagedAiSessionContentRecord } from '../src/shared/contracts/managedAiSessionContent'
import { builtinAgentSessionParserDefinitions } from '../src/shared/agentSessionParserConfigRuntime'

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
const codexParser = builtinAgentSessionParserDefinitions.find((definition) => definition.source === 'codex')!

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
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'tool output' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'call-2', name: 'terminal', input: 'inspect files' } }),
          JSON.stringify({
            type: 'response_item',
            payload: {
              type: 'custom_tool_call_output',
              call_id: 'call-2',
              output: [
                { type: 'input_text', text: 'Script completed' },
                { type: 'input_text', text: 'file.txt' }
              ]
            }
          })
        ].join('\n') + '\n',
        'utf-8'
      )

      const result = await listJsonlSessionContentInWorker({ ...pageInput(path, 'session-1', 2, 1), parserDefinition: codexParser })

      expect(isMainThread).toBe(true)
      expect(result.workerIsMainThread).toBe(false)
      expect(result.workerThreadId).not.toBe(threadId)
      expect(result.total).toBe(6)
      expect(result.matchTotal).toBe(6)
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
        parserDefinition: codexParser,
        query: 'tool'
      })
      expect(searched.total).toBe(6)
      expect(searched.matchTotal).toBe(5)
      expect(searched.records).toEqual([
        expect.objectContaining({ ordinal: 1, messageType: 'tool call: exec_command' })
      ])

      const customResults = await listJsonlSessionContentInWorker({
        ...pageInput(path, 'session-1', 0, 20),
        parserDefinition: codexParser,
        query: 'tool result'
      })
      expect(customResults.records).toEqual([
        expect.objectContaining({ content: 'tool output', locationLabel: 'line 3 /payload/output', editable: true }),
        expect.objectContaining({ content: 'Script completed', locationLabel: 'line 5 /payload/output/0/text', editable: true }),
        expect.objectContaining({ content: 'file.txt', locationLabel: 'line 5 /payload/output/1/text', editable: true })
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

  it('updates structured values and deletes raw records without a read-only guard', async () => {
    const {
      listJsonlSessionContentInWorker,
      rewriteJsonlSessionContentInWorker
    } = await loadWorkerRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-worker-structured-'))
    try {
      const path = join(root, 'session.jsonl')
      const updatePath = join(root, '.update.tmp')
      const deletePath = join(root, '.delete.tmp')
      await writeFile(
        path,
        [
          JSON.stringify({ type: 'tool', payload: { input: { command: 'pwd' } } }),
          '{broken json'
        ].join('\n') + '\n',
        'utf-8'
      )
      const parserDefinition = {
        schemaVersion: 1 as const,
        id: 'structured-test',
        source: 'codex' as const,
        displayName: 'Structured test',
        storage: { kind: 'jsonl' as const, paths: [path] },
        fallback: 'raw-json' as const,
        rules: [{ id: 'tool', match: { '/type': 'tool' }, kind: 'tool call' as const, contentPointers: ['/payload/input'] }]
      }
      const page = await listJsonlSessionContentInWorker({ ...pageInput(path, 'structured'), parserDefinition })
      expect(page.records).toEqual([
        expect.objectContaining({ locationLabel: 'line 1 /payload/input', editable: true }),
        expect.objectContaining({ locationLabel: 'line 2 /', messageType: 'raw-text', editable: true })
      ])

      await rewriteJsonlSessionContentInWorker({
        path,
        tempPath: updatePath,
        sourceRevision: page.sourceRevision,
        lineNumber: 1,
        pointer: '/payload/input',
        operation: 'update',
        content: '{"command":"ls"}'
      })
      const updated = await readFile(updatePath, 'utf-8')
      expect(JSON.parse(updated.split('\n')[0]).payload.input).toEqual({ command: 'ls' })

      const updatedPage = await listJsonlSessionContentInWorker({ ...pageInput(updatePath, 'structured'), parserDefinition })
      await rewriteJsonlSessionContentInWorker({
        path: updatePath,
        tempPath: deletePath,
        sourceRevision: updatedPage.sourceRevision,
        lineNumber: 2,
        pointer: '/',
        operation: 'delete'
      })
      expect(await readFile(deletePath, 'utf-8')).not.toContain('{broken json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
