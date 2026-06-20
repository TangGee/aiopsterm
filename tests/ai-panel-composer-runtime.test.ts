import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAiPanelChipElement,
  createAiPanelCommandChipElement,
  createAiPanelImageElement,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import {
  AI_PANEL_COMPOSER_NO_MODEL_NOTICE,
  createAiPanelComposerRuntime,
  isAiPanelComposerEmpty,
  planAiPanelComposerSend,
  removeAiPanelComposerPartFromClickTarget,
  syncAiPanelComposerStateFromEditable
} from '@/services/aiPanelComposerRuntime'
import type { AiContentPart, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

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

const docPart: AiDocChipContentPart = {
  type: 'chip',
  chipType: 'doc',
  ref: {
    absPath: '/ops/runbook.md',
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

const createEditable = (text = '') => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  if (text) editable.appendChild(document.createTextNode(text))
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

const eventWithTarget = (target: HTMLElement) => {
  const event = new MouseEvent('click', { bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
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

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe('aiPanelComposerRuntime', () => {
  it('plans empty state and send actions without depending on the Vue component', () => {
    expect(isAiPanelComposerEmpty({ draft: '  ', selectedContextCount: 0, images: [], files: [], selectedCommand: null })).toBe(true)
    expect(isAiPanelComposerEmpty({ draft: '', selectedContextCount: 1, images: [], files: [], selectedCommand: null })).toBe(false)
    expect(isAiPanelComposerEmpty({ draft: '', selectedContextCount: 0, images: [imagePart], files: [], selectedCommand: null })).toBe(false)
    expect(isAiPanelComposerEmpty({ draft: '', selectedContextCount: 0, images: [], files: [], selectedCommand: { id: 'cmd' } })).toBe(false)

    expect(planAiPanelComposerSend({ streaming: true, noModelPrompt: true, chatMode: 'cmd' })).toEqual({ kind: 'cancel-streaming' })
    expect(planAiPanelComposerSend({ streaming: false, noModelPrompt: true, chatMode: 'agent' })).toEqual({
      kind: 'notify-no-model',
      message: AI_PANEL_COMPOSER_NO_MODEL_NOTICE
    })
    expect(planAiPanelComposerSend({ streaming: false, noModelPrompt: false, chatMode: 'cmd' })).toEqual({ kind: 'send', mode: 'command' })
    expect(planAiPanelComposerSend({ streaming: false, noModelPrompt: false, chatMode: 'cmd', agentMode: true })).toEqual({
      kind: 'send',
      mode: 'agent'
    })
  })

  it('syncs draft, staged files, staged images, and stale command state from editable DOM', () => {
    const editable = createEditable(' deploy ')
    editable.appendChild(createAiPanelImageElement(imagePart))
    editable.appendChild(createAiPanelChipElement(docPart, renderOptions, { removablePart: true }))

    expect(syncAiPanelComposerStateFromEditable(editable, { selectedCommandId: 'rollback' })).toEqual({
      draft: 'deploy',
      files: [docPart],
      images: [imagePart],
      shouldClearCommand: true
    })

    const commandChip = createAiPanelCommandChipElement({ command: '/rollback', label: 'Rollback' }, renderOptions)
    if (!commandChip) throw new Error('command chip was not created')
    editable.appendChild(commandChip)
    expect(syncAiPanelComposerStateFromEditable(editable, { selectedCommandId: 'rollback' }).shouldClearCommand).toBe(false)
  })

  it('classifies removable click targets and mutates only local editable parts', () => {
    const contextChip = document.createElement('span')
    contextChip.dataset.contextId = 'ctx-1'
    const contextRemove = document.createElement('button')
    contextRemove.dataset.removeContext = 'true'
    contextRemove.dataset.contextId = 'ctx-1'
    contextChip.appendChild(contextRemove)
    expect(removeAiPanelComposerPartFromClickTarget(contextRemove)).toEqual({ kind: 'remove-context', contextId: 'ctx-1' })

    const commandRemove = document.createElement('button')
    commandRemove.dataset.removeCommand = 'true'
    expect(removeAiPanelComposerPartFromClickTarget(commandRemove)).toEqual({ kind: 'remove-command' })

    const imageElement = createAiPanelImageElement(imagePart)
    const imageRemove = imageElement.querySelector<HTMLElement>('[data-remove-image="true"]')
    if (!imageRemove) throw new Error('image remove button was not created')
    document.body.appendChild(imageElement)
    expect(removeAiPanelComposerPartFromClickTarget(imageRemove)).toEqual({ kind: 'remove-image', removed: true })
    expect(document.body.querySelector('.image-preview-wrapper')).toBeNull()

    const docChip = createAiPanelChipElement(docPart, renderOptions, { removablePart: true })
    const chipRemove = docChip.querySelector<HTMLElement>('[data-remove-chip="true"]')
    if (!chipRemove) throw new Error('chip remove button was not created')
    document.body.appendChild(docChip)
    expect(removeAiPanelComposerPartFromClickTarget(chipRemove)).toEqual({ kind: 'remove-chip', removed: true })
    expect(document.body.querySelector('.mention-chip')).toBeNull()
  })

  it('runs main composer input, paste, click, and send effects through an injected boundary', async () => {
    const editable = createEditable()
    setCaretAtEnd(editable)
    let draft = ''
    let images: AiImageContentPart[] = []
    let files: AiDocChipContentPart[] = []
    let selectedCommandId: string | null = 'rollback'
    let streaming = false
    let noModelPrompt = false
    let chatMode: 'agent' | 'cmd' = 'cmd'
    const contentParts: AiContentPart[] = [{ type: 'text', text: 'deploy' }]
    const syncEvents: boolean[] = []
    const calls = {
      cancelStreaming: vi.fn(async () => true),
      sendChat: vi.fn(async () => true),
      clearSelectedCommand: vi.fn(() => {
        selectedCommandId = null
      }),
      removeContext: vi.fn(),
      saveSelection: vi.fn(),
      insertPastedImage: vi.fn(),
      scheduleCaretToEnd: vi.fn(),
      closePopups: vi.fn(),
      notify: vi.fn()
    }
    const runtime = createAiPanelComposerRuntime({
      editable: () => editable,
      draft: () => draft,
      selectedCommandId: () => selectedCommandId,
      streaming: () => streaming,
      noModelPrompt: () => noModelPrompt,
      chatMode: () => chatMode,
      agentMode: () => false,
      clipboardHasImage: () => false,
      extractContentParts: () => contentParts,
      cancelStreaming: calls.cancelStreaming,
      sendChat: calls.sendChat,
      clearSelectedCommand: calls.clearSelectedCommand,
      removeContext: calls.removeContext,
      setDraftFromEditable: (value) => {
        draft = value
      },
      resetDraft: (value) => {
        draft = value
        editable.replaceChildren()
      },
      setImageInputParts: (parts) => {
        images = parts
      },
      setFileInputParts: (parts) => {
        files = parts
      },
      saveSelection: calls.saveSelection,
      setSyncingFromEditable: (value) => {
        syncEvents.push(value)
      },
      afterInputSync: () => Promise.resolve(),
      insertPastedImage: calls.insertPastedImage,
      scheduleCaretToEnd: calls.scheduleCaretToEnd,
      closePopups: calls.closePopups,
      notify: calls.notify
    })

    const event = pasteEvent('deploy\r\nnow')
    const preventDefault = vi.spyOn(event, 'preventDefault')
    runtime.handlePaste(event)
    await Promise.resolve()
    expect(preventDefault).toHaveBeenCalled()
    expect(editable.innerHTML).toBe('deploy<br>now')
    expect(draft).toBe('deploy\nnow')
    expect(syncEvents).toEqual([true, false])
    expect(calls.clearSelectedCommand).toHaveBeenCalledTimes(1)
    expect(images).toEqual([])
    expect(files).toEqual([])

    const contextRemove = document.createElement('button')
    contextRemove.dataset.removeContext = 'true'
    contextRemove.dataset.contextId = 'ctx-1'
    expect(runtime.handleClick(eventWithTarget(contextRemove))).toEqual({ kind: 'remove-context', contextId: 'ctx-1' })
    expect(calls.removeContext).toHaveBeenCalledWith('ctx-1')
    expect(calls.scheduleCaretToEnd).toHaveBeenCalled()

    draft = 'deploy now'
    selectedCommandId = 'rollback'
    const sent = await runtime.send()
    expect(sent).toBe(true)
    expect(calls.sendChat).toHaveBeenCalledWith('deploy now', contentParts, 'command')
    expect(draft).toBe('')
    expect(images).toEqual([])
    expect(files).toEqual([])
    expect(calls.closePopups).toHaveBeenCalled()

    streaming = true
    expect(await runtime.send()).toBe(false)
    expect(calls.cancelStreaming).toHaveBeenCalled()

    streaming = false
    noModelPrompt = true
    chatMode = 'agent'
    expect(await runtime.send()).toBe(false)
    expect(calls.notify).toHaveBeenCalledWith(AI_PANEL_COMPOSER_NO_MODEL_NOTICE)
  })
})
