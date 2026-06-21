import type { FileContentOptions, FileListEntry, FileWriteContentResult } from '@shared/contracts/files'

export const normalizeRemotePath = (path: string) => {
  const normalized = String(path || '/').trim().replace(/\/+/g, '/')
  return normalized || '/'
}

export const remoteDirname = (path: string) => {
  const normalized = normalizeRemotePath(path)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

export const remoteBasename = (path: string) => normalizeRemotePath(path).split('/').filter(Boolean).at(-1) || path

export const modeString = (type: FileListEntry['type'], mode: number) => {
  const prefix = type === 'directory' ? 'd' : type === 'link' ? 'l' : '-'
  return `${prefix}${(mode & 0o777).toString(8).padStart(3, '0')}`
}

export const sortFileEntries = (entries: FileListEntry[]) =>
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : b.type === 'directory' ? 1 : a.type.localeCompare(b.type)
    return a.name.localeCompare(b.name)
  })

const maxTextBytes = 1024 * 1024

export const ensureTextSize = (size: number) => {
  if (size > maxTextBytes) throw new Error('File too large')
}

const hasExpectedFileVersion = (options: FileContentOptions) =>
  options.expectedAction === 'edit' ||
  options.expectedAction === 'create' ||
  typeof options.expectedMtimeMs === 'number' ||
  typeof options.expectedSize === 'number'

const fileContentConflict = (message = 'File changed on disk. Reload before saving.'): FileWriteContentResult => ({
  ok: false,
  errorCode: 'conflict',
  errorMessage: message
})

const nearlySameMtime = (left: number, right: number, toleranceMs = 1) => Math.abs(left - right) <= toleranceMs

export const validateFileContentVersion = (
  current: { exists: boolean; type?: FileListEntry['type']; size?: number; mtimeMs?: number },
  options: FileContentOptions
): FileWriteContentResult | null => {
  if (options.overwrite || !hasExpectedFileVersion(options)) return null

  if (options.expectedAction === 'create') {
    if (current.exists) return fileContentConflict('File was created by another process. Reload before saving.')
    return null
  }

  if (!current.exists) return fileContentConflict('File was removed on disk. Reload before saving.')
  if (current.type && current.type !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }

  if (typeof options.expectedSize === 'number' && Number(current.size ?? 0) !== options.expectedSize) return fileContentConflict()
  if (typeof options.expectedMtimeMs === 'number' && !nearlySameMtime(Number(current.mtimeMs ?? 0), options.expectedMtimeMs)) return fileContentConflict()

  return null
}
