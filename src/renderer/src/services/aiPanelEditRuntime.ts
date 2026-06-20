import {
  cloneAiContextOption,
  fallbackAiContentPartsForMessage,
  hasSendableAiContent,
  splitAiContentInputParts
} from '@/services/aiPanelInputRuntime'
import type { AiContentPart, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

export type AiPanelEditState = {
  editingMessageId: string | null
  editDraft: string
  editImageInputParts: AiImageContentPart[]
  editFileInputParts: AiDocChipContentPart[]
  editHostContexts: AiContextOption[]
}

export type AiPanelEditableMessage = {
  id: string
  role: string
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiContextOption[]
}

export const createEmptyAiPanelEditState = (): AiPanelEditState => ({
  editingMessageId: null,
  editDraft: '',
  editImageInputParts: [],
  editFileInputParts: [],
  editHostContexts: []
})

export const startAiPanelMessageEdit = (message: AiPanelEditableMessage): { state: AiPanelEditState; parts: AiContentPart[] } | null => {
  if (message.role !== 'user') return null
  const parts = fallbackAiContentPartsForMessage(message)
  const splitParts = splitAiContentInputParts(parts)
  return {
    state: {
      editingMessageId: message.id,
      editDraft: '',
      editImageInputParts: splitParts.images,
      editFileInputParts: splitParts.docs,
      editHostContexts: message.hosts?.map(cloneAiContextOption) || []
    },
    parts
  }
}

export const cancelAiPanelMessageEdit = createEmptyAiPanelEditState

export const syncAiPanelEditStateFromParts = (parts: AiContentPart[], draft: string): Pick<AiPanelEditState, 'editDraft' | 'editImageInputParts' | 'editFileInputParts'> => {
  const splitParts = splitAiContentInputParts(parts)
  return {
    editDraft: draft,
    editImageInputParts: splitParts.images,
    editFileInputParts: splitParts.docs
  }
}

export const removeAiPanelEditPartFromClickTarget = (target: HTMLElement | null | undefined) => {
  if (!target) return false
  if (target.dataset.removeImage || target.closest('[data-remove-image]')) {
    const wrapper = target.closest('.image-preview-wrapper')
    wrapper?.remove()
    return Boolean(wrapper)
  }
  if (target.dataset.removeChip || target.closest('[data-remove-chip]')) {
    const chip = target.closest('.mention-chip')
    chip?.remove()
    return Boolean(chip)
  }
  return false
}

export const prepareAiPanelMessageEditConfirmation = (
  state: Pick<AiPanelEditState, 'editingMessageId' | 'editHostContexts'>,
  contentParts: AiContentPart[]
) => {
  if (!state.editingMessageId || !hasSendableAiContent(contentParts)) return null
  return {
    messageId: state.editingMessageId,
    contentParts,
    hostContexts: state.editHostContexts.map(cloneAiContextOption)
  }
}
