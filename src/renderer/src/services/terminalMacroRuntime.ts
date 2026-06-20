export type MacroCommandEntry = {
  command: string
  timestamp: number
}

export type MacroTerminalInputState = {
  lineBuffer: string
  commands: MacroCommandEntry[]
}

export type MacroTerminalInputParseOptions = {
  recordControlKeys: boolean
  timestamp: number
}

export const MACRO_MAX_RECORDING_DURATION_MS = 5 * 60 * 1000
export const MACRO_MAX_COMMAND_COUNT = 50
export const MACRO_DEFAULT_SLEEP_THRESHOLD_MS = 500

const ctrlKeyMap: Record<string, string> = {
  'ctrl+a': '\x01',
  'ctrl+b': '\x02',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+f': '\x06',
  'ctrl+g': '\x07',
  'ctrl+h': '\x08',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+n': '\x0e',
  'ctrl+p': '\x10',
  'ctrl+r': '\x12',
  'ctrl+t': '\x14',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a'
}

const keyMap: Record<string, string> = {
  esc: '\x1b',
  tab: '\t',
  return: '\r',
  backspace: '\b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}

const keySequences = Object.entries(keyMap).sort(([, first], [, second]) => second.length - first.length)
const ctrlSequences = Object.entries(ctrlKeyMap).sort(([, first], [, second]) => second.length - first.length)

export const createMacroSnippetName = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `macro-${year}${month}${day}-${hour}${minute}${second}`
}

export const normalizeMacroSleepThreshold = (milliseconds: number) => Math.max(0, Math.round(milliseconds))

const commitLine = (state: MacroTerminalInputState, timestamp: number) => {
  if (!state.lineBuffer.length) return
  state.commands.push({ command: state.lineBuffer, timestamp })
  state.lineBuffer = ''
}

export const parseMacroTerminalInput = (
  input: MacroTerminalInputState,
  data: string,
  options: MacroTerminalInputParseOptions
): MacroTerminalInputState => {
  const next: MacroTerminalInputState = {
    lineBuffer: input.lineBuffer,
    commands: input.commands.map((entry) => ({ ...entry }))
  }
  let cursor = 0

  while (cursor < data.length) {
    const remaining = data.slice(cursor)
    const keyMatch = keySequences.find(([, sequence]) => remaining.startsWith(sequence))
    if (keyMatch) {
      const [key, sequence] = keyMatch
      if (key === 'return') {
        commitLine(next, options.timestamp)
      } else if (key === 'backspace') {
        next.lineBuffer = next.lineBuffer.slice(0, -1)
      } else if (options.recordControlKeys) {
        commitLine(next, options.timestamp)
        next.commands.push({ command: key, timestamp: options.timestamp })
      }
      cursor += sequence.length
      continue
    }

    const ctrlMatch = ctrlSequences.find(([, sequence]) => remaining.startsWith(sequence))
    if (ctrlMatch) {
      const [ctrl, sequence] = ctrlMatch
      if (options.recordControlKeys) {
        commitLine(next, options.timestamp)
        next.commands.push({ command: ctrl, timestamp: options.timestamp })
      }
      if (ctrl === 'ctrl+c') {
        next.lineBuffer = ''
      }
      cursor += sequence.length
      continue
    }

    const char = data[cursor]
    if (char === '\n' || char === '\r') {
      commitLine(next, options.timestamp)
    } else if (char === '\b' || char === '\x7f') {
      next.lineBuffer = next.lineBuffer.slice(0, -1)
    } else if (char === '\t') {
      if (options.recordControlKeys) {
        commitLine(next, options.timestamp)
        next.commands.push({ command: 'tab', timestamp: options.timestamp })
      }
    } else if (char.charCodeAt(0) >= 32) {
      next.lineBuffer += char
    }
    cursor += 1
  }

  return next
}
