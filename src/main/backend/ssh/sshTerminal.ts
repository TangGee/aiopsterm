import { clearSshConnectionPools } from './sshTerminalConnectionPool'
import { setSshTerminalBackendRuntimeConfig } from './sshTerminalRuntimeConfig'
import type { SshTerminalRuntimeConfig } from './sshTerminalTypes'

export type {
  SshTerminalCreateResult,
  SshTerminalEventSink,
  SshTerminalRuntimeConfig,
  SshTerminalSession,
  SshTerminalTarget
} from './sshTerminalTypes'
export { resolveSshTerminalTarget } from './sshTerminalRuntimeConfig'
import { createSshTerminalSession as createSession } from './sshTerminalSessionRuntime'
import { createRecoveringSshTerminalSession } from './sshTerminalRecovery'
import type { TerminalCreateOptions } from '@shared/contracts/terminalSessions'
import type { SshTerminalEventSink } from './sshTerminalTypes'

export const createSshTerminalSession = (id: string, options: TerminalCreateOptions, sink: SshTerminalEventSink) =>
  (options.sshAutoReconnect || options.sshShellIntegration) ? createRecoveringSshTerminalSession(id, options, sink, createSession) : createSession(id, options, sink)

export const configureSshTerminalBackendRuntime = (config: SshTerminalRuntimeConfig = {}) => {
  setSshTerminalBackendRuntimeConfig(config)
  clearSshConnectionPools()
}
