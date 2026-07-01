import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { promisify } from 'util'

export type ManagedAiSessionGitInfo = {
  gitBranch?: string
  gitDirty?: boolean
  gitStatusUpdatedAt?: number
}

export type AgentSessionGitRuntime = {
  configure: (input?: Partial<AgentSessionGitRuntimeConfig>) => void
  gitInfoForCwd: (cwd?: string) => Promise<ManagedAiSessionGitInfo>
}

type AgentSessionGitRuntimeConfig = {
  enabled: boolean
  ttlMs: number
  timeoutMs: number
  now: () => number
  runGit: (cwd: string, args: string[], timeoutMs: number) => Promise<string>
}

const execFileAsync = promisify(execFile)
const defaultTtlMs = 30_000
const defaultTimeoutMs = 1500

const cleanBranch = (value: string) => value.trim().split(/\r?\n/)[0]?.trim() || ''

const defaultRunGit = async (cwd: string, args: string[], timeoutMs: number) => {
  const result = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
    windowsHide: true
  })
  return String(result.stdout || '')
}

const normalizeCwd = (cwd?: string) => {
  const value = String(cwd || '').trim()
  if (!value) return undefined
  try {
    return existsSync(value) && statSync(value).isDirectory() ? value : undefined
  } catch {
    return undefined
  }
}

const branchFor = async (config: AgentSessionGitRuntimeConfig, cwd: string) => {
  const symbolic = cleanBranch(await config.runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], config.timeoutMs))
  if (symbolic && symbolic !== 'HEAD') return symbolic
  const detached = cleanBranch(await config.runGit(cwd, ['rev-parse', '--short', 'HEAD'], config.timeoutMs))
  return detached ? `detached:${detached}` : ''
}

export const createAgentSessionGitRuntime = (config: Partial<AgentSessionGitRuntimeConfig> = {}): AgentSessionGitRuntime => {
  const defaultConfig: AgentSessionGitRuntimeConfig = {
    enabled: process.env.AIOPSTERM_AGENT_SESSION_GIT_DISABLED !== '1',
    ttlMs: defaultTtlMs,
    timeoutMs: defaultTimeoutMs,
    now: () => Date.now(),
    runGit: defaultRunGit
  }
  let runtimeConfig: AgentSessionGitRuntimeConfig = { ...defaultConfig, ...config }
  const cache = new Map<string, ManagedAiSessionGitInfo>()
  const pending = new Map<string, Promise<ManagedAiSessionGitInfo>>()

  const probe = async (cwd: string) => {
    const now = runtimeConfig.now()
    try {
      const branch = await branchFor(runtimeConfig, cwd)
      if (!branch) return { gitStatusUpdatedAt: now }
      const porcelain = await runtimeConfig.runGit(cwd, ['status', '--porcelain'], runtimeConfig.timeoutMs)
      return {
        gitBranch: branch,
        gitDirty: porcelain.trim().length > 0,
        gitStatusUpdatedAt: now
      }
    } catch {
      return { gitStatusUpdatedAt: now }
    }
  }

  const gitInfoForCwd = async (cwd?: string) => {
    if (!runtimeConfig.enabled) return {}
    const normalized = normalizeCwd(cwd)
    if (!normalized) return {}
    const cached = cache.get(normalized)
    const now = runtimeConfig.now()
    if (cached?.gitStatusUpdatedAt && now - cached.gitStatusUpdatedAt < runtimeConfig.ttlMs) return cached
    const existing = pending.get(normalized)
    if (existing) return existing
    const request = probe(normalized)
      .then((info) => {
        cache.set(normalized, info)
        return info
      })
      .finally(() => {
        pending.delete(normalized)
      })
    pending.set(normalized, request)
    return request
  }

  return {
    configure: (input = {}) => {
      runtimeConfig = { ...defaultConfig, ...input }
      cache.clear()
      pending.clear()
    },
    gitInfoForCwd
  }
}
