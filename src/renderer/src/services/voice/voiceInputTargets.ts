export type VoiceInputTarget = {
  kind: 'text' | 'terminal'
  dispose?: () => void
  insert: (text: string) => boolean
}

type TargetFactory = () => VoiceInputTarget | null
const adapters = new WeakMap<Element, TargetFactory>()

export const registerVoiceInputTarget = (element: Element, capture: TargetFactory) => {
  adapters.set(element, capture)
  return () => adapters.delete(element)
}

export const isVoiceTargetVisible = (element: HTMLElement) => {
  if (!element.isConnected || element.closest('[inert], [aria-hidden="true"]')) return false
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (parent.hidden || style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

export const captureVoiceInputTarget = (element: Element | null = document.activeElement): VoiceInputTarget | null => {
  if (!(element instanceof HTMLElement) || !isVoiceTargetVisible(element)) return null
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const capture = adapters.get(parent)
    if (capture) return capture()
  }
  // Hidden terminal and editor textareas are not ordinary text inputs.
  if (element.closest('.xterm, .threaded-terminal-input, .monaco-editor, [data-voice-ignore]')) return null
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly || (element instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'email'].includes(element.type))) return null
    const value = element.value
    const start = element.selectionStart ?? value.length
    const end = element.selectionEnd ?? start
    let changed = false
    const markChanged = () => { changed = true }
    element.addEventListener('input', markChanged, { once: true })
    return {
      kind: 'text',
      dispose: () => element.removeEventListener('input', markChanged),
      insert(text) {
        element.removeEventListener('input', markChanged)
        if (changed || !isVoiceTargetVisible(element) || element.disabled || element.readOnly || element.value !== value) return false
        element.focus({ preventScroll: true })
        // insertText preserves native undo and emits input for Vue's bindings.
        if (element.selectionStart !== null) element.setSelectionRange(start, end)
        if (document.execCommand?.('insertText', false, text)) return true
        element.value = value.slice(0, start) + text + value.slice(end)
        if (element.selectionStart !== null) element.setSelectionRange(start + text.length, start + text.length)
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
        return true
      }
    }
  }
  if (element.closest('[contenteditable="false"]')) return null
  const editable = element.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]')
  if (!editable || editable.closest('[contenteditable="false"]')) return null
  const selection = document.getSelection()
  if (!selection?.rangeCount || !editable.contains(selection.anchorNode) || !editable.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0).cloneRange()
  const html = editable.innerHTML
  let changed = false
  const observer = new MutationObserver(() => { changed = true })
  observer.observe(editable, { subtree: true, childList: true, characterData: true, attributes: true })
  return {
    kind: 'text',
    dispose: () => observer.disconnect(),
    insert(text) {
      changed ||= observer.takeRecords().length > 0
      observer.disconnect()
      if (changed || !isVoiceTargetVisible(editable) || editable.innerHTML !== html || !editable.contains(range.startContainer)) return false
      editable.focus({ preventScroll: true })
      const current = document.getSelection()
      current?.removeAllRanges()
      current?.addRange(range)
      if (document.execCommand?.('insertText', false, text)) return true
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      current?.removeAllRanges()
      current?.addRange(range)
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      return true
    }
  }
}
