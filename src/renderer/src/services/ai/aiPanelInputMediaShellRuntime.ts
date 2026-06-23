import { computed, ref } from 'vue'
import type { AiPanelAttachmentRuntimeOptions } from '@/services/ai/aiPanelAttachmentRuntime'
import { createAiPanelAttachmentRuntime } from '@/services/ai/aiPanelAttachmentRuntime'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import {
  aiPanelContextUsageColor,
  aiPanelContextUsageDisplay,
  aiPanelContextUsageTooltip,
  aiPanelContextUsageTrackColor,
  createAiPanelSurfaceRuntime
} from '@/services/ai/aiPanelSurfaceRuntime'
import type { AiPanelVoiceRuntimeOptions } from '@/services/ai/aiPanelVoiceRuntime'
import { createAiPanelVoiceRuntime } from '@/services/ai/aiPanelVoiceRuntime'
import type { AiChatContextUsageSnapshot, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'

type AiPanelAttachmentServices = Pick<
  AiPanelAttachmentRuntimeOptions,
  'showOpenDialog' | 'prepareImageFromFile' | 'prepareImageFromClipboard' | 'stageAttachment'
>

type AiPanelVoiceServices = Pick<
  AiPanelVoiceRuntimeOptions,
  'transcribeVoiceInput' | 'getMediaRecorder' | 'getUserMedia' | 'now' | 'setTimeout' | 'clearTimeout' | 'createBlob'
>

export type AiPanelInputMediaShellRuntimeOptions<Panel extends { id: string; sessionId?: string | null }> = {
  mode: () => AiPanelMode
  contextUsageSnapshot: () => Pick<AiChatContextUsageSnapshot, 'used' | 'contextWindow' | 'percent'> | null | undefined
  selectedConversationId: () => string
  panels: () => Panel[]
  createConversation: () => Promise<{ id: string } | null | undefined>
  addKnowledgeFilesToChat: (relPaths: string[]) => Promise<unknown>
  bindTerminalPanelToCodex: (panel: Panel, source: string) => Promise<unknown>
  bindHostContextToCodex: (context: AiContextOption) => Promise<unknown>
  draftText: () => string
  setDraft: (value: string) => void
  closePopups: () => void
  moveCaretToEnd: () => void
  streaming: () => boolean
  editingMessageId: () => string | null
  insertImageAtMainCursor: (part: AiImageContentPart) => boolean | void
  insertImageAtEditCursor: (part: AiImageContentPart) => boolean | void
  insertFileChipAtMainCursor: (part: AiDocChipContentPart) => boolean
  insertFileChipAtEditCursor: (part: AiDocChipContentPart) => boolean
  restoreMainSelection: () => void | boolean
  insertVoiceTranscription: (text: string) => void | Promise<void>
  afterVoiceInsert?: () => void | Promise<void>
  sendAfterVoiceTranscription: () => void | Promise<void>
  requestFrame: (callback: () => void) => number
  setNoticeTimer: (callback: () => void, delay: number) => number
  clearNoticeTimer: (timer: number) => void
  attachmentServices?: Partial<AiPanelAttachmentServices>
  voiceServices?: Partial<AiPanelVoiceServices>
}

export const createAiPanelInputMediaShellRuntime = <Panel extends { id: string; sessionId?: string | null }>(
  options: AiPanelInputMediaShellRuntimeOptions<Panel>
) => {
  const dropActive = ref(false)
  const inputPlaceholderNotice = ref('')
  const contextUsage = computed(() => aiPanelContextUsageDisplay(options.contextUsageSnapshot()))
  const contextUsageColor = computed(() => aiPanelContextUsageColor(contextUsage.value))
  const contextUsageTrackColor = computed(() => aiPanelContextUsageTrackColor())
  const contextUsageTooltip = computed(() => aiPanelContextUsageTooltip(contextUsage.value))

  const surfaceRuntime = createAiPanelSurfaceRuntime({
    state: {
      dropActive,
      inputPlaceholderNotice
    },
    mode: options.mode,
    selectedConversationId: options.selectedConversationId,
    panels: options.panels,
    createConversation: options.createConversation,
    addKnowledgeFilesToChat: options.addKnowledgeFilesToChat,
    bindTerminalPanelToCodex: options.bindTerminalPanelToCodex,
    bindHostContextToCodex: options.bindHostContextToCodex,
    draftText: options.draftText,
    setDraft: options.setDraft,
    closePopups: options.closePopups,
    moveCaretToEnd: options.moveCaretToEnd,
    requestFrame: options.requestFrame,
    setNoticeTimer: options.setNoticeTimer,
    clearNoticeTimer: options.clearNoticeTimer
  })

  const attachmentRuntime = createAiPanelAttachmentRuntime({
    streaming: options.streaming,
    editingMessageId: options.editingMessageId,
    ensureConversationId: surfaceRuntime.ensureAttachmentConversationId,
    insertImageAtMainCursor: options.insertImageAtMainCursor,
    insertImageAtEditCursor: options.insertImageAtEditCursor,
    insertFileChipAtMainCursor: options.insertFileChipAtMainCursor,
    insertFileChipAtEditCursor: options.insertFileChipAtEditCursor,
    notify: surfaceRuntime.showInputPlaceholderNotice,
    ...options.attachmentServices
  })

  const voiceRuntime = createAiPanelVoiceRuntime({
    streaming: options.streaming,
    draft: options.draftText,
    closePopups: options.closePopups,
    restoreSelection: options.restoreMainSelection,
    insertTranscription: options.insertVoiceTranscription,
    afterInsert: options.afterVoiceInsert,
    sendAfterTranscription: options.sendAfterVoiceTranscription,
    notify: surfaceRuntime.showInputPlaceholderNotice,
    ...options.voiceServices
  })

  const dispose = () => {
    surfaceRuntime.dispose()
    voiceRuntime.dispose()
  }

  return {
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    dropActive,
    inputPlaceholderNotice,
    ensureAttachmentConversationId: surfaceRuntime.ensureAttachmentConversationId,
    showInputPlaceholderNotice: surfaceRuntime.showInputPlaceholderNotice,
    insertImageFilePaths: attachmentRuntime.insertImageFilePaths,
    insertPastedImage: attachmentRuntime.insertPastedImage,
    insertPastedImageIntoEdit: attachmentRuntime.insertPastedImageIntoEdit,
    openImagePicker: attachmentRuntime.openImagePicker,
    handleFileUpload: attachmentRuntime.handleFileUpload,
    voiceRecording: voiceRuntime.voiceRecording,
    voiceTranscribing: voiceRuntime.voiceTranscribing,
    voiceButtonTitle: voiceRuntime.voiceButtonTitle,
    toggleVoiceInput: voiceRuntime.toggleVoiceInput,
    handleDragEnter: surfaceRuntime.handleDragEnter,
    handleDragOver: surfaceRuntime.handleDragOver,
    handleDragLeave: surfaceRuntime.handleDragLeave,
    handleDrop: surfaceRuntime.handleDrop,
    dispose,
    disposeSurfaceRuntime: surfaceRuntime.dispose,
    disposeVoiceRuntime: voiceRuntime.dispose
  }
}
