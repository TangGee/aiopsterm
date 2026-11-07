export const keyDataForTerminal = (value: unknown) => {
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

