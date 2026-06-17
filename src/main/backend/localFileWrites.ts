import { cp, mkdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { pathToFileURL } from 'url'
import type { CustomBackgroundSaveResult, LocalFileWriteResult } from '@shared/preload'

const defaultAllowedCustomBackgroundExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const defaultMaxCustomBackgroundBytes = 20 * 1024 * 1024

type LocalFileWriteRuntime = {
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<void>
}

type CustomBackgroundRuntime = {
  backgroundDir: string
  maxBytes?: number
  allowedExtensions?: Set<string>
  toUrl?: (filePath: string) => string
  copyFile?: (source: string, target: string) => Promise<void>
  now?: () => Date
}

class LocalFileWriteError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'LocalFileWriteError'
  }
}

class CustomBackgroundError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'CustomBackgroundError'
  }
}

const localFileWriteErrorResult = (error: unknown): LocalFileWriteResult => ({
  ok: false,
  errorCode: error instanceof LocalFileWriteError ? error.errorCode : 'LOCAL_FILE_WRITE_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Local file write failed.')
})

export const sanitizeCustomBackgroundName = (name: string, now = new Date()) => {
  const ext = extname(name).toLowerCase()
  const base = basename(name, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || `background-${now.getTime()}`}${ext}`
}

const pathExists = async (absPath: string) => {
  try {
    await stat(absPath)
    return true
  } catch {
    return false
  }
}

const splitNameExt = (fileName: string) => {
  const ext = extname(fileName)
  return { base: ext ? fileName.slice(0, -ext.length) : fileName, ext }
}

export const ensureUniqueLocalFileName = async (dirAbs: string, desiredName: string) => {
  const { base, ext } = splitNameExt(desiredName)
  let candidate = desiredName
  let index = 1
  while (await pathExists(join(dirAbs, candidate))) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }
  return candidate
}

export const writeLocalTextFile = async (filePath: string, content: string, runtime: LocalFileWriteRuntime = {}): Promise<LocalFileWriteResult> => {
  try {
    if (!filePath || typeof filePath !== 'string') throw new LocalFileWriteError('LOCAL_FILE_WRITE_PATH_REQUIRED', 'filePath is required')
    if (!isAbsolute(filePath)) throw new LocalFileWriteError('LOCAL_FILE_WRITE_PATH_INVALID', 'filePath must be absolute')
    const text = typeof content === 'string' ? content : String(content)
    const expectedBytes = Buffer.byteLength(text, 'utf-8')
    await mkdir(dirname(filePath), { recursive: true })
    await (runtime.writeFile || writeFile)(filePath, text, 'utf-8')
    const metadata = await stat(filePath)
    if (!metadata.isFile()) throw new LocalFileWriteError('LOCAL_FILE_WRITE_CONFIRMATION_INVALID', 'Local file write target is not a file.')
    if (metadata.size !== expectedBytes) {
      throw new LocalFileWriteError('LOCAL_FILE_WRITE_CONFIRMATION_INVALID', 'Local file size does not match the written content byte count.')
    }
    return {
      ok: true,
      data: {
        filePath,
        bytes: expectedBytes,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs
      }
    }
  } catch (error) {
    return localFileWriteErrorResult(error)
  }
}

export const saveCustomBackgroundFile = async (srcAbsPath: string, runtime: CustomBackgroundRuntime): Promise<CustomBackgroundSaveResult> => {
  if (!srcAbsPath || typeof srcAbsPath !== 'string') throw new CustomBackgroundError('CUSTOM_BACKGROUND_SOURCE_REQUIRED', 'srcAbsPath is required')
  if (!isAbsolute(srcAbsPath)) throw new CustomBackgroundError('CUSTOM_BACKGROUND_SOURCE_INVALID', 'srcAbsPath must be absolute')
  const sourceMetadata = await stat(srcAbsPath)
  if (!sourceMetadata.isFile()) throw new CustomBackgroundError('CUSTOM_BACKGROUND_SOURCE_NOT_FILE', 'Background source must be a file')
  const maxBytes = runtime.maxBytes ?? defaultMaxCustomBackgroundBytes
  if (sourceMetadata.size > maxBytes) throw new CustomBackgroundError('CUSTOM_BACKGROUND_TOO_LARGE', 'Background file too large')
  const ext = extname(srcAbsPath).toLowerCase()
  const allowedExtensions = runtime.allowedExtensions ?? defaultAllowedCustomBackgroundExtensions
  if (!allowedExtensions.has(ext)) throw new CustomBackgroundError('CUSTOM_BACKGROUND_TYPE_NOT_ALLOWED', 'Background file type not allowed')

  const backgroundDir = runtime.backgroundDir
  if (!backgroundDir || !isAbsolute(backgroundDir)) throw new CustomBackgroundError('CUSTOM_BACKGROUND_DIR_INVALID', 'Background directory must be absolute')
  await mkdir(backgroundDir, { recursive: true })
  const finalName = await ensureUniqueLocalFileName(backgroundDir, sanitizeCustomBackgroundName(basename(srcAbsPath), runtime.now?.() || new Date()))
  const finalPath = join(backgroundDir, finalName)
  await (runtime.copyFile || cp)(srcAbsPath, finalPath)
  const targetMetadata = await stat(finalPath)
  if (!targetMetadata.isFile()) throw new CustomBackgroundError('CUSTOM_BACKGROUND_WRITE_CONFIRMATION_INVALID', 'Saved background target is not a file.')
  if (targetMetadata.size !== sourceMetadata.size) {
    throw new CustomBackgroundError('CUSTOM_BACKGROUND_WRITE_CONFIRMATION_INVALID', 'Saved background size does not match the source file.')
  }
  return {
    filePath: finalPath,
    url: runtime.toUrl ? runtime.toUrl(finalPath) : pathToFileURL(finalPath).href,
    name: finalName,
    size: targetMetadata.size,
    bytes: targetMetadata.size,
    mtimeMs: targetMetadata.mtimeMs
  }
}
