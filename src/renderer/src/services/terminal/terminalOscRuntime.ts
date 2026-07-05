export type TerminalProgressStatus = 'running' | 'error' | 'indeterminate' | 'paused'

export type TerminalProgress = {
  status: TerminalProgressStatus
  value?: number
  updatedAt: number
}

export type TerminalProgressOscChange =
  | { action: 'ignore' }
  | { action: 'clear' }
  | { action: 'set'; progress: TerminalProgress }

const terminalTitleMaxLength = 180
const terminalUserHostTitlePattern = /^([A-Za-z_][A-Za-z0-9_.-]*)@([A-Za-z0-9][A-Za-z0-9_.-]*)(?::.*)?$/

const cleanTerminalProgramTitle = (title: string) =>
  String(title || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isIpv4Host = (host: string) => {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export const isTerminalUserHostTitle = (title: string) => {
  const normalized = cleanTerminalProgramTitle(title)
  const match = normalized.match(terminalUserHostTitlePattern)
  if (!match) return false
  const host = match[2]
  return /[A-Za-z]/.test(host) || isIpv4Host(host)
}

export const normalizeTerminalProgramTitle = (title: string) => {
  const normalized = cleanTerminalProgramTitle(title)
  const trimmed = normalized.length > terminalTitleMaxLength ? normalized.slice(0, terminalTitleMaxLength).trim() : normalized
  return isTerminalUserHostTitle(trimmed) ? '' : trimmed
}

const terminalProgressStatusForCode = (code: number): TerminalProgressStatus | null => {
  if (code === 1) return 'running'
  if (code === 2) return 'error'
  if (code === 3) return 'indeterminate'
  if (code === 4) return 'paused'
  return null
}

export const parseTerminalProgressOsc = (data: string, now = Date.now()): TerminalProgressOscChange => {
  const parts = String(data || '').split(';').map((part) => part.trim())
  if (parts[0] !== '4') return { action: 'ignore' }
  const state = Number(parts[1])
  if (!Number.isFinite(state)) return { action: 'ignore' }
  if (state === 0) return { action: 'clear' }
  const status = terminalProgressStatusForCode(state)
  if (!status) return { action: 'ignore' }
  const rawValue = parts[2] === undefined || parts[2] === '' ? NaN : Number(parts[2])
  const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(100, Math.round(rawValue))) : undefined
  return {
    action: 'set',
    progress: {
      status,
      ...(value !== undefined ? { value } : {}),
      updatedAt: now
    }
  }
}
