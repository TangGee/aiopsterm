import { afterEach, describe, expect, it, vi } from 'vitest'
import { knowledgeClient } from '@/services/knowledge/knowledgeClient'
import type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseEntry,
  KnowledgeBaseImportResult,
  KnowledgeBasePastedImageResult,
  KnowledgeBaseReadResult,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseWriteResult
} from '@shared/contracts/knowledgeBase'

const originalAiops = window.aiops

const entry: KnowledgeBaseEntry = {
  name: 'Deploy.md',
  relPath: 'Runbooks/Deploy.md',
  type: 'file',
  size: 128,
  mtimeMs: 1781913600000
}

const mutationEntry: KnowledgeBaseCreateResult = {
  relPath: entry.relPath,
  type: 'file',
  size: 128,
  mtimeMs: 1781913600000
}

const writeResult: KnowledgeBaseWriteResult = {
  ...mutationEntry,
  type: 'file',
  size: 12,
  bytes: 12
}

const importResult: KnowledgeBaseImportResult = {
  ...mutationEntry,
  jobId: 'knowledge-import-1'
}

const readResult: KnowledgeBaseReadResult = {
  content: '# Deploy',
  mtimeMs: 1781913600000,
  mimeType: 'text/markdown'
}

const pastedImageResult: KnowledgeBasePastedImageResult = {
  relPath: 'images/pasted.png',
  fileName: 'pasted.png',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,AA==',
  size: 2,
  mtimeMs: 1781913600000
}

const searchResult: KnowledgeBaseSearchResult = {
  path: entry.relPath,
  startLine: 1,
  endLine: 2,
  score: 1.2,
  snippet: 'deploy',
  matchCount: 1
}

const searchStatus: KnowledgeBaseSearchStatus = {
  totalFiles: 1,
  totalChunks: 2,
  provider: 'aiopsterm-local',
  model: 'lexical',
  updatedAt: 1781913600000
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('knowledgeClient', () => {
  it('returns undefined for unavailable bridge methods and binds Knowledge Base bridge methods', async () => {
    const unsubscribe = vi.fn()
    window.aiops = {
      ...originalAiops,
      kbCheckPath: vi.fn(async (absPath) => ({ exists: true, isDirectory: absPath.endsWith('/dir'), isFile: !absPath.endsWith('/dir') })),
      kbEnsureRoot: vi.fn(async () => ({ success: true })),
      kbGetRoot: vi.fn(async () => ({ root: '/tmp/aiopsterm/knowledgebase' })),
      kbListDir: vi.fn(async () => [entry]),
      kbReadFile: vi.fn(async () => readResult),
      kbWriteFile: vi.fn(async () => writeResult),
      kbPasteImageFromClipboard: vi.fn(async () => pastedImageResult),
      kbMkdir: vi.fn(
        async (relDir, name): Promise<KnowledgeBaseCreateResult> => ({ ...mutationEntry, relPath: relDir ? `${relDir}/${name}` : name, type: 'dir' })
      ),
      kbCreateFile: vi.fn(
        async (relDir, name): Promise<KnowledgeBaseCreateResult> => ({ ...mutationEntry, relPath: relDir ? `${relDir}/${name}` : name, type: 'file' })
      ),
      kbRename: vi.fn(async (_relPath, name) => ({ ...mutationEntry, relPath: `Runbooks/${name}` })),
      kbDelete: vi.fn(async (relPath): Promise<{ success: true; relPath: string; type: 'file'; deleted: true }> => ({ success: true, relPath, type: 'file', deleted: true })),
      kbMove: vi.fn(async (_srcRelPath, dstRelDir) => ({ ...mutationEntry, relPath: `${dstRelDir}/Deploy.md` })),
      kbCopy: vi.fn(async (_srcRelPath, dstRelDir) => ({ ...mutationEntry, relPath: `${dstRelDir}/Deploy copy.md` })),
      kbImportFile: vi.fn(async () => importResult),
      kbImportFolder: vi.fn(
        async (srcAbsPath, dstRelDir): Promise<KnowledgeBaseImportResult> => ({
          ...importResult,
          relPath: `${dstRelDir}/${srcAbsPath.split('/').pop() || 'folder'}`,
          type: 'dir'
        })
      ),
      kbSearch: vi.fn(async () => [searchResult]),
      kbSearchStatus: vi.fn(async () => searchStatus),
      kbReindex: vi.fn(async () => ({ files: 1, chunks: 2 })),
      onKbTransferProgress: vi.fn((listener: (event: KnowledgeBaseTransferProgress) => void) => {
        listener({ jobId: 'knowledge-import-1', transferred: 1, total: 2, destRelPath: entry.relPath })
        return unsubscribe
      })
    }

    await expect(knowledgeClient.kbCheckPath()?.('/tmp/file.md')).resolves.toEqual({ exists: true, isDirectory: false, isFile: true })
    await expect(knowledgeClient.kbEnsureRoot()?.()).resolves.toEqual({ success: true })
    await expect(knowledgeClient.kbGetRoot()?.()).resolves.toEqual({ root: '/tmp/aiopsterm/knowledgebase' })
    await expect(knowledgeClient.kbListDir()?.('Runbooks')).resolves.toEqual([entry])
    await expect(knowledgeClient.kbReadFile()?.(entry.relPath)).resolves.toEqual(readResult)
    await expect(knowledgeClient.kbWriteFile()?.(entry.relPath, '# Updated')).resolves.toEqual(writeResult)
    await expect(knowledgeClient.kbPasteImageFromClipboard()?.('images')).resolves.toEqual(pastedImageResult)
    await expect(knowledgeClient.kbMkdir()?.('', 'Runbooks')).resolves.toEqual(expect.objectContaining({ relPath: 'Runbooks', type: 'dir' }))
    await expect(knowledgeClient.kbCreateFile()?.('Runbooks', 'Deploy.md', '')).resolves.toEqual(expect.objectContaining({ type: 'file' }))
    await expect(knowledgeClient.kbRename()?.(entry.relPath, 'Deploy v2.md')).resolves.toEqual(expect.objectContaining({ relPath: 'Runbooks/Deploy v2.md' }))
    await expect(knowledgeClient.kbDelete()?.(entry.relPath, false)).resolves.toEqual({ success: true, relPath: entry.relPath, type: 'file', deleted: true })
    await expect(knowledgeClient.kbMove()?.(entry.relPath, 'Archive')).resolves.toEqual(expect.objectContaining({ relPath: 'Archive/Deploy.md' }))
    await expect(knowledgeClient.kbCopy()?.(entry.relPath, 'Archive')).resolves.toEqual(expect.objectContaining({ relPath: 'Archive/Deploy copy.md' }))
    await expect(knowledgeClient.kbImportFile()?.('/tmp/Deploy.md', 'Runbooks')).resolves.toEqual(importResult)
    await expect(knowledgeClient.kbImportFolder()?.('/tmp/runbooks', 'Runbooks')).resolves.toEqual(expect.objectContaining({ type: 'dir' }))
    await expect(knowledgeClient.kbSearch()?.('deploy', { maxResults: 5 })).resolves.toEqual([searchResult])
    await expect(knowledgeClient.kbSearchStatus()?.()).resolves.toEqual(searchStatus)
    await expect(knowledgeClient.kbReindex()?.()).resolves.toEqual({ files: 1, chunks: 2 })

    const listener = vi.fn()
    expect(knowledgeClient.onKbTransferProgress()?.(listener)).toBe(unsubscribe)
    expect(listener).toHaveBeenCalledWith({ jobId: 'knowledge-import-1', transferred: 1, total: 2, destRelPath: entry.relPath })
    expect(window.aiops.kbCheckPath).toHaveBeenCalledWith('/tmp/file.md')
    expect(window.aiops.kbListDir).toHaveBeenCalledWith('Runbooks')
    expect(window.aiops.kbReadFile).toHaveBeenCalledWith(entry.relPath)
    expect(window.aiops.kbWriteFile).toHaveBeenCalledWith(entry.relPath, '# Updated')
    expect(window.aiops.kbPasteImageFromClipboard).toHaveBeenCalledWith('images')
    expect(window.aiops.kbMkdir).toHaveBeenCalledWith('', 'Runbooks')
    expect(window.aiops.kbCreateFile).toHaveBeenCalledWith('Runbooks', 'Deploy.md', '')
    expect(window.aiops.kbRename).toHaveBeenCalledWith(entry.relPath, 'Deploy v2.md')
    expect(window.aiops.kbDelete).toHaveBeenCalledWith(entry.relPath, false)
    expect(window.aiops.kbMove).toHaveBeenCalledWith(entry.relPath, 'Archive')
    expect(window.aiops.kbCopy).toHaveBeenCalledWith(entry.relPath, 'Archive')
    expect(window.aiops.kbImportFile).toHaveBeenCalledWith('/tmp/Deploy.md', 'Runbooks')
    expect(window.aiops.kbImportFolder).toHaveBeenCalledWith('/tmp/runbooks', 'Runbooks')
    expect(window.aiops.kbSearch).toHaveBeenCalledWith('deploy', { maxResults: 5 })
    expect(window.aiops.onKbTransferProgress).toHaveBeenCalledWith(listener)

    window.aiops = {
      ...originalAiops,
      kbCheckPath: undefined as any,
      kbEnsureRoot: undefined as any,
      kbGetRoot: undefined as any,
      kbListDir: undefined as any,
      kbReadFile: undefined as any,
      kbWriteFile: undefined as any,
      kbPasteImageFromClipboard: undefined as any,
      kbMkdir: undefined as any,
      kbCreateFile: undefined as any,
      kbRename: undefined as any,
      kbDelete: undefined as any,
      kbMove: undefined as any,
      kbCopy: undefined as any,
      kbImportFile: undefined as any,
      kbImportFolder: undefined as any,
      kbSearch: undefined as any,
      kbSearchStatus: undefined as any,
      kbReindex: undefined as any,
      onKbTransferProgress: undefined as any
    }
    expect(knowledgeClient.kbCheckPath()).toBeUndefined()
    expect(knowledgeClient.kbEnsureRoot()).toBeUndefined()
    expect(knowledgeClient.kbGetRoot()).toBeUndefined()
    expect(knowledgeClient.kbListDir()).toBeUndefined()
    expect(knowledgeClient.kbReadFile()).toBeUndefined()
    expect(knowledgeClient.kbWriteFile()).toBeUndefined()
    expect(knowledgeClient.kbPasteImageFromClipboard()).toBeUndefined()
    expect(knowledgeClient.kbMkdir()).toBeUndefined()
    expect(knowledgeClient.kbCreateFile()).toBeUndefined()
    expect(knowledgeClient.kbRename()).toBeUndefined()
    expect(knowledgeClient.kbDelete()).toBeUndefined()
    expect(knowledgeClient.kbMove()).toBeUndefined()
    expect(knowledgeClient.kbCopy()).toBeUndefined()
    expect(knowledgeClient.kbImportFile()).toBeUndefined()
    expect(knowledgeClient.kbImportFolder()).toBeUndefined()
    expect(knowledgeClient.kbSearch()).toBeUndefined()
    expect(knowledgeClient.kbSearchStatus()).toBeUndefined()
    expect(knowledgeClient.kbReindex()).toBeUndefined()
    expect(knowledgeClient.onKbTransferProgress()).toBeUndefined()
  })
})
