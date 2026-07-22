export type TerminalHttpLink = {
  text: string
  start: number
  end: number
}

const urlPattern = /https?:\/\/[^\s<>"'`]+/giu
const trailingPunctuation = /[.,;:!?]$/
const closingPairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

const trimTerminalUrl = (value: string) => {
  let text = value
  while (trailingPunctuation.test(text)) text = text.slice(0, -1)
  while (text) {
    const closing = text.at(-1) || ''
    const opening = closingPairs[closing]
    if (!opening) break
    const openingCount = Array.from(text).filter((char) => char === opening).length
    const closingCount = Array.from(text).filter((char) => char === closing).length
    if (closingCount <= openingCount) break
    text = text.slice(0, -1)
  }
  return text
}

export const findTerminalHttpLinks = (text: string) => {
  const links: TerminalHttpLink[] = []
  for (const match of String(text || '').matchAll(urlPattern)) {
    const value = trimTerminalUrl(match[0])
    if (!value || match.index === undefined) continue
    links.push({ text: value, start: match.index, end: match.index + value.length })
  }
  return links
}

export const terminalHttpLinkAtIndex = (text: string, index: number) =>
  findTerminalHttpLinks(text).find((link) => index >= link.start && index < link.end) || null

const isWideCodePoint = (codePoint: number) =>
  codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )

export const terminalColumnAtTextIndex = (text: string, targetIndex: number) => {
  let column = 0
  let index = 0
  for (const char of text) {
    if (index >= targetIndex) break
    column += isWideCodePoint(char.codePointAt(0) || 0) ? 2 : 1
    index += char.length
  }
  return column
}

export const isTerminalLinkActivation = (event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey'>) =>
  event.button === 0 && (event.ctrlKey || event.metaKey)
