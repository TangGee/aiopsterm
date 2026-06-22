import { beforeEach, describe, expect, it } from 'vitest'
import {
  aiPanelActiveEditableRange,
  aiPanelCharBeforeCaret,
  moveAiPanelEditableCaretToEnd,
  restoreAiPanelEditableSelection,
  saveAiPanelEditableSelection,
  shouldTriggerAiPanelCommandPopupForPendingSlash,
  shouldTriggerAiPanelCommandPopupForSlash
} from '@/services/aiPanelEditableSelectionRuntime'

const createEditable = (text = 'run /') => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.textContent = text
  document.body.appendChild(editable)
  return editable
}

const setCaret = (editable: HTMLElement, offset: number) => {
  const textNode = editable.firstChild
  if (!textNode) throw new Error('missing text node')
  const range = document.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

beforeEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('aiPanelEditableSelectionRuntime', () => {
  it('saves, restores, and moves editable selections without owning editor state', () => {
    const editable = createEditable('hello world')
    const original = setCaret(editable, 5)

    const saved = saveAiPanelEditableSelection(editable)
    expect(saved?.startContainer).toBe(original.startContainer)
    expect(saved?.startOffset).toBe(5)

    setCaret(editable, 11)
    expect(restoreAiPanelEditableSelection(editable, saved)).toBe(true)
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe(5)

    const endRange = moveAiPanelEditableCaretToEnd(editable)
    expect(endRange?.startOffset).toBe(1)
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe(1)
  })

  it('falls back to saved ranges only when they belong to the editable', () => {
    const editable = createEditable('alpha')
    const other = createEditable('beta')
    const fallback = setCaret(other, 2).cloneRange()
    window.getSelection()?.removeAllRanges()

    expect(aiPanelActiveEditableRange(editable, fallback)).toBeNull()

    const ownFallback = setCaret(editable, 3).cloneRange()
    window.getSelection()?.removeAllRanges()
    expect(aiPanelActiveEditableRange(editable, ownFallback)?.startOffset).toBe(3)
    expect(restoreAiPanelEditableSelection(editable, fallback)).toBe(false)
  })

  it('detects caret context and slash command triggers for text ranges', () => {
    const editable = createEditable('run /  now')
    setCaret(editable, 5)

    expect(aiPanelCharBeforeCaret(editable)).toBe('/')
    expect(shouldTriggerAiPanelCommandPopupForSlash(editable)).toBe(true)
    expect(shouldTriggerAiPanelCommandPopupForPendingSlash(editable)).toBe(false)

    setCaret(editable, 6)
    expect(aiPanelCharBeforeCaret(editable)).toBe(' ')
    expect(shouldTriggerAiPanelCommandPopupForSlash(editable)).toBe(false)
    expect(shouldTriggerAiPanelCommandPopupForPendingSlash(editable)).toBe(true)

    const noBoundary = createEditable('run /now')
    setCaret(noBoundary, 5)
    expect(shouldTriggerAiPanelCommandPopupForSlash(noBoundary)).toBe(false)
  })

  it('detects pending slash boundaries around element-child ranges', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.append('before ')
    const chip = document.createElement('span')
    chip.textContent = ' @host'
    editable.appendChild(chip)
    editable.append(' after')
    document.body.appendChild(editable)

    const range = document.createRange()
    range.setStart(editable, 1)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(aiPanelCharBeforeCaret(editable)).toBe(' ')
    expect(shouldTriggerAiPanelCommandPopupForPendingSlash(editable)).toBe(true)
  })
})
