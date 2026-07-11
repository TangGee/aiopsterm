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

export const registerClineAgentIpc = (ipcMain: IpcMain, input: RegisterClineAgentIpcInput = {}) => {
  const respondApproval = input.respondApproval || respondClineAgentApproval
  const abortTask = input.abortTask || abortClineAgentTask

  ipcMain.handle('cline-agent:approval:respond', (event, approvalInput: ClineAgentApprovalInput) => {
    if (!isRecord(approvalInput)) {
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
