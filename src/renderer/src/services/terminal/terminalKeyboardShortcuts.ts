export type TerminalKeyboardEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export type TerminalShortcutAction =
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'search' }
  | { type: 'searchNext' }
  | { type: 'searchPrevious' }
  | { type: 'searchClear' }
  | { type: 'newWindow' }
  | { type: 'closeWindow' }
  | { type: 'fullscreen' }
  | { type: 'newTab' }
  | { type: 'forkSsh' }
  | { type: 'closeTab' }
  | { type: 'commandDialog' }
  | { type: 'clear' }
  | { type: 'fileManager' }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'previousTab' }
  | { type: 'nextTab' }
  | { type: 'moveTabLeft' }
  | { type: 'moveTabRight' }
  | { type: 'specificTab'; digit: number }
  | { type: 'scrollLineUp' }
  | { type: 'scrollLineDown' }
  | { type: 'scrollPageUp' }
  | { type: 'scrollPageDown' }
  | { type: 'scrollTop' }
  | { type: 'scrollBottom' }
  | { type: 'previousCommand' }
  | { type: 'nextCommand' }
  | { type: 'reconnect' }

const keyName = (event: TerminalKeyboardEvent) => event.key.toLowerCase()
const hasPrimaryModifier = (event: TerminalKeyboardEvent) => event.ctrlKey || event.metaKey
const hasOnlyShiftPrimary = (event: TerminalKeyboardEvent) => event.shiftKey && hasPrimaryModifier(event) && !event.altKey

export const isTerminalCopyShortcut = (event: TerminalKeyboardEvent) => {
  const key = keyName(event)
  if (key !== 'c') return false
  if (hasOnlyShiftPrimary(event)) return true
  return event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export const isTerminalPasteShortcut = (event: TerminalKeyboardEvent) => {
  const key = keyName(event)
  if (key !== 'v') return false
  if (hasOnlyShiftPrimary(event)) return true
  return event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export const isPlainTerminalControlShortcut = (event: TerminalKeyboardEvent) =>
  event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && keyName(event).length === 1

export const terminalDeletePreviousWordInput = '\x17'

export const isTerminalDeletePreviousWordShortcut = (event: TerminalKeyboardEvent) =>
  event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && keyName(event) === 'backspace'

export const terminalShortcutActionForEvent = (event: TerminalKeyboardEvent): TerminalShortcutAction | null => {
  const key = keyName(event)
  const primary = hasPrimaryModifier(event)

  if (!primary && !event.shiftKey && !event.altKey && key === 'enter') return { type: 'reconnect' }
  if (!primary && !event.shiftKey && !event.altKey && key === 'f11') return { type: 'fullscreen' }

  if (isTerminalCopyShortcut(event)) return { type: 'copy' }
  if (isTerminalPasteShortcut(event)) return { type: 'paste' }

  if (primary && event.altKey && !event.shiftKey) {
    if (key === 'f') return { type: 'search' }
    if (key === 'g') return { type: 'searchNext' }
    if (key === 'h') return { type: 'searchPrevious' }
    if (key === 'j') return { type: 'searchClear' }
  }

  if (primary && event.shiftKey && !event.altKey) {
    if (key === 'n') return { type: 'newWindow' }
    if (key === 'q') return { type: 'closeWindow' }
    if (key === 't') return { type: 'newTab' }
    if (key === 'y') return { type: 'forkSsh' }
    if (key === 'w') return { type: 'closeTab' }
    if (key === 'k') return { type: 'commandDialog' }
    if (key === 'l') return { type: 'clear' }
    if (key === 'm') return { type: 'fileManager' }
    if (key === 'pageup') return { type: 'moveTabLeft' }
    if (key === 'pagedown') return { type: 'moveTabRight' }
    if (key === 'arrowup') return { type: 'scrollLineUp' }
    if (key === 'arrowdown') return { type: 'scrollLineDown' }
    if (key === 'arrowleft') return { type: 'previousCommand' }
    if (key === 'arrowright') return { type: 'nextCommand' }
  }

  if (primary && !event.altKey) {
    if (key === '+' || key === '=') return { type: 'zoomIn' }
    if (key === '-') return { type: 'zoomOut' }
    if (key === '0') return { type: 'zoomReset' }
    if (!event.shiftKey && key === 'pageup') return { type: 'previousTab' }
    if (!event.shiftKey && key === 'pagedown') return { type: 'nextTab' }
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && /^\d$/.test(key)) {
    return { type: 'specificTab', digit: key === '0' ? 10 : Number(key) }
  }

  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'pageup') return { type: 'scrollPageUp' }
    if (key === 'pagedown') return { type: 'scrollPageDown' }
    if (key === 'home') return { type: 'scrollTop' }
    if (key === 'end') return { type: 'scrollBottom' }
  }

  return null
}
