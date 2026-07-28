import { createHash } from 'crypto'
import { watch, type FSWatcher } from 'fs'
import { open, readFile, realpath, stat, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute } from 'path'
import type {
  LocalEditorFileInspectResult,
  LocalEditorFileReadResult,
  LocalEditorFileWatchEvent,
  LocalEditorFileWatchInput,
  LocalEditorFileWatchResult,
  LocalEditorFileWriteInput,
  LocalEditorFileWriteResult
} from '@shared/contracts/localFiles'

type LocalEditorFilesRuntime = {
  emitWatchEvent?: (event: LocalEditorFileWatchEvent) => void
}

type WatchedTarget = {
  filePath: string
  watchId: string
  lastMtimeMs: number
  lastSize: number
  existed: boolean
}

type ParentWatch = {
  watcher: FSWatcher
  targets: Map<string, WatchedTarget>
}

const maxTextBytes = 2 * 1024 * 1024
const maxParentWatchers = 64
const binaryProbeBytes = 8192

let runtime: LocalEditorFilesRuntime = {}
const parentWatches = new Map<string, ParentWatch>()
const watchDebounce = new Map<string, NodeJS.Timeout>()

const failure = (errorCode: string, errorMessage: string) => ({
  ok: false as const,
  errorCode,
  errorMessage
})

const contentHash = (content: Buffer | string) => createHash('sha256').update(content).digest('hex')

const canonicalExistingFile = async (filePathInput: unknown) => {
  const filePath = typeof filePathInput === 'string' ? filePathInput.trim() : ''
  if (!filePath) throw new Error('LOCAL_EDITOR_FILE_PATH_REQUIRED')
  if (!isAbsolute(filePath)) throw new Error('LOCAL_EDITOR_FILE_PATH_INVALID')
  const canonicalPath = await realpath(filePath)
  const metadata = await stat(canonicalPath)
  if (!metadata.isFile()) throw new Error('LOCAL_EDITOR_FILE_NOT_FILE')
  if (metadata.size > maxTextBytes) throw new Error('LOCAL_EDITOR_FILE_TOO_LARGE')
  const handle = await open(canonicalPath, 'r')
  try {
    const probe = Buffer.alloc(Math.min(binaryProbeBytes, metadata.size))
    if (probe.length) await handle.read(probe, 0, probe.length, 0)
    if (probe.includes(0)) throw new Error('LOCAL_EDITOR_FILE_BINARY')
    if (probe.length) new TextDecoder('utf-8', { fatal: true }).decode(probe)
  } finally {
    await handle.close()
  }
  return { filePath: canonicalPath, metadata }
}

const errorResult = (error: unknown) => {
  const code = error instanceof Error ? error.message : ''
  if (code === 'LOCAL_EDITOR_FILE_PATH_REQUIRED') {
    return failure(code, 'A file path is required.')
  }
  if (code === 'LOCAL_EDITOR_FILE_PATH_INVALID') {
    return failure(code, 'The local editor file path must be absolute.')
  }
  if (code === 'LOCAL_EDITOR_FILE_NOT_FILE') {
    return failure(code, 'The requested path is not a file.')
  }
  if (code === 'LOCAL_EDITOR_FILE_TOO_LARGE') {
    return failure(code, 'Files larger than 2 MiB cannot be edited.')
  }
  if (code === 'LOCAL_EDITOR_FILE_BINARY') {
    return failure(code, 'Binary files cannot be edited.')
  }
  if (error instanceof TypeError && error.message.includes('encoded data was not valid')) {
    return failure('LOCAL_EDITOR_FILE_BINARY', 'Binary files cannot be edited.')
  }
  const nodeCode = (error as NodeJS.ErrnoException)?.code
  if (nodeCode === 'ENOENT') return failure('LOCAL_EDITOR_FILE_NOT_FOUND', 'The requested file does not exist.')
  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return failure('LOCAL_EDITOR_FILE_PERMISSION_DENIED', 'Permission was denied for the requested file.')
  }
  return failure('LOCAL_EDITOR_FILE_FAILED', error instanceof Error ? error.message : String(error))
}

export const configureLocalEditorFilesRuntime = (config: LocalEditorFilesRuntime = {}) => {
  runtime = { ...runtime, ...config }
}

export const inspectLocalEditorFile = async (filePath: string): Promise<LocalEditorFileInspectResult> => {
  try {
    const resolved = await canonicalExistingFile(filePath)
    return {
      ok: true,
      data: {
        filePath: resolved.filePath,
        size: resolved.metadata.size,
        mtimeMs: resolved.metadata.mtimeMs
      }
    }
  } catch (error) {
    return errorResult(error)
  }
}

export const readLocalEditorFile = async (filePath: string): Promise<LocalEditorFileReadResult> => {
  try {
    const resolved = await canonicalExistingFile(filePath)
    const buffer = await readFile(resolved.filePath)
    return {
      ok: true,
      data: {
        filePath: resolved.filePath,
        content: buffer.toString('utf8'),
        contentHash: contentHash(buffer),
        size: resolved.metadata.size,
        mtimeMs: resolved.metadata.mtimeMs
      }
    }
  } catch (error) {
    return errorResult(error)
  }
}

export const writeLocalEditorFile = async (input: LocalEditorFileWriteInput): Promise<LocalEditorFileWriteResult> => {
  try {
    const requestedPath = typeof input?.filePath === 'string' ? input.filePath.trim() : ''
    if (!requestedPath) throw new Error('LOCAL_EDITOR_FILE_PATH_REQUIRED')
    if (!isAbsolute(requestedPath)) throw new Error('LOCAL_EDITOR_FILE_PATH_INVALID')
    const existingPath = await realpath(requestedPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && input.overwrite) return requestedPath
      throw error
    })
    const before = await stat(existingPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && input.overwrite) return null
      throw error
    })
    if (before && !before.isFile()) throw new Error('LOCAL_EDITOR_FILE_NOT_FILE')
    if (!input.overwrite) {
      if (!before) return failure('LOCAL_EDITOR_FILE_CONFLICT', 'The file was removed on disk.')
      if (input.expectedSize !== undefined && before.size !== input.expectedSize) {
        return failure('LOCAL_EDITOR_FILE_CONFLICT', 'The file changed on disk.')
      }
      if (input.expectedMtimeMs !== undefined && Math.abs(before.mtimeMs - input.expectedMtimeMs) > 1) {
        return failure('LOCAL_EDITOR_FILE_CONFLICT', 'The file changed on disk.')
      }
      if (input.expectedContentHash !== undefined) {
        const currentHash = contentHash(await readFile(existingPath))
        if (currentHash !== input.expectedContentHash) {
          return failure('LOCAL_EDITOR_FILE_CONFLICT', 'The file changed on disk.')
        }
      }
    }
    const content = typeof input.content === 'string' ? input.content : String(input.content)
    if (Buffer.byteLength(content, 'utf8') > maxTextBytes) {
      return failure('LOCAL_EDITOR_FILE_TOO_LARGE', 'Files larger than 2 MiB cannot be edited.')
    }
    await writeFile(existingPath, content, 'utf8')
    const persisted = await readFile(existingPath)
    const writtenHash = contentHash(content)
    if (contentHash(persisted) !== writtenHash) {
      return failure('LOCAL_EDITOR_FILE_CONFLICT', 'The file changed while it was being saved.')
    }
    const after = await stat(existingPath)
    for (const parent of parentWatches.values()) {
      for (const target of parent.targets.values()) {
        if (target.filePath !== existingPath) continue
        target.existed = true
        target.lastMtimeMs = after.mtimeMs
        target.lastSize = after.size
      }
    }
    return {
      ok: true,
      data: {
        filePath: existingPath,
        contentHash: writtenHash,
        size: after.size,
        mtimeMs: after.mtimeMs
      }
    }
  } catch (error) {
    return errorResult(error)
  }
}

const inspectWatchedTarget = async (target: WatchedTarget) => {
  const metadata = await stat(target.filePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  const existed = Boolean(metadata?.isFile())
  const changed = existed !== target.existed ||
    Boolean(metadata && (metadata.mtimeMs !== target.lastMtimeMs || metadata.size !== target.lastSize))
  if (!changed) return
  target.existed = existed
  target.lastMtimeMs = metadata?.mtimeMs || 0
  target.lastSize = metadata?.size || 0
  runtime.emitWatchEvent?.({
    filePath: target.filePath,
    watchId: target.watchId,
    kind: existed ? 'modified' : 'deleted',
    changedAt: Date.now()
  })
}

const scheduleWatchInspection = (target: WatchedTarget) => {
  const existing = watchDebounce.get(target.watchId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    watchDebounce.delete(target.watchId)
    void inspectWatchedTarget(target).catch(() => undefined)
  }, 80)
  timer.unref()
  watchDebounce.set(target.watchId, timer)
}

export const startLocalEditorFileWatch = async (input: LocalEditorFileWatchInput): Promise<LocalEditorFileWatchResult> => {
  const watchId = typeof input?.watchId === 'string' ? input.watchId.trim() : ''
  if (!watchId) return failure('LOCAL_EDITOR_FILE_WATCH_INVALID', 'A watchId is required.')
  stopLocalEditorFileWatch(watchId)
  const inspected = await inspectLocalEditorFile(input.filePath)
  if (!inspected.ok || !inspected.data) {
    return failure(
      inspected.errorCode || 'LOCAL_EDITOR_FILE_FAILED',
      inspected.errorMessage || 'The requested file could not be inspected.'
    )
  }
  const filePath = inspected.data.filePath
  const parentPath = dirname(filePath)
  let parent = parentWatches.get(parentPath)
  if (!parent) {
    if (parentWatches.size >= maxParentWatchers) {
      return { ok: true, data: { filePath, watchId, watched: false, fallback: true } }
    }
    const targets = new Map<string, WatchedTarget>()
    const watcher = watch(parentPath, { recursive: false }, (_event, filename) => {
      const changedName = filename || ''
      for (const target of targets.values()) {
        if (!changedName || basename(target.filePath) === changedName) scheduleWatchInspection(target)
      }
    })
    watcher.on('error', () => {
      watcher.close()
      parentWatches.delete(parentPath)
    })
    parent = { watcher, targets }
    parentWatches.set(parentPath, parent)
  }
  parent.targets.set(watchId, {
    filePath,
    watchId,
    lastMtimeMs: inspected.data.mtimeMs,
    lastSize: inspected.data.size,
    existed: true
  })
  return { ok: true, data: { filePath, watchId, watched: true, fallback: false } }
}

export const stopLocalEditorFileWatch = (watchIdInput: string): LocalEditorFileWatchResult => {
  const watchId = typeof watchIdInput === 'string' ? watchIdInput.trim() : ''
  for (const [parentPath, parent] of parentWatches) {
    const target = parent.targets.get(watchId)
    if (!target) continue
    parent.targets.delete(watchId)
    const timer = watchDebounce.get(watchId)
    if (timer) clearTimeout(timer)
    watchDebounce.delete(watchId)
    if (!parent.targets.size) {
      parent.watcher.close()
      parentWatches.delete(parentPath)
    }
    return { ok: true, data: { filePath: target.filePath, watchId, watched: false, fallback: false } }
  }
  return { ok: true, data: { filePath: '', watchId, watched: false, fallback: false } }
}

export const resetLocalEditorFilesRuntimeForTests = () => {
  for (const timer of watchDebounce.values()) clearTimeout(timer)
  watchDebounce.clear()
  for (const parent of parentWatches.values()) parent.watcher.close()
  parentWatches.clear()
  runtime = {}
}
