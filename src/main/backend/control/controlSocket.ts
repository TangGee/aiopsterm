import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { IpcMain } from 'electron'
import type { ControlResponse } from '@shared/contracts/control'
import { platformSocketPath } from '../app/platformRuntime'
import { configureAiAgentSessionStore } from '../agent/agentSessions'
import {
  configureControlSocketAgentRuntime,
  handleAgentHooksControlRequest,
  handleAgentSessionControlRequest,
  handleFeedControlRequest,
  handleMobileChatControlRequest,
  isControlAgentHooksMethod as isAgentHooksMethod,
  isControlAgentSessionMethod as isAgentSessionMethod,
  isControlFeedMethod as isFeedMethod,
  isControlMobileChatMethod as isMobileChatMethod
} from './controlSocketAgentRuntime'
import {
  configureControlSocketCompatibilityRuntime,
  handleCloudRemotesControlRequest,
  handleCloudVmControlRequest,
  handleSidebarCustomControlRequest,
  isControlCloudRemotesMethod as isCloudRemotesMethod,
  isControlCloudVmMethod as isCloudVmMethod,
  isControlSidebarCustomMethod as isSidebarCustomMethod
} from './controlSocketCompatibilityRuntime'
import {
  agentVaultPathFor,
  configureAgentVaultRuntime,
  handleAgentVaultControlRequest,
  loadAgentVaultStore,
  prepareAgentVaultTeamLaunchParams,
  resetAgentVaultRuntimeState,
  sortedAgentVaultEntries
} from './controlSocketAgentVault'
import {
  configureControlSocketTerminalTools,
  handleTerminalBufferControlRequest,
  handleTmuxCompatControlRequest,
  listTerminalBuffers,
  listTmuxCompatHooks,
  resetControlSocketTerminalTools,
  sendTerminalKey,
  sendTerminalText,
  terminalPanelId
} from './controlSocketTerminalTools'
import {
  closeControlSocketStateRuntime,
  configureControlSocketStateRuntime,
  controlSocketEventLogPathFor as eventLogPathFor,
  controlSocketSessionSnapshotPathFor as sessionSnapshotPathFor,
  eventSubscriptionCountForTesting,
  handleMobileEventsControlRequest,
  handleSessionControlRequest,
  handleWaitForControlRequest,
  isControlEventListMethod as isEventListMethod,
  isControlEventStreamMethod as isEventStreamMethod,
  isControlMobileEventsMethod as isMobileEventsMethod,
  isControlSessionMethod as isSessionMethod,
  isControlWaitForMethod as isWaitForMethod,
  listEvents,
  listEventsForTesting,
  listMobileEventSubscriptionsForTesting,
  listSessionSnapshotsForTesting,
  loadControlSessionSnapshotStore as loadSessionSnapshotStore,
  loadControlSocketDurableEventLog as loadDurableEventLog,
  mobileEventSubscriptionCountForTesting,
  publishControlEvent,
  startEventStream
} from './controlSocketStateRuntime'
import {
  clearNotifications,
  configureControlSocketNotificationRuntime,
  createCallerNotification,
  createNotification,
  createTargetedNotification,
  dismissNotification,
  jumpToUnreadNotification,
  listNotifications,
  listNotificationsForTesting,
  markNotificationRead,
  openNotification,
  resetControlSocketNotificationRuntime
} from './controlSocketNotificationRuntime'
import {
  configureControlSocketSidebarMetadataRuntime,
  handleSidebarMetadataControlRequest,
  isControlSidebarMetadataMethod as isSidebarMetadataMethod,
  resetControlSocketSidebarMetadataRuntime
} from './controlSocketSidebarMetadataRuntime'
import {
  closePendingRendererControlRequests,
  configureControlSocketRendererRuntime,
  dispatchRendererControlRequest,
  handleControlSystemCompatibilityRequest,
  handleMobileAttachTicketControlRequest,
  handleMobileTerminalControlRequest,
  handleWindowControlRequest,
  isControlMobileAttachTicketMethod,
  isControlMobileTerminalMethod,
  isControlProjectFileMethod,
  isControlSystemCompatibilityMethod,
  pendingRendererRequestCount,
  resolvePendingRendererControlResponse,
  workspaceContextPayload,
  type ControlSocketRuntime
} from './controlSocketRendererRuntime'
import {
  configureControlSocketSystemRuntime,
  mobileHostStatus,
  systemCapabilities,
  systemIdentify
} from './controlSocketSystemRuntime'
import { publishRendererMutationEvent } from './controlSocketRendererMutationRuntime'

type ControlSocketRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
}

let server: Server | null = null
let socketPath = ''
let runtime: ControlSocketRuntime = {}
const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const socketPathFor = (userDataPath: string) => {
  return platformSocketPath(userDataPath, 'aiopsterm-control', { directory: 'control' })
}

const isAgentVaultMethod = (method: string) => method.startsWith('agent.vault.') || method.startsWith('agent-vault.')

const isTerminalBufferMethod = (method: string) =>
  method.startsWith('terminal.buffer.') ||
  method.startsWith('buffer.') ||
  ['set-buffer', 'paste-buffer', 'list-buffers', 'show-buffer', 'showb', 'save-buffer', 'saveb'].includes(method)

const isTmuxCompatMethod = (method: string) =>
  method.startsWith('tmux.') ||
  [
    'set-hook',
    'show-hooks',
    'show-options',
    'show-option',
    'show',
    'set-option',
    'set',
    'set-window-option',
    'setw',
    'source-file',
    'refresh-client',
    'attach-session',
    'detach-client',
    'popup',
    'bind-key',
    'unbind-key',
    'copy-mode'
  ].includes(method)

const handleControlRequest = async (request: ControlSocketRequest): Promise<ControlResponse> => {
  const method = cleanText(request.method)
  const params = request.params || {}
  if (!method || method === 'ping' || method === 'system.ping') return ok({ pong: true, socketPath })
  if (method === 'system.capabilities' || method === 'capabilities') return systemCapabilities()
  if (method === 'system.identify' || method === 'identify') return systemIdentify(params)
  if (method === 'workspace.context' || method === 'context') return workspaceContextPayload(params)
  if (method === 'mobile.host.status') return mobileHostStatus(params)
  if (isControlSystemCompatibilityMethod(method)) return handleControlSystemCompatibilityRequest(method, params)
  if (method.startsWith('window.')) return handleWindowControlRequest(method, params)
  if (isWaitForMethod(method)) return handleWaitForControlRequest(method, params)
  if (isSidebarCustomMethod(method)) return handleSidebarCustomControlRequest(method, params)
  if (isSidebarMetadataMethod(method)) return handleSidebarMetadataControlRequest(method, params)
  if (isTerminalBufferMethod(method)) return handleTerminalBufferControlRequest(method, params)
  if (isTmuxCompatMethod(method)) return handleTmuxCompatControlRequest(method, params)
  if (isEventListMethod(method)) return listEvents(params)
  if (isMobileEventsMethod(method)) return handleMobileEventsControlRequest(method, params)
  if (isMobileChatMethod(method)) return handleMobileChatControlRequest(method, params)
  if (isControlMobileAttachTicketMethod(method)) return handleMobileAttachTicketControlRequest(params)
  if (isFeedMethod(method)) return handleFeedControlRequest(method, params)
  if (isCloudVmMethod(method)) return handleCloudVmControlRequest(method, params)
  if (isCloudRemotesMethod(method)) return handleCloudRemotesControlRequest(method, params)
  if (isAgentHooksMethod(method)) return handleAgentHooksControlRequest(method, params)
  if (isAgentVaultMethod(method)) return handleAgentVaultControlRequest(method, params)
  if (isAgentSessionMethod(method)) return handleAgentSessionControlRequest(method, params)
  if (isSessionMethod(method)) return handleSessionControlRequest(method, params)
  if (isControlMobileTerminalMethod(method)) return handleMobileTerminalControlRequest(method, params)
  if (isControlProjectFileMethod(method)) {
    const response = await dispatchRendererControlRequest(method, params, { focus: ['project.open', 'markdown.open', 'file.open'].includes(method) && params.focus !== false })
    publishRendererMutationEvent(method, params, response)
    return response
  }
  if (
    method === 'workspace.snapshot' ||
    method === 'workspace.list' ||
    method === 'workspace.current' ||
    method.startsWith('workspace.group.') ||
    method === 'surface.list' ||
    method === 'surface.current' ||
    method.startsWith('surface.resume.') ||
    method === 'surface.focus' ||
    method === 'surface.create' ||
    method === 'surface.report_tty' ||
    method === 'surface.report_shell_state' ||
    method === 'surface.ports_kick' ||
    method === 'workspace.next' ||
    method === 'workspace.previous' ||
    method === 'workspace.last' ||
    method === 'workspace.select' ||
    method === 'workspace.find' ||
    method === 'workspace.create' ||
    method === 'workspace.rename' ||
    method === 'workspace.close' ||
    method === 'workspace.reorder' ||
    method === 'workspace.reorder_many' ||
    method === 'workspace.move_to_window' ||
    method === 'workspace.equalize_splits' ||
    method === 'workspace.prompt_submit' ||
    method === 'workspace.action' ||
    method === 'workspace.env' ||
    method === 'workspace.set_auto_title' ||
    method.startsWith('workspace.remote.') ||
    method.startsWith('remote.tmux.') ||
    method === 'workspace.has_session' ||
    method === 'workspace.select_layout' ||
    method === 'pane.list' ||
    method === 'pane.surfaces' ||
    method === 'pane.create' ||
    method === 'pane.focus' ||
    method === 'pane.last' ||
    method === 'surface.split' ||
    method === 'surface.close' ||
    method === 'surface.move' ||
    method === 'surface.reorder' ||
    method === 'surface.action' ||
    method === 'tab.action' ||
    method === 'surface.drag_to_split' ||
    method === 'surface.split_off' ||
    method === 'surface.refresh' ||
    method === 'surface.health' ||
    method === 'surface.trigger_flash' ||
    method === 'pane.break' ||
    method === 'pane.join' ||
    method === 'pane.swap' ||
    method === 'pane.resize' ||
    method.startsWith('session.') ||
    method.startsWith('agent-hibernation.') ||
    method.startsWith('agent.') ||
    method.startsWith('agent.team.') ||
    method === 'tree' ||
    method === 'top'
  ) {
    const rendererParamsOrResponse = method === 'agent.team.launch' ? await prepareAgentVaultTeamLaunchParams(params) : params
    if ('ok' in rendererParamsOrResponse && rendererParamsOrResponse.ok === false) return rendererParamsOrResponse as ControlResponse
    const rendererParams = rendererParamsOrResponse as Record<string, unknown>
    const response = await dispatchRendererControlRequest(method, rendererParams)
    publishRendererMutationEvent(method, rendererParams, response)
    return response
  }
  if (method === 'list_workspaces') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'list_surfaces') return dispatchRendererControlRequest('surface.list', params)
  if (method === 'refresh-surfaces' || method === 'refresh_surfaces') {
    const response = await dispatchRendererControlRequest('surface.refresh', params)
    publishRendererMutationEvent('surface.refresh', params, response)
    return response
  }
  if (method === 'surface-health' || method === 'surface_health') return dispatchRendererControlRequest('surface.health', params)
  if (method === 'trigger-flash' || method === 'trigger_flash') {
    const response = await dispatchRendererControlRequest('surface.trigger_flash', params, { focus: true })
    publishRendererMutationEvent('surface.trigger_flash', params, response)
    return response
  }
  if (method === 'move-surface') {
    const response = await dispatchRendererControlRequest('surface.move', params)
    publishRendererMutationEvent('surface.move', params, response)
    return response
  }
  if (method === 'reorder-surface') {
    const response = await dispatchRendererControlRequest('surface.reorder', params)
    publishRendererMutationEvent('surface.reorder', params, response)
    return response
  }
  if (method === 'split-off' || method === 'drag-surface-to-split') {
    const response = await dispatchRendererControlRequest('surface.split_off', params)
    publishRendererMutationEvent('surface.split_off', params, response)
    return response
  }
  if (method === 'reorder-workspace') {
    const response = await dispatchRendererControlRequest('workspace.reorder', params)
    publishRendererMutationEvent('workspace.reorder', params, response)
    return response
  }
  if (method === 'reorder-workspaces') {
    const response = await dispatchRendererControlRequest('workspace.reorder_many', params)
    publishRendererMutationEvent('workspace.reorder_many', params, response)
    return response
  }
  if (method === 'move-workspace-to-window') {
    const response = await dispatchRendererControlRequest('workspace.move_to_window', params)
    publishRendererMutationEvent('workspace.move_to_window', params, response)
    return response
  }
  if (method === 'new-workspace') {
    const response = await dispatchRendererControlRequest('workspace.create', params, { focus: params.focus !== false })
    publishRendererMutationEvent('workspace.create', params, response)
    return response
  }
  if (method === 'current-workspace') return dispatchRendererControlRequest('workspace.current', params)
  if (method === 'select-workspace') {
    const response = await dispatchRendererControlRequest('workspace.select', params, { focus: true })
    publishRendererMutationEvent('workspace.select', params, response)
    return response
  }
  if (method === 'close-workspace') {
    const response = await dispatchRendererControlRequest('workspace.close', params)
    publishRendererMutationEvent('workspace.close', params, response)
    return response
  }
  if (method === 'list-panels') return dispatchRendererControlRequest('surface.list', params)
  if (method === 'list-pane-surfaces') return dispatchRendererControlRequest('pane.surfaces', params)
  if (method === 'close-surface') {
    const response = await dispatchRendererControlRequest('surface.close', params)
    publishRendererMutationEvent('surface.close', params, response)
    return response
  }
  if (method === 'surface-focus' || method === 'focus-surface') {
    const response = await dispatchRendererControlRequest('surface.focus', params, { focus: true })
    publishRendererMutationEvent('surface.focus', params, response)
    return response
  }
  if (method === 'create-surface' || method === 'new-surface') {
    const response = await dispatchRendererControlRequest('surface.create', params, { focus: params.focus === true })
    publishRendererMutationEvent('surface.create', params, response)
    return response
  }
  if (method === 'create-pane') {
    const response = await dispatchRendererControlRequest('pane.create', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.create', params, response)
    return response
  }
  if (method === 'report_tty' || method === 'report-tty') {
    const response = await dispatchRendererControlRequest('surface.report_tty', params)
    publishRendererMutationEvent('surface.report_tty', params, response)
    return response
  }
  if (method === 'report_shell_state' || method === 'report-shell-state') {
    const response = await dispatchRendererControlRequest('surface.report_shell_state', params)
    publishRendererMutationEvent('surface.report_shell_state', params, response)
    return response
  }
  if (method === 'ports_kick' || method === 'ports-kick') {
    const response = await dispatchRendererControlRequest('surface.ports_kick', params)
    publishRendererMutationEvent('surface.ports_kick', params, response)
    return response
  }
  if (method === 'new-split' || method === 'new-pane') {
    const response = await dispatchRendererControlRequest('surface.split', params, { focus: params.focus === true })
    publishRendererMutationEvent('surface.split', params, response)
    return response
  }
  if (method === 'list-windows' || method === 'lsw') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'current-window' || method === 'currentw') return dispatchRendererControlRequest('workspace.current', params)
  if (method === 'list-panes' || method === 'lsp') return dispatchRendererControlRequest('pane.list', params)
  if (method === 'new-window' || method === 'neww') {
    const response = await dispatchRendererControlRequest('workspace.create', params, { focus: params.focus !== false })
    publishRendererMutationEvent('workspace.create', params, response)
    return response
  }
  if (method === 'split-window' || method === 'splitw') {
    const response = await dispatchRendererControlRequest('surface.split', params, { focus: params.focus !== false })
    publishRendererMutationEvent('surface.split', params, response)
    return response
  }
  if (method === 'rename-window' || method === 'renamew' || method === 'rename-workspace') {
    const response = await dispatchRendererControlRequest('workspace.rename', params)
    publishRendererMutationEvent('workspace.rename', params, response)
    return response
  }
  if (method === 'kill-window' || method === 'killw') {
    const response = await dispatchRendererControlRequest('workspace.close', params)
    publishRendererMutationEvent('workspace.close', params, response)
    return response
  }
  if (method === 'kill-pane' || method === 'killp') {
    const response = await dispatchRendererControlRequest('surface.close', params)
    publishRendererMutationEvent('surface.close', params, response)
    return response
  }
  if (method === 'has-session' || method === 'has') return dispatchRendererControlRequest('workspace.has_session', params)
  if (method === 'select-layout') {
    const response = await dispatchRendererControlRequest('workspace.select_layout', params)
    publishRendererMutationEvent('workspace.select_layout', params, response)
    return response
  }
  if (method === 'next-window' || method === 'nextw') {
    const response = await dispatchRendererControlRequest('workspace.next', params, { focus: true })
    publishRendererMutationEvent('workspace.next', params, response)
    return response
  }
  if (method === 'previous-window' || method === 'prev-window' || method === 'previousw' || method === 'prevw') {
    const response = await dispatchRendererControlRequest('workspace.previous', params, { focus: true })
    publishRendererMutationEvent('workspace.previous', params, response)
    return response
  }
  if (method === 'last-window' || method === 'lastw') {
    const response = await dispatchRendererControlRequest('workspace.last', params, { focus: true })
    publishRendererMutationEvent('workspace.last', params, response)
    return response
  }
  if (method === 'select-window' || method === 'selectw') {
    const response = await dispatchRendererControlRequest('workspace.select', params, { focus: true })
    publishRendererMutationEvent('workspace.select', params, response)
    return response
  }
  if (method === 'select-pane' || method === 'selectp' || method === 'focus-pane') {
    const response = await dispatchRendererControlRequest('pane.focus', params, { focus: true })
    publishRendererMutationEvent('pane.focus', params, response)
    return response
  }
  if (method === 'last-pane' || method === 'lastp') {
    const response = await dispatchRendererControlRequest('pane.last', params, { focus: true })
    publishRendererMutationEvent('pane.last', params, response)
    return response
  }
  if (method === 'find-window' || method === 'findw') return dispatchRendererControlRequest('workspace.find', params, { focus: params.select === true })
  if (method === 'break-pane' || method === 'breakp') {
    const response = await dispatchRendererControlRequest('pane.break', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.break', params, response)
    return response
  }
  if (method === 'join-pane' || method === 'joinp') {
    const response = await dispatchRendererControlRequest('pane.join', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.join', params, response)
    return response
  }
  if (method === 'swap-pane' || method === 'swapp') {
    const response = await dispatchRendererControlRequest('pane.swap', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.swap', params, response)
    return response
  }
  if (method === 'resize-pane' || method === 'resizep') {
    const response = await dispatchRendererControlRequest('pane.resize', params)
    publishRendererMutationEvent('pane.resize', params, response)
    return response
  }
  if (method === 'terminal.list' || method === 'list_terminals' || method === 'debug.terminals') return dispatchRendererControlRequest('terminal.list', params)
  if (method === 'terminal.focus' || method === 'focus_terminal' || method === 'focus-panel') {
    const response = await dispatchRendererControlRequest('terminal.focus', params, { focus: true })
    if (response.ok) {
      const data = response.data || {}
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.focused',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(terminal?.panelId || params.panelId),
        payload: {
          panel_id: cleanText(terminal?.panelId || params.panelId),
          session_id: cleanText(terminal?.sessionId || params.sessionId)
        }
      })
    }
    return response
  }
  if (method === 'terminal.read_screen' || method === 'surface.read_text' || method === 'capture-pane' || method === 'read-screen') return dispatchRendererControlRequest('terminal.read_screen', params)
  if (method === 'terminal.clear_history' || method === 'surface.clear_history' || method === 'clear-history') {
    const response = await dispatchRendererControlRequest('terminal.clear_history', params)
    if (response.ok) {
      const data = response.data || {}
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.history_cleared',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(terminal?.panelId || params.panelId || params.surfaceId),
        payload: {
          panel_id: cleanText(terminal?.panelId || params.panelId || params.surfaceId),
          session_id: cleanText(terminal?.sessionId || params.sessionId || params.terminalSessionId)
        }
      })
    }
    return response
  }
  if (method === 'terminal.respawn' || method === 'surface.respawn' || method === 'respawn-pane') {
    const response = await dispatchRendererControlRequest('surface.respawn', params)
    if (response.ok) {
      const data = response.data || {}
      const surface = data.surface && typeof data.surface === 'object' ? (data.surface as Record<string, unknown>) : null
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      const decision = data.decision && typeof data.decision === 'object' ? (data.decision as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.respawn_requested',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(surface?.panelId || terminal?.panelId || params.panelId || params.surfaceId),
        payload: {
          panel_id: cleanText(surface?.panelId || terminal?.panelId || params.panelId || params.surfaceId),
          session_id: cleanText(terminal?.sessionId || params.sessionId || params.terminalSessionId),
          command_length: cleanText(data.command || params.command || params.tmux_start_command).length,
          decision_status: cleanText(decision?.status)
        }
      })
    }
    return response
  }
  if (method === 'terminal.send_text' || method === 'surface.send_text' || method === 'send' || method === 'send-panel') return sendTerminalText(params)
  if (method === 'terminal.send_key' || method === 'surface.send_key' || method === 'send-key' || method === 'send-key-panel') return sendTerminalKey(params)
  if (method === 'notification.create' || method === 'notify') return createNotification(params)
  if (method === 'notification.create_for_caller') return createCallerNotification(params)
  if (method === 'notification.create_for_surface' || method === 'notify-surface') return createTargetedNotification(method, params)
  if (method === 'notification.create_for_target' || method === 'notify-target') return createTargetedNotification(method, params)
  if (method === 'notification.list' || method === 'list-notifications') return listNotifications(params)
  if (method === 'notification.mark_read' || method === 'mark-notification-read') return markNotificationRead(params)
  if (method === 'notification.dismiss' || method === 'dismiss-notification') return dismissNotification(params)
  if (method === 'notification.clear' || method === 'clear-notifications') return clearNotifications()
  if (method === 'notification.open' || method === 'open-notification') return openNotification(params)
  if (method === 'notification.jump_to_unread' || method === 'jump-to-unread') return jumpToUnreadNotification()
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm control method: ${method}`)
}

const writeSocketResponse = (socket: Socket, id: string | undefined, response: ControlResponse) => {
  socket.write(`${JSON.stringify({ id, ...response })}\n`)
}

export const configureControlSocketRuntime = (config: ControlSocketRuntime = {}) => {
  runtime = { ...runtime, ...config }
  configureControlSocketRendererRuntime({ ...runtime, socketPath })
  configureControlSocketSystemRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    socketPath,
    getWindows: runtime.getWindows,
    dispatchRendererControlRequest
  })
  configureControlSocketStateRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    dispatchRendererControlRequest
  })
  configureControlSocketNotificationRuntime({
    dispatchRendererControlRequest,
    showNotification: runtime.showNotification,
    publishControlEvent
  })
  configureAgentVaultRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    dispatchRendererControlRequest,
    publishControlEvent
  })
  configureControlSocketAgentRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    writeTerminal: runtime.writeTerminal,
    handleMobileTerminalControlRequest,
    publishControlEvent
  })
  configureControlSocketCompatibilityRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {})
  })
  configureControlSocketSidebarMetadataRuntime({ publishControlEvent })
  configureControlSocketTerminalTools({
    writeTerminal: runtime.writeTerminal,
    dispatchRendererControlRequest,
    publishControlEvent
  })
}

export const getControlSocketPath = () => socketPath

export const registerControlSocketIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('control:invoke', (_event, method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params }))
  ipcMain.handle('control:response', (_event, id: string, response: ControlResponse) => resolvePendingRendererControlResponse(id, response))
}

export const ensureControlSocketServer = async (userDataPath: string) => {
  if (server && socketPath) return socketPath
  socketPath = socketPathFor(userDataPath)
  runtime = { ...runtime, userDataPath }
  configureControlSocketRendererRuntime({ ...runtime, socketPath })
  configureControlSocketSystemRuntime({ userDataPath, socketPath, getWindows: runtime.getWindows, dispatchRendererControlRequest })
  configureControlSocketStateRuntime({ userDataPath, dispatchRendererControlRequest })
  configureControlSocketNotificationRuntime({ dispatchRendererControlRequest, showNotification: runtime.showNotification, publishControlEvent })
  configureAgentVaultRuntime({ userDataPath, dispatchRendererControlRequest, publishControlEvent })
  configureControlSocketAgentRuntime({ userDataPath, writeTerminal: runtime.writeTerminal, handleMobileTerminalControlRequest, publishControlEvent })
  configureControlSocketCompatibilityRuntime({ userDataPath })
  configureControlSocketSidebarMetadataRuntime({ publishControlEvent })
  configureControlSocketTerminalTools({ writeTerminal: runtime.writeTerminal, dispatchRendererControlRequest, publishControlEvent })
  await loadDurableEventLog(userDataPath)
  await loadAgentVaultStore(userDataPath)
  await loadSessionSnapshotStore(userDataPath)
  await configureAiAgentSessionStore(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    let buffer = ''
    let streaming = false
    socket.on('data', (chunk) => {
      if (streaming) return
      buffer += chunk.toString('utf8')
      for (;;) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        let request: ControlSocketRequest
        try {
          request = JSON.parse(line) as ControlSocketRequest
        } catch (error) {
          writeSocketResponse(socket, undefined, fail('INVALID_JSON', error instanceof Error ? error.message : String(error)))
          continue
        }
        if (isEventStreamMethod(request.method)) {
          streaming = true
          startEventStream(socket, request)
          return
        }
        void handleControlRequest(request)
          .then((response) => writeSocketResponse(socket, request.id, response))
          .catch((error) => writeSocketResponse(socket, request.id, fail('CONTROL_REQUEST_FAILED', error instanceof Error ? error.message : String(error))))
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    const failListen = (error: Error) => {
      server?.off('listening', done)
      reject(error)
    }
    const done = () => {
      server?.off('error', failListen)
      resolve()
    }
    server?.once('error', failListen)
    server?.once('listening', done)
    server?.listen(socketPath)
  })
  return socketPath
}

export const closeControlSocketServer = () => {
  closePendingRendererControlRequests()
  closeControlSocketStateRuntime()
  resetControlSocketNotificationRuntime()
  resetControlSocketSidebarMetadataRuntime()
  resetControlSocketTerminalTools()
  resetAgentVaultRuntimeState()
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
  configureControlSocketRendererRuntime({ socketPath })
  configureControlSocketSystemRuntime({ socketPath })
}

export const invokeControlSocketMethod = (method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params })

export const __testing = {
  handleControlRequest,
  listEvents: listEventsForTesting,
  eventLogPathFor,
  listSessionSnapshots: listSessionSnapshotsForTesting,
  sessionSnapshotPathFor,
  listAgentVaultEntries: () => sortedAgentVaultEntries(),
  agentVaultPathFor,
  listNotifications: listNotificationsForTesting,
  listTerminalBuffers,
  listTmuxCompatHooks,
  pendingRendererRequestCount,
  eventSubscriptionCount: eventSubscriptionCountForTesting,
  mobileEventSubscriptionCount: mobileEventSubscriptionCountForTesting,
  listMobileEventSubscriptions: listMobileEventSubscriptionsForTesting
}
