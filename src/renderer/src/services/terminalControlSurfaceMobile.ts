import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  terminalControlBufferText,
  type TerminalControlSurfaceView,
  type WorkspaceStore
} from '@/services/terminalControlSurfaceCore'
import { terminalBracketedPasteText, terminalSubmitKeyData, writeControlTerminalText } from '@/services/terminalControlRuntime'
import type { ControlResponse, ControlTerminalSummary } from '@shared/contracts/control'

type TerminalControlSurfaceMobileDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  terminalSummaryForControl: (panel: TerminalPanel) => ControlTerminalSummary
}

export const createTerminalControlSurfaceMobileHandlers = ({
  workspace,
  terminalViews,
  terminalSummaryForControl
}: TerminalControlSurfaceMobileDependencies) => {
  const resolveControlTerminalPanel = (params: Record<string, unknown> = {}) => {
    const panelId = controlText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.terminalId || params.terminal_id || params.tabId || params.tab_id)
    const sessionId = controlText(params.sessionId || params.session_id || params.terminalSessionId || params.terminal_session_id)
    if (panelId || sessionId) {
      return workspace.panels.find((panel) => panel.kind !== 'knowledge' && (panel.id === panelId || panel.sessionId === sessionId)) || null
    }
    const active = workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.id === workspace.activePanelId)
    return active || workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.sessionId) || null
  }

  const terminalMobileTargetPayload = (panel: TerminalPanel, extra: Record<string, unknown> = {}) => {
    const terminal = terminalSummaryForControl(panel)
    return {
      workspace_id: 'main',
      workspaceId: 'main',
      surface_id: panel.id,
      surfaceId: panel.id,
      terminal_id: panel.id,
      terminalId: panel.id,
      ...(panel.sessionId ? { session_id: panel.sessionId, sessionId: panel.sessionId, terminal_session_id: panel.sessionId, terminalSessionId: panel.sessionId } : {}),
      terminal,
      ...extra
    }
  }

  const handleMobileTerminalInputControlRequest = async (params: Record<string, unknown>) => {
    const text = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : ''
    if (!text) return controlFail('TERMINAL_TEXT_REQUIRED', 'terminal.input requires text.')
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    if (!panel.sessionId) return controlFail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId: panel.id, surface_id: panel.id })
    const ok = await writeControlTerminalText(panel.sessionId, text)
    if (!ok) return controlFail('TERMINAL_WRITE_FAILED', 'Terminal input could not be delivered.', { panelId: panel.id, sessionId: panel.sessionId })
    return controlOk(terminalMobileTargetPayload(panel, { queued: false, bytes: new TextEncoder().encode(text).length, textLength: text.length, text_length: text.length }))
  }

  const handleMobileTerminalPasteControlRequest = async (params: Record<string, unknown>) => {
    const text = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : ''
    if (!text) return controlFail('TERMINAL_TEXT_REQUIRED', 'terminal.paste requires text.')
    const submitKey = terminalSubmitKeyData(params.submit_key || params.submitKey)
    if (submitKey === null) return controlFail('TERMINAL_SUBMIT_KEY_UNSUPPORTED', 'Unsupported submit_key.', { submit_key: controlText(params.submit_key || params.submitKey) })
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    if (!panel.sessionId) return controlFail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId: panel.id, surface_id: panel.id })
    const payload = `${terminalBracketedPasteText(text)}${submitKey}`
    const ok = await writeControlTerminalText(panel.sessionId, payload)
    if (!ok) return controlFail('TERMINAL_WRITE_FAILED', 'Terminal paste could not be delivered.', { panelId: panel.id, sessionId: panel.sessionId })
    return controlOk(
      terminalMobileTargetPayload(panel, {
        queued: false,
        submitted: Boolean(submitKey),
        submit_key: controlText(params.submit_key || params.submitKey) || 'return',
        bytes: new TextEncoder().encode(payload).length,
        textLength: text.length,
        text_length: text.length
      })
    )
  }

  const handleMobileTerminalReplayControlRequest = (params: Record<string, unknown>) => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    const view = terminalViews.get(panel.id)
    if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, surface_id: panel.id, sessionId: panel.sessionId })
    const tailLines = controlNumber(params.tailLines || params.lines, view.terminal.rows || 30, 1, Math.max(1, workspace.terminalSettings.scrollBack || 1000))
    const text = terminalControlBufferText(view, tailLines)
    return controlOk(
      terminalMobileTargetPayload(panel, {
        seq: Date.now(),
        columns: Math.max(1, view.terminal.cols || 80),
        rows: Math.max(1, view.terminal.rows || 24),
        text,
        snapshot_format: 'aiopsterm.text',
        snapshot_text: text,
        tailLines,
        tail_lines: tailLines
      })
    )
  }

  const handleMobileTerminalViewportControlRequest = (params: Record<string, unknown>) => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    const view = terminalViews.get(panel.id)
    if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, surface_id: panel.id, sessionId: panel.sessionId })
    return controlOk(
      terminalMobileTargetPayload(panel, {
        columns: Math.max(1, view.terminal.cols || 80),
        rows: Math.max(1, view.terminal.rows || 24),
        viewport_columns: controlNumber(params.viewport_columns || params.viewportColumns, view.terminal.cols || 80, 1, 500),
        viewport_rows: controlNumber(params.viewport_rows || params.viewportRows, view.terminal.rows || 24, 1, 500),
        cleared: controlBool(params.clear, false)
      })
    )
  }

  const handleTerminalUnsupportedGestureRequest = (params: Record<string, unknown>, unsupportedReason: string) => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    return controlOk(terminalMobileTargetPayload(panel, { unsupported: true, unsupportedReason }))
  }

  const handleTerminalFocusControlRequest = async (params: Record<string, unknown>): Promise<ControlResponse> => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    await nextTick()
    terminalViews.get(panel.id)?.terminal.focus()
    return controlOk({ terminal: terminalSummaryForControl(panel) })
  }

  const handleTerminalReadScreenControlRequest = (params: Record<string, unknown>) => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    const view = terminalViews.get(panel.id)
    if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, sessionId: panel.sessionId })
    const tailLines = controlNumber(params.tailLines || params.lines, view.terminal.rows || 30, 1, Math.max(1, workspace.terminalSettings.scrollBack || 1000))
    return controlOk({
      terminal: terminalSummaryForControl(panel),
      text: terminalControlBufferText(view, tailLines),
      tailLines
    })
  }

  const clearTerminalHistoryForControl = async (params: Record<string, unknown>) => {
    const panel = resolveControlTerminalPanel(params)
    if (!panel) return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    if (panel.kind === 'knowledge') return controlFail('TERMINAL_PANEL_NOT_FOUND', 'Terminal panel not found.')
    const view = terminalViews.get(panel.id)
    if (!view) return controlFail('TERMINAL_VIEW_NOT_READY', 'Terminal view is not ready.', { panelId: panel.id, sessionId: panel.sessionId })
    workspace.replaceTerminalOutput(panel.id, '')
    view.terminal.clear()
    view.lastOutput = ''
    await nextTick()
    return controlOk({ terminal: terminalSummaryForControl(panel), cleared: true })
  }

  return {
    handleMobileTerminalInputControlRequest,
    handleMobileTerminalPasteControlRequest,
    handleMobileTerminalReplayControlRequest,
    handleMobileTerminalViewportControlRequest,
    handleTerminalUnsupportedGestureRequest,
    handleTerminalFocusControlRequest,
    handleTerminalReadScreenControlRequest,
    clearTerminalHistoryForControl
  }
}
