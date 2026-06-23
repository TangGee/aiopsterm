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
export { createSshTerminalSession } from './sshTerminalSessionRuntime'

export const configureSshTerminalBackendRuntime = (config: SshTerminalRuntimeConfig = {}) => {
  setSshTerminalBackendRuntimeConfig(config)
  clearSshConnectionPools()
}
