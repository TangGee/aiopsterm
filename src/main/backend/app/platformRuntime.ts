import { createHash } from 'crypto'
import { basename, posix } from 'path'

export type PlatformRuntime = NodeJS.Platform

export const isWindowsPlatform = (platform: PlatformRuntime = process.platform) => platform === 'win32'

export const defaultShellForPlatform = (env: NodeJS.ProcessEnv = process.env, platform: PlatformRuntime = process.platform) => {
  if (isWindowsPlatform(platform)) return 'powershell.exe'
  if (platform === 'darwin') return env.SHELL || '/bin/zsh'
  return env.SHELL || '/bin/bash'
}

const loginShellNames = new Set(['zsh', 'bash', 'fish', 'sh'])

export const localShellArgsForPlatform = (shell: string, platform: PlatformRuntime = process.platform) => {
  if (isWindowsPlatform(platform)) return []
  const shellName = basename(shell).toLowerCase()
  return loginShellNames.has(shellName) ? ['--login'] : []
}

export const executableCandidateNames = (binaryName: string, env: NodeJS.ProcessEnv = process.env, platform: PlatformRuntime = process.platform) => {
  const cleanName = String(binaryName || '').trim()
  if (!cleanName) return []
  if (!isWindowsPlatform(platform)) return [cleanName]
  if (/\.[^\\/]+$/.test(cleanName)) return [cleanName]
  const extensions = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return [cleanName, ...extensions.map((extension) => `${cleanName}${extension}`)]
}

export const platformSocketPath = (
  userDataPath: string,
  namespace: string,
  options: { platform?: PlatformRuntime; pid?: number; directory?: string; uid?: number; stable?: boolean } = {}
) => {
  const platform = options.platform || process.platform
  const pid = Number.isFinite(options.pid) ? Math.floor(Number(options.pid)) : process.pid
  const cleanNamespace = String(namespace || 'aiopsterm').replace(/[^a-zA-Z0-9_-]/g, '-')
  if (isWindowsPlatform(platform)) return `\\\\.\\pipe\\${cleanNamespace}${options.stable ? '' : `-${pid}`}`
  const directory = options.directory || cleanNamespace
  const socketName = `${cleanNamespace}${options.stable ? '' : `-${pid}`}.sock`
  const preferredPath = posix.join(userDataPath, directory, socketName)
  if (Buffer.byteLength(preferredPath) <= 103) return preferredPath

  const uid = Number.isFinite(options.uid)
    ? Math.floor(Number(options.uid))
    : typeof process.getuid === 'function'
      ? process.getuid()
      : 0
  const profileSuffix = options.stable
    ? `-${createHash('sha256').update(userDataPath).digest('hex').slice(0, 12)}`
    : `-${pid}`
  return posix.join('/tmp', `aiopsterm-${uid}`, `${cleanNamespace}${profileSuffix}.sock`)
}
