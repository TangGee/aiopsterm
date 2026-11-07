const baseKeyData = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const namedKeys: Record<string, string> = {
    enter: '\r',
    return: '\r',
    cr: '\r',
    tab: '\t',
    space: ' ',
    escape: '\x1b',
    esc: '\x1b',
    backspace: '\x7f',
    bs: '\x7f',
    delete: '\x1b[3~',
    del: '\x1b[3~',
    insert: '\x1b[2~',
    ins: '\x1b[2~',
    up: '\x1b[A',
    arrowup: '\x1b[A',
    down: '\x1b[B',
    arrowdown: '\x1b[B',
    right: '\x1b[C',
    arrowright: '\x1b[C',
    left: '\x1b[D',
    arrowleft: '\x1b[D',
    home: '\x1b[H',
    end: '\x1b[F',
    pageup: '\x1b[5~',
    pgup: '\x1b[5~',
    pagedown: '\x1b[6~',
    pgdn: '\x1b[6~',
    f1: '\x1bOP',
    f2: '\x1bOQ',
    f3: '\x1bOR',
    f4: '\x1bOS',
    f5: '\x1b[15~',
    f6: '\x1b[17~',
    f7: '\x1b[18~',
    f8: '\x1b[19~',
    f9: '\x1b[20~',
    f10: '\x1b[21~',
    f11: '\x1b[23~',
    f12: '\x1b[24~'
  }
  if (Object.prototype.hasOwnProperty.call(namedKeys, normalized)) return { key: raw, data: namedKeys[normalized] }
  const ctrlMatch = raw.match(/^(?:c|ctrl|control)[+-](.)$/i) || raw.match(/^\^(.)$/)
  if (ctrlMatch?.[1]) {
    const char = ctrlMatch[1].toUpperCase()
    if (char === '?') return { key: raw, data: '\x7f' }
    const code = char.charCodeAt(0)
    if (code >= 64 && code <= 95) return { key: raw, data: String.fromCharCode(code - 64) }
    if (code >= 65 && code <= 90) return { key: raw, data: String.fromCharCode(code - 64) }
  }
  if (raw.length === 1) return { key: raw, data: raw }
  return null
}

// Explicit remote keys use xterm modifiers for navigation and CSI-u to preserve
// Ctrl+Shift on characters instead of silently turning it into plain Ctrl.
export const keyDataForTerminal = (value: unknown): { key: string; data: string } | null => {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(raw)) return null
  let key = raw
  let modifiers = 0
  while (true) {
    const match = key.match(/^(ctrl|control|c|alt|shift)(?:\s*[+-]\s*|\s+)(.+)$/i)
    if (!match) break
    const bit = /^(ctrl|control|c)$/i.test(match[1]) ? 4 : /^alt$/i.test(match[1]) ? 2 : 1
    if (modifiers & bit) return null
    modifiers |= bit
    key = match[2].trim()
  }
  const base = baseKeyData(key)
  if (!base) return null
  if (!modifiers) return { key: raw, data: base.data }
  const modifier = modifiers + 1
  const cursor = base.data.match(/^\x1b(?:\[|O)([ABCDHFPQRS])$/)
  const numbered = base.data.match(/^\x1b\[(\d+)~$/)
  if (cursor) return { key: raw, data: `\x1b[1;${modifier}${cursor[1]}` }
  if (numbered) return { key: raw, data: `\x1b[${numbered[1]};${modifier}~` }
  if (base.data.length !== 1) return null
  const shift = Boolean(modifiers & 1)
  const alt = Boolean(modifiers & 2)
  const ctrl = Boolean(modifiers & 4)
  const char = base.data
  let data: string
  if (modifiers === 1 && char === '\t') data = '\x1b[Z'
  else if (!shift && ctrl && char === ' ') data = (alt ? '\x1b' : '') + '\x00'
  else if (!shift && ctrl && char === '\x7f') data = (alt ? '\x1b' : '') + '\x08'
  else if (!shift && ctrl && /[@-_a-z?]/.test(char)) {
    data = (alt ? '\x1b' : '') + (char === '?' ? '\x7f' : String.fromCharCode(char.toUpperCase().charCodeAt(0) - 64))
  } else if (ctrl || shift && char <= ' ' || shift && char === '\x7f') {
    data = `\x1b[${char.toLowerCase().charCodeAt(0)};${modifier}u`
  } else {
    const unshifted = "`1234567890-=[]\\;',./"
    const shifted = '~!@#$%^&*()_+{}|:"<>?'
    const index = unshifted.indexOf(char)
    const text = shift ? index >= 0 ? shifted[index] : char.toUpperCase() : char
    data = (alt ? '\x1b' : '') + text
  }
  return { key: raw, data }
}
