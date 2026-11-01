import type { ControlResponse, ControlTerminalSummary } from '@shared/contracts/control'
import type { GatewayTerminalPort } from './gatewayTypes'

type Invoke = (method: string, params?: Record<string, unknown>) => Promise<ControlResponse>
export const createGatewayTerminalPort = (invoke: Invoke): GatewayTerminalPort => ({
  list: async () => {
    const response = await invoke('terminal.list')
    if (!response.ok || !Array.isArray(response.data?.terminals)) throw new Error('IM_GATEWAY_TERMINALS_UNAVAILABLE')
    return (response.data.terminals as ControlTerminalSummary[]).filter(item => item && typeof item.panelId === 'string' && typeof item.title === 'string' && typeof item.sessionId === 'string')
  },
  write: async (binding, text) => {
    // Address the exact backend session, never the currently focused panel.
    const response = await invoke('terminal.send_text', { sessionId: binding.sessionId, text })
    if (!response.ok) throw new Error('IM_GATEWAY_WRITE_FAILED')
  },
  read: async binding => {
    const response = await invoke('terminal.read_screen', { panelId: binding.panelId, sessionId: binding.sessionId, tailLines: 40 })
    const terminal = response.data?.terminal as ControlTerminalSummary | undefined
    if (!response.ok || terminal?.sessionId !== binding.sessionId || typeof response.data?.text !== 'string') throw new Error('IM_GATEWAY_READ_FAILED')
    return response.data.text
  }
})
