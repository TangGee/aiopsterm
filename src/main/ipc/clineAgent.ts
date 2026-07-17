import type { IpcMain } from 'electron'
import {
  abortClineAgentTask,
  respondClineAgentApproval
} from '../backend/agent/clineAgentRuntime'
import type {
  ClineAgentAbortInput,
  ClineAgentAbortResult,
  ClineAgentApprovalInput,
  ClineAgentApprovalResult
} from '@shared/contracts/clineAgent'

type RegisterClineAgentIpcInput = {
  respondApproval?: (
    input: ClineAgentApprovalInput,
    ownerWebContentsId: number
  ) => ClineAgentApprovalResult | Promise<ClineAgentApprovalResult>
  abortTask?: (
    input: ClineAgentAbortInput,
    ownerWebContentsId: number
  ) => ClineAgentAbortResult | Promise<ClineAgentAbortResult>
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hostApprovalToolNames = new Set(['run_host_command', 'read_host_file', 'search_host_files'])
const approvalInputKeys = new Set([
  'taskId',
  'turnId',
  'toolCallId',
  'toolName',
  'targetId',
  'targetLabel',
  'terminalSessionId',
  'serverName',
  'resourceUri',
  'approved',
  'enableReadOnlyAutoRun',
  'reason'
])

const nonEmptyString = (value: unknown) => typeof value === 'string' && Boolean(value.trim())

const validApprovalInput = (input: unknown): input is ClineAgentApprovalInput => {
  if (!isRecord(input) || Object.keys(input).some((key) => !approvalInputKeys.has(key))) return false
  if (
    !nonEmptyString(input.taskId) ||
    !nonEmptyString(input.turnId) ||
    !nonEmptyString(input.toolCallId) ||
    !nonEmptyString(input.toolName) ||
    typeof input.approved !== 'boolean' ||
    (input.enableReadOnlyAutoRun !== undefined && typeof input.enableReadOnlyAutoRun !== 'boolean') ||
    (input.reason !== undefined && typeof input.reason !== 'string')
  ) return false
  const toolName = String(input.toolName).trim()
  if (hostApprovalToolNames.has(toolName)) {
    return nonEmptyString(input.targetId) &&
      nonEmptyString(input.targetLabel) &&
      nonEmptyString(input.terminalSessionId) &&
      input.serverName === undefined &&
      input.resourceUri === undefined &&
      (input.enableReadOnlyAutoRun !== true || toolName === 'run_host_command')
  }
  if (toolName === 'access_mcp_resource') {
    return nonEmptyString(input.serverName) &&
      nonEmptyString(input.resourceUri) &&
      input.targetId === undefined &&
      input.targetLabel === undefined &&
      input.terminalSessionId === undefined &&
      input.enableReadOnlyAutoRun !== true
  }
  return false
}

export const registerClineAgentIpc = (ipcMain: IpcMain, input: RegisterClineAgentIpcInput = {}) => {
  const respondApproval = input.respondApproval || respondClineAgentApproval
  const abortTask = input.abortTask || abortClineAgentTask

  ipcMain.handle('cline-agent:approval:respond', (event, approvalInput: ClineAgentApprovalInput) => {
    if (!validApprovalInput(approvalInput)) {
      return { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_INVALID', errorMessage: 'Cline Agent approval input is invalid.' }
    }
    return respondApproval(approvalInput, event.sender.id)
  })
  ipcMain.handle('cline-agent:task:abort', (event, abortInput: ClineAgentAbortInput) => {
    if (!isRecord(abortInput)) {
      return { ok: false, errorCode: 'CLINE_AGENT_ABORT_INVALID', errorMessage: 'Cline Agent abort input is invalid.' }
    }
    return abortTask(abortInput, event.sender.id)
  })
}
