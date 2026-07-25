export const terminalFlowInitialBudgetBytes = 64 * 1024
export const terminalFlowMinimumBudgetBytes = 64 * 1024
export const terminalFlowMaximumBudgetBytes = 2 * 1024 * 1024
export const terminalFlowTargetDurationMs = 100

export type TerminalFlowState = {
  unacked: number
  sentBytes: number
  ackedBytes: number
  pauseCount: number
  paused: boolean
  pausedAt: number
  budgetBytes: number
  epochStartedAt: number
  epochBytes: number
}

export type TerminalFlowAcknowledgement = {
  acknowledged: number
  shouldResume: boolean
  previousBudgetBytes: number
  budgetBytes: number
  epochBytes: number
  epochDurationMs: number
}

const clampTerminalFlowBudget = (bytes: number) =>
  Math.max(terminalFlowMinimumBudgetBytes, Math.min(terminalFlowMaximumBudgetBytes, Math.floor(bytes)))

export const createTerminalFlowState = (): TerminalFlowState => ({
  unacked: 0,
  sentBytes: 0,
  ackedBytes: 0,
  pauseCount: 0,
  paused: false,
  pausedAt: 0,
  budgetBytes: terminalFlowInitialBudgetBytes,
  epochStartedAt: 0,
  epochBytes: 0
})

export const trackTerminalFlowSend = (flow: TerminalFlowState, bytes: number, now: number) => {
  const sent = Math.max(0, Math.floor(Number(bytes) || 0))
  if (!sent) return false
  if (!flow.unacked) {
    flow.epochStartedAt = now
    flow.epochBytes = 0
  }
  flow.unacked += sent
  flow.sentBytes += sent
  flow.epochBytes += sent
  if (flow.paused || flow.unacked < flow.budgetBytes) return false
  flow.paused = true
  flow.pausedAt = now
  flow.pauseCount += 1
  return true
}

export const acknowledgeTerminalFlow = (flow: TerminalFlowState, bytes: number, now: number): TerminalFlowAcknowledgement => {
  const acknowledged = Math.min(flow.unacked, Math.max(0, Math.floor(Number(bytes) || 0)))
  flow.unacked = Math.max(0, flow.unacked - acknowledged)
  flow.ackedBytes += acknowledged

  const result: TerminalFlowAcknowledgement = {
    acknowledged,
    shouldResume: false,
    previousBudgetBytes: flow.budgetBytes,
    budgetBytes: flow.budgetBytes,
    epochBytes: 0,
    epochDurationMs: 0
  }
  if (flow.unacked) return result

  result.epochBytes = flow.epochBytes
  result.epochDurationMs = flow.epochStartedAt ? Math.max(1, now - flow.epochStartedAt) : 0
  if (flow.epochBytes >= terminalFlowMinimumBudgetBytes && result.epochDurationMs) {
    const targetBudgetBytes = (flow.epochBytes * terminalFlowTargetDurationMs) / result.epochDurationMs
    flow.budgetBytes = clampTerminalFlowBudget((flow.budgetBytes + targetBudgetBytes) / 2)
    result.budgetBytes = flow.budgetBytes
  }
  flow.epochStartedAt = 0
  flow.epochBytes = 0
  if (!flow.paused) return result

  flow.paused = false
  flow.pausedAt = 0
  result.shouldResume = true
  return result
}

export const resetTerminalFlowAfterSafetyResume = (flow: TerminalFlowState) => {
  flow.unacked = 0
  flow.paused = false
  flow.pausedAt = 0
  flow.budgetBytes = terminalFlowInitialBudgetBytes
  flow.epochStartedAt = 0
  flow.epochBytes = 0
}
