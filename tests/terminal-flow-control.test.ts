import { beforeAll, describe, expect, it } from 'vitest'

type FlowState = {
  unacked: number
  paused: boolean
  budgetBytes: number
  epochBytes: number
  epochStartedAt: number
}

type FlowControlBackend = {
  acknowledgeTerminalFlow: (flow: FlowState, bytes: number, now: number) => {
    shouldResume: boolean
    epochBytes: number
    epochDurationMs: number
  }
  createTerminalFlowState: () => FlowState
  resetTerminalFlowAfterSafetyResume: (flow: FlowState) => void
  terminalFlowInitialBudgetBytes: number
  terminalFlowMaximumBudgetBytes: number
  trackTerminalFlowSend: (flow: FlowState, bytes: number, now: number) => boolean
}

let backend: FlowControlBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminal/terminalFlowControl'
  backend = (await import(modulePath)) as unknown as FlowControlBackend
})

describe('terminal flow control', () => {
  it('starts with a 64 KiB budget and resumes only after the epoch is fully consumed', () => {
    const flow = backend.createTerminalFlowState()

    expect(flow.budgetBytes).toBe(64 * 1024)
    expect(backend.trackTerminalFlowSend(flow, 64 * 1024, 1000)).toBe(true)
    expect(flow.paused).toBe(true)

    const partial = backend.acknowledgeTerminalFlow(flow, 32 * 1024, 1050)
    expect(partial.shouldResume).toBe(false)
    expect(flow.paused).toBe(true)
    expect(flow.unacked).toBe(32 * 1024)

    const complete = backend.acknowledgeTerminalFlow(flow, 32 * 1024, 1100)
    expect(complete.shouldResume).toBe(true)
    expect(flow.paused).toBe(false)
    expect(flow.unacked).toBe(0)
    expect(flow.budgetBytes).toBe(64 * 1024)
  })

  it('grows the shared read budget when the renderer consumes an epoch quickly', () => {
    const flow = backend.createTerminalFlowState()

    backend.trackTerminalFlowSend(flow, 64 * 1024, 1000)
    const result = backend.acknowledgeTerminalFlow(flow, 64 * 1024, 1020)

    expect(result.shouldResume).toBe(true)
    expect(result.epochBytes).toBe(64 * 1024)
    expect(result.epochDurationMs).toBe(20)
    expect(flow.budgetBytes).toBe(192 * 1024)
  })

  it('shrinks a large budget when end to end consumption is slow', () => {
    const flow = backend.createTerminalFlowState()
    flow.budgetBytes = 1024 * 1024

    backend.trackTerminalFlowSend(flow, 1024 * 1024, 1000)
    backend.acknowledgeTerminalFlow(flow, 1024 * 1024, 1400)

    expect(flow.budgetBytes).toBe(640 * 1024)
  })

  it('clamps rapid growth to the hard maximum', () => {
    const flow = backend.createTerminalFlowState()

    backend.trackTerminalFlowSend(flow, 64 * 1024, 1000)
    backend.acknowledgeTerminalFlow(flow, 64 * 1024, 1001)

    expect(flow.budgetBytes).toBe(backend.terminalFlowMaximumBudgetBytes)
  })

  it('resets stalled flow state and budget after the safety resume', () => {
    const flow = backend.createTerminalFlowState()
    flow.budgetBytes = 1024 * 1024
    backend.trackTerminalFlowSend(flow, 1024 * 1024, 1000)

    backend.resetTerminalFlowAfterSafetyResume(flow)

    expect(flow.unacked).toBe(0)
    expect(flow.paused).toBe(false)
    expect(flow.budgetBytes).toBe(backend.terminalFlowInitialBudgetBytes)
    expect(flow.epochBytes).toBe(0)
    expect(flow.epochStartedAt).toBe(0)
  })

  it('keeps the hard limit independent of whether output came from cat or paste echo', () => {
    const catFlow = backend.createTerminalFlowState()
    const pasteFlow = backend.createTerminalFlowState()

    expect(backend.trackTerminalFlowSend(catFlow, 64 * 1024, 1000)).toBe(true)
    expect(backend.trackTerminalFlowSend(pasteFlow, 64 * 1024, 1000)).toBe(true)
    expect(catFlow).toEqual(pasteFlow)
  })
})
