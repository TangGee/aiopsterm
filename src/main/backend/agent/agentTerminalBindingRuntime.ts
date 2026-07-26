export type AgentTerminalBinding = {
  agentId: string
  sessionId: string
  terminalSessionId: string
  panelId?: string
  workspaceId?: string
  cwd?: string
  boundAt: number
}

export type AgentTerminalBindingSignal = {
  kind: 'activate' | 'end'
  agentId: string
  sessionId: string
  terminalSessionId: string
  panelId?: string
  workspaceId?: string
  cwd?: string
  at?: number
}

export type AgentTerminalBindingChange = {
  changed: boolean
  current: AgentTerminalBinding | null
  previous: AgentTerminalBinding | null
}

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const bindingKey = (agentId: string, sessionId: string) => `${agentId}\0${sessionId}`

export const createAgentTerminalBindingRuntime = () => {
  const byTerminal = new Map<string, AgentTerminalBinding>()
  const terminalByAgentSession = new Map<string, string>()

  const remove = (binding: AgentTerminalBinding) => {
    byTerminal.delete(binding.terminalSessionId)
    terminalByAgentSession.delete(bindingKey(binding.agentId, binding.sessionId))
  }

  const bind = (signal: AgentTerminalBindingSignal): AgentTerminalBindingChange => {
    const agentId = cleanText(signal.agentId)
    const sessionId = cleanText(signal.sessionId)
    const terminalSessionId = cleanText(signal.terminalSessionId)
    if (!agentId || !sessionId || !terminalSessionId) {
      return { changed: false, current: null, previous: null }
    }

    const previous = byTerminal.get(terminalSessionId) || null
    const previousTerminal = terminalByAgentSession.get(bindingKey(agentId, sessionId))
    if (previousTerminal && previousTerminal !== terminalSessionId) {
      const previousAgentBinding = byTerminal.get(previousTerminal)
      if (previousAgentBinding) remove(previousAgentBinding)
    }

    const current: AgentTerminalBinding = {
      agentId,
      sessionId,
      terminalSessionId,
      ...(cleanText(signal.panelId) ? { panelId: cleanText(signal.panelId) } : {}),
      ...(cleanText(signal.workspaceId) ? { workspaceId: cleanText(signal.workspaceId) } : {}),
      ...(cleanText(signal.cwd) ? { cwd: cleanText(signal.cwd) } : {}),
      boundAt: signal.at || Date.now()
    }
    const unchanged = previous?.agentId === current.agentId &&
      previous.sessionId === current.sessionId &&
      previous.panelId === current.panelId &&
      previous.workspaceId === current.workspaceId &&
      previous.cwd === current.cwd
    if (previous) remove(previous)
    byTerminal.set(terminalSessionId, current)
    terminalByAgentSession.set(bindingKey(agentId, sessionId), terminalSessionId)
    return { changed: !unchanged, current, previous }
  }

  const end = (signal: AgentTerminalBindingSignal): AgentTerminalBindingChange => {
    const terminalSessionId = cleanText(signal.terminalSessionId)
    const current = byTerminal.get(terminalSessionId) || null
    if (!current ||
      current.agentId !== cleanText(signal.agentId) ||
      current.sessionId !== cleanText(signal.sessionId)) {
      return { changed: false, current, previous: null }
    }
    remove(current)
    return { changed: true, current: null, previous: current }
  }

  const apply = (signal: AgentTerminalBindingSignal) =>
    signal.kind === 'activate' ? bind(signal) : end(signal)

  const releaseTerminal = (terminalSessionIdInput: string): AgentTerminalBindingChange => {
    const terminalSessionId = cleanText(terminalSessionIdInput)
    const previous = byTerminal.get(terminalSessionId) || null
    if (!previous) return { changed: false, current: null, previous: null }
    remove(previous)
    return { changed: true, current: null, previous }
  }

  const getByTerminal = (terminalSessionIdInput: string) =>
    byTerminal.get(cleanText(terminalSessionIdInput)) || null

  const clear = () => {
    byTerminal.clear()
    terminalByAgentSession.clear()
  }

  return {
    apply,
    releaseTerminal,
    getByTerminal,
    clear
  }
}

export type AgentTerminalBindingRuntime = ReturnType<typeof createAgentTerminalBindingRuntime>
