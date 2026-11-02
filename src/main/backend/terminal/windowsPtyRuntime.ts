import { release } from 'os'
import type { WindowsPtyInfo } from '@shared/contracts/terminalSessions'

export const windowsPtyForPlatform = (platform: NodeJS.Platform, osRelease = release()): WindowsPtyInfo | undefined => {
  if (platform !== 'win32') return undefined
  const buildNumber = Number(osRelease.split('.')[2])
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) return { backend: 'conpty' }
  return { backend: buildNumber >= 18309 ? 'conpty' : 'winpty', buildNumber }
}
