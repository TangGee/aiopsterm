import { appendFile, mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'

type RuntimeLogConfig = {
  getLogDir?: () => string
  appendFile?: typeof appendFile
  mkdir?: typeof mkdir
  rename?: typeof rename
  rm?: typeof rm
  stat?: typeof stat
  now?: () => Date
  isDebugEnabled?: () => boolean
  maxFileBytes?: number
  maxBackupFiles?: number
}

type RuntimeLogFields = Record<string, unknown>

const runtimeConfig: RuntimeLogConfig = {}
const sensitiveFieldPattern = /(pass(word)?|secret|token|key|credential|private|command|data|input|payload|content)/i
const maxStringFieldLength = 300

export const runtimeLogFileName = 'aiopsterm-runtime.log'
export const runtimeLogMaxFileBytes = 10 * 1024 * 1024
export const runtimeLogMaxBackupFiles = 3

let writeQueue: Promise<void> = Promise.resolve()

export const configureRuntimeLog = (config: RuntimeLogConfig = {}) => {
  runtimeConfig.getLogDir = config.getLogDir
  runtimeConfig.appendFile = config.appendFile
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.rename = config.rename
  runtimeConfig.rm = config.rm
  runtimeConfig.stat = config.stat
  runtimeConfig.now = config.now
  runtimeConfig.isDebugEnabled = config.isDebugEnabled
  runtimeConfig.maxFileBytes = config.maxFileBytes
  runtimeConfig.maxBackupFiles = config.maxBackupFiles
}

const normalizeField = (key: string, value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (sensitiveFieldPattern.test(key)) return '[redacted]'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: (value as NodeJS.ErrnoException).code
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => normalizeField(key, item, seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([nestedKey, nestedValue]) => [nestedKey, normalizeField(nestedKey, nestedValue, seen)] as const)
        .filter(([, nestedValue]) => nestedValue !== undefined)
    )
  }
  return value
}

const normalizeFields = (fields: RuntimeLogFields = {}) =>
  Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => {
        const normalized = normalizeField(key, value)
        if (typeof normalized === 'string' && normalized.length > maxStringFieldLength) {
          return [key, `${normalized.slice(0, maxStringFieldLength)}...`] as const
        }
        return [key, normalized] as const
      })
      .filter(([, value]) => value !== undefined)
  )

export const runtimeLogPath = () => {
  const dir = runtimeConfig.getLogDir?.()
  return dir ? join(dir, runtimeLogFileName) : ''
}

const rotateRuntimeLogIfNeeded = async (path: string) => {
  const statFn = runtimeConfig.stat || stat
  const fileSizeLimit = runtimeConfig.maxFileBytes || runtimeLogMaxFileBytes
  const backupCount = Math.max(1, runtimeConfig.maxBackupFiles || runtimeLogMaxBackupFiles)
  try {
    const current = await statFn(path)
    if (current.size < fileSizeLimit) return
  } catch {
    return
  }

  const renameFn = runtimeConfig.rename || rename
  const removeFn = runtimeConfig.rm || rm
  for (let index = backupCount; index >= 1; index -= 1) {
    const source = index === 1 ? path : `${path}.${index - 1}`
    const target = `${path}.${index}`
    try {
      await removeFn(target, { force: true })
      await renameFn(source, target)
    } catch {
      // A missing backup is normal during the first rotation.
    }
  }
}

const writeRuntimeLogNow = async (level: RuntimeLogLevel, event: string, fields: RuntimeLogFields = {}) => {
  if (level === 'debug' && runtimeConfig.isDebugEnabled?.() !== true) return
  const dir = runtimeConfig.getLogDir?.()
  if (!dir) return
  const line = {
    at: (runtimeConfig.now?.() || new Date()).toISOString(),
    level,
    event,
    ...normalizeFields(fields)
  }
  try {
    await (runtimeConfig.mkdir || mkdir)(dir, { recursive: true })
    const path = join(dir, runtimeLogFileName)
    await rotateRuntimeLogIfNeeded(path)
    await (runtimeConfig.appendFile || appendFile)(path, `${JSON.stringify(line)}\n`, 'utf-8')
  } catch (error) {
    console.warn('[aiopsterm runtime log] failed to write log entry', error)
  }
}

export const writeRuntimeLog = (level: RuntimeLogLevel, event: string, fields: RuntimeLogFields = {}) => {
  writeQueue = writeQueue.then(() => writeRuntimeLogNow(level, event, fields), () => writeRuntimeLogNow(level, event, fields))
  return writeQueue
}

export const logRuntimeEvent = (level: RuntimeLogLevel, event: string, fields: RuntimeLogFields = {}) => {
  void writeRuntimeLog(level, event, fields)
}
