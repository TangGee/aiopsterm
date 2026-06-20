import {
  aiPanelEditablePlainText,
  insertAiPanelPlainTextIntoEditableCursor,
  syncAiPanelMainInputPartsFromEditable
} from '@/services/aiPanelEditableRuntime'
import type { AiContentPart, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

export type AiPanelComposerChatMode = 'agent' | 'cmd'
export type AiPanelComposerResponseMode = 'agent' | 'command'

export const AI_PANEL_COMPOSER_NO_MODEL_NOTICE = '请先配置可用模型。'

export type AiPanelComposerSyncedState = {
  draft: string
  files: AiDocChipContentPart[]
  images: AiImageContentPart[]
  shouldClearCommand: boolean
}

export type AiPanelComposerClickAction =
  | { kind: 'remove-context'; contextId: string }
  | { kind: 'remove-command' }
  | { kind: 'remove-image'; removed: boolean }
  | { kind: 'remove-chip'; removed: boolean }
  | { kind: 'save-selection' }

export type AiPanelComposerSendAction =
  | { kind: 'cancel-streaming' }
  | { kind: 'notify-no-model'; message: string }
  | { kind: 'send'; mode: AiPanelComposerResponseMode }

export type AiPanelComposerRuntimeOptions = {
  editable: () => HTMLElement | null
  draft: () => string
  selectedCommandId: () => string | null | undefined
  streaming: () => boolean
  noModelPrompt: () => boolean
  chatMode: () => AiPanelComposerChatMode
  agentMode: () => boolean | undefined
  clipboardHasImage: (event: ClipboardEvent) => boolean
  extractContentParts: () => AiContentPart[]
  cancelStreaming: () => Promise<unknown>
  sendChat: (text: string, contentParts: AiContentPart[], mode: AiPanelComposerResponseMode) => Promise<boolean>
  clearSelectedCommand: () => void
  removeContext: (id: string) => void
  setDraftFromEditable: (value: string) => void
  resetDraft: (value: string) => void
  setImageInputParts: (parts: AiImageContentPart[]) => void
  setFileInputParts: (parts: AiDocChipContentPart[]) => void
  saveSelection: () => void
  setSyncingFromEditable: (value: boolean) => void
  afterInputSync: () => void | Promise<void>
  insertPastedImage: () => void | Promise<void>
  scheduleCaretToEnd: () => void
  closePopups: () => void
  notify: (message: string) => void
}

export const isAiPanelComposerEmpty = (input: {
  draft: string
  selectedContextCount: number
  images: readonly unknown[]
  files: readonly unknown[]
  selectedCommand: unknown
}) => !input.draft.trim() && input.selectedContextCount === 0 && input.images.length === 0 && input.files.length === 0 && !input.selectedCommand

export const aiPanelComposerResponseMode = (input: { chatMode: AiPanelComposerChatMode; agentMode?: boolean }): AiPanelComposerResponseMode =>
  input.chatMode === 'agent' || input.agentMode ? 'agent' : 'command'

export const planAiPanelComposerSend = (input: {
  streaming: boolean
  noModelPrompt: boolean
  chatMode: AiPanelComposerChatMode
  agentMode?: boolean
}): AiPanelComposerSendAction => {
  if (input.streaming) return { kind: 'cancel-streaming' }
  if (input.noModelPrompt) return { kind: 'notify-no-model', message: AI_PANEL_COMPOSER_NO_MODEL_NOTICE }
  return { kind: 'send', mode: aiPanelComposerResponseMode(input) }
}

export const syncAiPanelComposerStateFromEditable = (
  editable: HTMLElement | null,
  input: { selectedCommandId?: string | null } = {}
): AiPanelComposerSyncedState => {
  const parts = syncAiPanelMainInputPartsFromEditable(editable)
  return {
    draft: aiPanelEditablePlainText(editable),
    files: parts.files,
    images: parts.images,
    shouldClearCommand: Boolean(input.selectedCommandId && !parts.commandPresent)
  }
}

export const removeAiPanelComposerPartFromClickTarget = (target: HTMLElement | null | undefined): AiPanelComposerClickAction => {
  if (!target) return { kind: 'save-selection' }

  const removeContextButton = target.closest('[data-remove-context]') as HTMLElement | null
  const removeContextId = removeContextButton?.dataset.contextId
  if (removeContextId) return { kind: 'remove-context', contextId: removeContextId }

  if (target.dataset.removeCommand || target.closest('[data-remove-command]')) {
    return { kind: 'remove-command' }
  }

  if (target.dataset.removeImage || target.closest('[data-remove-image]')) {
    const wrapper = target.closest('.image-preview-wrapper')
    wrapper?.remove()
    return { kind: 'remove-image', removed: Boolean(wrapper) }
  }

  if (target.dataset.removeChip || target.closest('[data-remove-chip]')) {
    const chip = target.closest('.mention-chip')
    chip?.remove()
    return { kind: 'remove-chip', removed: Boolean(chip) }
  }

  return { kind: 'save-selection' }
}

export const createAiPanelComposerRuntime = (options: AiPanelComposerRuntimeOptions) => {
  const syncStorePartsFromEditable = () => {
    const state = syncAiPanelComposerStateFromEditable(options.editable(), {
      selectedCommandId: options.selectedCommandId()
    })
    if (state.shouldClearCommand) options.clearSelectedCommand()
    options.setFileInputParts(state.files)
    options.setImageInputParts(state.images)
    return state
  }

  const handleInput = () => {
    options.setSyncingFromEditable(true)
    const state = syncStorePartsFromEditable()
    options.setDraftFromEditable(state.draft)
    options.saveSelection()
    const done = Promise.resolve(options.afterInputSync()).finally(() => {
      options.setSyncingFromEditable(false)
    })
    void done
    return done
  }

  const insertPlainTextAtCursor = (text: string) => {
    insertAiPanelPlainTextIntoEditableCursor(options.editable(), text, handleInput)
  }

  const handleClick = (event: MouseEvent) => {
    const action = removeAiPanelComposerPartFromClickTarget(event.target as HTMLElement | null)
    if (action.kind === 'remove-context') {
      options.removeContext(action.contextId)
      options.scheduleCaretToEnd()
      return action
    }
    if (action.kind === 'remove-command') {
      options.clearSelectedCommand()
      options.scheduleCaretToEnd()
      return action
    }
    if (action.kind === 'remove-image' || action.kind === 'remove-chip') {
      void handleInput()
      options.scheduleCaretToEnd()
      return action
    }
    options.saveSelection()
    return action
  }

  const handlePaste = (event: ClipboardEvent) => {
    if (options.clipboardHasImage(event)) {
      event.preventDefault()
      void options.insertPastedImage()
      return
    }

    event.preventDefault()
    insertPlainTextAtCursor(event.clipboardData?.getData('text/plain') || '')
  }

  const send = async () => {
    const action = planAiPanelComposerSend({
      streaming: options.streaming(),
      noModelPrompt: options.noModelPrompt(),
      chatMode: options.chatMode(),
      agentMode: options.agentMode()
    })
    if (action.kind === 'cancel-streaming') {
      await options.cancelStreaming()
      return false
    }
    if (action.kind === 'notify-no-model') {
      options.notify(action.message)
      return false
    }

    const sent = await options.sendChat(options.draft(), options.extractContentParts(), action.mode)
    if (!sent) return false
    options.setImageInputParts([])
    options.setFileInputParts([])
    options.resetDraft('')
    options.closePopups()
    return true
  }

  return {
    handleClick,
    handleInput,
    handlePaste,
    insertPlainTextAtCursor,
    send,
    syncStorePartsFromEditable
  }
}
