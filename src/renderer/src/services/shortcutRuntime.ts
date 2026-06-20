import type { ShortcutUserConfig } from '@shared/contracts/settingsPreferences'

export type ShortcutActionHandler = (payload?: { digit?: number }) => void

type ParsedShortcut = {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  key: string
}

type ShortcutBinding = {
  actionId: string
  parsed: ParsedShortcut
  handler: ShortcutActionHandler
  digit?: number
}

const modifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const modifierEventKeys = new Set(['control', 'alt', 'shift', 'meta', 'command'])
const specialKeyAliases: Record<string, string> = {
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  ';': 'semicolon',
  "'": 'quote',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\\': 'backslash',
  '`': 'backquote',
  '-': 'minus',
  '=': 'equal',
  tab: 'tab',
  return: 'enter',
  esc: 'escape',
  space: ' '
}

export const parseShortcut = (shortcut: string): ParsedShortcut | null => {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const parsed: ParsedShortcut = {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    key: ''
  }
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') {
      parsed.ctrlKey = true
    } else if (lower === 'shift') {
      parsed.shiftKey = true
    } else if (lower === 'alt' || lower === 'option') {
      parsed.altKey = true
    } else if (lower === 'cmd' || lower === 'command' || lower === 'meta') {
      parsed.metaKey = true
    } else if (!parsed.key) {
      parsed.key = lower
    }
  }
  if (!parsed.key && !parsed.ctrlKey && !parsed.shiftKey && !parsed.altKey && !parsed.metaKey) return null
  return parsed
}

export const isSpecificTabShortcutPrefix = (shortcut: string) => {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return false
  if (parts.some((part) => /^\d$/.test(part))) return false
  return parts.some((part) => modifierTokens.has(part.toLowerCase()))
}

const eventKeyName = (event: KeyboardEvent) => {
  if (event.code === 'Tab' || event.key === 'Tab') return 'tab'
  if (event.key === ' ') return ' '
  return event.key.toLowerCase()
}

const normalizedKey = (key: string) => specialKeyAliases[key.toLowerCase()] || key.toLowerCase()

export const matchesShortcut = (event: KeyboardEvent, parsed: ParsedShortcut) => {
  if (event.ctrlKey !== parsed.ctrlKey || event.shiftKey !== parsed.shiftKey || event.altKey !== parsed.altKey || event.metaKey !== parsed.metaKey) {
    return false
  }
  if (!parsed.key) {
    return modifierEventKeys.has(event.key.toLowerCase())
  }
  const eventKey = eventKeyName(event)
  const parsedKey = parsed.key.toLowerCase()
  return parsedKey === eventKey || normalizedKey(parsedKey) === eventKey || parsedKey === normalizedKey(eventKey)
}

export class ShortcutRuntime {
  private bindings: ShortcutBinding[] = []
  private listener: ((event: KeyboardEvent) => void) | null = null
  private recording = false

  install(shortcuts: ShortcutUserConfig[], handlers: Record<string, ShortcutActionHandler>) {
    this.bindings = this.buildBindings(shortcuts, handlers)
    if (!this.listener) {
      this.listener = (event: KeyboardEvent) => this.handleKeydown(event)
      document.addEventListener('keydown', this.listener, true)
    }
  }

  update(shortcuts: ShortcutUserConfig[], handlers: Record<string, ShortcutActionHandler>) {
    this.bindings = this.buildBindings(shortcuts, handlers)
  }

  setRecording(recording: boolean) {
    this.recording = recording
  }

  destroy() {
    if (this.listener) {
      document.removeEventListener('keydown', this.listener, true)
      this.listener = null
    }
    this.bindings = []
    this.recording = false
  }

  private buildBindings(shortcuts: ShortcutUserConfig[], handlers: Record<string, ShortcutActionHandler>) {
    const bindings: ShortcutBinding[] = []
    shortcuts.forEach((shortcut) => {
      const handler = handlers[shortcut.id]
      if (!handler) return
      if (shortcut.id === 'switchToSpecificTab') {
        if (!isSpecificTabShortcutPrefix(shortcut.shortcut)) return
        for (let digit = 1; digit <= 9; digit += 1) {
          const parsed = parseShortcut(`${shortcut.shortcut}+${digit}`)
          if (parsed) bindings.push({ actionId: shortcut.id, parsed, handler, digit })
        }
        return
      }
      const parsed = parseShortcut(shortcut.shortcut)
      if (parsed) bindings.push({ actionId: shortcut.id, parsed, handler })
    })
    return bindings
  }

  private handleKeydown(event: KeyboardEvent) {
    if (this.recording) return
    const binding = this.bindings.find((item) => matchesShortcut(event, item.parsed))
    if (!binding) return
    event.preventDefault()
    event.stopPropagation()
    binding.handler(binding.digit ? { digit: binding.digit } : undefined)
  }
}

export const shortcutRuntime = new ShortcutRuntime()
