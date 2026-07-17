import { computed } from 'vue'
import { controlClient } from '@/services/app/controlClient'
import { isAiAgentSessionSource } from '@/services/ai/managedAiBackendGuards'
import { playAiNotificationSound } from '@/services/ai/notificationSoundRuntime'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import type { ControlNotificationFocusRequest, ControlNotificationRecord } from '@shared/contracts/control'
import type { ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type {
  AiAttentionInput,
  AiAttentionItem,
  AiAttentionKind,
  WorkspaceManagedAiControllerState
} from '@/services/ai/workspaceManagedAiTypes'

export type WorkspaceManagedAiAttentionRuntime = ReturnType<typeof createWorkspaceManagedAiAttentionRuntime>

const attentionPriority = (kind: AiAttentionKind) => {
  if (kind === 'approval') return 100
  if (kind === 'question') return 90
  if (kind === 'plan') return 80
  if (kind === 'error') return 70
  return 40
}

const controlNotificationAttentionId = (notification: Pick<ControlNotificationRecord, 'id'>) => `notification:${notification.id}`

const sameAiAttentionItem = (first: AiAttentionItem, second: AiAttentionItem) =>
  first.id === second.id &&
  first.source === second.source &&
  first.kind === second.kind &&
  first.title === second.title &&
  first.summary === second.summary &&
  first.priority === second.priority &&
  first.createdAt === second.createdAt &&
  first.conversationId === second.conversationId &&
  first.sessionId === second.sessionId &&
  first.surfaceId === second.surfaceId &&
  first.notificationId === second.notificationId &&
  first.handledAt === second.handledAt

const managedAiNotificationPartsFromId = (id?: string) => {
  if (!id) return null
  const match = id.match(/^managed-ai:([^:]+):(.+)$/)
  const source = match?.[1]
  const sessionId = match?.[2]
  if (!source || !sessionId || !isAiAgentSessionSource(source)) return null
  return { source, sessionId }
}

export const createWorkspaceManagedAiAttentionRuntime = (input: {
  state: Pick<
    WorkspaceManagedAiControllerState,
    'mode' | 'activeModule' | 'activePanelId' | 'panels' | 'notificationSettings' | 'aiAttentionItems' | 'controlNotifications'
  >
  setTopNotice: (message: string) => void
  focusManagedAiSession?: (request: ManagedAiSessionFocusRequest) => boolean
}) => {
  const { state, setTopNotice } = input
  const { mode, activeModule, activePanelId, panels, notificationSettings, aiAttentionItems, controlNotifications } = state

  const pendingAiAttentionItems = computed(() =>
    [...aiAttentionItems.value]
      .filter((item) => !item.handledAt)
      .sort((first, second) => {
        if (second.priority !== first.priority) return second.priority - first.priority
        return first.createdAt - second.createdAt
      })
  )
  const aiAttentionUnreadCount = computed(() => pendingAiAttentionItems.value.length)
  const currentAiAttentionItem = computed(() => pendingAiAttentionItems.value[0] || null)

  const upsertAiAttentionItem = (input: AiAttentionInput) => {
    const title = input.title.trim()
    const summary = input.summary.trim()
    const existing = aiAttentionItems.value.find((item) => item.id === input.id)
    const handledAt = 'handledAt' in input ? input.handledAt : undefined
    const next: AiAttentionItem = {
      id: input.id,
      source: input.source,
      kind: input.kind,
      title: title || input.source,
      summary,
      priority: input.priority ?? attentionPriority(input.kind),
      createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
      ...(handledAt ? { handledAt } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
      ...(input.notificationId ? { notificationId: input.notificationId } : {})
    }
    const shouldPlaySound = !next.handledAt && (!existing || Boolean(existing.handledAt))
    if (existing && sameAiAttentionItem(existing, next)) return existing
    aiAttentionItems.value = existing ? aiAttentionItems.value.map((item) => (item.id === input.id ? next : item)) : [next, ...aiAttentionItems.value]
    if (shouldPlaySound) playAiNotificationSound(notificationSettings.value, { title: next.title, summary: next.summary })
    return next
  }

  const removeAiAttentionItem = (id: string) => {
    if (!aiAttentionItems.value.some((item) => item.id === id)) return false
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.id !== id)
    return true
  }

  const markAiAttentionHandled = (id: string) => {
    let changed = false
    aiAttentionItems.value = aiAttentionItems.value.map((item) => {
      if (item.id !== id || item.handledAt) return item
      changed = true
      return { ...item, handledAt: Date.now() }
    })
    return changed
  }

  const clearAiAttentionForConversation = (conversationId: string) => {
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.conversationId !== conversationId)
  }

  const refreshControlNotificationAttentionItems = () => {
    const notificationIds = new Set(controlNotifications.value.map(controlNotificationAttentionId))
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => !item.id.startsWith('notification:') || notificationIds.has(item.id))
    if (!notificationSettings.value.controlNotificationBell) {
      controlNotifications.value.forEach((notification) => removeAiAttentionItem(controlNotificationAttentionId(notification)))
      return
    }
    controlNotifications.value.forEach((notification) => {
      const id = controlNotificationAttentionId(notification)
      if (!notification.read) {
        upsertAiAttentionItem({
          id,
          source: 'control-notification',
          kind: notification.level === 'approval' ? 'approval' : notification.level === 'error' || notification.level === 'warning' ? 'error' : 'done',
          title: notification.source ? `${notification.source}: ${notification.title}` : notification.title,
          summary: [notification.group, notification.level && notification.level !== 'info' ? notification.level : '', notification.subtitle, notification.body].filter(Boolean).join(' · '),
          sessionId: notification.sessionId || notification.terminalSessionId,
          surfaceId: notification.panelId || notification.sessionId || notification.terminalSessionId,
          notificationId: notification.id,
          createdAt: notification.createdAt,
          priority: notification.level === 'approval' || notification.level === 'error' ? 60 : notification.level === 'warning' ? 45 : 30
        })
      } else {
        removeAiAttentionItem(id)
      }
    })
  }

  const applyControlNotificationSnapshot = (notifications: ControlNotificationRecord[] = []) => {
    controlNotifications.value = notifications.map((notification) => ({ ...notification }))
    refreshControlNotificationAttentionItems()
  }

  const managedAiFocusRequestForControlNotification = (
    request: ControlNotificationFocusRequest | ControlNotificationRecord,
    notification: ControlNotificationRecord
  ): ManagedAiSessionFocusRequest | null => {
    const parsed = managedAiNotificationPartsFromId(notification.id) || managedAiNotificationPartsFromId(notification.key)
    const source = parsed?.source || (isAiAgentSessionSource(notification.source) ? notification.source : undefined)
    if (!source && !parsed?.sessionId) return null
    const panelId = 'panelId' in request && request.panelId ? request.panelId : notification.panelId
    const sessionId = parsed?.sessionId || ('sessionId' in request && request.sessionId ? request.sessionId : notification.sessionId)
    const terminalSessionId = 'terminalSessionId' in request && request.terminalSessionId ? request.terminalSessionId : notification.terminalSessionId
    return {
      ...(source ? { source } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(panelId ? { panelId } : {}),
      ...(terminalSessionId ? { terminalSessionId } : {})
    }
  }

  const focusControlNotification = (request: ControlNotificationFocusRequest | ControlNotificationRecord) => {
    const notification = 'notification' in request ? request.notification : request
    const managedAiFocusRequest = managedAiFocusRequestForControlNotification(request, notification)
    if (managedAiFocusRequest && input.focusManagedAiSession?.(managedAiFocusRequest)) {
      markAiAttentionHandled(controlNotificationAttentionId(notification))
      setTopNotice(`已定位通知：${notification.title}`)
      return true
    }
    const panelId = 'panelId' in request && request.panelId ? request.panelId : notification.panelId
    const sessionId = 'sessionId' in request && request.sessionId ? request.sessionId : notification.sessionId || notification.terminalSessionId
    const target = panels.value.find((panel) => isTerminalWorkspacePanel(panel) && (panel.id === panelId || panel.sessionId === sessionId))
    if (!target) {
      setTopNotice(`通知已打开：${notification.title}`)
      return false
    }
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    markAiAttentionHandled(controlNotificationAttentionId(notification))
    setTopNotice(`已定位通知：${notification.title}`)
    return true
  }

  const openControlNotification = async (notificationId: string) => {
    const bridge = controlClient.invokeControlRequest()
    if (!bridge) {
      const notification = controlNotifications.value.find((item) => item.id === notificationId)
      if (notification) return focusControlNotification(notification)
      return false
    }
    try {
      const result = await bridge('notification.open', { id: notificationId })
      if (!result?.ok) {
        setTopNotice(result?.errorMessage || '通知打开失败')
        return false
      }
      const data = result.data || {}
      if (Array.isArray(data.notifications)) applyControlNotificationSnapshot(data.notifications as ControlNotificationRecord[])
      const focusRequest = data.focusRequest as ControlNotificationFocusRequest | undefined
      if (focusRequest?.notification) focusControlNotification(focusRequest)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '通知打开失败')
      return false
    }
  }

  return {
    pendingAiAttentionItems,
    aiAttentionUnreadCount,
    currentAiAttentionItem,
    upsertAiAttentionItem,
    removeAiAttentionItem,
    markAiAttentionHandled,
    clearAiAttentionForConversation,
    refreshControlNotificationAttentionItems,
    applyControlNotificationSnapshot,
    focusControlNotification,
    openControlNotification
  }
}
