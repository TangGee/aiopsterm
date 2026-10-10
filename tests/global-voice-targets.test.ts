import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureVoiceInputTarget, registerVoiceInputTarget } from '@/services/voice/voiceInputTargets'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
const input = (value = 'before after') => {
  const element = document.createElement('textarea')
  document.body.append(element)
  element.value = value
  element.focus()
  element.setSelectionRange(7, 7)
  return element
}

describe('global voice input targets', () => {
  it('retains the original caret after the button takes focus and emits input', () => {
    const element = input()
    const onInput = vi.fn()
    element.addEventListener('input', onInput)
    const target = captureVoiceInputTarget()
    const button = document.createElement('button'); document.body.append(button); button.focus()
    expect(target?.insert('spoken ')).toBe(true)
    expect(element.value).toBe('before spoken after')
    expect(element.selectionStart).toBe(14)
    expect(onInput).toHaveBeenCalledOnce()
  })
  it('advances the saved caret across fragments and detects subsequent manual edits', () => {
    const element = input()
    const target = captureVoiceInputTarget()
    expect(target?.insert('first ')).toBe(true)
    expect(target?.insert('second ')).toBe(true)
    expect(element.value).toBe('before first second after')
    element.dispatchEvent(new InputEvent('input'))
    expect(target?.insert('late')).toBe(false)
    target?.dispose?.()
  })
  it('replaces the saved selection without replacing the surrounding text', () => {
    const element = input('one two three'); element.setSelectionRange(4, 7)
    expect(captureVoiceInputTarget()?.insert('voice')).toBe(true)
    expect(element.value).toBe('one voice three')
  })
  it.each(['changed', 'removed', 'hidden', 'readonly', 'edit-and-undo'])('falls back when the original target is %s', (reason) => {
    const element = input()
    const target = captureVoiceInputTarget()
    if (reason === 'changed') element.value = 'edited'
    if (reason === 'removed') element.remove()
    if (reason === 'hidden') element.style.display = 'none'
    if (reason === 'readonly') element.readOnly = true
    if (reason === 'edit-and-undo') element.dispatchEvent(new InputEvent('input'))
    expect(target?.insert('voice')).toBe(false)
  })
  it('does not target passwords, numeric inputs, terminal internals or Monaco internals', () => {
    for (const type of ['password', 'number', 'checkbox']) {
      const element = document.createElement('input'); element.type = type; document.body.append(element)
      expect(captureVoiceInputTarget(element)).toBeNull()
    }
    for (const className of ['xterm', 'monaco-editor']) {
      const parent = document.createElement('div'); parent.className = className; document.body.append(parent)
      const element = document.createElement('textarea'); parent.append(element)
      expect(captureVoiceInputTarget(element)).toBeNull()
    }
  })
  it('uses registered editor adapters instead of writing to their internal textarea', () => {
    const parent = document.createElement('div'); document.body.append(parent)
    const child = document.createElement('textarea'); parent.append(child)
    const insert = vi.fn(() => true)
    const remove = registerVoiceInputTarget(parent, () => ({ kind: 'terminal', insert }))
    expect(captureVoiceInputTarget(child)?.kind).toBe('terminal')
    captureVoiceInputTarget(child)?.insert('hello')
    expect(insert).toHaveBeenCalledWith('hello')
    remove()
    expect(captureVoiceInputTarget(child)?.kind).toBe('text')
  })
  it('inserts plain text into a contenteditable selection and rejects stale changes', () => {
    const element = document.createElement('div'); element.contentEditable = 'true'; element.setAttribute('contenteditable', 'true'); element.textContent = 'hello world'; document.body.append(element)
    const range = document.createRange(); range.setStart(element.firstChild!, 6); range.setEnd(element.firstChild!, 11)
    document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range)
    const target = captureVoiceInputTarget(element)
    expect(target?.insert('<script>')).toBe(true)
    expect(element.textContent).toBe('hello <script>')
    expect(element.querySelector('script')).toBeNull()
    expect(target?.insert(' next')).toBe(true)
    expect(element.textContent).toBe('hello <script> next')
    target?.dispose?.()
    const stale = captureVoiceInputTarget(element)
    element.textContent = 'changed'
    expect(stale?.insert('voice')).toBe(false)
  })
})
