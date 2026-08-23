import type { TerminalDisconnectReason } from '@shared/contracts/terminalSessions'
import { createTerminalLifecycleEvent } from '../terminal/terminal'
import { createLifecycleBase, sendLifecycle } from './sshTerminalRuntimeConfig'
import type { SshTerminalCreateResult, SshTerminalEventSink, SshTerminalSession, SshTerminalTarget } from './sshTerminalTypes'

export const createBackendDoubleSession = (
  id: string,
  target: SshTerminalTarget,
  sink: SshTerminalEventSink,
  panelId?: string
): SshTerminalCreateResult => {
  const { cwd, lifecycleBase } = createLifecycleBase(id, target, panelId)
  let closed = false
  const session: SshTerminalSession = {
    write: () => undefined,
    resize: () => undefined,
    kill(reason: TerminalDisconnectReason = 'manual') {
      if (closed) return
      closed = true
      sink.closed?.(id)
      const lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'closed',
        code: 0,
        reason,
        isNetworkDisconnect: false,
        message: reason === 'manual' ? 'Terminal closed by user.' : 'SSH terminal closed.'
      })
      sink.exit(lifecycle, 0)
    }
  }
  const lifecycle = createTerminalLifecycleEvent(id, {
    ...lifecycleBase,
    stage: 'shell-ready',
    message: target.host ? `SSH shell ready ${target.username}@${target.host}:${target.port}` : 'SSH shell ready.'
  })
  sink.lifecycle(lifecycle)
  return {
    shell: 'ssh',
    cwd,
    session,
    connection: target,
    lifecycle
  }
}
