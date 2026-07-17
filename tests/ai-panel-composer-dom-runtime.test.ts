import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiPanelComposerDomRuntime } from '@/services/ai/aiPanelComposerDomRuntime'
import type { AiPanelEditableRenderOptions } from '@/services/ai/aiPanelEditableRuntime'
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

const docContext: AiContextOption = {
  id: 'doc-1',
  kind: 'docs',
  label: 'Runbook.md',
  relPath: 'docs/runbook.md'
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

const flushDomWork = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const createHarness = (input: { clipboardHasImage?: boolean; sendResult?: boolean; additionalImageCount?: number } = {}) => {
  let selectedCommandId: string | null = null
  let selectedCommandRef: { command: string; label?: string; path?: string } | null = null
  let streaming = false
  let noModelPrompt = false
  let chatMode: 'agent' | 'cmd' | 'chat' = 'cmd'
  const calls = {
    cancelStreaming: vi.fn(async () => true),
    sendChat: vi.fn(async (_text: string, _contentParts: AiContentPart[], _mode: 'agent' | 'command' | 'chat') => input.sendResult ?? true),
    clearSelectedCommand: vi.fn(() => {
      selectedCommandId = null
      selectedCommandRef = null
    }),
    removeContext: vi.fn(),
    insertPastedImage: vi.fn(),
    closePopups: vi.fn(),
    notify: vi.fn(),
    afterDomUpdate: vi.fn(() => Promise.resolve()),
    afterInputSync: vi.fn(() => Promise.resolve()),
    requestFrame: vi.fn((callback: () => void) => {
      callback()
      return 1
    })
  }
  const runtime = createAiPanelComposerDomRuntime({
    renderOptions: () => renderOptions,
    selectedCommandId: () => selectedCommandId,
    selectedCommandRef: () => selectedCommandRef,
    contextById: (id) => (id === docContext.id ? docContext : null),
    streaming: () => streaming,
    noModelPrompt: () => noModelPrompt,
    chatMode: () => chatMode,
    agentMode: () => false,
    clipboardHasImage: () => Boolean(input.clipboardHasImage),
    cancelStreaming: calls.cancelStreaming,
    sendChat: calls.sendChat,
    clearSelectedCommand: calls.clearSelectedCommand,
    removeContext: calls.removeContext,
    insertPastedImage: calls.insertPastedImage,
    closePopups: calls.closePopups,
    notify: calls.notify,
    additionalImageCount: () => input.additionalImageCount || 0,
    imageLimitMessage: () => '每条消息最多添加 5 张图片。',
    afterDomUpdate: calls.afterDomUpdate,
    afterInputSync: calls.afterInputSync,
    requestFrame: calls.requestFrame
  })
  return {
    calls,
    runtime,
    setChatMode: (mode: 'agent' | 'cmd' | 'chat') => {
      chatMode = mode
    },
    setNoModelPrompt: (value: boolean) => {
      noModelPrompt = value
    },
    setSelectedCommand: (command: { id: string; command: string; label?: string; path?: string } | null) => {
      selectedCommandId = command?.id ?? null
      selectedCommandRef = command ? { command: command.command, label: command.label, path: command.path } : null
    },
    setStreaming: (value: boolean) => {
      streaming = value
    }
  }
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe('aiPanelComposerDomRuntime', () => {
  it('renders main composer state, syncs DOM parts, and derives empty state inside one boundary', async () => {
    const editable = createEditable()
    const { runtime, setSelectedCommand } = createHarness()
    runtime.editableRef.value = editable
    setSelectedCommand({ id: 'rollback', command: '/rollback', label: 'Rollback', path: 'rollback.md' })

    runtime.setDraft('deploy')
    await flushDomWork()

    expect(editable.textContent).toContain('deploy')
    expect(editable.querySelector('.mention-chip-command')).not.toBeNull()
    expect(runtime.isEmpty({ selectedContextCount: 0, selectedCommand: null })).toBe(false)

    setCaretAtEnd(editable)
    expect(runtime.insertImageAtCursor(imagePart)).toBe(true)
    expect(runtime.insertFileChipAtCursor(docPart)).toBe(true)
    await flushDomWork()

    expect(runtime.imageInputParts.value).toEqual([imagePart])
    expect(runtime.fileInputParts.value).toEqual([docPart])
    expect(runtime.extractEditableContentParts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('deploy') }),
        imagePart,
        docPart
      ])
    )
  })

  it('routes paste and send behavior through the wrapped composer runtime', async () => {
    const editable = createEditable()
    const { calls, runtime, setChatMode, setNoModelPrompt, setStreaming } = createHarness({ clipboardHasImage: true })
    runtime.editableRef.value = editable
    runtime.setDraft('deploy')
    await flushDomWork()

    const event = pasteEvent('ignored')
    const preventDefault = vi.spyOn(event, 'preventDefault')
    runtime.aiPanelComposerRuntime.handlePaste(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(calls.insertPastedImage).toHaveBeenCalled()

    await runtime.handleSend()
    expect(calls.sendChat).toHaveBeenCalledWith('deploy', [{ type: 'text', text: 'deploy' }], 'command')
    expect(runtime.draft.value).toBe('')
    expect(calls.closePopups).toHaveBeenCalled()

    setChatMode('chat')
    runtime.setDraft('explain only')
    await flushDomWork()
    await runtime.handleSend()
    expect(calls.sendChat).toHaveBeenLastCalledWith('explain only', [{ type: 'text', text: 'explain only' }], 'chat')

    setStreaming(true)
    await runtime.handleSend()
    expect(calls.cancelStreaming).toHaveBeenCalled()

    setStreaming(false)
    setNoModelPrompt(true)
    setChatMode('agent')
    await runtime.handleSend()
    expect(calls.notify).toHaveBeenCalledWith('请先配置可用模型。')
  })

  it('keeps five images and rejects the sixth without changing the composer', () => {
    const editable = createEditable()
    const { calls, runtime } = createHarness()
    runtime.editableRef.value = editable

    for (let index = 0; index < 5; index += 1) {
      setCaretAtEnd(editable)
      expect(runtime.insertImageAtCursor({ ...imagePart, name: `diagram-${index + 1}.png` })).toBe(true)
    }

    setCaretAtEnd(editable)
    expect(runtime.insertImageAtCursor({ ...imagePart, name: 'diagram-6.png' })).toBe(false)
    expect(runtime.imageInputParts.value).toHaveLength(5)
    expect(editable.querySelectorAll('.image-preview-wrapper')).toHaveLength(5)
    expect(calls.notify).toHaveBeenCalledWith('每条消息最多添加 5 张图片。')
  })

  it('counts selected image contexts toward the five-image composer limit', () => {
    const editable = createEditable()
    const { calls, runtime } = createHarness({ additionalImageCount: 4 })
    runtime.editableRef.value = editable

    setCaretAtEnd(editable)
    expect(runtime.insertImageAtCursor({ ...imagePart, name: 'fifth.png' })).toBe(true)
    setCaretAtEnd(editable)
    expect(runtime.insertImageAtCursor({ ...imagePart, name: 'sixth.png' })).toBe(false)

    expect(runtime.imageInputParts.value.map((part) => part.name)).toEqual(['fifth.png'])
    expect(calls.notify).toHaveBeenCalledWith('每条消息最多添加 5 张图片。')
  })

  it('owns caret helpers, trigger-token cleanup, and voice transcription insertion for the main input', async () => {
    const editable = createEditable('/')
    const { calls, runtime } = createHarness()
    runtime.editableRef.value = editable
    setCaretAtTextEnd(editable)
    runtime.saveEditableSelection()

    expect(runtime.charBeforeCaret()).toBe('/')
    expect(runtime.shouldTriggerCommandPopupForSlash()).toBe(true)
    runtime.removeTriggerToken('/')
    await flushDomWork()
    expect(runtime.draft.value).toBe('')
    expect(editable.textContent).toBe('')
    expect(runtime.shouldTriggerCommandPopupForPendingSlash()).toBe(true)

    editable.textContent = 'run /'
    setCaretAtTextEnd(editable)
    runtime.saveEditableSelection()
    expect(runtime.shouldTriggerCommandPopupFromEditableText()).toBe(true)

    runtime.appendVoiceTranscriptionToInput('rollback now')
    await flushDomWork()
    expect(runtime.draft.value).toContain('rollback now')
    expect(calls.requestFrame).toHaveBeenCalled()
  })
})
