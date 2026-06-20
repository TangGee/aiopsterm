import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'path'
import type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseEntry,
  KnowledgeBaseWriteResult
} from '../src/shared/preload'

const backendMocks = vi.hoisted(() => ({
  writeKnowledgePastedImageFromClipboard: vi.fn()
}))

vi.mock('../src/main/backend/knowledgeBaseImage', () => ({
  writeKnowledgePastedImageFromClipboard: backendMocks.writeKnowledgePastedImageFromClipboard
}))

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type KnowledgeBaseIpcBackend = {
  registerKnowledgeBaseIpc: (ipcMain: IpcMain, input: any) => void
}

const tempDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/knowledgeBase'
  return (await import(modulePath)) as KnowledgeBaseIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-kb-ipc-'))
  tempDirs.push(dir)
  return dir
}

const pathExists = async (absPath: string) => {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

const splitNameExt = (fileName: string) => {
  const ext = extname(fileName)
  return { base: ext ? fileName.slice(0, -ext.length) : fileName, ext }
}

const createRegistrationInput = async () => {
  const root = await createTempDir()
  await mkdir(root, { recursive: true })
  const ownerWindow = { id: 17 }
  const searchIndex = {
    chunks: [],
    status: { totalFiles: 2, totalChunks: 3, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 1780490000000 }
  }
  let currentSearchIndex = searchIndex

  const resolveKnowledgePath = (relPath: string) => {
    const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new Error('Absolute path not allowed')
    const rootAbs = resolve(root)
    const absPath = resolve(rootAbs, normalized)
    if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) throw new Error('Path escapes knowledgebase root')
    return { rootAbs, absPath, relPath: normalized }
  }

  const isSafeKnowledgeBasename = (name: string) => Boolean(name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'))
  const ensureUniqueKnowledgeName = vi.fn(async (dirAbs: string, desiredName: string) => {
    const { base, ext } = splitNameExt(desiredName)
    let candidate = desiredName
    let index = 1
    while (await pathExists(join(dirAbs, candidate))) {
      candidate = `${base} (${index})${ext}`
      index += 1
    }
    return candidate
  })

  const knowledgeMutationEntry = async (relPath: string, absPath: string): Promise<KnowledgeBaseCreateResult> => {
    const metadata = await stat(absPath)
    if (metadata.isDirectory()) return { relPath, type: 'dir', mtimeMs: metadata.mtimeMs }
    return { relPath, type: 'file', size: metadata.size, mtimeMs: metadata.mtimeMs }
  }

  const knowledgeWriteResult = async (relPath: string, absPath: string, expectedBytes: number): Promise<KnowledgeBaseWriteResult> => {
    const metadata = await stat(absPath)
    return { relPath, type: 'file', size: metadata.size, bytes: expectedBytes, mtimeMs: metadata.mtimeMs }
  }

  const knowledgeDeletedResult = async (relPath: string, type: 'file' | 'dir', absPath: string): Promise<KnowledgeBaseDeleteResult> => {
    if (await pathExists(absPath)) throw new Error('Knowledge delete target still exists')
    return { success: true, relPath, type, deleted: true }
  }

  const listKnowledgeDir = async (relDir: string): Promise<KnowledgeBaseEntry[]> => {
    const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
    if (!(await pathExists(dirAbs))) return []
    const entries = await readdir(dirAbs, { withFileTypes: true })
    const result: KnowledgeBaseEntry[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const childAbs = join(dirAbs, entry.name)
      const metadata = await stat(childAbs)
      const childRel = posix.join(normalizedRelDir, entry.name)
      result.push({
        name: entry.name,
        relPath: childRel,
        type: entry.isDirectory() ? 'dir' : 'file',
        ...(entry.isDirectory() ? {} : { size: metadata.size }),
        mtimeMs: metadata.mtimeMs
      })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  const collectKnowledgeImportTasks = vi.fn(async (srcDir: string, destDir: string) => {
    const tasks: Array<{ srcPath: string; destPath: string }> = []
    const entries = await readdir(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name)
      const destPath = join(destDir, entry.name)
      if (entry.isDirectory()) {
        const nested = await collectKnowledgeImportTasks(srcPath, destPath)
        tasks.push(...nested)
      } else if (entry.isFile()) {
        tasks.push({ srcPath, destPath })
      }
    }
    return tasks
  })

  return {
    ensureKnowledgeBaseDirectory: vi.fn(async () => root),
    syncKnowledgeBaseConfigFromDisk: vi.fn(async () => ({ ok: true })),
    listKnowledgeDir: vi.fn(listKnowledgeDir),
    resolveKnowledgePath: vi.fn(resolveKnowledgePath),
    getKnowledgeMimeType: vi.fn((relPath: string) => (relPath.endsWith('.png') ? 'image/png' : 'application/octet-stream')),
    isKnowledgeImage: vi.fn((relPath: string) => ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(extname(relPath).toLowerCase())),
    knowledgeWriteResult: vi.fn(knowledgeWriteResult),
    knowledgeMutationEntry: vi.fn(knowledgeMutationEntry),
    knowledgeDeletedResult: vi.fn(knowledgeDeletedResult),
    isSafeKnowledgeBasename: vi.fn(isSafeKnowledgeBasename),
    ensureUniqueKnowledgeName,
    pathExists: vi.fn(pathExists),
    isKnowledgeFileAllowedForImport: vi.fn((fileName: string, fileSize: number) => fileSize <= 10 * 1024 * 1024 && !fileName.endsWith('.exe')),
    maxKnowledgeImportBytes: 10 * 1024 * 1024,
    collectKnowledgeImportTasks,
    getOwnerWindow: vi.fn(() => ownerWindow),
    sendKnowledgeProgress: vi.fn(),
    searchKnowledgeIndex: vi.fn(async () => [{ path: 'Runbooks/Deploy.md', startLine: 1, endLine: 3, score: 1.5, snippet: 'deploy', matchCount: 1 }]),
    getKnowledgeSearchIndex: vi.fn(async () => currentSearchIndex),
    buildKnowledgeSearchIndex: vi.fn(async () => ({
      chunks: [],
      status: { totalFiles: 4, totalChunks: 8, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 1780490100000 }
    })),
    setKnowledgeSearchIndex: vi.fn((index) => {
      currentSearchIndex = index
    }),
    paths: { root },
    ownerWindow
  }
}

describe('knowledge base IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendMocks.writeKnowledgePastedImageFromClipboard.mockResolvedValue({
      relPath: 'Runbooks/pasted.png',
      fileName: 'pasted.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,cG5n',
      size: 3,
      mtimeMs: 1780490000000
    })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('registers stable knowledge base channels', async () => {
    const { registerKnowledgeBaseIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerKnowledgeBaseIpc(ipcMain, await createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'kb:check-path',
      'kb:ensure-root',
      'kb:get-root',
      'kb:list-dir',
      'kb:read-file',
      'kb:write-file',
      'kb:paste-image-from-clipboard',
      'kb:mkdir',
      'kb:create-file',
      'kb:rename',
      'kb:delete',
      'kb:move',
      'kb:copy',
      'kb:import-file',
      'kb:import-folder',
      'kb:search',
      'kb:search-status',
      'kb:reindex'
    ])
  })

  it('checks paths, ensures root, lists directories, and reads/writes text and image files', async () => {
    const { registerKnowledgeBaseIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()
    const runbooksDir = join(input.paths.root, 'Runbooks')
    await mkdir(runbooksDir, { recursive: true })
    await writeFile(join(runbooksDir, 'Deploy.md'), 'deploy steps', 'utf-8')
    await writeFile(join(runbooksDir, 'diagram.png'), Buffer.from('png'))

    registerKnowledgeBaseIpc(ipcMain, input)

    await expect(handlers.get('kb:check-path')?.({}, { absPath: runbooksDir })).resolves.toEqual({ exists: true, isDirectory: true, isFile: false })
    await expect(handlers.get('kb:ensure-root')?.({})).resolves.toEqual({ success: true })
    await expect(handlers.get('kb:get-root')?.({})).resolves.toEqual({ root: input.paths.root })
    await expect(handlers.get('kb:list-dir')?.({}, { relDir: 'Runbooks' })).resolves.toEqual([
      expect.objectContaining({ name: 'Deploy.md', relPath: 'Runbooks/Deploy.md', type: 'file' }),
      expect.objectContaining({ name: 'diagram.png', relPath: 'Runbooks/diagram.png', type: 'file' })
    ])

    await expect(handlers.get('kb:read-file')?.({}, { relPath: 'Runbooks/Deploy.md' })).resolves.toEqual({
      content: 'deploy steps',
      mtimeMs: expect.any(Number)
    })
    await expect(handlers.get('kb:read-file')?.({}, { relPath: 'Runbooks/diagram.png', encoding: 'base64' })).resolves.toEqual({
      content: Buffer.from('png').toString('base64'),
      mtimeMs: expect.any(Number),
      mimeType: 'image/png',
      isImage: true
    })

    await expect(handlers.get('kb:write-file')?.({}, { relPath: 'Runbooks/New.md', content: '# New' })).resolves.toMatchObject({
      relPath: 'Runbooks/New.md',
      type: 'file',
      bytes: Buffer.byteLength('# New')
    })
    expect(await readFile(join(runbooksDir, 'New.md'), 'utf-8')).toBe('# New')
    expect(input.syncKnowledgeBaseConfigFromDisk).toHaveBeenCalled()
  })

  it('creates, renames, copies, moves, deletes, and pastes knowledge entries through backend boundaries', async () => {
    const { registerKnowledgeBaseIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerKnowledgeBaseIpc(ipcMain, input)

    await expect(handlers.get('kb:mkdir')?.({}, { relDir: '', name: 'Runbooks' })).resolves.toMatchObject({ relPath: 'Runbooks', type: 'dir' })
    await expect(handlers.get('kb:create-file')?.({}, { relDir: 'Runbooks', name: 'Deploy.md', content: 'deploy' })).resolves.toMatchObject({
      relPath: 'Runbooks/Deploy.md',
      type: 'file'
    })
    await expect(handlers.get('kb:rename')?.({}, { relPath: 'Runbooks/Deploy.md', newName: 'Deploy-v2.md' })).resolves.toMatchObject({
      relPath: 'Runbooks/Deploy-v2.md',
      type: 'file'
    })
    await expect(handlers.get('kb:copy')?.({}, { srcRelPath: 'Runbooks/Deploy-v2.md', dstRelDir: '' })).resolves.toMatchObject({
      relPath: 'Deploy-v2.md',
      type: 'file'
    })
    await expect(handlers.get('kb:move')?.({}, { srcRelPath: 'Deploy-v2.md', dstRelDir: 'Runbooks' })).resolves.toMatchObject({
      relPath: 'Runbooks/Deploy-v2 (1).md',
      type: 'file'
    })
    await expect(handlers.get('kb:delete')?.({}, { relPath: 'Runbooks/Deploy-v2.md', recursive: false })).resolves.toMatchObject({
      success: true,
      relPath: 'Runbooks/Deploy-v2.md',
      deleted: true
    })

    await expect(handlers.get('kb:paste-image-from-clipboard')?.({}, { relDir: 'Runbooks' })).resolves.toMatchObject({
      relPath: 'Runbooks/pasted.png',
      mimeType: 'image/png'
    })
    expect(backendMocks.writeKnowledgePastedImageFromClipboard).toHaveBeenCalledWith(
      { relDir: 'Runbooks' },
      expect.objectContaining({
        resolveKnowledgePath: input.resolveKnowledgePath,
        ensureUniqueKnowledgeName: input.ensureUniqueKnowledgeName,
        syncKnowledgeBaseConfigFromDisk: input.syncKnowledgeBaseConfigFromDisk
      })
    )
  })

  it('imports files and folders with progress events and exposes search status/reindex results', async () => {
    const { registerKnowledgeBaseIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()
    const sourceDir = await createTempDir()
    const sourceFile = join(sourceDir, 'imported-note.md')
    const sourceFolder = join(sourceDir, 'folder-import')
    await writeFile(sourceFile, 'imported', 'utf-8')
    await mkdir(sourceFolder, { recursive: true })
    await writeFile(join(sourceFolder, 'a.md'), 'a', 'utf-8')
    await mkdir(join(sourceFolder, 'nested'), { recursive: true })
    await writeFile(join(sourceFolder, 'nested', 'b.md'), 'b', 'utf-8')

    registerKnowledgeBaseIpc(ipcMain, input)

    await expect(handlers.get('kb:import-file')?.({ sender: {} }, { srcAbsPath: sourceFile, dstRelDir: 'Runbooks' })).resolves.toMatchObject({
      relPath: 'Runbooks/imported-note.md',
      type: 'file',
      jobId: expect.any(String)
    })
    expect(input.sendKnowledgeProgress).toHaveBeenCalledWith(input.ownerWindow, expect.objectContaining({ transferred: 0, destRelPath: 'Runbooks/imported-note.md' }))
    expect(input.sendKnowledgeProgress).toHaveBeenCalledWith(input.ownerWindow, expect.objectContaining({ transferred: Buffer.byteLength('imported'), destRelPath: 'Runbooks/imported-note.md' }))

    await expect(handlers.get('kb:import-folder')?.({ sender: {} }, { srcAbsPath: sourceFolder, dstRelDir: '' })).resolves.toMatchObject({
      relPath: 'folder-import',
      type: 'dir',
      jobId: expect.any(String)
    })
    expect(await readFile(join(input.paths.root, 'folder-import', 'nested', 'b.md'), 'utf-8')).toBe('b')

    await expect(handlers.get('kb:search')?.({}, 'deploy', { maxResults: 5 })).resolves.toEqual([
      { path: 'Runbooks/Deploy.md', startLine: 1, endLine: 3, score: 1.5, snippet: 'deploy', matchCount: 1 }
    ])
    expect(input.searchKnowledgeIndex).toHaveBeenCalledWith('deploy', { maxResults: 5 })
    const status = await handlers.get('kb:search-status')?.({})
    expect(status).toEqual({ totalFiles: 2, totalChunks: 3, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 1780490000000 })
    await expect(handlers.get('kb:reindex')?.({})).resolves.toEqual({ files: 4, chunks: 8 })
    expect(input.setKnowledgeSearchIndex).toHaveBeenCalledWith(expect.objectContaining({ status: expect.objectContaining({ totalFiles: 4, totalChunks: 8 }) }))

    await expect(handlers.get('kb:import-file')?.({ sender: {} }, { srcAbsPath: join(sourceDir, 'blocked.exe'), dstRelDir: '' })).rejects.toThrow()
  })
})
