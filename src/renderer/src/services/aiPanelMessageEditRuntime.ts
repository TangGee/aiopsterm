import { ref, type ComponentPublicInstance, type Ref } from 'vue'
import { aiChipPartFromContext, aiImagePartFromContext } from '@/services/aiPanelInputRuntime'
import {
  aiPanelEditablePlainText,
  extractAiPanelContentPartsFromEditable,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  insertAiPanelPlainTextIntoEditableCursor,
  removeAiPanelTokenFromEditableCursor,
  renderAiPanelPartsIntoEditable,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import {
  aiPanelCharBeforeCaret,
  moveAiPanelEditableCaretToEnd,
  restoreAiPanelEditableSelection,
  saveAiPanelEditableSelection,
  shouldTriggerAiPanelCommandPopupForPendingSlash,
  shouldTriggerAiPanelCommandPopupForSlash
} from '@/services/aiPanelEditableSelectionRuntime'
import {
  cancelAiPanelMessageEdit,
  prepareAiPanelMessageEditConfirmation,
  removeAiPanelEditPartFromClickTarget,
  startAiPanelMessageEdit,
  syncAiPanelEditStateFromParts,
  type AiPanelEditableMessage
} from '@/services/aiPanelEditRuntime'
import type { AiChipContentPart, AiContentPart, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

export type AiPanelMessageEditRuntimeOptions = {
  renderOptions: () => AiPanelEditableRenderOptions
  contextById: (id: string) => AiContextOption | null | undefined
  clipboardHasImage: (event: ClipboardEvent) => boolean
  closePopups: () => void
  openContextPopupForTarget: (target: 'edit') => void
  afterDomUpdate: () => void | Promise<void>
  requestFrame: (callback: () => void) => number
  fallbackEditTarget: () => HTMLElement | null
  insertPastedImageIntoEdit: () => void | Promise<void>
  resendUserMessageFromParts: (messageId: string, contentParts: AiContentPart[], hostContexts: AiContextOption[]) => Promise<boolean>
}

export type AiPanelMessageEditStateRefs = {
  editEditableRef: Ref<HTMLElement | null>
  editingMessageId: Ref<string | null>
  editDraft: Ref<string>
  editImageInputParts: Ref<AiImageContentPart[]>
  editFileInputParts: Ref<AiDocChipContentPart[]>
  editHostContexts: Ref<AiContextOption[]>
}

export const createAiPanelMessageEditRuntime = (options: AiPanelMessageEditRuntimeOptions) => {
  const editEditableRef = ref<HTMLElement | null>(null)
  const editSavedRange = ref<Range | null>(null)
  const editingMessageId = ref<string | null>(null)
  const editDraft = ref('')
  const editImageInputParts = ref<AiImageContentPart[]>([])
  const editFileInputParts = ref<AiDocChipContentPart[]>([])
  const editHostContexts = ref<AiContextOption[]>([])

  const state: AiPanelMessageEditStateRefs = {
    editEditableRef,
    editingMessageId,
    editDraft,
    editImageInputParts,
    editFileInputParts,
    editHostContexts
  }

  const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
    editEditableRef.value = el instanceof HTMLElement ? el : null
  }

  const editCommandTarget = () => editEditableRef.value || options.fallbackEditTarget()

  const extractContentPartsFromEdit = () =>
    extractAiPanelContentPartsFromEditable(editEditableRef.value, {
      contextById: options.contextById
    })

  const editableTextFromEdit = () => aiPanelEditablePlainText(editEditableRef.value)

  const applySyncedEditState = (parts: AiContentPart[], draft: string) => {
    const nextState = syncAiPanelEditStateFromParts(parts, draft)
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
  }

  const handleEditEditableInput = () => {
    applySyncedEditState(extractContentPartsFromEdit(), editableTextFromEdit())
    saveEditSelection()
  }

  const renderEditEditableFromParts = (parts: AiContentPart[]) => {
    const editable = editEditableRef.value
    if (!editable) return
    renderAiPanelPartsIntoEditable(editable, parts, options.renderOptions())
    applySyncedEditState(parts, aiPanelEditablePlainText(editable))
    options.requestFrame(() => {
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      editable.focus()
    })
  }

  const startMessageEdit = async (message: AiPanelEditableMessage) => {
    const edit = startAiPanelMessageEdit(message)
    if (!edit) return
    editingMessageId.value = edit.state.editingMessageId
    editDraft.value = edit.state.editDraft
    editImageInputParts.value = edit.state.editImageInputParts
    editFileInputParts.value = edit.state.editFileInputParts
    editHostContexts.value = edit.state.editHostContexts
    options.closePopups()
    await options.afterDomUpdate()
    renderEditEditableFromParts(edit.parts)
  }

  const cancelMessageEdit = () => {
    const nextState = cancelAiPanelMessageEdit()
    editingMessageId.value = nextState.editingMessageId
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    editHostContexts.value = nextState.editHostContexts
    editSavedRange.value = null
  }

  const confirmMessageEdit = async () => {
    const confirmation = prepareAiPanelMessageEditConfirmation(
      {
        editingMessageId: editingMessageId.value,
        editHostContexts: editHostContexts.value
      },
      extractContentPartsFromEdit()
    )
    if (!confirmation) return false
    const sent = await options.resendUserMessageFromParts(confirmation.messageId, confirmation.contentParts, confirmation.hostContexts)
    if (sent) cancelMessageEdit()
    return sent
  }

  const saveEditSelection = () => {
    editSavedRange.value = saveAiPanelEditableSelection(editEditableRef.value) || editSavedRange.value
  }

  const restoreEditSelection = () => {
    return restoreAiPanelEditableSelection(editEditableRef.value, editSavedRange.value)
  }

  const moveEditCaretToEnd = () => {
    editSavedRange.value = moveAiPanelEditableCaretToEnd(editEditableRef.value) || editSavedRange.value
  }

  const restoreEditInputSelection = () => {
    if (restoreEditSelection()) return true
    if (!editEditableRef.value || !window.getSelection()) return false
    moveEditCaretToEnd()
    return true
  }

  const insertImageAtEditCursor = (part: AiImageContentPart) => {
    return insertAiPanelImageIntoEditableCursor(editEditableRef.value, part, () => {
      editImageInputParts.value = [...editImageInputParts.value, part]
      handleEditEditableInput()
    })
  }

  const insertChipAtEditCursor = (
    editable: HTMLElement | null,
    part: AiChipContentPart,
    onInserted: () => void = handleEditEditableInput,
    triggerToken = '/'
  ) => insertAiPanelChipIntoEditableCursor(editable, part, options.renderOptions(), onInserted, triggerToken)

  const insertContextAtEditCursor = (context: AiContextOption) => {
    const imagePart = aiImagePartFromContext(context)
    if (imagePart) return insertImageAtEditCursor(imagePart)

    const chipPart = aiChipPartFromContext(context)
    if (!chipPart) return false
    restoreEditSelection()
    return insertChipAtEditCursor(editCommandTarget(), chipPart, handleEditEditableInput, '@')
  }

  const insertFileChipAtEditCursor = (part: AiDocChipContentPart) => {
    restoreEditSelection()
    return insertChipAtEditCursor(editCommandTarget(), part, handleEditEditableInput, '@')
  }

  const insertCommandAtEditCursor = (target: HTMLElement | null, part: AiChipContentPart) =>
    insertChipAtEditCursor(target, part, handleEditEditableInput)

  const insertPlainTextAtEditCursor = (text: string) => {
    insertAiPanelPlainTextIntoEditableCursor(editEditableRef.value, text, handleEditEditableInput)
  }

  const removeEditTriggerToken = (token: '@' | '/') => {
    removeAiPanelTokenFromEditableCursor(editEditableRef.value, editSavedRange, token, handleEditEditableInput)
  }

  const handleEditEditableClick = (event: MouseEvent) => {
    const removed = removeAiPanelEditPartFromClickTarget(event.target as HTMLElement | null)
    if (removed) {
      handleEditEditableInput()
      return
    }
    saveEditSelection()
  }

  const handleEditEditablePaste = (event: ClipboardEvent) => {
    if (options.clipboardHasImage(event)) {
      event.preventDefault()
      void options.insertPastedImageIntoEdit()
      return
    }

    event.preventDefault()
    insertPlainTextAtEditCursor(event.clipboardData?.getData('text/plain') || '')
  }

  const removeEditHostContext = (id: string) => {
    editHostContexts.value = editHostContexts.value.filter((context) => context.id !== id)
  }

  const openEditContextPopup = () => {
    options.openContextPopupForTarget('edit')
  }

  const setEditHostContexts = (contexts: AiContextOption[]) => {
    editHostContexts.value = contexts
  }

  return {
    ...state,
    cancelMessageEdit,
    charBeforeCaret: () => aiPanelCharBeforeCaret(editEditableRef.value, editSavedRange.value),
    confirmMessageEdit,
    editCommandTarget,
    handleEditEditableClick,
    handleEditEditableInput,
    handleEditEditablePaste,
    insertCommandAtEditCursor,
    insertContextAtEditCursor,
    insertFileChipAtEditCursor,
    insertImageAtEditCursor,
    moveEditCaretToEnd,
    openEditContextPopup,
    removeEditHostContext,
    removeEditTriggerToken,
    renderEditEditableFromParts,
    restoreEditInputSelection,
    restoreEditSelection,
    saveEditSelection,
    setEditEditableRef,
    setEditHostContexts,
    shouldTriggerCommandPopupForPendingSlash: () => shouldTriggerAiPanelCommandPopupForPendingSlash(editEditableRef.value, editSavedRange.value),
    shouldTriggerCommandPopupForSlash: () => shouldTriggerAiPanelCommandPopupForSlash(editEditableRef.value, editSavedRange.value),
    startMessageEdit
  }
}
