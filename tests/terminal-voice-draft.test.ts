import { afterEach, expect, it, vi } from 'vitest'
import { createTerminalVoiceTarget } from '@/services/voice/terminalVoiceDraft'
afterEach(() => { document.body.innerHTML = '' })
const setup = () => {
  const element = document.createElement('div'); document.body.append(element)
  let identity = 'one'
  const insert = vi.fn(() => true)
  const target = createTerminalVoiceTarget({ element, valid: () => true, cursor: () => ({ left: 20, top: 30, height: 18, font: '14px monospace', identity }), insert })
  return { target, element, insert, move: () => { identity = 'two' } }
}
it('shows live text at the terminal cursor and sends finalized text once without backspaces or Enter', () => {
  const t = setup()
  t.target.replaceDraft!('列出'); t.target.replaceDraft!('列出文件')
  expect(t.element.querySelector('.terminal-voice-draft')?.textContent).toBe('列出文件')
  expect(t.insert).not.toHaveBeenCalled()
  expect(t.target.replaceDraft!('列出文件。\n', true)).toBe(true)
  expect(t.insert).toHaveBeenCalledWith('列出文件。 ')
  expect(t.insert).toHaveBeenCalledTimes(1)
  expect(t.element.querySelector('.terminal-voice-draft')).toBeNull()
  t.target.dispose?.()
})
it('rejects a draft after manual input or cursor movement and cancels without remote edits', () => {
  for (const manual of [true, false]) {
    const t = setup(); t.target.replaceDraft!('临时')
    if (manual) t.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    else t.move()
    expect(t.target.replaceDraft!('结束。', true)).toBe(false)
    t.target.cancelDraft?.(); t.target.dispose?.(); expect(t.insert).not.toHaveBeenCalled()
  }
})
