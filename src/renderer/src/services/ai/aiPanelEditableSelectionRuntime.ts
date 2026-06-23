export const saveAiPanelEditableSelection = (editable: HTMLElement | null, selection: Selection | null = window.getSelection()) => {
  if (!selection || selection.rangeCount === 0 || !editable) return null
  const range = selection.getRangeAt(0)
  if (!editable.contains(range.startContainer)) return null
  return range.cloneRange()
}

export const restoreAiPanelEditableSelection = (
  editable: HTMLElement | null,
  savedRange?: Range | null,
  selection: Selection | null = window.getSelection()
) => {
  if (!editable || !selection || !savedRange || !editable.contains(savedRange.startContainer)) return false
  editable.focus()
  selection.removeAllRanges()
  selection.addRange(savedRange.cloneRange())
  return true
}

export const moveAiPanelEditableCaretToEnd = (
  editable: HTMLElement | null,
  selection: Selection | null = window.getSelection(),
  createRange: () => Range = () => document.createRange()
) => {
  if (!editable || !selection) return null
  editable.focus()
  const range = createRange()
  range.selectNodeContents(editable)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  return range.cloneRange()
}

export const aiPanelActiveEditableRange = (editable: HTMLElement | null, fallbackRange?: Range | null, selection: Selection | null = window.getSelection()) => {
  if (!editable) return null
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0)
    if (editable.contains(range.startContainer)) return range
  }
  if (fallbackRange && editable.contains(fallbackRange.startContainer)) return fallbackRange
  return null
}

export const aiPanelCharBeforeCaret = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
  const range = aiPanelActiveEditableRange(editable, fallbackRange)
  if (!range) return null
  const container = range.startContainer
  const offset = range.startOffset
  if (container.nodeType === Node.TEXT_NODE) {
    const text = (container as Text).data
    if (offset <= 0 || offset > text.length) return null
    return text[offset - 1] ?? null
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const previousNode = (container as Element).childNodes[offset - 1]
    if (!previousNode) return null
    if (previousNode.nodeType === Node.TEXT_NODE) {
      const text = (previousNode as Text).data
      return text.length > 0 ? text[text.length - 1] : null
    }
    const text = (previousNode as HTMLElement).textContent || ''
    return text.length > 0 ? text[text.length - 1] : null
  }
  return null
}

const isBoundaryOrWhitespace = (char: string | null) => char === null || /\s/.test(char)

export const shouldTriggerAiPanelCommandPopupForSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
  const range = aiPanelActiveEditableRange(editable, fallbackRange)
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return false
  const textNode = range.startContainer as Text
  const text = textNode.data
  const offset = range.startOffset
  if (offset <= 0 || offset > text.length || text[offset - 1] !== '/') return false
  const beforeChar = offset - 2 >= 0 ? text[offset - 2] : null
  const afterChar = offset < text.length ? text[offset] : null
  return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
}

export const shouldTriggerAiPanelCommandPopupForPendingSlash = (editable: HTMLElement | null, fallbackRange?: Range | null) => {
  const range = aiPanelActiveEditableRange(editable, fallbackRange)
  if (!range) return false

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = (range.startContainer as Text).data
    const offset = range.startOffset
    const beforeChar = offset - 1 >= 0 ? text[offset - 1] : null
    const afterChar = offset < text.length ? text[offset] : null
    return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as Element
    const previousNode = element.childNodes[range.startOffset - 1]
    const nextNode = element.childNodes[range.startOffset]
    const previousText = previousNode?.textContent || ''
    const nextText = nextNode?.textContent || ''
    const beforeChar = previousText ? previousText[previousText.length - 1] : null
    const afterChar = nextText ? nextText[0] : null
    return isBoundaryOrWhitespace(beforeChar) && isBoundaryOrWhitespace(afterChar)
  }

  return false
}
