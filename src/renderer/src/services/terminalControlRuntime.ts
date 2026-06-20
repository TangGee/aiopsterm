import { terminalClient } from '@/services/terminalClient'

const controlText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const terminalBracketedPasteText = (text: string) => `\x1b[200~${text}\x1b[201~`

export const terminalSubmitKeyData = (value: unknown) => {
  const normalized = controlText(value || 'return').toLowerCase().replace(/[\s_]+/g, '')
  if (!normalized || normalized === 'return' || normalized === 'enter') return '\r'
  if (normalized === 'none') return ''
  if (normalized === 'ctrl+enter' || normalized === 'control+enter' || normalized === 'ctrl-enter' || normalized === 'control-enter') return '\x1b[13;5u'
  return null
}

export const writeControlTerminalText = async (sessionId: string, text: string) => {
  const writeTerminal = terminalClient.writeTerminal()
  return Boolean(writeTerminal && (await writeTerminal(sessionId, text)))
}
