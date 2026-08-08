import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

type ProjectFilesBackend = Record<string, (...args: any[]) => any>
type ProjectFileAdapters = Record<string, (...args: any[]) => any>

const cleanup: string[] = []
let backend: ProjectFilesBackend | null = null
let adapters: ProjectFileAdapters | null = null

const loadModules = async () => {
  const backendPath = '../src/main/backend/files/projectFiles'
  const adaptersPath = '../src/main/backend/agent/projectFileChangeAdapters'
  backend = (await import(backendPath)) as ProjectFilesBackend
  adapters = (await import(adaptersPath)) as ProjectFileAdapters
  return { backend, adapters }
}

afterEach(async () => {
  adapters?.clearProjectFileAgentAdapterState()
  await backend?.resetProjectFilesRuntimeForTests()
  backend = null
  adapters = null
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('project file change adapters', () => {
  it('records only stat-confirmed changes from recognized file tools', async () => {
    const modules = await loadModules()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-adapter-user-'))
    const projectRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-adapter-root-'))
    cleanup.push(userDataPath, projectRoot)
    const session = {
      id: 'session-1',
      source: 'claude-code',
      terminalSessionId: 'terminal-1',
      canonicalCwd: projectRoot
    } as ManagedAiSessionRecord
    modules.backend.configureProjectFilesRuntime({
      userDataPath,
      getManagedSession: async () => session,
      findProductSession: () => null
    })

    const base = {
      source: 'claude-code',
      sessionId: 'session-1',
      terminalSessionId: 'terminal-1',
      cwd: projectRoot,
      tool_name: 'Write',
      tool_input: { file_path: 'created.ts' }
    }
    expect(await modules.adapters.handleProjectFileAgentHook({ ...base, event: 'PreToolUse' })).toBe(true)
    await writeFile(join(projectRoot, 'created.ts'), 'created\n')
    expect(await modules.adapters.handleProjectFileAgentHook({ ...base, event: 'PostToolUse' })).toBe(true)

    const context = await modules.backend.getProjectFileContext({ source: 'claude-code', sessionId: 'session-1' })
    expect(context.data?.recent).toEqual([
      expect.objectContaining({ path: 'created.ts', kind: 'created', origin: 'adapter' })
    ])
  })

  it('records Codex apply_patch paths supplied through tool_input.command', async () => {
    const modules = await loadModules()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-patch-user-'))
    const projectRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-patch-root-'))
    cleanup.push(userDataPath, projectRoot)
    const session = {
      id: 'session-1',
      source: 'codex',
      terminalSessionId: 'terminal-1',
      canonicalCwd: projectRoot
    } as ManagedAiSessionRecord
    modules.backend.configureProjectFilesRuntime({
      userDataPath,
      getManagedSession: async () => session,
      findProductSession: () => null
    })

    const patch = [
      '*** Begin Patch',
      `*** Add File: ${join(await realpath(projectRoot), 'install.sh')}`,
      '+#!/bin/sh',
      '+echo installed',
      '*** End Patch'
    ].join('\n')
    const base = {
      source: 'codex',
      sessionId: 'session-1',
      terminalSessionId: 'terminal-1',
      cwd: projectRoot,
      tool_name: 'apply_patch',
      tool_input: { command: patch }
    }
    expect(await modules.adapters.handleProjectFileAgentHook({ ...base, event: 'PreToolUse' })).toBe(true)
    await writeFile(join(projectRoot, 'install.sh'), '#!/bin/sh\necho installed\n')
    expect(await modules.adapters.handleProjectFileAgentHook({ ...base, event: 'Stop' })).toBe(true)

    const context = await modules.backend.getProjectFileContext({ source: 'codex', sessionId: 'session-1' })
    expect(context.data?.recent).toEqual([
      expect.objectContaining({ path: 'install.sh', kind: 'created', origin: 'adapter' })
    ])
  })

  it('does not infer arbitrary shell command changes', async () => {
    const modules = await loadModules()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-adapter-user-'))
    const projectRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-adapter-root-'))
    cleanup.push(userDataPath, projectRoot)
    const session = {
      id: 'session-1',
      source: 'codex',
      terminalSessionId: 'terminal-1',
      canonicalCwd: projectRoot
    } as ManagedAiSessionRecord
    modules.backend.configureProjectFilesRuntime({
      userDataPath,
      getManagedSession: async () => session,
      findProductSession: () => null
    })

    const handled = await modules.adapters.handleProjectFileAgentHook({
      source: 'codex',
      sessionId: 'session-1',
      terminalSessionId: 'terminal-1',
      event: 'PreToolUse',
      tool_name: 'shell',
      tool_input: { command: 'printf changed > hidden.ts' },
      cwd: projectRoot
    })
    expect(handled).toBe(false)
    await writeFile(join(projectRoot, 'hidden.ts'), 'changed\n')
    await modules.adapters.handleProjectFileAgentHook({
      source: 'codex',
      sessionId: 'session-1',
      terminalSessionId: 'terminal-1',
      event: 'Stop',
      cwd: projectRoot
    })
    const context = await modules.backend.getProjectFileContext({ source: 'codex', sessionId: 'session-1' })
    expect(context.data?.recent).toEqual([])
  })
})
