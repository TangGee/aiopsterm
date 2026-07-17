import { ref, type Ref } from 'vue'
import {
  aiPanelEditablePlainText,
  extractAiPanelContentPartsFromEditable,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  removeAiPanelTokenFromEditableCursor,
  renderAiPanelMainEditableFromState,
  type AiPanelEditableRenderOptions
} from '@/services/ai/aiPanelEditableRuntime'
import {
  aiPanelCharBeforeCaret,
  moveAiPanelEditableCaretToEnd,
  restoreAiPanelEditableSelection,
  saveAiPanelEditableSelection,
  shouldTriggerAiPanelCommandPopupForPendingSlash,
  shouldTriggerAiPanelCommandPopupForSlash
} from '@/services/ai/aiPanelEditableSelectionRuntime'
import { MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE } from '@shared/chatImageAttachment'
import {
  createAiPanelComposerRuntime,
  isAiPanelComposerEmpty,
  type AiPanelComposerChatMode,
  type AiPanelComposerResponseMode
} from '@/services/ai/aiPanelComposerRuntime'
import type { AiChipContentPart, AiContentPart, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

export type AiPanelComposerDomCommandRef = { command: string; label?: string; path?: string } | null | undefined

export type AiPanelComposerDomRuntimeOptions = {
  renderOptions: () => AiPanelEditableRenderOptions
  selectedCommandId: () => string | null | undefined
  selectedCommandRef: () => AiPanelComposerDomCommandRef
  contextById: (id: string) => AiContextOption | null | undefined
  streaming: () => boolean
  noModelPrompt: () => boolean
  chatMode: () => AiPanelComposerChatMode
  agentMode: () => boolean | undefined
  clipboardHasImage: (event: ClipboardEvent) => boolean
  cancelStreaming: () => Promise<unknown>
  sendChat: (text: string, contentParts: AiContentPart[], mode: AiPanelComposerResponseMode) => Promise<boolean>
  clearSelectedCommand: () => void
  removeContext: (id: string) => void
  insertPastedImage: () => void | Promise<void>
  closePopups: () => void
  notify: (message: string) => void
  additionalImageCount?: () => number
  imageLimitMessage?: () => string
  afterDomUpdate: () => void | Promise<void>
  afterInputSync: () => void | Promise<void>
  requestFrame: (callback: () => void) => number
  shouldMoveCaretAfterRender?: () => boolean
}

export type AiPanelComposerDomStateRefs = {
  draft: Ref<string>
  editableRef: Ref<HTMLElement | null>
  fileInputParts: Ref<AiDocChipContentPart[]>
  imageInputParts: Ref<AiImageContentPart[]>
  syncingFromEditable: Ref<boolean>
}

export const createAiPanelComposerDomRuntime = (options: AiPanelComposerDomRuntimeOptions) => {
  const draft = ref('')
  const imageInputParts = ref<AiImageContentPart[]>([])
  const fileInputParts = ref<AiDocChipContentPart[]>([])
  const editableRef = ref<HTMLElement | null>(null)
  const savedRange = ref<Range | null>(null)
  const syncingFromEditable = ref(false)

  const state: AiPanelComposerDomStateRefs = {
    draft,
    editableRef,
    fileInputParts,
    imageInputParts,
    syncingFromEditable
  }

  const extractEditableContentParts = () =>
    extractAiPanelContentPartsFromEditable(editableRef.value, {
      contextById: options.contextById
    })

  const saveEditableSelection = () => {
    savedRange.value = saveAiPanelEditableSelection(editableRef.value) || savedRange.value
  }

  const moveEditableCaretToEnd = () => {
    savedRange.value = moveAiPanelEditableCaretToEnd(editableRef.value) || savedRange.value
  }

  const restoreEditableSelection = () => {
    if (restoreAiPanelEditableSelection(editableRef.value, savedRange.value)) return true
    if (!editableRef.value || !window.getSelection()) return false
    moveEditableCaretToEnd()
    return true
  }

  const renderEditableFromState = () => {
    const editable = editableRef.value
    if (!editable) return
    syncingFromEditable.value = true
    const active = document.activeElement === editable
    renderAiPanelMainEditableFromState(
      editable,
      {
        draft: draft.value,
        images: imageInputParts.value,
        files: fileInputParts.value,
        command: options.selectedCommandRef()
      },
      options.renderOptions()
    )
    if (active && (options.shouldMoveCaretAfterRender?.() ?? true)) moveEditableCaretToEnd()
    void Promise.resolve(options.afterDomUpdate()).finally(() => {
      syncingFromEditable.value = false
    })
  }

  const setDraft = (value: string) => {
    draft.value = value
    void Promise.resolve(options.afterDomUpdate()).then(renderEditableFromState)
  }

  const insertChipIntoEditableCursor = (
    editable: HTMLElement | null,
    part: AiChipContentPart,
    onInserted: () => void,
    triggerToken = '/'
  ) => insertAiPanelChipIntoEditableCursor(editable, part, options.renderOptions(), onInserted, triggerToken)

  const aiPanelComposerRuntime = createAiPanelComposerRuntime({
    editable: () => editableRef.value,
    draft: () => draft.value,
    selectedCommandId: options.selectedCommandId,
    streaming: options.streaming,
    noModelPrompt: options.noModelPrompt,
    chatMode: options.chatMode,
    agentMode: options.agentMode,
    clipboardHasImage: options.clipboardHasImage,
    extractContentParts: extractEditableContentParts,
    cancelStreaming: options.cancelStreaming,
    sendChat: options.sendChat,
    clearSelectedCommand: options.clearSelectedCommand,
    removeContext: options.removeContext,
    setDraftFromEditable: (value) => {
      draft.value = value
    },
    resetDraft: setDraft,
    setImageInputParts: (parts) => {
      imageInputParts.value = parts
    },
    setFileInputParts: (parts) => {
      fileInputParts.value = parts
    },
    saveSelection: saveEditableSelection,
    setSyncingFromEditable: (value) => {
      syncingFromEditable.value = value
    },
    afterInputSync: options.afterInputSync,
    insertPastedImage: options.insertPastedImage,
    scheduleCaretToEnd: () => options.requestFrame(moveEditableCaretToEnd),
    closePopups: options.closePopups,
    notify: options.notify
  })

  const handleEditableInput = () => aiPanelComposerRuntime.handleInput()

  const insertImageAtCursor = (part: AiImageContentPart) => {
    if (imageInputParts.value.length + (options.additionalImageCount?.() || 0) >= MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE) {
      options.notify(options.imageLimitMessage?.() || `Each message can include up to ${MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE} images.`)
      return false
    }
    return insertAiPanelImageIntoEditableCursor(editableRef.value, part, () => {
      imageInputParts.value = [...imageInputParts.value, part]
      handleEditableInput()
    })
  }

  const insertFileChipAtCursor = (part: AiDocChipContentPart) => {
    restoreEditableSelection()
    return insertChipIntoEditableCursor(editableRef.value, part, () => {
      fileInputParts.value = [...fileInputParts.value, part]
      handleEditableInput()
    }, '@')
  }

  const insertPlainTextAtCursor = (text: string) => aiPanelComposerRuntime.insertPlainTextAtCursor(text)

  const handleSend = async () => {
    await aiPanelComposerRuntime.send()
  }

  const appendVoiceTranscriptionToInput = (text: string) => {
    restoreEditableSelection()
    insertPlainTextAtCursor(text)
    options.requestFrame(moveEditableCaretToEnd)
  }

  const removeTriggerToken = (token: '@' | '/') => {
    removeAiPanelTokenFromEditableCursor(editableRef.value, savedRange, token, handleEditableInput)
  }

  const isEmpty = (input: { selectedContextCount: number; selectedCommand: unknown }) =>
    isAiPanelComposerEmpty({
      draft: draft.value,
      selectedContextCount: input.selectedContextCount,
      images: imageInputParts.value,
      files: fileInputParts.value,
      selectedCommand: input.selectedCommand
    })

  const shouldTriggerCommandPopupFromEditableText = () => /(?:^|\s)\/$/.test(aiPanelEditablePlainText(editableRef.value))

  return {
    ...state,
    aiPanelComposerRuntime,
    appendVoiceTranscriptionToInput,
    charBeforeCaret: () => aiPanelCharBeforeCaret(editableRef.value, savedRange.value),
    extractEditableContentParts,
    handleEditableInput,
    handleSend,
    insertFileChipAtCursor,
    insertImageAtCursor,
    insertPlainTextAtCursor,
    isEmpty,
    moveEditableCaretToEnd,
    removeTriggerToken,
    renderEditableFromState,
    restoreEditableSelection,
    saveEditableSelection,
    setDraft,
    shouldTriggerCommandPopupForPendingSlash: () => shouldTriggerAiPanelCommandPopupForPendingSlash(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupForSlash: () => shouldTriggerAiPanelCommandPopupForSlash(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupFromEditableText
  }
}
