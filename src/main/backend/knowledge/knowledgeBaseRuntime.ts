import type { BrowserWindow } from 'electron'
import { basename, dirname, extname, isAbsolute, join, posix, resolve, sep } from 'path'
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import {
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH,
  defaultKnowledgeSeedTree,
  getDefaultKnowledgeSeedFile,
  shouldUseKnowledgeSeedData
} from '@shared/knowledgeBaseSeed'
import { sendWindowEvent } from '@shared/windowEvents'
import type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseEntry,
  KnowledgeBaseNodeConfig,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeBaseWriteResult
} from '@shared/contracts/knowledgeBase'
import type { UserConfig } from '@shared/contracts/userConfig'

export type KnowledgeSearchChunk = {
  id: string
  path: string
  startLine: number
  endLine: number
  text: string
  normalizedText: string
  tokens: string[]
}

export type KnowledgeSearchIndex = {
  chunks: KnowledgeSearchChunk[]
  status: KnowledgeBaseSearchStatus
}

type KnowledgeBaseRuntimeOptions = {
  userDataPath: () => string
  getConfig: () => UserConfig
  saveKnowledgeBase: (knowledgeBase: KnowledgeBaseUserConfig) => void
  defaultKnowledgeBase: KnowledgeBaseUserConfig
  /** Absolute path of the bundled best-practices docs directory; empty/missing disables bundled-docs sync. */
  bundledDocsPath?: () => string
  /** Version string persisted in the bundled-docs sync marker; sync re-runs when it changes. */
  bundledDocsVersion?: () => string
}

export const BUNDLED_DOCS_TARGET_DIR = '使用指南'

export const createKnowledgeBaseRuntime = (options: KnowledgeBaseRuntimeOptions) => {
  const getKnowledgeBasePath = () => join(options.userDataPath(), 'knowledgebase')
  const getKnowledgeBaseInitMarkerPath = () => join(getKnowledgeBasePath(), '.aiopsterm-knowledge-initialized')
  const getBundledDocsSyncMarkerPath = () => join(getKnowledgeBasePath(), '.aiopsterm-bundled-docs-synced')

  const blockedKnowledgeImportExtensions = new Set([
    '.exe',
    '.msi',
    '.bat',
    '.cmd',
    '.ps1',
    '.sh',
    '.app',
    '.dmg',
    '.pkg',
    '.deb',
    '.rpm',
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.gz',
    '.tgz',
    '.bz2',
    '.xz',
    '.iso',
    '.bin',
    '.dll',
    '.so',
    '.dylib',
    '.jar',
    '.class',
    '.pyc',
    '.o',
    '.a',
    '.lib',
    '.db',
    '.sqlite',
    '.sqlite3'
  ])

  const knowledgeImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
  const knowledgeSearchExtensions = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.log',
    '.json',
    '.jsonc',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.conf',
    '.cfg',
    '.csv',
    '.tsv',
    '.sql',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.js',
    '.ts',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.html',
    '.css',
    '.xml'
  ])
  const maxKnowledgeImportBytes = 10 * 1024 * 1024
  const maxKnowledgeSearchFileBytes = 2 * 1024 * 1024
  const maxKnowledgeSearchQueryLength = 512

  const normalizeKnowledgeRelPath = (relPath: string) => relPath.replace(/\\/g, '/').replace(/^\/+/, '')

  let knowledgeSearchIndex: KnowledgeSearchIndex | null = null

  const invalidateKnowledgeSearchIndex = () => {
    knowledgeSearchIndex = null
  }

  const isSafeKnowledgeBasename = (name: string) => {
    if (!name || name === '.' || name === '..') return false
    return !name.includes('/') && !name.includes('\\')
  }

  const resolveKnowledgePath = (relPath: string) => {
    const normalized = normalizeKnowledgeRelPath(relPath || '')
    if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
      throw new Error('Absolute path not allowed')
    }
    const rootAbs = resolve(getKnowledgeBasePath())
    const absPath = resolve(rootAbs, normalized)
    if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
      throw new Error('Path escapes knowledgebase root')
    }
    return { rootAbs, absPath, relPath: normalized }
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

  const ensureUniqueKnowledgeName = async (dirAbs: string, desiredName: string) => {
    const { base, ext } = splitNameExt(desiredName)
    let candidate = desiredName
    let index = 1
    while (await pathExists(join(dirAbs, candidate))) {
      candidate = `${base} (${index})${ext}`
      index += 1
    }
    return candidate
  }

  const knowledgeMutationEntry = async (relPath: string, absPath: string): Promise<KnowledgeBaseCreateResult> => {
    const metadata = await stat(absPath)
    if (metadata.isDirectory()) {
      return {
        relPath,
        type: 'dir',
        mtimeMs: metadata.mtimeMs
      }
    }
    if (!metadata.isFile()) throw new Error('Knowledge target is not a file or directory')
    return {
      relPath,
      type: 'file',
      size: metadata.size,
      mtimeMs: metadata.mtimeMs
    }
  }

  const knowledgeWriteResult = async (relPath: string, absPath: string, expectedBytes: number): Promise<KnowledgeBaseWriteResult> => {
    const entry = await knowledgeMutationEntry(relPath, absPath)
    if (entry.type !== 'file') throw new Error('Knowledge write target is not a file')
    if (entry.size !== expectedBytes) throw new Error('Knowledge write size does not match content byte count')
    return {
      relPath: entry.relPath,
      type: 'file',
      size: entry.size,
      bytes: expectedBytes,
      mtimeMs: entry.mtimeMs
    }
  }

  const knowledgeDeletedResult = async (relPath: string, type: 'file' | 'dir', absPath: string): Promise<KnowledgeBaseDeleteResult> => {
    if (await pathExists(absPath)) throw new Error('Knowledge delete target still exists')
    return {
      success: true,
      relPath,
      type,
      deleted: true
    }
  }

  const getKnowledgeMimeType = (relPath: string) => {
    const ext = extname(relPath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml'
    }
    return mimeTypes[ext] || 'application/octet-stream'
  }

  const isKnowledgeSearchableFile = (relPath: string, size: number) => {
    const ext = extname(relPath).toLowerCase()
    return size <= maxKnowledgeSearchFileBytes && knowledgeSearchExtensions.has(ext)
  }

  const normalizeKnowledgeSearchText = (value: string) => value.toLowerCase().normalize('NFKC')

  const tokenizeKnowledgeSearch = (value: string) =>
    Array.from(new Set(normalizeKnowledgeSearchText(value).match(/[\p{L}\p{N}_-]+/gu) || [])).filter((token) => token.length > 1)

  const createKnowledgeSearchSnippet = (text: string, queryTokens: string[]) => {
    const compact = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
    if (!compact) return ''
    const normalized = normalizeKnowledgeSearchText(compact)
    const firstMatch = queryTokens.reduce((best, token) => {
      const index = normalized.indexOf(token)
      return index === -1 ? best : Math.min(best, index)
    }, Number.POSITIVE_INFINITY)
    if (!Number.isFinite(firstMatch)) return compact.slice(0, 260)
    const start = Math.max(0, firstMatch - 80)
    const end = Math.min(compact.length, firstMatch + 180)
    return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`
  }

  const chunkKnowledgeSearchText = (relPath: string, content: string): KnowledgeSearchChunk[] => {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const chunks: KnowledgeSearchChunk[] = []
    const maxLines = 36
    const overlapLines = 6
    for (let start = 0; start < lines.length; start += maxLines - overlapLines) {
      const slice = lines.slice(start, start + maxLines)
      const text = slice.join('\n').trim()
      if (!text) continue
      chunks.push({
        id: `${relPath}:${start + 1}`,
        path: relPath,
        startLine: start + 1,
        endLine: Math.min(lines.length, start + slice.length),
        text,
        normalizedText: normalizeKnowledgeSearchText(text),
        tokens: tokenizeKnowledgeSearch(text)
      })
      if (start + maxLines >= lines.length) break
    }
    return chunks
  }

  const walkKnowledgeSearchFiles = async (relDir = ''): Promise<Array<{ relPath: string; size: number }>> => {
    const files: Array<{ relPath: string; size: number }> = []
    const entries = await listKnowledgeDir(relDir)
    for (const entry of entries) {
      if (entry.type === 'dir') {
        files.push(...(await walkKnowledgeSearchFiles(entry.relPath)))
      } else if (isKnowledgeSearchableFile(entry.relPath, entry.size || 0)) {
        files.push({ relPath: entry.relPath, size: entry.size || 0 })
      }
    }
    return files
  }

  const buildKnowledgeSearchIndex = async (): Promise<KnowledgeSearchIndex> => {
    await ensureKnowledgeBaseDirectory()
    const files = await walkKnowledgeSearchFiles('')
    const chunks: KnowledgeSearchChunk[] = []
    for (const file of files) {
      const { absPath } = resolveKnowledgePath(file.relPath)
      try {
        const content = await readFile(absPath, 'utf-8')
        chunks.push(...chunkKnowledgeSearchText(file.relPath, content))
      } catch {
        // Ignore unreadable/binary-like text files; the tree and editor read paths still surface file errors.
      }
    }
    return {
      chunks,
      status: {
        totalFiles: files.length,
        totalChunks: chunks.length,
        provider: 'aiopsterm-local',
        model: 'lexical',
        updatedAt: Date.now()
      }
    }
  }

  const getKnowledgeSearchIndex = async () => {
    if (!knowledgeSearchIndex) {
      knowledgeSearchIndex = await buildKnowledgeSearchIndex()
    }
    return knowledgeSearchIndex
  }

  const scoreKnowledgeChunk = (chunk: KnowledgeSearchChunk, query: string, queryTokens: string[]) => {
    const normalizedQuery = normalizeKnowledgeSearchText(query)
    let matchCount = 0
    let score = 0
    if (chunk.normalizedText.includes(normalizedQuery)) {
      matchCount += 1
      score += 1.5
    }
    for (const token of queryTokens) {
      const occurrences = chunk.normalizedText.split(token).length - 1
      if (occurrences <= 0) continue
      matchCount += occurrences
      score += Math.min(occurrences, 4) * (chunk.tokens.includes(token) ? 0.55 : 0.3)
    }
    const fileName = normalizeKnowledgeSearchText(basename(chunk.path))
    if (queryTokens.some((token) => fileName.includes(token))) {
      score += 0.35
    }
    return { score, matchCount }
  }

  const searchKnowledgeIndex = async (query: string, options?: { maxResults?: number; minScore?: number }): Promise<KnowledgeBaseSearchResult[]> => {
    const normalizedQuery = typeof query === 'string' ? query.trim() : ''
    if (!normalizedQuery || normalizedQuery.length > maxKnowledgeSearchQueryLength) return []
    const queryTokens = tokenizeKnowledgeSearch(normalizedQuery)
    if (!queryTokens.length) return []
    const maxResults = Math.min(Math.max(Math.floor(options?.maxResults || 20), 1), 50)
    const minScore = Math.max(options?.minScore ?? 0.15, 0)
    const index = await getKnowledgeSearchIndex()
    return index.chunks
      .map((chunk) => {
        const scored = scoreKnowledgeChunk(chunk, normalizedQuery, queryTokens)
        return {
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: Number(scored.score.toFixed(4)),
          snippet: createKnowledgeSearchSnippet(chunk.text, queryTokens),
          matchCount: scored.matchCount
        }
      })
      .filter((result) => result.score >= minScore && result.matchCount > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
      .slice(0, maxResults)
  }

  const ensureKnowledgeSeedNode = async (node: KnowledgeBaseNodeConfig, parentRelDir = '') => {
    const relPath = node.relPath || posix.join(parentRelDir, node.title)
    const { absPath } = resolveKnowledgePath(relPath)
    if (node.type === 'dir') {
      await mkdir(absPath, { recursive: true })
      for (const child of node.children || []) {
        await ensureKnowledgeSeedNode(child, relPath)
      }
      return
    }
    if (!(await pathExists(absPath))) {
      await mkdir(dirname(absPath), { recursive: true })
      const seedFile = getDefaultKnowledgeSeedFile(relPath)
      if (seedFile?.kind === 'base64') {
        await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
      } else {
        await writeFile(absPath, seedFile?.content || '', 'utf-8')
      }
    }
  }

  const migrateKnowledgeSeedPlaceholders = async () => {
    const seedFile = getDefaultKnowledgeSeedFile(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
    if (seedFile?.kind !== 'base64') return
    try {
      const { absPath } = resolveKnowledgePath(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
      const current = await readFile(absPath)
      if (current.toString('utf-8') === 'aiopsterm knowledge image placeholder\n') {
        await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
      }
    } catch {
      // Missing user-edited default images are left untouched after initial seeding.
    }
  }

  let bundledDocsSyncChecked = false

  const listBundledDocFiles = async (rootAbs: string, relDir = ''): Promise<string[]> => {
    const entries = await readdir(join(rootAbs, relDir), { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const childRel = relDir ? posix.join(relDir, entry.name) : entry.name
      if (entry.isDirectory()) {
        files.push(...(await listBundledDocFiles(rootAbs, childRel)))
      } else if (entry.isFile()) {
        files.push(childRel)
      }
    }
    return files
  }

  const syncBundledDocsIntoKnowledgeBase = async () => {
    if (bundledDocsSyncChecked) return
    bundledDocsSyncChecked = true
    const bundledRoot = options.bundledDocsPath?.() || ''
    if (!bundledRoot || !(await pathExists(bundledRoot))) return
    const syncVersion = options.bundledDocsVersion?.() || 'unversioned'
    try {
      const marker = await readFile(getBundledDocsSyncMarkerPath(), 'utf-8').catch(() => '')
      if (marker.trim() === syncVersion) return
      const bundledFiles = await listBundledDocFiles(bundledRoot)
      for (const fileRel of bundledFiles) {
        const targetRel = posix.join(BUNDLED_DOCS_TARGET_DIR, fileRel)
        const { absPath: targetAbs } = resolveKnowledgePath(targetRel)
        if (await pathExists(targetAbs)) continue
        await mkdir(dirname(targetAbs), { recursive: true })
        await copyFile(join(bundledRoot, ...fileRel.split('/')), targetAbs)
      }
      await writeFile(getBundledDocsSyncMarkerPath(), `${syncVersion}\n`, 'utf-8')
    } catch {
      // Bundled docs are best-effort: a failed sync retries on the next app start instead of breaking knowledge APIs.
      bundledDocsSyncChecked = false
    }
  }

  const ensureKnowledgeBaseDirectory = async () => {
    const knowledgePath = getKnowledgeBasePath()
    await mkdir(knowledgePath, { recursive: true })
    try {
      await access(getKnowledgeBaseInitMarkerPath())
    } catch {
      if (shouldUseKnowledgeSeedData()) {
        for (const node of defaultKnowledgeSeedTree()) {
          await ensureKnowledgeSeedNode(node)
        }
      }
      await writeFile(getKnowledgeBaseInitMarkerPath(), 'initialized\n', 'utf-8')
    }
    await migrateKnowledgeSeedPlaceholders()
    await syncBundledDocsIntoKnowledgeBase()
    return knowledgePath
  }

  const listKnowledgeDir = async (relDir: string): Promise<KnowledgeBaseEntry[]> => {
    await ensureKnowledgeBaseDirectory()
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
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  const getKnowledgeNodeId = (relPath: string) => `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`

  const buildKnowledgeTreeFromDisk = async (relDir = ''): Promise<KnowledgeBaseNodeConfig[]> => {
    const entries = await listKnowledgeDir(relDir)
    const nodes: KnowledgeBaseNodeConfig[] = []
    for (const entry of entries) {
      const node: KnowledgeBaseNodeConfig = {
        id: getKnowledgeNodeId(entry.relPath),
        key: entry.relPath,
        title: entry.name,
        type: entry.type,
        relPath: entry.relPath,
        ...(entry.type === 'file' ? { size: entry.size || 0 } : {})
      }
      if (entry.type === 'dir') {
        node.children = await buildKnowledgeTreeFromDisk(entry.relPath)
      }
      nodes.push(node)
    }
    return nodes
  }

  const sumKnowledgeTreeSize = (nodes: KnowledgeBaseNodeConfig[]): number =>
    nodes.reduce((total, node) => total + (node.size || 0) + (node.children ? sumKnowledgeTreeSize(node.children) : 0), 0)

  const syncKnowledgeBaseConfigFromDisk = async () => {
    const tree = await buildKnowledgeTreeFromDisk()
    const config = options.getConfig()
    const nextKnowledgeBase: KnowledgeBaseUserConfig = {
      tree,
      usedBytes: sumKnowledgeTreeSize(tree),
      totalBytes: config.knowledgeBase?.totalBytes || options.defaultKnowledgeBase.totalBytes
    }
    options.saveKnowledgeBase(nextKnowledgeBase)
    invalidateKnowledgeSearchIndex()
    return nextKnowledgeBase
  }

  const isKnowledgeFileAllowedForImport = (fileName: string, fileSize: number) => {
    const ext = extname(fileName).toLowerCase()
    if (ext && blockedKnowledgeImportExtensions.has(ext)) return false
    return fileSize <= maxKnowledgeImportBytes
  }

  const collectKnowledgeImportTasks = async (srcDir: string, destDir: string): Promise<Array<{ srcPath: string; destPath: string }>> => {
    const tasks: Array<{ srcPath: string; destPath: string }> = []
    const entries = await readdir(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const srcPath = join(srcDir, entry.name)
      const destPath = join(destDir, entry.name)
      if (entry.isDirectory()) {
        tasks.push(...(await collectKnowledgeImportTasks(srcPath, destPath)))
        continue
      }
      if (!entry.isFile()) continue
      const metadata = await stat(srcPath)
      if (isKnowledgeFileAllowedForImport(entry.name, metadata.size)) {
        tasks.push({ srcPath, destPath })
      }
    }
    return tasks
  }

  const sendKnowledgeProgress = (window: BrowserWindow | null, payload: KnowledgeBaseTransferProgress) => {
    sendWindowEvent(window, 'kb:transfer-progress', payload)
  }

  return {
    ensureKnowledgeBaseDirectory,
    syncKnowledgeBaseConfigFromDisk,
    listKnowledgeDir,
    buildKnowledgeTreeFromDisk,
    resolveKnowledgePath,
    getKnowledgeMimeType,
    isKnowledgeImage: (relPath: string) => knowledgeImageExtensions.has(extname(relPath).toLowerCase()),
    knowledgeWriteResult,
    knowledgeMutationEntry,
    knowledgeDeletedResult,
    isSafeKnowledgeBasename,
    ensureUniqueKnowledgeName,
    pathExists,
    isKnowledgeFileAllowedForImport,
    maxKnowledgeImportBytes,
    collectKnowledgeImportTasks,
    sendKnowledgeProgress,
    searchKnowledgeIndex,
    getKnowledgeSearchIndex,
    buildKnowledgeSearchIndex,
    setKnowledgeSearchIndex: (index: KnowledgeSearchIndex) => {
      knowledgeSearchIndex = index
    }
  }
}
