import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

type ProjectFilesBackend = Record<string, (...args: any[]) => any>

const cleanup: string[] = []
let backend: ProjectFilesBackend | null = null

const loadBackend = async () => {
  const modulePath = '../src/main/backend/files/projectFiles'
  backend = (await import(modulePath)) as ProjectFilesBackend
  return backend
}

afterEach(async () => {
  await backend?.resetProjectFilesRuntimeForTests()
  backend = null
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const setupRuntime = async () => {
  const projectFiles = await loadBackend()
  const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-project-files-user-'))
  const projectRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-project-files-root-'))
  cleanup.push(userDataPath, projectRoot)
  const session = {
    id: 'session-1',
    source: 'codex',
    terminalSessionId: 'terminal-1',
    canonicalCwd: projectRoot
  } as ManagedAiSessionRecord
  const secondSession = {
    ...session,
    id: 'session-2',
    terminalSessionId: 'terminal-2'
  } as ManagedAiSessionRecord
  projectFiles.configureProjectFilesRuntime({
    userDataPath,
    getManagedSession: async (source: string, sessionId: string) => {
      if (source !== 'codex') return null
      if (sessionId === 'session-1') return session
      if (sessionId === 'session-2') return secondSession
      return null
    },
    findProductSession: () => null
  })
  return { projectRoot, projectFiles }
}

describe('project files backend', () => {
  it('shares recent file changes by canonical project root and rejects traversal', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await writeFile(join(projectRoot, 'app.ts'), 'export const value = 1\n')

    const first = await projectFiles.recordProjectFileChange({
      protocolVersion: 1,
      eventId: 'event-1',
      source: 'codex',
      sessionId: 'session-1',
      cwd: projectRoot,
      changes: [
        { path: 'app.ts', kind: 'modified' },
        { path: '../outside.ts', kind: 'modified' }
      ]
    }, 'adapter')
    expect(first).toMatchObject({ ok: true, data: { accepted: 1, rejected: 1, duplicate: 0 } })

    const duplicate = await projectFiles.recordProjectFileChange({
      protocolVersion: 1,
      eventId: 'event-1',
      source: 'codex',
      sessionId: 'session-1',
      changes: [{ path: 'app.ts', kind: 'modified' }]
    })
    expect(duplicate).toMatchObject({ ok: true, data: { accepted: 0, duplicate: 1 } })

    const context = await projectFiles.getProjectFileContext({ source: 'codex', sessionId: 'session-1' })
    expect(context.ok).toBe(true)
    expect(context.data?.projectRoot).toBe(projectRoot)
    expect(context.data?.recent).toEqual([
      expect.objectContaining({ path: 'app.ts', kind: 'modified', origin: 'adapter' })
    ])
    const secondContext = await projectFiles.getProjectFileContext({ source: 'codex', sessionId: 'session-2' })
    expect(secondContext.data?.recent).toEqual(context.data?.recent)
    await expect(
      projectFiles.projectFileSessionMatchesTerminal(
        { source: 'codex', sessionId: 'session-2' },
        'terminal-2'
      )
    ).resolves.toBe(true)
    await expect(
      projectFiles.projectFileSessionMatchesTerminal(
        { source: 'codex', sessionId: 'session-2' },
        'terminal-1'
      )
    ).resolves.toBe(false)

    const native = await projectFiles.recordProjectFileChange({
      protocolVersion: 1,
      eventId: 'event-native',
      source: 'codex',
      sessionId: 'session-2',
      changes: [{ path: 'app.ts', kind: 'modified' }]
    })
    expect(native.ok).toBe(true)
    const nativeContext = await projectFiles.getProjectFileContext({ source: 'codex', sessionId: 'session-2' })
    expect(nativeContext.data?.capability).toBe('native')
  })

  it('lists directories lazily and enforces optimistic writes', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await mkdir(join(projectRoot, 'src'))
    await writeFile(join(projectRoot, 'src', 'a.ts'), 'first\n')
    await writeFile(join(projectRoot, 'readme.md'), 'readme\n')

    const root = await projectFiles.listProjectDirectory({ source: 'codex', sessionId: 'session-1', limit: 1 })
    expect(root.ok).toBe(true)
    expect(root.data?.entries).toHaveLength(1)
    expect(root.data?.entries[0]).toMatchObject({ name: 'src', type: 'directory' })
    expect(root.data?.nextOffset).toBe(1)

    const read = await projectFiles.readProjectFile({ source: 'codex', sessionId: 'session-1', relativePath: 'src/a.ts' })
    expect(read).toMatchObject({ ok: true, data: { content: 'first\n' } })

    const conflict = await projectFiles.writeProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'src/a.ts',
      content: 'second\n',
      expectedMtimeMs: 1,
      expectedSize: 6
    })
    expect(conflict).toMatchObject({ ok: false, errorCode: 'PROJECT_FILE_CONFLICT' })

    const saved = await projectFiles.writeProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'src/a.ts',
      content: 'second\n',
      overwrite: true
    })
    expect(saved).toMatchObject({ ok: true, data: { created: false, size: 7 } })
  })

  it('shares non-recursive parent watchers and releases the last lease', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await writeFile(join(projectRoot, 'a.ts'), 'a\n')
    await writeFile(join(projectRoot, 'b.ts'), 'b\n')

    await projectFiles.startProjectFileWatch({ source: 'codex', sessionId: 'session-1', relativePath: 'a.ts', watchId: 'watch-a' })
    await projectFiles.startProjectFileWatch({ source: 'codex', sessionId: 'session-1', relativePath: 'b.ts', watchId: 'watch-b' })
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({ parentWatcherCount: 1, watchedTargetCount: 2 })

    projectFiles.stopProjectFileWatch('watch-a')
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({ parentWatcherCount: 1, watchedTargetCount: 1 })
    projectFiles.stopProjectFileWatch('watch-b')
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({ parentWatcherCount: 0, watchedTargetCount: 0 })
  })

  it('caps parent watchers and falls back without consuming more watcher resources', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    for (let index = 0; index < 65; index += 1) {
      const directory = join(projectRoot, `dir-${index}`)
      await mkdir(directory)
      await writeFile(join(directory, 'file.ts'), `${index}\n`)
      const result = await projectFiles.startProjectFileWatch({
        source: 'codex',
        sessionId: 'session-1',
        relativePath: `dir-${index}/file.ts`,
        watchId: `watch-${index}`
      })
      expect(result.data?.fallback).toBe(index === 64)
    }
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({
      parentWatcherCount: 64,
      watchedTargetCount: 64
    })
    for (let index = 0; index < 65; index += 1) projectFiles.stopProjectFileWatch(`watch-${index}`)
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({
      parentWatcherCount: 0,
      watchedTargetCount: 0
    })
  })
})
