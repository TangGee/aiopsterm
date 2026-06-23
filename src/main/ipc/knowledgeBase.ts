import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { basename, dirname, extname, join, posix, sep } from 'path'
import { Buffer } from 'buffer'
import { cp, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { writeKnowledgePastedImageFromClipboard } from '../backend/knowledge/knowledgeBaseImage'
import type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseEntry,
  KnowledgeBaseImportResult,
  KnowledgeBasePastedImageInput,
  KnowledgeBasePastedImageResult,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseWriteResult
} from '@shared/contracts/knowledgeBase'

type ResolvedKnowledgePath = {
  rootAbs?: string
  absPath: string
  relPath: string
}

type KnowledgeSearchIndexSnapshot = {
  status: KnowledgeBaseSearchStatus
} & Record<string, unknown>

type RegisterKnowledgeBaseIpcInput<TKnowledgeSearchIndex extends KnowledgeSearchIndexSnapshot = KnowledgeSearchIndexSnapshot> = {
  ensureKnowledgeBaseDirectory: () => Promise<string>
  syncKnowledgeBaseConfigFromDisk: () => Promise<unknown>
  listKnowledgeDir: (relDir: string) => Promise<KnowledgeBaseEntry[]>
  resolveKnowledgePath: (relPath: string) => ResolvedKnowledgePath
  getKnowledgeMimeType: (relPath: string) => string
  isKnowledgeImage: (relPath: string) => boolean
  knowledgeWriteResult: (relPath: string, absPath: string, expectedBytes: number) => Promise<KnowledgeBaseWriteResult>
  knowledgeMutationEntry: (relPath: string, absPath: string) => Promise<KnowledgeBaseCreateResult>
  knowledgeDeletedResult: (relPath: string, type: 'file' | 'dir', absPath: string) => Promise<KnowledgeBaseDeleteResult>
  isSafeKnowledgeBasename: (name: string) => boolean
  ensureUniqueKnowledgeName: (dirAbs: string, desiredName: string) => Promise<string>
  pathExists: (absPath: string) => Promise<boolean>
  isKnowledgeFileAllowedForImport: (fileName: string, fileSize: number) => boolean
  maxKnowledgeImportBytes: number
  collectKnowledgeImportTasks: (srcDir: string, destDir: string) => Promise<Array<{ srcPath: string; destPath: string }>>
  getOwnerWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
  sendKnowledgeProgress: (window: BrowserWindow | null, payload: KnowledgeBaseTransferProgress) => void
  searchKnowledgeIndex: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<KnowledgeBaseSearchResult[]>
  getKnowledgeSearchIndex: () => Promise<TKnowledgeSearchIndex>
  buildKnowledgeSearchIndex: () => Promise<TKnowledgeSearchIndex>
  setKnowledgeSearchIndex: (index: TKnowledgeSearchIndex) => void
}

export const registerKnowledgeBaseIpc = <TKnowledgeSearchIndex extends KnowledgeSearchIndexSnapshot>(
  ipcMain: IpcMain,
  input: RegisterKnowledgeBaseIpcInput<TKnowledgeSearchIndex>
) => {
  ipcMain.handle('kb:check-path', async (_event, payload: { absPath: string }) => {
    const absPath = typeof payload?.absPath === 'string' ? payload.absPath : ''
    try {
      const metadata = await stat(absPath)
      return {
        exists: true,
        isDirectory: metadata.isDirectory(),
        isFile: metadata.isFile()
      }
    } catch {
      return { exists: false, isDirectory: false, isFile: false }
    }
  })
  ipcMain.handle('kb:ensure-root', async () => {
    await input.ensureKnowledgeBaseDirectory()
    await input.syncKnowledgeBaseConfigFromDisk()
    return { success: true }
  })
  ipcMain.handle('kb:get-root', async () => {
    const root = await input.ensureKnowledgeBaseDirectory()
    await input.syncKnowledgeBaseConfigFromDisk()
    return { root }
  })
  ipcMain.handle('kb:list-dir', async (_event, payload: { relDir: string }) => input.listKnowledgeDir(payload?.relDir || ''))
  ipcMain.handle('kb:read-file', async (_event, payload: { relPath: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = input.resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    if (!metadata.isFile()) throw new Error('Not a file')
    if (encoding === 'base64') {
      const content = (await readFile(absPath)).toString('base64')
      return {
        content,
        mtimeMs: metadata.mtimeMs,
        mimeType: input.getKnowledgeMimeType(relPath),
        isImage: input.isKnowledgeImage(relPath)
      }
    }
    return {
      content: await readFile(absPath, 'utf-8'),
      mtimeMs: metadata.mtimeMs
    }
  })
  ipcMain.handle('kb:write-file', async (_event, payload: { relPath: string; content: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = input.resolveKnowledgePath(relPath)
    await mkdir(dirname(absPath), { recursive: true })
    if (encoding === 'base64') {
      const bytes = Buffer.from(content, 'base64')
      await writeFile(absPath, bytes)
      const result = await input.knowledgeWriteResult(relPath, absPath, bytes.byteLength)
      await input.syncKnowledgeBaseConfigFromDisk()
      return result
    }
    await writeFile(absPath, content, 'utf-8')
    const result = await input.knowledgeWriteResult(relPath, absPath, Buffer.byteLength(content, 'utf-8'))
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:paste-image-from-clipboard', async (_event, payload?: KnowledgeBasePastedImageInput): Promise<KnowledgeBasePastedImageResult> =>
    writeKnowledgePastedImageFromClipboard(payload || {}, {
      resolveKnowledgePath: input.resolveKnowledgePath,
      ensureUniqueKnowledgeName: input.ensureUniqueKnowledgeName,
      syncKnowledgeBaseConfigFromDisk: input.syncKnowledgeBaseConfigFromDisk
    })
  )
  ipcMain.handle('kb:mkdir', async (_event, payload: { relDir: string; name: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!input.isSafeKnowledgeBasename(name)) throw new Error('Invalid folder name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = input.resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const targetAbs = join(dirAbs, name)
    await mkdir(targetAbs, { recursive: false })
    const relPath = posix.join(normalizedRelDir, name)
    const result = await input.knowledgeMutationEntry(relPath, targetAbs)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:create-file', async (_event, payload: { relDir: string; name: string; content?: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!input.isSafeKnowledgeBasename(name)) throw new Error('Invalid file name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = input.resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const finalName = await input.ensureUniqueKnowledgeName(dirAbs, name)
    const content = typeof payload?.content === 'string' ? payload.content : ''
    const targetAbs = join(dirAbs, finalName)
    await writeFile(targetAbs, content, 'utf-8')
    const relPath = posix.join(normalizedRelDir, finalName)
    const result = await input.knowledgeMutationEntry(relPath, targetAbs)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:rename', async (_event, payload: { relPath: string; newName: string }) => {
    const relPath = payload?.relPath || ''
    const newName = typeof payload?.newName === 'string' ? payload.newName.trim() : ''
    if (!input.isSafeKnowledgeBasename(newName)) throw new Error('Invalid name')
    const { absPath: srcAbs, relPath: normalizedRelPath } = input.resolveKnowledgePath(relPath)
    const parentAbs = dirname(srcAbs)
    const destAbs = join(parentAbs, newName)
    const parentRel = posix.dirname(normalizedRelPath)
    const nextRelPath = parentRel === '.' ? newName : posix.join(parentRel, newName)
    if (srcAbs === destAbs) return input.knowledgeMutationEntry(nextRelPath, destAbs)
    if (await input.pathExists(destAbs)) throw new Error('Target already exists')
    await rename(srcAbs, destAbs)
    const result = await input.knowledgeMutationEntry(nextRelPath, destAbs)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:delete', async (_event, payload: { relPath: string; recursive?: boolean }) => {
    const relPath = payload?.relPath || ''
    const { absPath, relPath: normalizedRelPath } = input.resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    const type = metadata.isDirectory() ? 'dir' : 'file'
    if (metadata.isDirectory()) {
      await rm(absPath, { recursive: Boolean(payload?.recursive), force: true })
    } else {
      await unlink(absPath)
    }
    const result = await input.knowledgeDeletedResult(normalizedRelPath, type, absPath)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:move', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = input.resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = input.resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot move a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await input.ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    const destAbs = join(dstDirAbs, finalName)
    try {
      await rename(srcAbs, destAbs)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EXDEV') {
        await cp(srcAbs, destAbs, { recursive: true })
        await rm(srcAbs, { recursive: true, force: true })
      } else {
        throw error
      }
    }
    const relPath = posix.join(normalizedDstRelDir, finalName)
    const result = await input.knowledgeMutationEntry(relPath, destAbs)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:copy', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = input.resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = input.resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot copy a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await input.ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    const destAbs = join(dstDirAbs, finalName)
    await cp(srcAbs, destAbs, { recursive: true })
    const relPath = posix.join(normalizedDstRelDir, finalName)
    const result = await input.knowledgeMutationEntry(relPath, destAbs)
    await input.syncKnowledgeBaseConfigFromDisk()
    return result
  })
  ipcMain.handle('kb:import-file', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isFile()) throw new Error('Source is not a file')
    if (!input.isKnowledgeFileAllowedForImport(srcAbsPath, sourceMetadata.size)) {
      if (sourceMetadata.size > input.maxKnowledgeImportBytes) throw new Error('File too large')
      throw new Error('File type not allowed')
    }
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = input.resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await input.ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destAbs = join(dstDirAbs, finalName)
    const jobId = randomUUID()
    const destRelPath = posix.join(normalizedDstRelDir, finalName)
    const owner = input.getOwnerWindow(event)
    input.sendKnowledgeProgress(owner, { jobId, transferred: 0, total: sourceMetadata.size || 1, destRelPath })
    await cp(srcAbsPath, destAbs)
    input.sendKnowledgeProgress(owner, { jobId, transferred: sourceMetadata.size || 1, total: sourceMetadata.size || 1, destRelPath })
    const result = (await input.knowledgeMutationEntry(destRelPath, destAbs)) as KnowledgeBaseImportResult
    await input.syncKnowledgeBaseConfigFromDisk()
    return { ...result, jobId }
  })
  ipcMain.handle('kb:import-folder', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isDirectory()) throw new Error('Source is not a folder')
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = input.resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalFolderName = await input.ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destFolderAbs = join(dstDirAbs, finalFolderName)
    const destFolderRel = posix.join(normalizedDstRelDir, finalFolderName)
    await mkdir(destFolderAbs, { recursive: true })
    const tasks = await input.collectKnowledgeImportTasks(srcAbsPath, destFolderAbs)
    const jobId = randomUUID()
    const owner = input.getOwnerWindow(event)
    input.sendKnowledgeProgress(owner, { jobId, transferred: 0, total: tasks.length, destRelPath: destFolderRel })
    for (let index = 0; index < tasks.length; index += 1) {
      await mkdir(dirname(tasks[index].destPath), { recursive: true })
      await cp(tasks[index].srcPath, tasks[index].destPath)
      input.sendKnowledgeProgress(owner, { jobId, transferred: index + 1, total: tasks.length, destRelPath: destFolderRel })
    }
    const result = (await input.knowledgeMutationEntry(destFolderRel, destFolderAbs)) as KnowledgeBaseImportResult
    await input.syncKnowledgeBaseConfigFromDisk()
    return { ...result, jobId }
  })
  ipcMain.handle('kb:search', async (_event, query: string, options?: { maxResults?: number; minScore?: number }) => input.searchKnowledgeIndex(query, options))
  ipcMain.handle('kb:search-status', async () => {
    const index = await input.getKnowledgeSearchIndex()
    return index.status
  })
  ipcMain.handle('kb:reindex', async () => {
    const index = await input.buildKnowledgeSearchIndex()
    input.setKnowledgeSearchIndex(index)
    return {
      files: index.status.totalFiles,
      chunks: index.status.totalChunks
    }
  })
}
