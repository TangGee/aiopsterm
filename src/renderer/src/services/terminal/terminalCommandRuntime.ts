import type { TerminalCommandGenerationContext, TerminalCommandGenerationInput, TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type { SettingsModelOption } from '@/services/settings/workspaceConfigRuntime'
import { isTerminalWorkspacePanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'

export type TerminalCommandGenerationPlan =
  | {
      ok: true
      panel: TerminalPanel
      request: TerminalCommandGenerationInput
    }
  | {
      ok: false
      reason: 'invalid-panel-or-prompt' | 'missing-model'
    }

export const terminalCommandHistoryLimit = 20

export const terminalCommandModelOptions = (models: SettingsModelOption[]) =>
  models.filter((model) => model.checked && !model.locked && !model.name.endsWith('-Thinking')).map((model) => model.name)

export const terminalCommandContextFromPanel = (panel: TerminalPanel): TerminalCommandGenerationContext => {
  const ssh = panel.sshSession
  return {
    host: ssh?.host || '127.0.0.1',
    username: ssh?.username || 'local',
    cwd: panel.cwd || '~',
    shell: panel.sessionId ? 'local-shell' : 'bash',
    connectionType: ssh ? 'ssh' : 'local'
  }
}

export const prepareTerminalCommandGeneration = (
  panels: TerminalPanel[],
  input: { panelId: string; instruction: string; modelName?: string; modelOptions: string[] }
): TerminalCommandGenerationPlan => {
  const panel = panels.find((item) => item.id === input.panelId || item.sessionId === input.panelId) || null
  const instruction = input.instruction.trim()
  if (!panel || !isTerminalWorkspacePanel(panel) || !instruction) return { ok: false, reason: 'invalid-panel-or-prompt' }
  const modelName = input.modelName || input.modelOptions[0]
  if (!modelName) return { ok: false, reason: 'missing-model' }
  return {
    ok: true,
    panel,
    request: {
      panelId: panel.id,
      instruction,
      modelName,
      context: terminalCommandContextFromPanel(panel)
    }
  }
}

export const terminalCommandGenerationRecordMatchesRequest = (record: TerminalCommandGenerationRecord, request: TerminalCommandGenerationInput) =>
  record.panelId === request.panelId && record.instruction === request.instruction

export const addTerminalCommandGenerationRecord = (
  records: TerminalCommandGenerationRecord[],
  record: TerminalCommandGenerationRecord,
  limit = terminalCommandHistoryLimit
) => [record, ...records].slice(0, limit)
