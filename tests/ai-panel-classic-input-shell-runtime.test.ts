import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiPanelClassicInputShellRuntime } from '@/services/ai/aiPanelClassicInputShellRuntime'
import { createEmptyAiPanelPopupInteractionState } from '@/services/ai/aiPanelPopupInteractionRuntime'
import type { AiPanelEditableRenderOptions } from '@/services/ai/aiPanelEditableRuntime'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import type { AiCommandCatalogOption, AiContentPart, AiContextOption } from '@shared/contracts/aiChat'
import type { ChatAttachmentStageResult } from '@shared/contracts/localFiles'

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

const rollbackCommand: AiCommandCatalogOption = {
  id: 'rollback',
  name: 'Rollback',
  label: 'Rollback',
  command: '/rollback',
  path: 'rollback.md'
}

const stagedAttachment = (taskId: string, srcAbsPath: string): ChatAttachmentStageResult => {
  const name = srcAbsPath.split('/').pop() || 'task.log'
  return {
    mode: 'local',
    taskId,
    srcAbsPath,
    refPath: `aiopsterm://chat-attachment/${taskId}/${name}`,
    name,
    size: 128,
    stagedPath: `/tmp/aiopsterm/chat-attachments/${taskId}/${name}`
  }
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

const keyEvent = (key: string, input: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...input
  }) as unknown as KeyboardEvent

const flushDomWork = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const createHarness = () => {
  const popupState = createEmptyAiPanelPopupInteractionState()
  let aiPanelMode: AiPanelMode = 'classic'
  let selectedContexts: AiContextOption[] = []
  let selectedCommandId: string | null = null
  let selectedCommandRef: { command: string; label?: string; path?: string } | null = null
  let selectedCommand: AiCommandCatalogOption | null = null
  const calls = {
    removeContext: vi.fn(),
    selectCommandPreset: vi.fn((id: string | null, commandRef?: { command: string; label: string; path: string }) => {
      selectedCommandId = id
      selectedCommandRef = commandRef ?? null
      selectedCommand = id ? rollbackCommand : null
    }),
    cancelStreaming: vi.fn(async () => true),
    sendChat: vi.fn(async (_text: string, _parts: AiContentPart[]) => true),
    resendUserMessageFromParts: vi.fn(async () => true),
    createConversation: vi.fn(async () => ({ id: 'chat-1' })),
    addKnowledgeFilesToChat: vi.fn(async () => true),
    bindTerminalPanelToCodex: vi.fn(async () => true),
    bindHostContextToCodex: vi.fn(async () => true),
    closeModeMenu: vi.fn(),
    closeModelMenu: vi.fn(),
    closeCodexTargetPicker: vi.fn(),
    closeMoreActionsMenu: vi.fn(),
    closePanelModeMenu: vi.fn(),
    closeHistoryMenu: vi.fn(),
    openChatSearch: vi.fn(),
    closeChatSearch: vi.fn(),
    refreshAiContextCatalog: vi.fn(async () => true),
    refreshAiCommandCatalog: vi.fn(async () => true),
    afterDomUpdate: vi.fn(() => Promise.resolve()),
    defer: vi.fn((callback: () => void) => callback()),
    setNoticeTimer: vi.fn((_callback: () => void) => {
      return 1
    }),
    clearNoticeTimer: vi.fn(),
    focusInputForTarget: vi.fn(),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/tmp/task.log'] }),
    stageAttachment: vi.fn(async ({ taskId, srcAbsPath }) => stagedAttachment(taskId, srcAbsPath))
  }
  const runtime = createAiPanelClassicInputShellRuntime<{ id: string; sessionId?: string | null }, string>({
    renderOptions: () => renderOptions,
    selectedCommandId: () => selectedCommandId,
    selectedCommandRef: () => selectedCommandRef,
    selectedCommand: () => selectedCommand,
    contextById: (id) => (id === hostContext.id ? hostContext : id === docContext.id ? docContext : null),
    selectedContexts: () => selectedContexts,
    setSelectedContexts: (contexts) => {
      selectedContexts = contexts
    },
    removeContext: calls.removeContext,
    clearSelectedCommand: () => calls.selectCommandPreset(null),
    selectCommandPreset: calls.selectCommandPreset,
    streaming: () => false,
    noModelPrompt: () => false,
    chatMode: () => 'agent',
    agentMode: () => false,
    clipboardHasImage: () => false,
    cancelStreaming: calls.cancelStreaming,
    sendChat: calls.sendChat,
    resendUserMessageFromParts: calls.resendUserMessageFromParts,
    aiPanelMode: () => aiPanelMode,
    contextUsageSnapshot: () => ({ used: 1000, contextWindow: 10000, percent: 10 }),
    selectedConversationId: () => '',
    panels: () => [{ id: 'panel-1', sessionId: 'session-1' }],
    createConversation: calls.createConversation,
    addKnowledgeFilesToChat: calls.addKnowledgeFilesToChat,
    bindTerminalPanelToCodex: calls.bindTerminalPanelToCodex,
    bindHostContextToCodex: calls.bindHostContextToCodex,
    popupState,
    maxHostContexts: 2,
    modelMenuOpen: () => false,
    closeModeMenu: calls.closeModeMenu,
    closeModelMenu: calls.closeModelMenu,
    closeCodexTargetPicker: calls.closeCodexTargetPicker,
    closeMoreActionsMenu: calls.closeMoreActionsMenu,
    closePanelModeMenu: calls.closePanelModeMenu,
    closeHistoryMenu: calls.closeHistoryMenu,
    openChatSearch: calls.openChatSearch,
    closeChatSearch: calls.closeChatSearch,
    chatSearchOpen: () => false,
    refreshAiContextCatalog: calls.refreshAiContextCatalog,
    refreshAiCommandCatalog: calls.refreshAiCommandCatalog,
    visibleHostContexts: () => [hostContext],
    displayedOpenedHosts: () => [hostContext],
    visibleContextCategories: () => [{ id: 'docs', label: 'Docs', options: [docContext], icon: 'docs-icon' }],
    filteredContextOptions: () => [docContext],
    filteredCommands: () => [rollbackCommand],
    afterDomUpdate: calls.afterDomUpdate,
    defer: calls.defer,
    requestFrame: (callback) => {
      callback()
      return 1
    },
    setNoticeTimer: calls.setNoticeTimer,
    clearNoticeTimer: calls.clearNoticeTimer,
    fallbackEditTarget: () => null,
    focusInputForTarget: calls.focusInputForTarget,
    attachmentServices: {
      showOpenDialog: () => calls.showOpenDialog,
      stageAttachment: () => calls.stageAttachment
    },
    voiceServices: {
      getMediaRecorder: () => undefined
    }
  })

  return {
    calls,
    popupState,
    runtime,
    selectedContexts: () => selectedContexts,
    selectedCommandRef: () => selectedCommandRef,
    setAiPanelMode: (mode: AiPanelMode) => {
      aiPanelMode = mode
    }
  }
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe('aiPanelClassicInputShellRuntime', () => {
  it('composes main composer, command selection, and send through one input boundary', async () => {
    const { calls, runtime, selectedCommandRef } = createHarness()
    const editable = createEditable()
    runtime.editableRef.value = editable

    runtime.setDraft('deploy /')
    await flushDomWork()
    setCaretAtEnd(editable)

    runtime.applyCommand(rollbackCommand)
    await flushDomWork()
    expect(calls.selectCommandPreset).toHaveBeenCalledWith('rollback', {
      command: '/rollback',
      label: 'Rollback',
      path: 'rollback.md'
    })
    expect(selectedCommandRef()).toEqual({ command: '/rollback', label: 'Rollback', path: 'rollback.md' })

    await runtime.handleSend()
    expect(calls.sendChat).toHaveBeenCalledWith(
      'deploy ',
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('deploy') }),
        expect.objectContaining({ type: 'chip', chipType: 'command' })
      ]),
      'agent'
    )
    expect(runtime.draft.value).toBe('')
  })

  it('composes context popup selection, edit message confirmation, and focus restoration', async () => {
    const { calls, popupState, runtime, selectedContexts } = createHarness()
    const mainEditable = createEditable('@')
    runtime.editableRef.value = mainEditable
    setCaretAtEnd(mainEditable)

    runtime.openContextPopup()
    await flushDomWork()
    expect(calls.refreshAiContextCatalog).toHaveBeenCalled()
    expect(popupState.contextPopupOpen).toBe(true)

    runtime.applyContext(hostContext)
    expect(selectedContexts()).toEqual([hostContext])
    expect(popupState.contextPopupOpen).toBe(false)
    expect(calls.focusInputForTarget).toHaveBeenCalledWith(
      'main',
      expect.objectContaining({
        restoreEditableSelection: expect.any(Function),
        restoreEditInputSelection: expect.any(Function)
      })
    )

    const editEditable = createEditable()
    runtime.setEditEditableRef(editEditable)
    await runtime.startMessageEdit({
      id: 'user-1',
      role: 'user',
      text: 'check',
      hosts: [hostContext]
    })
    setCaretAtEnd(editEditable)
    expect(runtime.editingMessageId.value).toBe('user-1')

    await runtime.confirmMessageEdit()
    expect(calls.resendUserMessageFromParts).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('check') })]),
      [hostContext]
    )
    expect(runtime.editingMessageId.value).toBeNull()
  })

  it('composes media upload, voice notices, panel shortcuts, and close-all menu coordination', async () => {
    const { calls, runtime } = createHarness()
    const editable = createEditable()
    runtime.editableRef.value = editable
    setCaretAtEnd(editable)
    runtime.saveEditableSelection()

    await runtime.handleFileUpload()
    expect(calls.createConversation).toHaveBeenCalled()
    expect(calls.stageAttachment).toHaveBeenCalledWith({ taskId: 'chat-1', srcAbsPath: '/tmp/task.log' })
    expect(runtime.fileInputParts.value.map((part) => part.ref.name)).toEqual(['task.log'])

    runtime.toggleVoiceInput()
    await vi.waitFor(() => expect(runtime.inputPlaceholderNotice.value).toContain('麦克风不可用'))

    runtime.handlePanelKeydown(keyEvent('f', { metaKey: true }))
    expect(calls.openChatSearch).toHaveBeenCalled()

    runtime.closePopups()
    expect(calls.closeCodexTargetPicker).toHaveBeenCalled()
    expect(calls.closeMoreActionsMenu).toHaveBeenCalled()
    expect(calls.closePanelModeMenu).toHaveBeenCalled()
    expect(calls.closeHistoryMenu).toHaveBeenCalled()
    expect(calls.closeModelMenu).toHaveBeenCalled()
  })
})
