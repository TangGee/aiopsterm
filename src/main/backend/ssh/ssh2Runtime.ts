import type { Client as Ssh2Client } from 'ssh2'

export const loadSsh2 = (): { Client: new () => Ssh2Client } | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ssh2') as { Client: new () => Ssh2Client }
  } catch {
    return null
  }
}
