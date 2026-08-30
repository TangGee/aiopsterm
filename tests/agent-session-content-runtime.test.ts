import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ManagedAiSessionContentRecord } from '../src/shared/contracts/managedAiSessionContent'
import type { AiAgentSessionSource, ManagedAiSessionRecord } from '../src/shared/contracts/managedAiSessions'
import type { AgentSessionParserDefinition } from '../src/shared/contracts/agentSessionParsers'
import { builtinAgentSessionParserDefinitions } from '../src/shared/agentSessionParserConfigRuntime'

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionContentRuntime'
  return import(modulePath)
}

const makeSession = (input: {
  id: string
  source: AiAgentSessionSource
  state?: ManagedAiSessionRecord['state']
  transcriptPath?: string
}): ManagedAiSessionRecord => ({
  id: input.id,
  source: input.source,
  title: `${input.source} session`,
  summary: 'session summary',
  state: input.state || 'idle',
  lastEvent: 'session_start',
  lastActivityAt: 100,
  createdAt: 100,
  updatedAt: 100,
  requestKind: 'telemetry',
  decisionMode: 'telemetry',
  ...(input.transcriptPath ? { transcriptPath: input.transcriptPath } : {}),
  events: [
    {
      id: 'event-1',
      source: input.source,
      event: 'session_start',
      sessionId: input.id,
      title: `${input.source} session`,
      summary: 'session summary',
      receivedAt: 100,
      requestKind: 'telemetry',
      decisionMode: 'telemetry'
    }
  ],
  decisions: []
})

describe('agentSessionContentRuntime', () => {
  it('lists and edits JSONL transcript text records with backups and revision conflicts', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-jsonl-'))
    try {
      const transcriptPath = join(root, 'codex-session.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ type: 'session_meta', payload: { id: 'codex-session-1', cwd: '/work/app' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'fix the api' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'assistant_message', message: 'done' } })
        ].join('\n') + '\n',
        'utf-8'
      )
      const session = makeSession({ id: 'codex-session-1', source: 'codex', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CODEX_HOME: join(root, 'codex-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'codex', sessionId: session.id })
      expect(listed.ok).toBe(true)
      expect(listed.data).toEqual(expect.objectContaining({ total: 3, matchTotal: 3 }))
      expect(listed.data?.records[0]).toEqual(expect.objectContaining({ messageType: 'raw-json', editable: false }))
      const userRecord = listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'fix the api')
      expect(userRecord).toEqual(expect.objectContaining({ role: 'user', editable: true }))

      const searched = await runtime.list({ source: 'codex', sessionId: session.id, query: 'api', offset: 0, limit: 1 })
      expect(searched.data).toEqual(expect.objectContaining({ total: 3, matchTotal: 1, offset: 0, limit: 1 }))
      expect(searched.data?.records).toEqual([
        expect.objectContaining({ content: 'fix the api', ordinal: 1 })
      ])

      const updated = await runtime.updateRecord({
        source: 'codex',
        sessionId: session.id,
        recordId: userRecord!.recordId,
        content: 'fix the billing api',
        sourceRevision: userRecord!.sourceRevision
      })
      expect(updated.ok).toBe(true)
      expect(updated.data?.record.content).toBe('fix the billing api')
      expect(existsSync(updated.data?.backupPath || '')).toBe(true)
      const updatedRaw = await readFile(transcriptPath, 'utf-8')
      expect(updatedRaw.endsWith('\n')).toBe(true)
      const lines = updatedRaw.split(/\n/)
      expect(lines).toHaveLength(4)
      expect(lines[3]).toBe('')
      expect(JSON.parse(lines[1]).payload.message).toBe('fix the billing api')

      const conflict = await runtime.updateRecord({
        source: 'codex',
        sessionId: session.id,
        recordId: userRecord!.recordId,
        content: 'stale write',
        sourceRevision: userRecord!.sourceRevision
      })
      expect(conflict).toEqual(expect.objectContaining({ ok: false, errorCode: 'MANAGED_AI_CONTENT_REVISION_CONFLICT' }))

      const deleted = await runtime.deleteRecord({
        source: 'codex',
        sessionId: session.id,
        recordId: updated.data!.record.recordId,
        sourceRevision: updated.data!.sourceRevision
      })
      expect(deleted.ok).toBe(true)
      expect(existsSync(deleted.data?.backupPath || '')).toBe(true)
      const deletedRaw = await readFile(transcriptPath, 'utf-8')
      const deletedLines = deletedRaw.split(/\n/)
      expect(deletedLines).toHaveLength(3)
      expect(deletedLines[2]).toBe('')
      expect(deletedRaw).not.toContain('fix the billing api')
      const relisted = await runtime.list({ source: 'codex', sessionId: session.id })
      expect(relisted.data?.records.map((record: ManagedAiSessionContentRecord) => record.messageType)).toEqual(['raw-json', 'message'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists Codex response_item message text without protocol discriminator fields', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-codex-response-item-'))
    try {
      const transcriptPath = join(root, 'codex-response-item.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ type: 'session_meta', payload: { cwd: '/work/app', base_instructions: { text: 'base instructions text' } } }),
          JSON.stringify({ type: 'turn_context', payload: { summary: 'auto' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'developer instructions' }] } }),
          JSON.stringify({
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_text', text: '# AGENTS.md instructions for /work/app\n\ncontext' },
                { type: 'input_text', text: 'real user prompt' }
              ]
            }
          }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'real assistant answer' }] } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call', call_id: 'call-1', name: 'exec_command', arguments: '{"cmd":"pwd"}' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'tool output text' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'call-2', name: 'exec', input: 'inspect files' } }),
          JSON.stringify({
            type: 'response_item',
            payload: {
              type: 'custom_tool_call_output',
              call_id: 'call-2',
              output: [
                { type: 'input_text', text: 'Script completed' },
                { type: 'input_text', text: 'Output:\nfile.txt' }
              ]
            }
          }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call', call_id: 'call-3', name: 'view_image', arguments: '{"path":"image.png"}' } }),
          JSON.stringify({
            type: 'response_item',
            payload: {
              type: 'function_call_output',
              call_id: 'call-3',
              output: [
                { type: 'input_text', text: 'image inspected' },
                { type: 'input_image', image_url: 'data:image/png;base64,hidden' }
              ]
            }
          }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'exec_command_end', aggregated_output: 'legacy command output' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'error', message: 'network failed' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'image_generation_call', result: '/tmp/out.png', revised_prompt: 'blue sky' } })
        ].join('\n') + '\n',
        'utf-8'
      )
      const session = makeSession({ id: 'codex-response-item', source: 'codex', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CODEX_HOME: join(root, 'codex-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'codex', sessionId: session.id })
      expect(listed.ok).toBe(true)
      const contents = listed.data?.records.map((record: ManagedAiSessionContentRecord) => record.content) || []
      expect(listed.data?.records.slice(0, 2)).toEqual([
        expect.objectContaining({ content: 'base instructions text', role: 'system', messageType: 'system prompt', editable: true }),
        expect.objectContaining({ messageType: 'raw-json', editable: false })
      ])
      expect(contents[1]).toContain('"summary": "auto"')
      expect(contents.slice(2)).toEqual([
        'developer instructions',
        '# AGENTS.md instructions for /work/app\n\ncontext',
        'real user prompt',
        'real assistant answer',
        '{"cmd":"pwd"}',
        'tool output text',
        'inspect files',
        'Script completed',
        'Output:\nfile.txt',
        '{"path":"image.png"}',
        'image inspected',
        'legacy command output',
        'network failed',
        '/tmp/out.png',
        'blue sky'
      ])
      expect(contents).not.toEqual(expect.arrayContaining(['auto', 'response_item', 'message', 'input_text', 'output_text', 'function_call_output']))
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'developer instructions')).toEqual(
        expect.objectContaining({ role: 'developer' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content.startsWith('# AGENTS.md instructions'))).toEqual(
        expect.objectContaining({ role: 'developer' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'real user prompt')).toEqual(
        expect.objectContaining({ role: 'user', locationLabel: 'line 4 /payload/content/1/text' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'real assistant answer')).toEqual(
        expect.objectContaining({ role: 'assistant' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === '{"cmd":"pwd"}')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool call: exec_command', locationLabel: 'line 6 /payload/arguments' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'tool output text')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool result: exec_command', locationLabel: 'line 7 /payload/output' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'Script completed')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool result', locationLabel: 'line 9 /payload/output/0/text', editable: true })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'Output:\nfile.txt')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool result', locationLabel: 'line 9 /payload/output/1/text', editable: true })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'image inspected')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool result: view_image', locationLabel: 'line 11 /payload/output/0/text', editable: true })
      )
      expect(contents.some((content: string) => content.includes('base64,hidden'))).toBe(false)
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'legacy command output')).toEqual(
        expect.objectContaining({ role: 'tool', messageType: 'tool result: exec_command', locationLabel: 'line 12 /payload/aggregated_output' })
      )
      expect(listed.data?.records.find((record: ManagedAiSessionContentRecord) => record.content === 'network failed')).toEqual(
        expect.objectContaining({ role: 'system', messageType: 'error', locationLabel: 'line 13 /payload/message' })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('shows custom tool input and unknown records instead of silently dropping them', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-fallback-'))
    try {
      const transcriptPath = join(root, 'codex-fallback.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'terminal', input: 'create hello_cat.py' } }),
          JSON.stringify({ type: 'future_behavior', payload: { opaque: { instruction: 'unknown message body' } } }),
          '{broken json'
        ].join('\n') + '\n',
        'utf-8'
      )
      const session = makeSession({ id: 'codex-fallback', source: 'codex', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CODEX_HOME: join(root, 'codex-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'codex', sessionId: session.id })
      expect(listed.data?.records).toEqual([
        expect.objectContaining({ content: 'create hello_cat.py', role: 'tool', messageType: 'tool call: terminal', editable: true }),
        expect.objectContaining({ messageType: 'raw-json', editable: false }),
        expect.objectContaining({ messageType: 'raw-text', content: '{broken json', editable: false })
      ])
      expect(listed.data?.records[1]?.content).toContain('unknown message body')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses an imported custom Agent parser and keeps unmatched records visible', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-custom-'))
    try {
      const transcriptPath = join(root, 'aider.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ event: 'chat', actor: 'human', body: 'review the patch' }),
          JSON.stringify({ event: 'usage', tokens: 120 })
        ].join('\n') + '\n',
        'utf-8'
      )
      const parser: AgentSessionParserDefinition = {
        schemaVersion: 1,
        id: 'aider',
        source: 'custom:aider',
        displayName: 'Aider',
        storage: { kind: 'jsonl', paths: [transcriptPath] },
        fallback: 'raw-json',
        rules: [
          {
            id: 'chat-message',
            match: { '/event': 'chat' },
            kind: 'message',
            rolePointer: '/actor',
            contentPointers: ['/body']
          }
        ]
      }
      const session = makeSession({ id: 'aider', source: 'custom:aider', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({}) as NodeJS.ProcessEnv,
        getParserDefinition: () => parser,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'custom:aider', sessionId: session.id })
      expect(listed.data?.records).toEqual([
        expect.objectContaining({ content: 'review the patch', messageType: 'message', editable: false }),
        expect.objectContaining({ messageType: 'raw-json', editable: false })
      ])
      expect(listed.data?.records[1]?.content).toContain('"tokens": 120')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('parses Kimi Code messages, reasoning, and tools through its built-in JSON rules', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-kimi-'))
    try {
      const transcriptPath = join(root, 'wire.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ type: 'config.update', systemPrompt: 'kimi system prompt' }),
          JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: 'hello kimi' }] } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'kimi reasoning' } } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'kimi answer' } } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', name: 'Read', args: { path: '/tmp/file' } } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: 'file body', note: 'complete' } } }),
          JSON.stringify({ type: 'usage.record', usage: { inputTokens: 10 } })
        ].join('\n') + '\n',
        'utf-8'
      )
      const parser = builtinAgentSessionParserDefinitions.find((definition) => definition.source === 'kimi-code')!
      const session = makeSession({ id: 'kimi-session', source: 'kimi-code', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({}) as NodeJS.ProcessEnv,
        getParserDefinition: () => parser,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'kimi-code', sessionId: session.id })
      expect(listed.data?.records).toEqual([
        expect.objectContaining({ content: 'kimi system prompt', role: 'system', messageType: 'system prompt', editable: false }),
        expect.objectContaining({ content: 'hello kimi', role: 'user', messageType: 'message', editable: false }),
        expect.objectContaining({ content: 'kimi reasoning', role: 'assistant', messageType: 'reasoning', editable: false }),
        expect.objectContaining({ content: 'kimi answer', role: 'assistant', messageType: 'message', editable: false }),
        expect.objectContaining({ role: 'tool', messageType: 'tool call: Read', editable: false }),
        expect.objectContaining({ content: 'file body', role: 'tool', messageType: 'tool result', editable: false }),
        expect.objectContaining({ content: 'complete', role: 'tool', messageType: 'tool result', editable: false }),
        expect.objectContaining({ messageType: 'raw-json', editable: false })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('extracts Claude Code array tool-result text and keeps object tool input read-only', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-claude-tools-'))
    try {
      const transcriptPath = join(root, 'claude-tools.jsonl')
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/file' } }] } }),
          JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'file body' }, { type: 'image', source: { data: 'hidden' } }] }] } })
        ].join('\n') + '\n',
        'utf-8'
      )
      const session = makeSession({ id: 'claude-tools', source: 'claude-code', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CLAUDE_CONFIG_DIR: join(root, 'claude-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'claude-code', sessionId: session.id })
      expect(listed.data?.records).toEqual([
        expect.objectContaining({ role: 'tool', messageType: 'tool call: Read', editable: false }),
        expect.objectContaining({ content: 'file body', role: 'tool', messageType: 'tool result', editable: true })
      ])
      expect(listed.data?.records.some((record: ManagedAiSessionContentRecord) => record.content.includes('hidden'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['working', 'needsInput'] as const)('edits JSONL content while the session is %s', async (state) => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), `aiopsterm-session-content-active-${state}-`))
    try {
      const transcriptPath = join(root, 'claude-session.jsonl')
      await writeFile(
        transcriptPath,
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'ship it' } })}\n`,
        'utf-8'
      )
      const session = makeSession({ id: 'claude-session-1', source: 'claude-code', state, transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CLAUDE_CONFIG_DIR: join(root, 'claude-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'claude-code', sessionId: session.id })
      const record = listed.data?.records[0]
      expect(listed.data).toEqual(expect.objectContaining({ editable: true, sessionState: state }))
      expect(record).toEqual(expect.objectContaining({ editable: true, content: 'ship it' }))
      const updated = await runtime.updateRecord({
        source: 'claude-code',
        sessionId: session.id,
        recordId: record!.recordId,
        content: 'changed',
        sourceRevision: record!.sourceRevision
      })
      expect(updated).toEqual(expect.objectContaining({ ok: true }))
      expect(existsSync(updated.data?.backupPath || '')).toBe(true)
      const deleted = await runtime.deleteRecord({
        source: 'claude-code',
        sessionId: session.id,
        recordId: record!.recordId,
        sourceRevision: updated.data!.sourceRevision
      })
      expect(deleted).toEqual(expect.objectContaining({ ok: true }))
      expect(existsSync(deleted.data?.backupPath || '')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent edits against the same JSONL revision', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-concurrent-'))
    try {
      const transcriptPath = join(root, 'codex-session.jsonl')
      await writeFile(transcriptPath, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'before' } })}\n`, 'utf-8')
      const session = makeSession({ id: 'codex-concurrent-1', source: 'codex', state: 'working', transcriptPath })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ CODEX_HOME: join(root, 'codex-home') }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })
      const listed = await runtime.list({ source: 'codex', sessionId: session.id })
      const record = listed.data!.records[0]

      const results = await Promise.all([
        runtime.updateRecord({
          source: 'codex',
          sessionId: session.id,
          recordId: record.recordId,
          content: 'first edit',
          sourceRevision: record.sourceRevision
        }),
        runtime.updateRecord({
          source: 'codex',
          sessionId: session.id,
          recordId: record.recordId,
          content: 'second edit',
          sourceRevision: record.sourceRevision
        })
      ])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ errorCode: 'MANAGED_AI_CONTENT_REVISION_CONFLICT' })
      ])
      expect(await readFile(transcriptPath, 'utf-8')).toMatch(/first edit|second edit/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists and edits OpenCode text parts in opencode.db', async () => {
    const { createAgentSessionContentRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-session-content-opencode-'))
    try {
      const openCodeRoot = join(root, 'opencode')
      await mkdir(openCodeRoot, { recursive: true })
      const dbPath = join(openCodeRoot, 'opencode.db')
      let db: Database.Database
      try {
        db = new Database(dbPath)
      } catch (error) {
        console.warn(`Skipping OpenCode SQLite content test: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      db.exec(`
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
        CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
      `)
      db.prepare('INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)').run(
        'message-1',
        'opencode-session-1',
        JSON.stringify({ role: 'assistant' }),
        200
      )
      db.prepare('INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)').run(
        'part-1',
        'message-1',
        'opencode-session-1',
        JSON.stringify({ type: 'text', text: 'original opencode answer' })
      )
      db.prepare('INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)').run(
        'part-2',
        'message-1',
        'opencode-session-1',
        JSON.stringify({ type: 'tool', tool: 'shell', state: { input: { command: 'pwd' }, output: '/work/app' } })
      )
      db.close()

      const session = makeSession({ id: 'opencode-session-1', source: 'opencode' })
      const runtime = createAgentSessionContentRuntime({
        loadStoreIfNeeded: async () => undefined,
        getSession: () => session,
        getUserDataPath: () => root,
        getHomeDir: () => root,
        getEnv: () => ({ OPENCODE_CONFIG_DIR: openCodeRoot }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const listed = await runtime.list({ source: 'opencode', sessionId: session.id })
      const record = listed.data?.records[0]
      expect(record).toEqual(expect.objectContaining({ role: 'assistant', content: 'original opencode answer', editable: true }))
      expect(listed.data?.records[1]).toEqual(expect.objectContaining({ messageType: 'tool', editable: false }))
      expect(listed.data?.records[1]?.content).toContain('pwd')

      const updated = await runtime.updateRecord({
        source: 'opencode',
        sessionId: session.id,
        recordId: record!.recordId,
        content: 'edited opencode answer',
        sourceRevision: record!.sourceRevision
      })
      expect(updated.ok).toBe(true)
      const verifyDb = new Database(dbPath, { readonly: true })
      const part = verifyDb.prepare('SELECT data FROM part WHERE id = ?').get('part-1') as { data: string }
      verifyDb.close()
      expect(JSON.parse(part.data).text).toBe('edited opencode answer')
      expect(existsSync(updated.data?.backupPath || '')).toBe(true)

      const deleted = await runtime.deleteRecord({
        source: 'opencode',
        sessionId: session.id,
        recordId: record!.recordId,
        sourceRevision: updated.data!.sourceRevision
      })
      expect(deleted.ok).toBe(true)
      const deletedDb = new Database(dbPath, { readonly: true })
      const remainingPart = deletedDb.prepare('SELECT data FROM part WHERE id = ?').get('part-1')
      deletedDb.close()
      expect(remainingPart).toBeUndefined()
      expect(existsSync(deleted.data?.backupPath || '')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
