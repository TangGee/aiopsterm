import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

type RuntimeLogConfig = {
  getLogDir?: () => string
  appendFile?: typeof appendFile
  mkdir?: typeof mkdir
  now?: () => Date
}

type RuntimeLogFields = Record<string, unknown>

const runtimeConfig: RuntimeLogConfig = {}
const sensitiveFieldPattern = /(pass(word)?|secret|token|key|credential|private|command|data|input|payload|content)/i
const maxStringFieldLength = 300

export const runtimeLogFileName = 'aiopsterm-runtime.log'

export const configureRuntimeLog = (config: RuntimeLogConfig = {}) => {
  runtimeConfig.getLogDir = config.getLogDir
  runtimeConfig.appendFile = config.appendFile
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.now = config.now
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

export const writeRuntimeLog = async (level: RuntimeLogLevel, event: string, fields: RuntimeLogFields = {}) => {
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
    await (runtimeConfig.appendFile || appendFile)(join(dir, runtimeLogFileName), `${JSON.stringify(line)}\n`, 'utf-8')
  } catch (error) {
    console.warn('[aiopsterm runtime log] failed to write log entry', error)
  }
}

export const logRuntimeEvent = (level: RuntimeLogLevel, event: string, fields: RuntimeLogFields = {}) => {
  void writeRuntimeLog(level, event, fields)
}
