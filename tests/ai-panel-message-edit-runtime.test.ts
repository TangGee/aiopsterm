import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiPanelChipElement, type AiPanelEditableRenderOptions } from '@/services/aiPanelEditableRuntime'
import { createAiPanelMessageEditRuntime } from '@/services/aiPanelMessageEditRuntime'
import type { AiContentPart, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

const renderOptions: AiPanelEditableRenderOptions = {
  iconMarkupByContextKind: {
    hosts: '<svg data-icon="host"></svg>',
    docs: '<svg data-icon="doc"></svg>',
    images: '<svg data-icon="image"></svg>',
    skills: '<svg data-icon="skill"></svg>',
    chats: '<svg data-icon="chat"></svg>'
  },
  commandIconMarkup: '<svg data-icon="command"></svg>'
}

const hostContext: AiContextOption = {
  id: 'host-1',
  kind: 'hosts',
  label: '10.0.0.8',
  detail: 'prod'
}

const docContext: AiContextOption = {
  id: 'doc-1',
  kind: 'docs',
  label: 'Runbook.md',
  relPath: 'docs/runbook.md'
}

const docPart: AiDocChipContentPart = {
  type: 'chip',
  chipType: 'doc',
  ref: {
    absPath: 'docs/runbook.md',
    relPath: 'docs/runbook.md',
    name: 'Runbook.md',
    type: 'file'
  }
}

const imagePart: AiImageContentPart = {
  type: 'image',
  mediaType: 'image/png',
  data: 'AAAA',
  name: 'diagram.png'
}

const createEditable = () => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  document.body.appendChild(editable)
  return editable
}

const setCaretAtEnd = (editable: HTMLElement) => {
  const range = document.createRange()
  range.selectNodeContents(editable)
  range.collapse(false)
  const selection = window.getSelection()
  if (!selection) throw new Error('Selection API is unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  editable.focus()
}

const setCaretAtTextEnd = (editable: HTMLElement) => {
  const textNode = Array.from(editable.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) as Text | undefined
  if (!textNode) {
    setCaretAtEnd(editable)
    return
  }
  const range = document.createRange()
  range.setStart(textNode, textNode.data.length)
  range.collapse(true)
  const selection = window.getSelection()
  if (!selection) throw new Error('Selection API is unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  editable.focus()
}

const pasteEvent = (text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: vi.fn(() => text)
    }
  })
  return event
}

const createHarness = (input: { clipboardHasImage?: boolean; resendResult?: boolean } = {}) => {
  const editable = createEditable()
  const calls = {
    closePopups: vi.fn(),
    openContextPopupForTarget: vi.fn(),
    insertPastedImageIntoEdit: vi.fn(),
    resendUserMessageFromParts: vi.fn(async () => input.resendResult ?? true)
  }
  const runtime = createAiPanelMessageEditRuntime({
    renderOptions: () => renderOptions,
    contextById: (id) => (id === hostContext.id ? hostContext : id === docContext.id ? docContext : null),
    clipboardHasImage: () => Boolean(input.clipboardHasImage),
    closePopups: calls.closePopups,
    openContextPopupForTarget: calls.openContextPopupForTarget,
    afterDomUpdate: () => Promise.resolve(),
    requestFrame: (callback) => {
      callback()
      return 1
    },
    fallbackEditTarget: () => editable,
    insertPastedImageIntoEdit: calls.insertPastedImageIntoEdit,
    resendUserMessageFromParts: calls.resendUserMessageFromParts
  })
  runtime.setEditEditableRef(editable)
  return { calls, editable, runtime }
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe('aiPanelMessageEditRuntime', () => {
  it('starts, renders, syncs, confirms, and cancels an editable user message', async () => {
    const { calls, editable, runtime } = createHarness()
    const parts: AiContentPart[] = [{ type: 'text', text: 'check ' }, docPart, imagePart]

    await runtime.startMessageEdit({
      id: 'user-1',
      role: 'user',
      text: 'fallback',
      contentParts: parts,
      hosts: [hostContext]
    })

    expect(calls.closePopups).toHaveBeenCalled()
    expect(runtime.editingMessageId.value).toBe('user-1')
    expect(runtime.editHostContexts.value).toEqual([hostContext])
    expect(runtime.editFileInputParts.value).toEqual([docPart])
    expect(runtime.editImageInputParts.value).toEqual([imagePart])
    expect(editable.querySelector('.mention-chip-doc')).not.toBeNull()
    expect(editable.querySelector('.image-preview-wrapper')).not.toBeNull()

    setCaretAtEnd(editable)
    runtime.handleEditEditablePaste(pasteEvent('\nnow'))
    expect(runtime.editDraft.value).toContain('check')
    expect(runtime.editDraft.value).toContain('now')

    const sent = await runtime.confirmMessageEdit()
    expect(sent).toBe(true)
    expect(calls.resendUserMessageFromParts).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('now') }),
        docPart,
        imagePart
      ]),
      [hostContext]
    )
    expect(runtime.editingMessageId.value).toBeNull()
    expect(runtime.editDraft.value).toBe('')
  })

  it('handles edit DOM removals, context insertion, image paste, and popup entry through injected dependencies', async () => {
    const imageHarness = createHarness({ clipboardHasImage: true })
    imageHarness.runtime.handleEditEditablePaste(pasteEvent('ignored'))
    expect(imageHarness.calls.insertPastedImageIntoEdit).toHaveBeenCalled()
    document.body.replaceChildren()

    const { calls, editable, runtime } = createHarness()
    await runtime.startMessageEdit({ id: 'user-1', role: 'user', text: 'edit me' })
    setCaretAtEnd(editable)

    expect(runtime.insertContextAtEditCursor(docContext)).toBe(true)
    expect(runtime.editFileInputParts.value).toEqual([docPart])

    const extraFile: AiDocChipContentPart = {
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath: '/tmp/report.md',
        name: 'Report.md',
        type: 'file'
      }
    }
    expect(runtime.insertFileChipAtEditCursor(extraFile)).toBe(true)
    expect(runtime.editFileInputParts.value).toEqual([docPart, extraFile])

    expect(runtime.insertImageAtEditCursor(imagePart)).toBe(true)
    expect(runtime.editImageInputParts.value).toEqual([imagePart])

    const removeButton = editable.querySelector<HTMLElement>('[data-remove-chip="true"]')
    if (!removeButton) throw new Error('Expected removable chip button')
    const event = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(event, 'target', { value: removeButton })
    runtime.handleEditEditableClick(event)
    expect(runtime.editFileInputParts.value).toEqual([extraFile])

    runtime.removeEditHostContext(hostContext.id)
    expect(runtime.editHostContexts.value).toEqual([])
    runtime.setEditHostContexts([hostContext])
    runtime.openEditContextPopup()
    expect(calls.openContextPopupForTarget).toHaveBeenCalledWith('edit')
  })

  it('supports command chips and edit selection helpers without leaking range ownership', async () => {
    const { editable, runtime } = createHarness()
    await runtime.startMessageEdit({ id: 'user-1', role: 'user', text: '' })
    setCaretAtEnd(editable)
    runtime.saveEditSelection()
    expect(runtime.shouldTriggerCommandPopupForPendingSlash()).toBe(true)

    await runtime.startMessageEdit({ id: 'user-1', role: 'user', text: '/' })
    setCaretAtTextEnd(editable)
    runtime.saveEditSelection()

    expect(runtime.shouldTriggerCommandPopupForSlash()).toBe(true)
    expect(runtime.charBeforeCaret()).toBe('/')

    const commandChip = {
      type: 'chip',
      chipType: 'command',
      ref: { command: '/rollback', label: 'Rollback', path: 'rollback.md' }
    } as const
    expect(runtime.insertCommandAtEditCursor(editable, commandChip)).toBe(true)
    expect(runtime.editDraft.value).toBe('')

    const chip = editable.querySelector<HTMLElement>('.mention-chip-command')
    expect(chip).not.toBeNull()
    expect(createAiPanelChipElement(commandChip, renderOptions).dataset.command).toBe('/rollback')
    expect(runtime.restoreEditInputSelection()).toBe(true)
  })
})
