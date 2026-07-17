import { codexTargetSignature, formatCodexTargetEvent, type CodexTargetEventKind } from '@/services/ai/codexTargetRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { CodexSessionExitEvent, CodexSessionInfo, CodexSessionLifecycleEvent, CodexSessionTargetContext } from '@shared/contracts/codexSessions'

export type AiPanelCodexConversationCore = {
  id: string
  title: string
  sessionId: string
  status: 'idle' | 'starting' | 'ready' | 'error' | 'closed'
  error: string
  boundTarget: CodexSessionTargetContext | null
  lastFitCols: number
  lastFitRows: number
  lastTargetSignature: string
  deliveredTargetSignature: string
  pendingTargetSignature: string
  pendingTargetContextActive: boolean
}

export type AiPanelCodexConversationRuntimeState = AiPanelCodexConversationCore & {
  startPromise: Promise<void> | null
}

export type AiPanelCodexConversationCloseResult<T extends { id: string }> =
  | {
      status: 'missing'
      nextConversations: T[]
      nextActiveId: string
    }
  | {
      status: 'closed-inactive'
      conversation: T
      nextConversations: T[]
      nextActiveId: string
    }
  | {
      status: 'closed-active'
      conversation: T
      nextConversation: T | null
      nextConversations: T[]
      nextActiveId: string
    }

export const terminalSettingsSignature = (settings: TerminalSettings) =>
  [
    settings.terminalType,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.cursorBlink,
    settings.cursorStyle,
    settings.scrollBack
  ].join('|')

export const codexTargetTitle = (target?: CodexSessionTargetContext | null, fallbackLabel = 'Codex CLI') =>
  target?.assetName || target?.label || target?.host || target?.sessionId || fallbackLabel

export const codexConversationTitle = (
  conversation: Pick<AiPanelCodexConversationCore, 'title' | 'boundTarget'>,
  fallbackLabel = 'Codex CLI'
) => conversation.title.trim() || codexTargetTitle(conversation.boundTarget, fallbackLabel)

export const codexAttentionId = (conversation: Pick<AiPanelCodexConversationCore, 'id'>) => `codex:${conversation.id}`

export const codexStatusLabelKey = (status: AiPanelCodexConversationCore['status']) => {
  if (status === 'starting') return 'starting'
  if (status === 'ready') return 'ready'
  if (status === 'error') return 'error'
  if (status === 'closed') return 'closed'
  return 'idle'
}

export const codexBoundTargetLabel = (target: CodexSessionTargetContext | null | undefined, fallbackLabel: string) =>
  target?.assetName || target?.label || fallbackLabel

export const codexBoundTargetDetail = (target: CodexSessionTargetContext | null | undefined, fallbackDetail: string) => {
  if (!target) return fallbackDetail
  const endpoint = target.host ? `${target.username ? `${target.username}@` : ''}${target.host}${target.port ? `:${target.port}` : ''}` : target.kind || ''
  return [endpoint, target.cwd].filter(Boolean).join(' · ') || target.sessionId || ''
}

export const createCodexConversationRecord = <T extends AiPanelCodexConversationRuntimeState>(
  id: string,
  target?: CodexSessionTargetContext | null,
  extras?: Omit<T, keyof AiPanelCodexConversationRuntimeState>
): T =>
  ({
    ...(extras || {}),
    id,
    title: '',
    sessionId: '',
    status: 'idle',
    error: '',
    boundTarget: target ? { ...target } : null,
    lastFitCols: 0,
    lastFitRows: 0,
    lastTargetSignature: '',
    deliveredTargetSignature: '',
    pendingTargetSignature: '',
    pendingTargetContextActive: false,
    startPromise: null
  }) as T

export const codexTargetContextFromPanel = (panel?: Pick<TerminalPanel, 'id' | 'sessionId' | 'title' | 'cwd' | 'sshSession'> | null): CodexSessionTargetContext => {
  const ssh = panel?.sshSession
  if (ssh) {
    return {
      kind: 'ssh',
      panelId: panel.id,
      ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
      label: ssh.assetName || panel.title || `${ssh.username}@${ssh.host}`,
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      ...(ssh.assetId ? { assetId: ssh.assetId } : {}),
      ...(ssh.connectionId ? { connectionId: ssh.connectionId } : {}),
      assetName: ssh.assetName,
      cwd: panel.cwd
    }
  }
  return {
    kind: panel?.sessionId ? 'local' : 'unknown',
    panelId: panel?.id,
    ...(panel?.sessionId ? { sessionId: panel.sessionId } : {}),
    label: panel?.title || 'Selected terminal',
    cwd: panel?.cwd
  }
}

export const currentBoundCodexTarget = <T extends Pick<TerminalPanel, 'id' | 'sessionId' | 'status' | 'title' | 'cwd' | 'sshSession'>>(
  conversation: Pick<AiPanelCodexConversationCore, 'boundTarget'> | null | undefined,
  panels: T[]
) => {
  const target = conversation?.boundTarget
  if (!target?.sessionId) return null
  const panel = panels.find((item) => item.id === target.panelId || item.sessionId === target.sessionId)
  if (!panel?.sessionId || panel.status === 'closed' || panel.status === 'error') {
    return null
  }
  return codexTargetContextFromPanel(panel)
}

export const applyCodexLifecycleEvent = (
  conversation: AiPanelCodexConversationCore,
  event: Pick<CodexSessionLifecycleEvent, 'stage' | 'message' | 'errorMessage'>,
  fallbackError: string
) => {
  if (event.stage === 'starting') conversation.status = 'starting'
  if (event.stage === 'ready') {
    conversation.status = 'ready'
    conversation.error = ''
  }
  if (event.stage === 'error') {
    conversation.status = 'error'
    conversation.error = event.errorMessage || event.message || fallbackError
  }
  if (event.stage === 'closed') {
    conversation.status = 'closed'
  }
  return conversation
}

export const applyCodexExitEvent = (conversation: AiPanelCodexConversationCore, event: Pick<CodexSessionExitEvent, 'errorCode' | 'errorMessage'>) => {
  conversation.status = event.errorCode ? 'error' : 'closed'
  if (event.errorMessage) conversation.error = event.errorMessage
  return conversation
}

export const applyCodexSessionStarted = (
  conversation: AiPanelCodexConversationCore,
  session: Pick<CodexSessionInfo, 'id' | 'lifecycle'>,
  target: CodexSessionTargetContext
) => {
  conversation.sessionId = session.id
  conversation.status = session.lifecycle?.stage === 'ready' ? 'ready' : 'starting'
  conversation.deliveredTargetSignature = codexTargetSignature(target)
  conversation.pendingTargetSignature = ''
  conversation.pendingTargetContextActive = false
  return conversation
}

export const resetCodexConversationForRestart = (conversation: AiPanelCodexConversationCore) => {
  conversation.sessionId = ''
  conversation.lastTargetSignature = ''
  conversation.status = 'idle'
  conversation.error = ''
  return conversation
}

export const applyCodexTargetBinding = (
  conversation: AiPanelCodexConversationCore,
  target: CodexSessionTargetContext,
  _options: { fallbackLabel?: string } = {}
) => {
  const previous = conversation.boundTarget
  conversation.boundTarget = { ...target }
  conversation.error = ''
  conversation.lastTargetSignature = ''
  return previous
}

export const applyCodexTargetUnbinding = (conversation: AiPanelCodexConversationCore, _fallbackLabel = 'Codex CLI') => {
  const previous = conversation.boundTarget
  conversation.boundTarget = null
  conversation.lastTargetSignature = ''
  return previous
}

export const prepareCodexTargetSync = (
  conversation: AiPanelCodexConversationCore & Pick<AiPanelCodexConversationRuntimeState, 'startPromise'>,
  target: CodexSessionTargetContext | null,
  force = false
) => {
  if (!conversation || (!conversation.sessionId && !conversation.startPromise) || !target) return null
  const signature = codexTargetSignature(target)
  if (!force && signature === conversation.lastTargetSignature) return null
  conversation.lastTargetSignature = signature
  return { target, signature }
}

export const markCodexTargetSyncFailed = (conversation: AiPanelCodexConversationCore) => {
  conversation.lastTargetSignature = ''
}

export const prepareCodexPendingTargetContext = (
  conversation: AiPanelCodexConversationCore,
  kind: CodexTargetEventKind,
  target?: CodexSessionTargetContext | null
) => {
  const nextSignature = target ? codexTargetSignature(target) : ''
  conversation.pendingTargetSignature = nextSignature
  if (nextSignature === conversation.deliveredTargetSignature) {
    conversation.pendingTargetContextActive = false
    return { text: '', clear: true }
  }
  const text = formatCodexTargetEvent(kind, target)
  conversation.pendingTargetContextActive = Boolean(text.trim())
  return { text, clear: false }
}

export const markCodexPendingTargetDelivered = (conversation: AiPanelCodexConversationCore) => {
  if (!conversation.pendingTargetContextActive) return false
  conversation.deliveredTargetSignature = conversation.pendingTargetSignature
  conversation.pendingTargetContextActive = false
  return true
}

export const closeCodexConversationRecord = <T extends { id: string }>(
  conversations: T[],
  activeId: string,
  closingId: string
): AiPanelCodexConversationCloseResult<T> => {
  const conversation = conversations.find((item) => item.id === closingId)
  if (!conversation) return { status: 'missing', nextConversations: conversations, nextActiveId: activeId }
  const currentIndex = conversations.findIndex((item) => item.id === closingId)
  const nextConversation = conversations[currentIndex + 1] || conversations[currentIndex - 1] || null
  const nextConversations = conversations.filter((item) => item.id !== closingId)
  if (activeId !== closingId) {
    return { status: 'closed-inactive', conversation, nextConversations, nextActiveId: activeId }
  }
  return {
    status: 'closed-active',
    conversation,
    nextConversation,
    nextConversations,
    nextActiveId: nextConversation?.id || nextConversations[0]?.id || ''
  }
}
