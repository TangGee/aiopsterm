import {
  aiChipPartFromContext,
  aiImagePartFromContext,
  aiPanelImagePartMediaTypes,
  editablePlainTextFromElement,
  extractEditablePlainTextFromNode,
  mergeAdjacentTextContentParts
} from '@/services/aiPanelInputRuntime'
import type {
  AiChatChipContentPart,
  AiChipContentPart,
  AiCommandChipContentPart,
  AiContentPart,
  AiContextKind,
  AiContextOption,
  AiDocChipContentPart,
  AiImageContentPart,
  AiSkillChipContentPart,
  AiSupportedImageType
} from '@shared/contracts/aiChat'

export type AiPanelChipRenderOptions = {
  removableContextId?: string
  removableCommand?: boolean
  removablePart?: boolean
}

export type AiPanelEditableRenderOptions = {
  iconMarkupByContextKind: Record<AiContextKind, string>
  commandIconMarkup: string
}

export type AiPanelEditableExtractOptions = {
  contextById?: (id: string) => AiContextOption | null | undefined
}

export const aiPanelChipLabel = (part: AiChipContentPart) => {
  if (part.chipType === 'doc') return part.ref.name || part.ref.absPath
  if (part.chipType === 'command') return part.ref.label || part.ref.command
  if (part.chipType === 'skill') return part.ref.skillName
  return part.ref.title || part.ref.taskId
}

export const createAiPanelIconElement = (kind: AiContextKind | 'command', options: AiPanelEditableRenderOptions) => {
  const span = document.createElement('span')
  span.className = 'mention-icon'
  span.innerHTML = kind === 'command' ? options.commandIconMarkup : options.iconMarkupByContextKind[kind]
  return span
}

export const setAiPanelChipElementAttributes = (chip: HTMLElement, part: AiChipContentPart) => {
  chip.dataset.chipType = part.chipType
  chip.title = aiPanelChipLabel(part)
  if (part.chipType === 'doc') {
    chip.dataset.absPath = part.ref.absPath
    if (part.ref.relPath) chip.dataset.relPath = part.ref.relPath
    if (part.ref.name) chip.dataset.name = part.ref.name
    if (part.ref.type) chip.dataset.docType = part.ref.type
    return
  }
  if (part.chipType === 'chat') {
    chip.dataset.chatId = part.ref.taskId
    if (part.ref.title) chip.dataset.title = part.ref.title
    return
  }
  if (part.chipType === 'command') {
    chip.dataset.command = part.ref.command
    if (part.ref.label) chip.dataset.label = part.ref.label
    if (part.ref.path) chip.dataset.path = part.ref.path
    return
  }
  chip.dataset.skillName = part.ref.skillName
  if (part.ref.description) chip.dataset.description = part.ref.description
}

export const createAiPanelChipElement = (
  part: AiChipContentPart,
  renderOptions: AiPanelEditableRenderOptions,
  options: AiPanelChipRenderOptions = {}
) => {
  const chip = document.createElement('span')
  chip.className = `mention-chip mention-chip-${part.chipType}`
  chip.contentEditable = 'false'
  setAiPanelChipElementAttributes(chip, part)

  if (options.removableContextId) chip.dataset.contextId = options.removableContextId
  if (options.removableCommand) chip.dataset.commandChip = 'true'

  if (part.chipType !== 'command') {
    chip.appendChild(createAiPanelIconElement(part.chipType === 'doc' ? 'docs' : part.chipType === 'chat' ? 'chats' : 'skills', renderOptions))
  }

  const label = document.createElement('span')
  label.className = 'mention-label'
  label.textContent = aiPanelChipLabel(part)
  chip.appendChild(label)

  if (options.removableContextId || options.removableCommand || options.removablePart) {
    const remove = document.createElement('button')
    remove.type = 'button'
    if (options.removableContextId) {
      remove.dataset.removeContext = 'true'
      remove.dataset.contextId = options.removableContextId
      remove.title = '移除上下文'
    } else if (options.removableCommand) {
      remove.dataset.removeCommand = 'true'
      remove.title = '移除命令'
    } else {
      remove.dataset.removeChip = 'true'
      remove.title = '移除上下文'
    }
    remove.textContent = 'x'
    chip.appendChild(remove)
  }

  return chip
}

export const createAiPanelContextChipElement = (context: AiContextOption, renderOptions: AiPanelEditableRenderOptions) => {
  const chipPart = aiChipPartFromContext(context)
  if (chipPart) return createAiPanelChipElement(chipPart, renderOptions, { removableContextId: context.id })

  const chip = document.createElement('span')
  chip.className = `mention-chip mention-chip-${context.kind}`
  chip.contentEditable = 'false'
  chip.dataset.contextId = context.id
  chip.dataset.contextKind = context.kind
  chip.title = context.detail || context.label
  chip.appendChild(createAiPanelIconElement(context.kind, renderOptions))

  if (context.kind === 'images' && context.data) {
    const image = document.createElement('img')
    image.className = 'mention-image-thumb'
    image.src = `data:${context.mediaType || 'image/png'};base64,${context.data}`
    image.alt = ''
    chip.appendChild(image)
  }

  const label = document.createElement('span')
  label.className = 'mention-label'
  label.textContent = context.label
  chip.appendChild(label)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.dataset.removeContext = 'true'
  remove.dataset.contextId = context.id
  remove.title = '移除上下文'
  remove.textContent = 'x'
  chip.appendChild(remove)

  return chip
}

export const createAiPanelCommandChipElement = (
  command: { command: string; label?: string; path?: string } | null | undefined,
  renderOptions: AiPanelEditableRenderOptions
) => {
  if (!command) return null
  return createAiPanelChipElement(
    {
      type: 'chip',
      chipType: 'command',
      ref: {
        command: command.command,
        label: command.label,
        path: command.path
      }
    },
    renderOptions,
    { removableCommand: true }
  )
}

export const createAiPanelImageElement = (part: AiImageContentPart) => {
  const wrapper = document.createElement('span')
  wrapper.className = 'image-preview-wrapper'
  wrapper.contentEditable = 'false'
  wrapper.dataset.imageType = 'true'
  wrapper.dataset.mediaType = part.mediaType
  wrapper.dataset.imageData = part.data
  if (part.name) wrapper.dataset.name = part.name

  const image = document.createElement('img')
  image.className = 'image-preview-thumbnail'
  image.src = `data:${part.mediaType};base64,${part.data}`
  image.alt = part.name || 'uploaded image'
  wrapper.appendChild(image)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'image-remove'
  remove.dataset.removeImage = 'true'
  remove.title = '移除图片'
  remove.textContent = 'x'
  wrapper.appendChild(remove)

  return wrapper
}

export const removeAiPanelTokenBeforeRange = (range: Range, token: string) => {
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return
  const textNode = range.startContainer as Text
  const offset = range.startOffset
  if (offset > 0 && textNode.data[offset - 1] === token) {
    textNode.data = textNode.data.slice(0, offset - 1) + textNode.data.slice(offset)
    range.setStart(textNode, offset - 1)
    range.collapse(true)
  }
}

export const removeAiPanelTokenFromEditableCursor = (
  editable: HTMLElement | null,
  rangeRef: { value: Range | null },
  token: string,
  onRemoved: () => void
) => {
  if (!editable) return
  const selection = window.getSelection()
  if (!selection) return
  if (rangeRef.value) {
    selection.removeAllRanges()
    selection.addRange(rangeRef.value.cloneRange())
  }
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) return
  removeAiPanelTokenBeforeRange(range, token)
  selection.removeAllRanges()
  selection.addRange(range)
  onRemoved()
}

const activeEditableRange = (editable: HTMLElement, selection: Selection | null) => {
  let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editable.contains(range.startContainer)) {
    if (!selection) return null
    const endRange = document.createRange()
    endRange.selectNodeContents(editable)
    endRange.collapse(false)
    selection.removeAllRanges()
    selection.addRange(endRange)
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  }
  return range
}

export const insertAiPanelImageIntoEditableCursor = (
  editable: HTMLElement | null,
  part: AiImageContentPart,
  onInserted: () => void
) => {
  if (!editable) return false
  editable.focus()
  const appendImageAtEnd = () => {
    editable.appendChild(createAiPanelImageElement(part))
    editable.appendChild(document.createTextNode(' '))
    onInserted()
    return true
  }

  const selection = window.getSelection()
  if (!selection) return appendImageAtEnd()
  const range = activeEditableRange(editable, selection)
  if (!range) return appendImageAtEnd()

  const imageElement = createAiPanelImageElement(part)
  range.deleteContents()
  range.insertNode(imageElement)
  const spacer = document.createTextNode(' ')
  imageElement.after(spacer)

  const nextRange = document.createRange()
  nextRange.setStart(spacer, 1)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)

  onInserted()
  return true
}

export const insertAiPanelPlainTextIntoEditableCursor = (editable: HTMLElement | null, text: string, onInserted: () => void) => {
  if (!editable || !text) return
  const selection = window.getSelection()
  if (!selection) return
  const range = activeEditableRange(editable, selection)
  if (!range) {
    editable.appendChild(document.createTextNode(text))
    onInserted()
    return
  }
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  const nextRange = document.createRange()
  nextRange.setStart(textNode, text.length)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  onInserted()
}

export const insertAiPanelChipIntoEditableCursor = (
  editable: HTMLElement | null,
  part: AiChipContentPart,
  renderOptions: AiPanelEditableRenderOptions,
  onInserted: () => void,
  triggerToken = '/'
) => {
  if (!editable) return false
  editable.focus()

  const insertAtEnd = () => {
    if (editable.lastChild) editable.appendChild(document.createTextNode(' '))
    const chip = createAiPanelChipElement(part, renderOptions, { removablePart: true })
    editable.appendChild(chip)
    editable.appendChild(document.createTextNode(' '))
    onInserted()
    return true
  }

  const selection = window.getSelection()
  if (!selection) return insertAtEnd()
  const range = activeEditableRange(editable, selection)
  if (!range) return insertAtEnd()

  removeAiPanelTokenBeforeRange(range, triggerToken)
  const chip = createAiPanelChipElement(part, renderOptions, { removablePart: true })
  range.deleteContents()
  range.insertNode(chip)
  const spacer = document.createTextNode(' ')
  chip.after(spacer)

  const nextRange = document.createRange()
  nextRange.setStart(spacer, 1)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  onInserted()
  return true
}

export const renderAiPanelPartsIntoEditable = (
  editable: HTMLElement,
  parts: AiContentPart[],
  renderOptions: AiPanelEditableRenderOptions
) => {
  editable.replaceChildren()
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      editable.appendChild(document.createTextNode(part.text))
    } else if (part.type === 'image') {
      if (index > 0) editable.appendChild(document.createTextNode(' '))
      editable.appendChild(createAiPanelImageElement(part))
      editable.appendChild(document.createTextNode(' '))
    } else {
      if (index > 0) editable.appendChild(document.createTextNode(' '))
      editable.appendChild(createAiPanelChipElement(part, renderOptions, { removablePart: true }))
      editable.appendChild(document.createTextNode(' '))
    }
  })
}

export const renderAiPanelMainEditableFromState = (
  editable: HTMLElement,
  input: {
    draft: string
    images: AiImageContentPart[]
    files: AiDocChipContentPart[]
    command: { command: string; label?: string; path?: string } | null | undefined
  },
  renderOptions: AiPanelEditableRenderOptions
) => {
  editable.replaceChildren()
  if (input.draft) editable.appendChild(document.createTextNode(input.draft))
  input.images.forEach((part) => {
    editable.appendChild(document.createTextNode(' '))
    editable.appendChild(createAiPanelImageElement(part))
    editable.appendChild(document.createTextNode(' '))
  })
  input.files.forEach((part) => {
    editable.appendChild(document.createTextNode(' '))
    editable.appendChild(createAiPanelChipElement(part, renderOptions, { removablePart: true }))
    editable.appendChild(document.createTextNode(' '))
  })
  if (input.command) {
    editable.appendChild(document.createTextNode(' '))
    const commandChip = createAiPanelCommandChipElement(input.command, renderOptions)
    if (commandChip) editable.appendChild(commandChip)
    editable.appendChild(document.createTextNode(' '))
  }
}

export const chipPartFromAiPanelChipElement = (chip: HTMLElement): AiChipContentPart | null => {
  if (chip.dataset.chipType === 'doc') {
    return {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath: chip.dataset.absPath || '',
        relPath: chip.dataset.relPath || undefined,
        name: chip.dataset.name || undefined,
        type: (chip.dataset.docType as 'file' | 'dir' | undefined) || undefined
      }
    } satisfies AiDocChipContentPart
  }
  if (chip.dataset.chipType === 'chat') {
    return {
      type: 'chip',
      chipType: 'chat',
      ref: {
        taskId: chip.dataset.chatId || '',
        title: chip.dataset.title || undefined
      }
    } satisfies AiChatChipContentPart
  }
  if (chip.dataset.chipType === 'command') {
    return {
      type: 'chip',
      chipType: 'command',
      ref: {
        command: chip.dataset.command || '',
        label: chip.dataset.label || undefined,
        path: chip.dataset.path || undefined
      }
    } satisfies AiCommandChipContentPart
  }
  if (chip.dataset.chipType === 'skill') {
    return {
      type: 'chip',
      chipType: 'skill',
      ref: {
        skillName: chip.dataset.skillName || '',
        description: chip.dataset.description || undefined
      }
    } satisfies AiSkillChipContentPart
  }
  return null
}

const contentPartFromContextChip = (chip: HTMLElement, options: AiPanelEditableExtractOptions): AiContentPart | null => {
  const contextId = chip.dataset.contextId
  const context = contextId ? options.contextById?.(contextId) : null
  if (!context) return null
  return aiImagePartFromContext(context) || aiChipPartFromContext(context)
}

export const extractAiPanelContentPartsFromNode = (node: Node, options: AiPanelEditableExtractOptions = {}): AiContentPart[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return text ? [{ type: 'text', text }] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []
  const element = node as HTMLElement
  if (element.classList.contains('mention-chip')) {
    if (element.dataset.contextId) {
      const part = contentPartFromContextChip(element, options)
      return part ? [part] : []
    }
    if (element.dataset.chipType) {
      const part = chipPartFromAiPanelChipElement(element)
      return part ? [part] : []
    }
    return []
  }
  if (element.dataset.imageType) {
    const mediaType = element.dataset.mediaType
    const data = element.dataset.imageData
    if (!mediaType || !data || !aiPanelImagePartMediaTypes.includes(mediaType as AiSupportedImageType)) return []
    return [{ type: 'image', mediaType: mediaType as AiSupportedImageType, data, name: element.dataset.name }]
  }
  if (element.tagName === 'BR') return [{ type: 'text', text: '\n' }]
  return Array.from(element.childNodes).flatMap((child) => extractAiPanelContentPartsFromNode(child, options))
}

export const extractAiPanelContentPartsFromEditable = (editable: HTMLElement | null, options: AiPanelEditableExtractOptions = {}) => {
  if (!editable) return []
  return mergeAdjacentTextContentParts(Array.from(editable.childNodes).flatMap((node) => extractAiPanelContentPartsFromNode(node, options))).filter(
    (part) => part.type !== 'text' || part.text.trim()
  )
}

export const syncAiPanelMainInputPartsFromEditable = (editable: HTMLElement | null) => {
  if (!editable) return { commandPresent: false, files: [] as AiDocChipContentPart[], images: [] as AiImageContentPart[] }
  const commandPresent = Boolean(editable.querySelector('.mention-chip[data-command-chip]'))
  const files = Array.from(editable.querySelectorAll<HTMLElement>('.mention-chip[data-chip-type="doc"]:not([data-context-id])'))
    .map(chipPartFromAiPanelChipElement)
    .filter((part): part is AiDocChipContentPart => Boolean(part && part.chipType === 'doc'))
  const images = Array.from(editable.querySelectorAll<HTMLElement>('.image-preview-wrapper[data-image-type]'))
    .map((element): AiImageContentPart | null => {
      const mediaType = element.dataset.mediaType
      const data = element.dataset.imageData
      if (!mediaType || !data || !aiPanelImagePartMediaTypes.includes(mediaType as AiSupportedImageType)) return null
      const part: AiImageContentPart = { type: 'image', mediaType: mediaType as AiSupportedImageType, data }
      if (element.dataset.name) part.name = element.dataset.name
      return part
    })
    .filter((part): part is AiImageContentPart => part !== null)
  return { commandPresent, files, images }
}

export const aiPanelEditablePlainText = editablePlainTextFromElement
export const extractAiPanelEditablePlainTextFromNode = extractEditablePlainTextFromNode
