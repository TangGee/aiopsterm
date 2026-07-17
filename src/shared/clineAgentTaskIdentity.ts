import type { ClineAgentTaskEvent } from './contracts/clineAgent'

const cleanText = (value: unknown) => String(value || '').trim()

export type ClineAgentTaskIdentity = {
  taskId: string
  turnId: string
}

export const clineAgentTaskIdentityKey = (identity: ClineAgentTaskIdentity) =>
  `${cleanText(identity.taskId)}\u0000${cleanText(identity.turnId)}`

export const databaseClineAgentTaskIdentity = (requestIdInput: string): ClineAgentTaskIdentity => {
  const requestId = cleanText(requestIdInput)
  return {
    taskId: `dbai-${requestId}`,
    turnId: requestId
  }
}

export const isTerminalClineAgentTaskEvent = (event: ClineAgentTaskEvent) =>
  event.type === 'done' || event.type === 'cancelled' || event.type === 'error'
