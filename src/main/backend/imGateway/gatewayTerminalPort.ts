import type { ControlResponse, ControlTerminalSummary } from '@shared/contracts/control'
import { subscribeTerminalOutput } from '../terminal/terminalOutputEvents'
import type { GatewayHost, GatewayTerminalPort } from './gatewayTypes'

type Invoke = (method: string, params?: Record<string, unknown>) => Promise<ControlResponse>
export const createGatewayTerminalPort = (invoke: Invoke): GatewayTerminalPort => ({
  list: async () => {
    const response = await invoke('terminal.list')
    if (!response.ok || !Array.isArray(response.data?.terminals)) throw new Error('IM_GATEWAY_TERMINALS_UNAVAILABLE')
    return (response.data.terminals as ControlTerminalSummary[]).filter(item => item && typeof item.panelId === 'string' && typeof item.title === 'string' && typeof item.sessionId === 'string')
  },
  subscribe: (binding, receive) => subscribeTerminalOutput(binding.sessionId, receive),
  hosts: async () => {
    const response = await invoke('asset.list', { connectableOnly: true })
    if (!response.ok || !Array.isArray(response.data?.assets)) throw new Error('IM_GATEWAY_HOSTS_UNAVAILABLE')
    return (response.data.assets as GatewayHost[]).filter(item => typeof item.id === 'string' && typeof item.name === 'string' && typeof item.host === 'string').map(({ id, name, host }) => ({ id, name, host }))
  },
  create: async (assetId, active = () => true) => {
    // Resolve the exact saved asset before using the general host lookup API.
    if (assetId) {
      const hosts = await invoke('asset.list', { connectableOnly: true })
      if (!hosts.ok || !Array.isArray(hosts.data?.assets) || !hosts.data.assets.some((item: GatewayHost) => item.id === assetId)) throw new Error('IM_GATEWAY_HOST_UNAVAILABLE')
    }
    if (!active()) throw new Error('IM_GATEWAY_STOPPED')
    const response = await invoke(assetId ? 'asset.ssh.connect' : 'surface.create', assetId ? { assetId, exactAssetId: true, reuse: false } : { type: 'local', focus: true, autoConnect: true })
    const panelId = response.data?.surfaceId
    if (!response.ok || typeof panelId !== 'string') throw new Error('IM_GATEWAY_CREATE_FAILED')
    if (response.data?.connected === false) throw new Error('IM_GATEWAY_CREATE_NOT_CONNECTED')
    // Never bind an unrelated active panel while the renderer publishes the new session.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!active()) throw new Error('IM_GATEWAY_STOPPED')
      const listed = await invoke('terminal.list')
      const terminal = (listed.data?.terminals as ControlTerminalSummary[] | undefined)?.find(item => item.panelId === panelId)
      if (listed.ok && terminal?.connected && terminal.sessionId && (assetId ? terminal.assetId === assetId && terminal.kind === 'ssh' : terminal.kind === 'local')) return terminal
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('IM_GATEWAY_CREATE_NOT_CONNECTED')
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
