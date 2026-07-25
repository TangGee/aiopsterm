import { mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { jumpPoolKey } from './sshTerminalConnectionPool'
import { defaultSshKeepaliveCountMax } from './sshDefaults'
import { cleanText, getConfiguredSshControlDir, getEnv, getSshKeepaliveIntervalMs } from './sshTerminalRuntimeConfig'
import type { SshTerminalTarget } from './sshTerminalTypes'

export const getSshControlDir = () => {
  const configured = getConfiguredSshControlDir()
  const base = configured || join(tmpdir(), `aiopsterm-ssh-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`)
  try {
    mkdirSync(base, { recursive: true, mode: 0o700 })
  } catch {}
  return base
}

export const relayControlPath = (jumpTarget: SshTerminalTarget) => join(getSshControlDir(), `cm-${jumpPoolKey(jumpTarget)}`)

export const pathExists = (path: string) => {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

export const getLocalSshSpawnCwd = () => {
  const env = getEnv()
  const candidates = [cleanText(env.HOME), cleanText(env.USERPROFILE), cleanText(env.PWD)]
  try {
    candidates.push(process.cwd())
  } catch {}
  for (const candidate of candidates) {
    try {
      if (candidate && statSync(candidate).isDirectory()) return candidate
    } catch {}
  }
  return '.'
}

export const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

export const sshDestination = (target: Pick<SshTerminalTarget, 'username' | 'host'>) => `${target.username}@${target.host}`

export const sshKeepaliveIntervalSeconds = () => Math.max(0, Math.ceil(getSshKeepaliveIntervalMs() / 1000))

export const sshKeepaliveOptions = () => {
  const interval = sshKeepaliveIntervalSeconds()
  return interval > 0
    ? [
        '-o',
        `ServerAliveInterval=${interval}`,
        '-o',
        `ServerAliveCountMax=${defaultSshKeepaliveCountMax}`
      ]
    : []
}

export const relayShellSshArgs = (jumpTarget: SshTerminalTarget) => [
  '-F',
  '/dev/null',
  '-o',
  'ControlMaster=auto',
  '-o',
  'ControlPersist=yes',
  '-o',
  `ControlPath=${relayControlPath(jumpTarget)}`,
  ...sshKeepaliveOptions(),
  '-o',
  'HostKeyAlgorithms=+ssh-rsa',
  '-o',
  'PubkeyAcceptedAlgorithms=+ssh-rsa',
  '-tt',
  '-p',
  String(jumpTarget.port),
  sshDestination(jumpTarget)
]

export const relayShellAuthPromptPattern =
  /(password|passphrase|verification code|verify code|one-time|otp|token|duo|keyboard-interactive|are you sure you want to continue connecting|yes\/no|input.*password)/i

export const relayShellReadyPattern = /([$#>]\s*$|[^\s]+@[^\s]+[: ].*[$#>]\s*$)/i
export const bracketPromptPattern = /^\[?([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)(?:[^\n]*)[#$>]\s*$/

export const stripTerminalControl = (value: string) =>
  value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '\n')

export const shouldBootstrapRelayShell = (value: string) => {
  const text = stripTerminalControl(value).trimEnd()
  if (!text.trim()) return false
  const tail = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (tail && relayShellReadyPattern.test(tail)) return true
  if (tail && relayShellAuthPromptPattern.test(tail)) return false
  return relayShellReadyPattern.test(text)
}

export const parsePromptEndpoint = (value: string) => {
  const text = stripTerminalControl(value).trimEnd()
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(bracketPromptPattern)
    if (match) return { actualUsername: match[1], actualHost: match[2] }
  }
  return null
}

export const hostLooksRelated = (actualHost: string, expectedHost: string) => {
  const actual = actualHost.toLowerCase()
  const expected = expectedHost.toLowerCase()
  return actual === expected || actual.startsWith(`${expected}.`) || expected.startsWith(`${actual}.`)
}

export const inferRelayTargetReady = (value: string, jumpTarget: SshTerminalTarget, target: SshTerminalTarget) => {
  const text = stripTerminalControl(value).trimEnd()
  if (!text.trim()) return null
  const tail = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (tail && relayShellAuthPromptPattern.test(tail)) return null
  const endpoint = parsePromptEndpoint(text)
  if (!endpoint) return null
  const isRelayPrompt = endpoint.actualUsername === jumpTarget.username && hostLooksRelated(endpoint.actualHost, jumpTarget.host)
  if (isRelayPrompt) return null
  const hostMatches = hostLooksRelated(endpoint.actualHost, target.host)
  const userMatches = endpoint.actualUsername === target.username
  const promptLooksReady = tail ? relayShellReadyPattern.test(tail) : false
  if (hostMatches || (userMatches && endpoint.actualUsername !== jumpTarget.username) || promptLooksReady) return endpoint
  return null
}

export const createHiddenTextFilter = (onData: (chunk: string) => void) => {
  let buffer = ''
  const hidden: string[] = []
  const addHiddenText = (value: string) => {
    const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!text) return
    const variants = new Set([text, text.replace(/\n/g, '\r\n'), text.replace(/\n/g, '\r')])
    for (const variant of variants) {
      if (variant && !hidden.includes(variant)) hidden.push(variant)
    }
  }
  const safeEmitIndex = (value: string) => {
    const maxLength = Math.max(1, ...hidden.map((item) => item.length))
    for (let index = Math.max(0, value.length - maxLength + 1); index < value.length; index += 1) {
      const suffix = value.slice(index)
      if (hidden.some((item) => item.startsWith(suffix))) return index
    }
    return value.length
  }
  const handle = (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      let matchIndex = -1
      let matchText = ''
      for (const item of hidden) {
        const index = buffer.indexOf(item)
        if (index >= 0 && (matchIndex < 0 || index < matchIndex || (index === matchIndex && item.length > matchText.length))) {
          matchIndex = index
          matchText = item
        }
      }
      if (matchIndex >= 0) {
        if (matchIndex > 0) {
          const emit = buffer.slice(0, matchIndex)
          buffer = buffer.slice(matchIndex)
          if (emit) onData(emit)
        }
        buffer = buffer.slice(matchText.length)
        continue
      }
      const emitIndex = safeEmitIndex(buffer)
      if (emitIndex <= 0) return
      const emit = buffer.slice(0, emitIndex)
      buffer = buffer.slice(emitIndex)
      if (emit) onData(emit)
      return
    }
  }
  const flush = () => {
    if (buffer) onData(buffer)
    buffer = ''
  }
  return { addHiddenText, handle, flush }
}

export const relayShellCommand = (target: SshTerminalTarget) => ['ssh', ...sshKeepaliveOptions(), '-tt', '-p', String(target.port), '--', shellSingleQuote(sshDestination(target))].join(' ')
