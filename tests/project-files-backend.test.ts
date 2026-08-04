import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
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

const setupRuntime = async (emitWatchEvent?: (event: Record<string, unknown>) => void) => {
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
    findProductSession: () => null,
    emitWatchEvent
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
    expect(context.data?.projectRoot).toBe(await realpath(projectRoot))
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

  it('rejects same-size external edits through the content hash revision', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    const filePath = join(projectRoot, 'same-size.ts')
    await writeFile(filePath, 'first\n')

    const read = await projectFiles.readProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'same-size.ts'
    })
    await writeFile(filePath, 'other\n')
    const changed = await stat(filePath)

    const conflict = await projectFiles.writeProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'same-size.ts',
      content: 'local\n',
      expectedMtimeMs: changed.mtimeMs,
      expectedSize: changed.size,
      expectedContentHash: read.data?.contentHash
    })

    expect(conflict).toMatchObject({ ok: false, errorCode: 'PROJECT_FILE_CONFLICT' })
  })

  it('creates, renames, moves, and deletes project entries safely', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await mkdir(join(projectRoot, 'src'))
    await mkdir(join(projectRoot, 'target'))

    const created = await projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'create-file',
      relativePath: 'src/new.ts'
    })
    expect(created).toMatchObject({
      ok: true,
      data: { kind: 'create-file', relativePath: 'src/new.ts', entryType: 'file' }
    })
    await expect(readFile(join(projectRoot, 'src', 'new.ts'), 'utf8')).resolves.toBe('')

    const duplicate = await projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'create-file',
      relativePath: 'src/new.ts'
    })
    expect(duplicate).toMatchObject({ ok: false, errorCode: 'PROJECT_ENTRY_EXISTS' })

    const renamed = await projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'rename',
      relativePath: 'src/new.ts',
      targetRelativePath: 'src/renamed.ts'
    })
    expect(renamed).toMatchObject({
      ok: true,
      data: { previousPath: 'src/new.ts', relativePath: 'src/renamed.ts' }
    })

    const moved = await projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'move',
      relativePath: 'src/renamed.ts',
      targetRelativePath: 'target/renamed.ts'
    })
    expect(moved).toMatchObject({
      ok: true,
      data: { previousPath: 'src/renamed.ts', relativePath: 'target/renamed.ts' }
    })
    await expect(stat(join(projectRoot, 'target', 'renamed.ts'))).resolves.toMatchObject({ size: 0 })

    const deleted = await projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'delete-file',
      relativePath: 'target/renamed.ts'
    })
    expect(deleted).toMatchObject({ ok: true, data: { relativePath: 'target/renamed.ts' } })
    await expect(stat(join(projectRoot, 'target', 'renamed.ts'))).rejects.toMatchObject({ code: 'ENOENT' })

    const context = await projectFiles.getProjectFileContext({ source: 'codex', sessionId: 'session-1' })
    expect(context.data?.recent.map((entry: { kind: string; path: string; previousPath?: string }) => ({
      kind: entry.kind,
      path: entry.path,
      previousPath: entry.previousPath
    }))).toEqual([
      { kind: 'deleted', path: 'target/renamed.ts', previousPath: undefined }
    ])
  })

  it('rejects destructive directory deletion, traversal, collisions, and self moves', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await mkdir(join(projectRoot, 'src', 'nested'), { recursive: true })
    await writeFile(join(projectRoot, 'src', 'existing.ts'), 'existing\n')
    await writeFile(join(projectRoot, 'collision.ts'), 'collision\n')

    await expect(projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'delete-file',
      relativePath: 'src'
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'PROJECT_ENTRY_DELETE_DIRECTORY_UNSUPPORTED'
    })
    await expect(projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'move',
      relativePath: 'src',
      targetRelativePath: 'src/nested/src'
    })).resolves.toMatchObject({ ok: false, errorCode: 'PROJECT_ENTRY_TARGET_INVALID' })
    await expect(projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'rename',
      relativePath: 'src/existing.ts',
      targetRelativePath: 'collision.ts'
    })).resolves.toMatchObject({ ok: false, errorCode: 'PROJECT_ENTRY_EXISTS' })
    await expect(projectFiles.mutateProjectEntry({
      source: 'codex',
      sessionId: 'session-1',
      kind: 'create-file',
      relativePath: '../outside.ts'
    })).resolves.toMatchObject({ ok: false, errorCode: 'PROJECT_ENTRY_PATH_INVALID' })
  })

  it('suppresses watcher notifications for editor writes but still reports external writes', async () => {
    const events: Array<Record<string, unknown>> = []
    const { projectRoot, projectFiles } = await setupRuntime((event) => events.push(event))
    const filePath = join(projectRoot, 'watched.ts')
    await writeFile(filePath, 'first\n')
    const read = await projectFiles.readProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'watched.ts'
    })
    await projectFiles.startProjectFileWatch({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'watched.ts',
      watchId: 'watch-editor'
    })

    await projectFiles.writeProjectFile({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'watched.ts',
      content: 'saved\n',
      expectedMtimeMs: read.data?.mtimeMs,
      expectedSize: read.data?.size,
      expectedContentHash: read.data?.contentHash
    })
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(events).toEqual([])

    await writeFile(filePath, 'agent\n')
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(events).toEqual([
      expect.objectContaining({ watchId: 'watch-editor', relativePath: 'watched.ts', kind: 'modified' })
    ])
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

  it('replaces an existing watch lease when the same editor moves to another directory', async () => {
    const { projectRoot, projectFiles } = await setupRuntime()
    await mkdir(join(projectRoot, 'first'))
    await mkdir(join(projectRoot, 'second'))
    await writeFile(join(projectRoot, 'first', 'a.ts'), 'a\n')
    await writeFile(join(projectRoot, 'second', 'a.ts'), 'a\n')

    await projectFiles.startProjectFileWatch({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'first/a.ts',
      watchId: 'watch-editor'
    })
    await projectFiles.startProjectFileWatch({
      source: 'codex',
      sessionId: 'session-1',
      relativePath: 'second/a.ts',
      watchId: 'watch-editor'
    })

    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({
      parentWatcherCount: 1,
      watchedTargetCount: 1
    })
    projectFiles.stopProjectFileWatch('watch-editor')
    expect(projectFiles.getProjectFilesRuntimeSnapshotForTests()).toMatchObject({
      parentWatcherCount: 0,
      watchedTargetCount: 0
    })
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
