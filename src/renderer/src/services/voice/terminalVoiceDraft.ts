import { isVoiceTargetVisible, type VoiceInputTarget } from './voiceInputTargets'

// A terminal owns its remote edit buffer. Display a local preedit at its cursor,
// then send the finalized text once, without guessing shell backspace semantics.
export const createTerminalVoiceTarget = (options: {
  element: HTMLElement
  valid: () => boolean
  cursor: () => { left: number; top: number; height: number; font: string; identity: string }
  insert: (text: string) => boolean
}): VoiceInputTarget => {
  const { element } = options
  const initial = options.cursor()
  let changed = false
  let preview: HTMLSpanElement | undefined
  const invalidate = () => { changed = true; preview?.remove(); preview = undefined }
  for (const event of ['keydown', 'beforeinput', 'paste', 'pointerdown']) element.addEventListener(event, invalidate, true)
  const valid = () => !changed && options.valid() && isVoiceTargetVisible(element) && options.cursor().identity === initial.identity
  const clear = () => { preview?.remove(); preview = undefined }
  return {
    kind: 'terminal',
    replaceDraft(text, final = false) {
      if (!valid()) { clear(); return false }
      const safeText = text.replace(/[\r\n\x00-\x1f\x7f-\x9f]+/g, ' ')
      if (final) { clear(); return options.insert(safeText) }
      if (!preview) {
        preview = document.createElement('span')
        preview.className = 'terminal-voice-draft'
        preview.setAttribute('role', 'status')
        Object.assign(preview.style, {
          position: 'fixed', zIndex: '2400', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          color: 'var(--theme-core-text)', background: 'var(--theme-core-bg, #10151f)', borderBottom: '1px solid var(--theme-core-accent)'
        })
        element.append(preview)
      }
      const cursor = options.cursor()
      Object.assign(preview.style, { left: `${cursor.left}px`, top: `${cursor.top}px`, font: cursor.font,
        lineHeight: `${cursor.height}px`, maxWidth: `${Math.max(40, element.getBoundingClientRect().right - cursor.left)}px` })
      preview.textContent = safeText
      return true
    },
    insert(text) { return valid() && options.insert(text) },
    cancelDraft: clear,
    dispose() {
      clear()
      for (const event of ['keydown', 'beforeinput', 'paste', 'pointerdown']) element.removeEventListener(event, invalidate, true)
    }
  }
}
