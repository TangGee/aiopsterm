// Internal terminal output subscriptions. Subscribers never block PTY delivery.
const listeners = new Map<string, Set<(data: string) => void>>()
export const subscribeTerminalOutput = (sessionId: string, receive: (data: string) => void) => {
  const set = listeners.get(sessionId) || new Set<(data: string) => void>()
  set.add(receive)
  listeners.set(sessionId, set)
  return () => { set.delete(receive); if (!set.size) listeners.delete(sessionId) }
}
export const publishTerminalOutput = (sessionId: string, data: string) => {
  for (const receive of listeners.get(sessionId) || []) {
    try { receive(data) } catch { /* An optional consumer cannot break terminal rendering. */ }
  }
}
