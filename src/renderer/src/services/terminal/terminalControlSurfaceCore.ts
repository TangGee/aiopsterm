import type { useWorkspaceStore, TerminalPanel } from '@/stores/workspace'
import type {
  ControlResponse,
  ControlSurfaceResumeBindingSummary,
  ControlWorkspaceGroupSummary
} from '@shared/contracts/control'
import type { TerminalKillResult } from '@shared/contracts/terminalSessions'
import type { TerminalFocusReason } from '@/services/terminal/terminalWorkspaceViewRuntime'

export type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

export type TerminalControlSurfaceView = {
  terminal: {
    cols: number
    rows: number
    buffer: {
      active: {
        length: number
        getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined
      }
    }
    clear(): void
    focus(): void
  }
  lastOutput: string
  clearPendingOutput?: () => void
}

export type TerminalFitOptions = { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean }

export type TerminalControlSurfaceDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  visibleTerminalPanels: Readonly<{ value: TerminalPanel[] }>
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  terminalViewSize: (panelId: string) => { cols: number; rows: number }
  startSshTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
  disconnectTerminalPanel: (panel: TerminalPanel) => Promise<boolean>
  scheduleVisibleTerminalFit: (options?: TerminalFitOptions) => void
  focusTerminalPanel?: (panelId: string, reason: TerminalFocusReason) => void
}

export type ControlWorkspaceGroupState = Omit<ControlWorkspaceGroupSummary, 'ref' | 'memberCount' | 'active'>
export type ControlSurfaceResumeBindingState = ControlSurfaceResumeBindingSummary

export type ControlProjectState = {
  surfaceId: string
  projectUrl: string
  activeTab: string
  selectedScheme: string
  selectedConfiguration: string
  selectedTargetId: string
  selectedFile: string
  settingsFilter: string
  updatedAt: number
}

export type ControlSurfaceTelemetryState = {
  ttyName?: string
  shellState?: 'prompt' | 'running' | 'unknown'
  lastShellStateAt?: number
  lastTtyAt?: number
  lastPortsKickAt?: number
  lastPortsKickReason?: 'command' | 'refresh'
}

export type ControlWorkspaceRemoteState = {
  surfaceId: string
  transport: 'ssh'
  destination: string
  host: string
  port: number
  username: string
  assetName: string
  assetId?: string
  proxyName?: string
  needProxy?: boolean
  foregroundAuthReadyAt?: number
  updatedAt: number
}

export type ControlWorkspaceEnvironmentState = {
  env: Record<string, string>
  updatedAt: number
}

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isTerminalKillSuccess = (result: TerminalKillResult | null | undefined, sessionId: string) =>
  result?.ok === true && isRecord(result.data) && result.data.id === sessionId

export const controlOk = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

export const controlFail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

export const controlText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const controlNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numberValue)))
}

export const controlBool = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return fallback
}

export const terminalControlBufferText = (view: TerminalControlSurfaceView, tailLines: number) => {
  const buffer = view.terminal.buffer.active
  const start = Math.max(0, buffer.length - tailLines)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '')
  }
  return lines.join('\n').replace(/\s+$/g, '')
}
