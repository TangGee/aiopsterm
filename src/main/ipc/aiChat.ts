import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { cancelAiChatResponse, createAiChatExchangeRequest, generateAiChatResponse } from '../backend/ai/aiChat'
import { withClineAgentRendererOwner } from '../backend/agent/clineAgentOwnerRuntime'
import type {
  AiChatCancelInput,
  AiChatExchangeRequestInput,
  AiChatResponseInput,
  AiChatResponseResult
} from '@shared/contracts/aiChat'
import {
  CLINE_AGENT_MAX_HOST_TARGETS,
  type ClineAgentHostTarget
} from '@shared/contracts/clineAgent'

type RegisterAiChatIpcInput = {
  resolveTrustedHostTarget?: (event: IpcMainInvokeEvent, terminalSessionId: string) => ClineAgentHostTarget | null
  bindProductSession?: (input: AiChatResponseInput, result: AiChatResponseResult) => Promise<void> | void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const terminalSessionError = () => ({
  ok: false as const,
  errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID',
  errorMessage: 'The selected terminal session is unavailable for this window.'
})

export const registerAiChatIpc = (ipcMain: IpcMain, runtime: RegisterAiChatIpcInput = {}) => {
  const runWithTrustedTerminals = <T extends { hostTargets?: unknown }>(
    event: IpcMainInvokeEvent,
    input: T,
    callback: (trustedInput: T) => unknown
  ) => {
    const rawTargets = input?.hostTargets
    if (rawTargets !== undefined && (!Array.isArray(rawTargets) || rawTargets.length > CLINE_AGENT_MAX_HOST_TARGETS)) {
      return terminalSessionError()
    }
    if (Array.isArray(rawTargets) && rawTargets.length > 0 && !runtime.resolveTrustedHostTarget) {
      return terminalSessionError()
    }
    const targetIds = new Set<string>()
    const terminalSessionIds = new Set<string>()
    const trustedTargets: ClineAgentHostTarget[] = []
    for (const rawTarget of (rawTargets || []) as unknown[]) {
      if (!isRecord(rawTarget)) return terminalSessionError()
      const targetId = typeof rawTarget.targetId === 'string' ? rawTarget.targetId.trim() : ''
      const targetTerminalSessionId = typeof rawTarget.terminalSessionId === 'string'
        ? rawTarget.terminalSessionId.trim()
        : ''
      const label = typeof rawTarget.label === 'string' ? rawTarget.label.trim() : ''
      const kind = rawTarget.kind
      if (!targetId || !targetTerminalSessionId || !label || (kind !== 'local' && kind !== 'ssh')) {
        return terminalSessionError()
      }
      const resolved = runtime.resolveTrustedHostTarget?.(event, targetTerminalSessionId)
      if (runtime.resolveTrustedHostTarget && !resolved) return terminalSessionError()
      if (!resolved) return terminalSessionError()
      const trusted = resolved
      const trustedTargetId = String(trusted.targetId || '').trim()
      const trustedTerminalSessionId = String(trusted.terminalSessionId || '').trim()
      const trustedLabel = String(trusted.label || '').trim()
      const scopedTrustedTargetId = `${trustedTargetId}::${trustedTerminalSessionId}`
      const canonicalTargetId = targetId === trustedTargetId || targetId === scopedTrustedTargetId
        ? targetId
        : ''
      if (
        !trustedTargetId ||
        !trustedTerminalSessionId ||
        !trustedLabel ||
        !canonicalTargetId ||
        (trusted.kind !== 'local' && trusted.kind !== 'ssh') ||
        trustedTerminalSessionId !== targetTerminalSessionId ||
        trusted.kind !== kind ||
        targetIds.has(canonicalTargetId) ||
        terminalSessionIds.has(trustedTerminalSessionId)
      ) return terminalSessionError()
      targetIds.add(canonicalTargetId)
      terminalSessionIds.add(trustedTerminalSessionId)
      const cwd = String(trusted.cwd || '').trim()
      trustedTargets.push({
        targetId: canonicalTargetId,
        terminalSessionId: trustedTerminalSessionId,
        label: trustedLabel,
        kind: trusted.kind,
        ...(cwd ? { cwd } : {})
      })
    }
    const trustedInput = (rawTargets === undefined ? input : { ...input, hostTargets: trustedTargets }) as T
    return withClineAgentRendererOwner(event.sender.id, () => callback(trustedInput))
  }

  ipcMain.handle('ai:chat-exchange-request', (event, input: AiChatExchangeRequestInput) =>
    runWithTrustedTerminals(event, input, (trustedInput) => createAiChatExchangeRequest(trustedInput))
  )
  ipcMain.handle('ai:chat-response', async (event, input: AiChatResponseInput) =>
    runWithTrustedTerminals(event, input, async (trustedInput) => {
      const result = await generateAiChatResponse(trustedInput)
      await runtime.bindProductSession?.(trustedInput, result)
      return result
    })
  )
  ipcMain.handle('ai:chat-response:cancel', (event, input: AiChatCancelInput) =>
    withClineAgentRendererOwner(event.sender.id, () => cancelAiChatResponse(input))
  )
}
