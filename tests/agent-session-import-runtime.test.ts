import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
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
        now: () => 1781884900000,
        maxPerSource: 10
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
        ])
      )
      expect(imported.every((session: Omit<ManagedAiSessionRecord, 'decisions'>) => session.events.length === 1 && session.events[0].requestKind === 'telemetry')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
