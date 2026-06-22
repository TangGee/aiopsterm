import type { Ref } from 'vue'
import type { AiPanelMode } from '@/services/aiPanelModeRuntime'
import {
  aiPanelDropEffect,
  canAcceptAiPanelDrop,
  planAiPanelDrop,
  type AiPanelDragDataTransfer
} from '@/services/aiPanelMediaRuntime'
import type { AiChatContextUsageSnapshot, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContextUsageDisplay = Pick<AiChatContextUsageSnapshot, 'used' | 'contextWindow' | 'percent'>

export const emptyAiPanelContextUsageDisplay = (): AiPanelContextUsageDisplay => ({
  used: 0,
  contextWindow: 0,
  percent: 0
})

export const aiPanelContextUsageDisplay = (
  usage: Pick<AiChatContextUsageSnapshot, 'used' | 'contextWindow' | 'percent'> | null | undefined
): AiPanelContextUsageDisplay => {
  if (!usage) return emptyAiPanelContextUsageDisplay()
  return {
    used: usage.used,
    contextWindow: usage.contextWindow,
    percent: usage.percent
  }
}

export const aiPanelContextUsageColor = (usage: Pick<AiPanelContextUsageDisplay, 'percent'>) => {
  if (usage.percent >= 90) return '#ef4444'
  if (usage.percent >= 70) return '#f59e0b'
  return '#3b82f6'
}

export const aiPanelContextUsageTrackColor = () => 'rgba(128, 128, 128, 0.2)'

const formatContextUsageValue = (value: number) => {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return `${value}`
}

export const aiPanelContextUsageTooltip = (usage: AiPanelContextUsageDisplay) =>
  `${usage.percent}% - ${formatContextUsageValue(usage.used)} / ${formatContextUsageValue(usage.contextWindow)} context used`

export const aiPanelDragLeaveKeepsDropActive = (currentTarget: EventTarget | null, relatedTarget: EventTarget | null) => {
  const target = currentTarget instanceof HTMLElement ? currentTarget : null
  const related = relatedTarget instanceof Node ? relatedTarget : null
  return Boolean(target && related && target.contains(related))
}

export type AiPanelSurfaceRuntimeState = {
  dropActive: Ref<boolean>
  inputPlaceholderNotice: Ref<string>
}

export type AiPanelSurfaceRuntimeOptions<Panel extends { id: string; sessionId?: string | null }> = {
  state: AiPanelSurfaceRuntimeState
  mode: () => AiPanelMode
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
  requestFrame: (callback: () => void) => number
  setNoticeTimer: (callback: () => void, delay: number) => number
  clearNoticeTimer: (timer: number) => void
}

export const createAiPanelSurfaceRuntime = <Panel extends { id: string; sessionId?: string | null }>(options: AiPanelSurfaceRuntimeOptions<Panel>) => {
  let inputPlaceholderNoticeTimer: number | undefined

  const canAcceptDrop = (event: Pick<DragEvent, 'dataTransfer'>) => canAcceptAiPanelDrop(options.mode(), event.dataTransfer as AiPanelDragDataTransfer)

  const handleDragEnter = (event: Pick<DragEvent, 'dataTransfer'>) => {
    if (canAcceptDrop(event)) options.state.dropActive.value = true
  }

  const handleDragOver = (event: Pick<DragEvent, 'dataTransfer'>) => {
    if (!canAcceptDrop(event)) return
    options.state.dropActive.value = true
    if (event.dataTransfer) event.dataTransfer.dropEffect = aiPanelDropEffect(options.mode())
  }

  const handleDragLeave = (event: Pick<DragEvent, 'currentTarget' | 'relatedTarget'>) => {
    if (!aiPanelDragLeaveKeepsDropActive(event.currentTarget, event.relatedTarget)) {
      options.state.dropActive.value = false
    }
  }

  const handleClassicDrop = async (event: Pick<DragEvent, 'dataTransfer'>) => {
    const plan = planAiPanelDrop('classic', event.dataTransfer as AiPanelDragDataTransfer)
    if (plan.kind !== 'classic-knowledge') return
    await options.addKnowledgeFilesToChat([plan.relPath])
    if (!options.draftText().trim()) options.setDraft(plan.draftText)
    options.requestFrame(options.moveCaretToEnd)
    options.closePopups()
  }

  const handleCodexDrop = async (event: Pick<DragEvent, 'dataTransfer'>) => {
    const plan = planAiPanelDrop('codex', event.dataTransfer as AiPanelDragDataTransfer)
    if (plan.kind === 'codex-terminal') {
      const panel = options.panels().find((item) => item.id === plan.panelId)
      if (panel?.sessionId) await options.bindTerminalPanelToCodex(panel, 'drop-terminal-tab')
      return
    }
    if (plan.kind === 'codex-host') await options.bindHostContextToCodex(plan.context)
  }

  const handleDrop = async (event: Pick<DragEvent, 'dataTransfer'>) => {
    options.state.dropActive.value = false
    if (options.mode() === 'codex') {
      await handleCodexDrop(event)
      return
    }
    await handleClassicDrop(event)
  }

  const showInputPlaceholderNotice = (message: string) => {
    options.state.inputPlaceholderNotice.value = message
    if (inputPlaceholderNoticeTimer !== undefined) options.clearNoticeTimer(inputPlaceholderNoticeTimer)
    inputPlaceholderNoticeTimer = options.setNoticeTimer(() => {
      options.state.inputPlaceholderNotice.value = ''
      inputPlaceholderNoticeTimer = undefined
    }, 2400)
  }

  const clearInputPlaceholderNoticeTimer = () => {
    if (inputPlaceholderNoticeTimer === undefined) return
    options.clearNoticeTimer(inputPlaceholderNoticeTimer)
    inputPlaceholderNoticeTimer = undefined
  }

  const ensureAttachmentConversationId = async () => {
    const selectedConversationId = options.selectedConversationId().trim()
    if (selectedConversationId) return selectedConversationId
    const created = await options.createConversation()
    return created?.id || ''
  }

  const dispose = () => {
    clearInputPlaceholderNoticeTimer()
  }

  return {
    canAcceptDrop,
    clearInputPlaceholderNoticeTimer,
    dispose,
    ensureAttachmentConversationId,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    showInputPlaceholderNotice
  }
}
