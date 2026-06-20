import { describe, expect, it } from 'vitest'
import {
  cancelAiPanelMessageEdit,
  createEmptyAiPanelEditState,
  prepareAiPanelMessageEditConfirmation,
  removeAiPanelEditPartFromClickTarget,
  startAiPanelMessageEdit,
  syncAiPanelEditStateFromParts
} from '@/services/aiPanelEditRuntime'
import type { AiContentPart, AiContextOption } from '@shared/contracts/aiChat'

const hostContext: AiContextOption = {
  id: 'host-1',
  kind: 'hosts',
  label: '10.0.0.8',
  detail: 'prod'
}

const parts: AiContentPart[] = [
  { type: 'text', text: 'check ' },
  {
    type: 'chip',
    chipType: 'doc',
    ref: {
      absPath: '/ops/runbook.md',
      relPath: 'docs/runbook.md',
      name: 'Runbook.md',
      type: 'file'
    }
  },
  {
    type: 'image',
    mediaType: 'image/png',
    data: 'AAAA',
    name: 'diagram.png'
  }
]

describe('aiPanelEditRuntime', () => {
  it('starts and cancels message edit state from user messages only', () => {
    expect(startAiPanelMessageEdit({ id: 'assistant-1', role: 'assistant', text: 'no edit' })).toBeNull()

    const edit = startAiPanelMessageEdit({
      id: 'user-1',
      role: 'user',
      text: 'fallback',
      contentParts: parts,
      hosts: [hostContext]
    })
    expect(edit).toEqual({
      parts,
      state: {
        editingMessageId: 'user-1',
        editDraft: '',
        editImageInputParts: [parts[2]],
        editFileInputParts: [parts[1]],
        editHostContexts: [hostContext]
      }
    })
    expect(edit?.state.editHostContexts[0]).not.toBe(hostContext)

    const fallbackEdit = startAiPanelMessageEdit({ id: 'user-2', role: 'user', text: 'plain fallback' })
    expect(fallbackEdit?.parts).toEqual([{ type: 'text', text: 'plain fallback' }])

    expect(cancelAiPanelMessageEdit()).toEqual(createEmptyAiPanelEditState())
  })

  it('syncs edit draft, image parts, and file parts from extracted content', () => {
    expect(syncAiPanelEditStateFromParts(parts, 'check Runbook')).toEqual({
      editDraft: 'check Runbook',
      editImageInputParts: [parts[2]],
      editFileInputParts: [parts[1]]
    })
  })

  it('removes editable image and chip elements from click targets', () => {
    const editable = document.createElement('div')
    const imageWrapper = document.createElement('span')
    imageWrapper.className = 'image-preview-wrapper'
    const imageRemove = document.createElement('button')
    imageRemove.dataset.removeImage = 'true'
    imageWrapper.appendChild(imageRemove)
    editable.appendChild(imageWrapper)

    const chip = document.createElement('span')
    chip.className = 'mention-chip'
    const chipRemove = document.createElement('button')
    chipRemove.dataset.removeChip = 'true'
    chip.appendChild(chipRemove)
    editable.appendChild(chip)

    expect(removeAiPanelEditPartFromClickTarget(imageRemove)).toBe(true)
    expect(editable.contains(imageWrapper)).toBe(false)
    expect(removeAiPanelEditPartFromClickTarget(chipRemove)).toBe(true)
    expect(editable.contains(chip)).toBe(false)
    expect(removeAiPanelEditPartFromClickTarget(editable)).toBe(false)
  })

  it('prepares confirmation payload only for sendable edit content', () => {
    expect(prepareAiPanelMessageEditConfirmation({ editingMessageId: null, editHostContexts: [hostContext] }, parts)).toBeNull()
    expect(prepareAiPanelMessageEditConfirmation({ editingMessageId: 'user-1', editHostContexts: [hostContext] }, [{ type: 'text', text: '   ' }])).toBeNull()

    const confirmation = prepareAiPanelMessageEditConfirmation({ editingMessageId: 'user-1', editHostContexts: [hostContext] }, parts)
    expect(confirmation).toEqual({
      messageId: 'user-1',
      contentParts: parts,
      hostContexts: [hostContext]
    })
    expect(confirmation?.hostContexts[0]).not.toBe(hostContext)
  })
})
