import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ManagedAiSessionRecord } from '../src/shared/contracts/managedAiSessions'

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionImportRuntime'
  return import(modulePath)
}

const createCodexRollout = async (codexHome: string) => {
  const sessionsDir = join(codexHome, 'sessions', '2026', '06', '29')
  await mkdir(sessionsDir, { recursive: true })
  await writeFile(
    join(sessionsDir, 'codex-session-1.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'codex-session-1',
          cwd: '/work/codex-app',
          git: { branch: 'main' }
        }
      }),
      JSON.stringify({
        type: 'turn_context',
        payload: {
          model: 'gpt-5.1',
          approval_policy: 'on-request',
          sandbox_policy: { type: 'workspace-write' },
          effort: 'high'
        }
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'please fix import' }
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'thread_name_updated', thread_name: 'Fix Codex Import' }
      })
    ].join('\n') + '\n',
    'utf-8'
  )
}

const createCodexSqlite = async (codexHome: string) => {
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'state_5.sqlite'), 'sqlite fixture placeholder', 'utf-8')
}

const createClaudeProject = async (claudeHome: string) => {
  const projectDir = join(claudeHome, 'projects', '-work-claude-app')
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'claude-session-1.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        cwd: '/work/claude-app',
        permissionMode: 'plan',
        message: { role: 'user', content: 'implement claude import' }
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', model: 'claude-sonnet-4-5[1m]', content: [{ type: 'text', text: 'done' }] }
      })
    ].join('\n') + '\n',
    'utf-8'
  )
  const subagentDir = join(projectDir, 'claude-session-1', 'subagents')
  await mkdir(subagentDir, { recursive: true })
  await writeFile(
    join(subagentDir, 'agent-claude-child-1.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        cwd: '/work/claude-app',
        isSidechain: true,
        message: { role: 'user', content: 'injected subagent prompt' }
      }),
      JSON.stringify({
        type: 'assistant',
        cwd: '/work/claude-app',
        isSidechain: true,
        message: { role: 'assistant', model: 'claude-sonnet-4-5[1m]', content: [{ type: 'text', text: 'subagent work' }] }
      })
    ].join('\n') + '\n',
    'utf-8'
  )
}

describe('agentSessionImportRuntime', () => {
  it('imports restorable Codex and Claude Code sessions from local state stores', async () => {
    const { createAgentSessionImportRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-'))
    try {
      const codexHome = join(root, 'codex-home')
      const claudeHome = join(root, 'claude-home')
      const openCodeRoot = join(root, 'opencode')
      await mkdir(codexHome, { recursive: true })
      await createCodexRollout(codexHome)
      await createClaudeProject(claudeHome)
      await mkdir(openCodeRoot, { recursive: true })

      const runtime = createAgentSessionImportRuntime({
        getHomeDir: () => root,
        getEnv: () => ({
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: claudeHome,
          OPENCODE_CONFIG_DIR: openCodeRoot
        }) as NodeJS.ProcessEnv,
        now: () => 1781884900000
      })

      const imported = await runtime.importSessions()

      expect(imported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'codex-session-1',
            source: 'codex',
            title: 'Fix Codex Import',
            cwd: '/work/codex-app',
            state: 'idle',
            resumeCommand: "cd '/work/codex-app' && codex resume 'codex-session-1' -m 'gpt-5.1' -a 'on-request' -s 'workspace-write' -c model_reasoning_effort='high'"
          }),
          expect.objectContaining({
            id: 'claude-session-1',
            source: 'claude-code',
            title: 'implement claude import',
            cwd: '/work/claude-app',
            resumeCommand: "cd '/work/claude-app' && claude --resume 'claude-session-1'"
          }),
          expect.objectContaining({
            id: 'agent-claude-child-1',
            source: 'claude-code',
            title: 'injected subagent prompt',
            cwd: '/work/claude-app',
            sessionKind: 'subagent',
            parentSessionId: 'claude-session-1',
            restorable: false
          }),
        ])
      )
      const claudeChild = imported.find((session: Omit<ManagedAiSessionRecord, 'decisions'>) => session.id === 'agent-claude-child-1')
      expect(claudeChild?.events[0]).toEqual(
        expect.objectContaining({
          sessionKind: 'subagent',
          parentSessionId: 'claude-session-1',
          restorable: false
        })
      )
      expect(claudeChild).not.toHaveProperty('resumeCommand')
      expect(claudeChild?.events[0]).not.toHaveProperty('resumeCommand')
      expect(imported.every((session: Omit<ManagedAiSessionRecord, 'decisions'>) => session.events.length === 1 && session.events[0].requestKind === 'telemetry')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('imports Codex SQLite subagent threads as review-only child sessions', async () => {
    const { createAgentSessionImportRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-sql-'))
    try {
      const codexHome = join(root, 'codex-home')
      const claudeHome = join(root, 'claude-home')
      const openCodeRoot = join(root, 'opencode')
      await createCodexSqlite(codexHome)
      await mkdir(claudeHome, { recursive: true })
      await mkdir(openCodeRoot, { recursive: true })

      const runtime = createAgentSessionImportRuntime({
        getHomeDir: () => root,
        getEnv: () => ({
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: claudeHome,
          OPENCODE_CONFIG_DIR: openCodeRoot
        }) as NodeJS.ProcessEnv,
        now: () => 1781885000000,
        openSqliteDatabase: () => ({
          prepare: (sql: string) => ({
            reader: true,
            all: () =>
              sql.startsWith('PRAGMA table_info')
                ? [
                    'id',
                    'rollout_path',
                    'cwd',
                    'title',
                    'source',
                    'thread_source',
                    'has_user_event',
                    'model',
                    'git_branch',
                    'approval_mode',
                    'sandbox_policy',
                    'reasoning_effort',
                    'first_user_message',
                    'updated_at_ms',
                    'archived'
                  ].map((name) => ({ name }))
                : [
                    {
                      id: 'codex-child-sql',
                      rollout_path: '/tmp/codex-child-sql.jsonl',
                      cwd: '/work/codex-sql',
                      title: 'SQL child session',
                      source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: 'codex-main-sql' } } }),
                      thread_source: 'subagent',
                      has_user_event: 0,
                      model: 'gpt-5.1',
                      git_branch: 'main',
                      approval_mode: 'on-request',
                      sandbox_policy: JSON.stringify({ type: 'workspace-write' }),
                      reasoning_effort: 'medium',
                      first_user_message: 'inspect as child',
                      updated_at_ms: 1781884900000
                    },
                    {
                      id: 'codex-main-sql',
                      rollout_path: '/tmp/codex-main-sql.jsonl',
                      cwd: '/work/codex-sql',
                      title: 'SQL main session',
                      source: 'cli',
                      thread_source: 'user',
                      has_user_event: 1,
                      model: 'gpt-5.1',
                      git_branch: 'main',
                      approval_mode: 'on-request',
                      sandbox_policy: JSON.stringify({ type: 'workspace-write' }),
                      reasoning_effort: 'medium',
                      first_user_message: 'make sql import work',
                      updated_at_ms: 1781884800000
                    },
                    ...Array.from({ length: 123 }, (_item, index) => ({
                      id: `codex-main-sql-extra-${index}`,
                      rollout_path: `/tmp/codex-main-sql-extra-${index}.jsonl`,
                      cwd: '/work/codex-sql',
                      title: `SQL main extra ${index}`,
                      source: 'cli',
                      thread_source: 'user',
                      has_user_event: 1,
                      model: 'gpt-5.1',
                      git_branch: 'main',
                      approval_mode: 'on-request',
                      sandbox_policy: JSON.stringify({ type: 'workspace-write' }),
                      reasoning_effort: 'medium',
                      first_user_message: `extra sql import ${index}`,
                      updated_at_ms: 1781884700000 - index
                    }))
                  ],
            run: () => ({}),
            columns: () => []
          }),
          close: () => undefined
        })
      })

      const imported = await runtime.importSessions()

      expect(imported).toHaveLength(125)
      expect(imported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'codex-main-sql',
            source: 'codex',
            sessionKind: 'main',
            restorable: true,
            resumeCommand: "cd '/work/codex-sql' && codex resume 'codex-main-sql' -m 'gpt-5.1' -a 'on-request' -s 'workspace-write' -c model_reasoning_effort='medium'"
          }),
          expect.objectContaining({
            id: 'codex-child-sql',
            source: 'codex',
            sessionKind: 'subagent',
            parentSessionId: 'codex-main-sql',
            restorable: false
          })
        ])
      )
      const child = imported.find((session: Omit<ManagedAiSessionRecord, 'decisions'>) => session.id === 'codex-child-sql')
      expect(child?.events[0]).toEqual(
        expect.objectContaining({
          sessionKind: 'subagent',
          parentSessionId: 'codex-main-sql',
          restorable: false
        })
      )
      expect(child).not.toHaveProperty('resumeCommand')
      expect(child?.events[0]).not.toHaveProperty('resumeCommand')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reuses parsed JSONL files until mtime or size changes', async () => {
    const { createAgentSessionImportRuntime } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-cache-'))
    const baseline = new Date('2026-06-29T00:00:00.000Z')
    const changed = new Date('2026-06-29T00:00:02.000Z')
    const writeCodexRollout = async (filePath: string, title: string, mtime: Date) => {
      await writeFile(
        filePath,
        [
          JSON.stringify({
            type: 'session_meta',
            payload: {
              id: 'codex-cache-session',
              cwd: '/work/codex-cache'
            }
          }),
          JSON.stringify({
            type: 'event_msg',
            payload: { type: 'thread_name_updated', thread_name: title }
          })
        ].join('\n') + '\n',
        'utf-8'
      )
      await utimes(filePath, mtime, mtime)
    }

    try {
      const codexHome = join(root, 'codex-home')
      const claudeHome = join(root, 'claude-home')
      const openCodeRoot = join(root, 'opencode')
      const sessionsDir = join(codexHome, 'sessions', '2026', '06', '29')
      const rolloutPath = join(sessionsDir, 'codex-cache-session.jsonl')
      await mkdir(sessionsDir, { recursive: true })
      await mkdir(claudeHome, { recursive: true })
      await mkdir(openCodeRoot, { recursive: true })
      await writeCodexRollout(rolloutPath, 'First Title', baseline)

      const runtime = createAgentSessionImportRuntime({
        getHomeDir: () => root,
        getEnv: () => ({
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: claudeHome,
          OPENCODE_CONFIG_DIR: openCodeRoot
        }) as NodeJS.ProcessEnv,
        now: () => 1781885000000,
        cacheTtlMs: 0
      })

      const first = await runtime.importSessions()
      await writeCodexRollout(rolloutPath, 'Other Title', baseline)
      const cached = await runtime.importSessions()
      await utimes(rolloutPath, changed, changed)
      const reparsed = await runtime.importSessions()

      expect(first[0]).toEqual(expect.objectContaining({ id: 'codex-cache-session', title: 'First Title' }))
      expect(cached[0]).toEqual(expect.objectContaining({ id: 'codex-cache-session', title: 'First Title' }))
      expect(reparsed[0]).toEqual(expect.objectContaining({ id: 'codex-cache-session', title: 'Other Title' }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
