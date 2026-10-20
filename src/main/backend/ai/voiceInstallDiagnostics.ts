import { logRuntimeEvent } from '../app/runtimeLog'

const redactUrls = (text: string) => text.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch { return '[invalid-url]' }
})

export const voiceInstallError = (error: unknown, depth = 0): Record<string, unknown> => {
  if (!(error instanceof Error)) return { message: redactUrls(String(error)) }
  return {
    name: error.name,
    message: redactUrls(error.message),
    code: (error as NodeJS.ErrnoException).code,
    stack: redactUrls(error.stack || '').slice(0, 6000),
    cause: depth < 3 && error.cause ? voiceInstallError(error.cause, depth + 1) : undefined
  }
}

export const createVoiceInstallLog = (context: Record<string, unknown>) =>
  (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
    logRuntimeEvent(level, `voice.install.${event}`, { ...context, ...fields })

export type VoiceInstallLog = ReturnType<typeof createVoiceInstallLog>
