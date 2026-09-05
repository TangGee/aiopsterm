import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type ReleaseArtifact = {
  platform: 'macos' | 'windows' | 'linux'
  arch: string
  kind: string
  sha256: string
  urlGlobal: string
  urlChina: string
}

type OnlineCheckResult = {
  ok: boolean
  data?: {
    available: boolean
    currentVersion: string
    version: string
    channel: string
    releasedAt: string
    downloadUrl: string
    downloadPageUrl: string
    artifact: ReleaseArtifact | null
  }
  errorCode?: string
  errorMessage?: string
}

let compareReleaseVersions: (left: string, right: string) => number
let selectReleaseArtifact: (artifacts: ReleaseArtifact[], platform: string, arch: string) => ReleaseArtifact | null
let checkStableReleaseUpdate: (input: {
  currentVersion: string
  platform?: string
  arch?: string
  releasesUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}) => Promise<OnlineCheckResult>
let registerAppUpdateIpc: (ipcMain: unknown, input: { getVersion: () => string; getUserDataPath: () => string; getPlatform?: () => string; getArch?: () => string }) => void

const macArm64Artifact: ReleaseArtifact = {
  platform: 'macos',
  arch: 'arm64',
  kind: 'dmg',
  sha256: 'a'.repeat(64),
  urlGlobal: 'https://downloads.aiopsterm.com/aiopsterm-0.2.0-macos-arm64.dmg',
  urlChina: 'https://mirror.example.cn/aiopsterm-0.2.0-macos-arm64.dmg'
}

const macX64Artifact: ReleaseArtifact = {
  platform: 'macos',
  arch: 'x64',
  kind: 'dmg',
  sha256: 'b'.repeat(64),
  urlGlobal: 'https://downloads.aiopsterm.com/aiopsterm-0.2.0-macos-x64.dmg',
  urlChina: 'https://mirror.example.cn/aiopsterm-0.2.0-macos-x64.dmg'
}

const windowsX64Artifact: ReleaseArtifact = {
  platform: 'windows',
  arch: 'x64',
  kind: 'nsis',
  sha256: 'c'.repeat(64),
  urlGlobal: 'https://downloads.aiopsterm.com/aiopsterm-0.2.0-windows-x64.exe',
  urlChina: 'https://mirror.example.cn/aiopsterm-0.2.0-windows-x64.exe'
}

const stablePayload = (overrides: Record<string, unknown> = {}) => ({
  available: true,
  channel: 'stable',
  version: '0.2.0',
  releasedAt: '2026-09-01T00:00:00.000Z',
  artifacts: [macArm64Artifact, macX64Artifact, windowsX64Artifact],
  ...overrides
})

const jsonResponse = (payload: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  }) as unknown as Response

const fetchReturning = (payload: unknown, status = 200) => (async () => jsonResponse(payload, status)) as unknown as typeof fetch

beforeAll(async () => {
  const backendModulePath = '../src/main/backend/app/updateCheck'
  const ipcModulePath = '../src/main/ipc/appUpdate'
  const backend = await import(backendModulePath)
  compareReleaseVersions = backend.compareReleaseVersions as typeof compareReleaseVersions
  selectReleaseArtifact = backend.selectReleaseArtifact as unknown as typeof selectReleaseArtifact
  checkStableReleaseUpdate = backend.checkStableReleaseUpdate as unknown as typeof checkStableReleaseUpdate
  const ipcModule = await import(ipcModulePath)
  registerAppUpdateIpc = ipcModule.registerAppUpdateIpc as unknown as typeof registerAppUpdateIpc
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('compareReleaseVersions', () => {
  it('compares numeric x.y.z versions', () => {
    expect(compareReleaseVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareReleaseVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareReleaseVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
  })

  it('tolerates v prefixes and missing segments', () => {
    expect(compareReleaseVersions('v0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2', '0.2.0')).toBe(0)
    expect(compareReleaseVersions('0.2.1', '0.2')).toBeGreaterThan(0)
  })
})

describe('selectReleaseArtifact', () => {
  const artifacts = [macArm64Artifact, macX64Artifact, windowsX64Artifact]

  it('picks the exact platform and arch match', () => {
    expect(selectReleaseArtifact(artifacts, 'darwin', 'arm64')).toEqual(macArm64Artifact)
    expect(selectReleaseArtifact(artifacts, 'darwin', 'x64')).toEqual(macX64Artifact)
    expect(selectReleaseArtifact(artifacts, 'win32', 'x64')).toEqual(windowsX64Artifact)
  })

  it('normalizes common arch aliases', () => {
    expect(selectReleaseArtifact(artifacts, 'darwin', 'aarch64')).toEqual(macArm64Artifact)
    expect(selectReleaseArtifact(artifacts, 'win32', 'amd64')).toEqual(windowsX64Artifact)
  })

  it('falls back to a universal artifact for the platform', () => {
    const universal: ReleaseArtifact = { ...macArm64Artifact, arch: 'universal' }
    expect(selectReleaseArtifact([universal], 'darwin', 'ppc')).toEqual(universal)
  })

  it('returns null when the platform or arch has no match', () => {
    expect(selectReleaseArtifact(artifacts, 'linux', 'x64')).toBeNull()
    expect(selectReleaseArtifact(artifacts, 'darwin', 'ppc')).toBeNull()
    expect(selectReleaseArtifact([], 'darwin', 'arm64')).toBeNull()
  })
})

describe('checkStableReleaseUpdate', () => {
  it('reports an available update with the matching artifact download url', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning(stablePayload())
    })
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(true)
    expect(result.data?.currentVersion).toBe('0.1.0')
    expect(result.data?.version).toBe('0.2.0')
    expect(result.data?.channel).toBe('stable')
    expect(result.data?.artifact).toEqual(macArm64Artifact)
    expect(result.data?.downloadUrl).toBe(macArm64Artifact.urlGlobal)
  })

  it('falls back to the download page when no artifact matches the platform', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      fetchImpl: fetchReturning(stablePayload())
    })
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(true)
    expect(result.data?.artifact).toBeNull()
    expect(result.data?.downloadUrl).toBe('https://aiopsterm.com/download')
    expect(result.data?.downloadPageUrl).toBe('https://aiopsterm.com/download')
  })

  it('reports no update when the version is not newer', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning(stablePayload({ version: '0.1.0' }))
    })
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(false)
    expect(result.data?.artifact).toBeNull()
    expect(result.data?.downloadUrl).toBe('')
  })

  it('reports no update when the server marks available=false', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning(stablePayload({ available: false }))
    })
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(false)
  })

  it('never reports a downgrade as an update', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.3.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning(stablePayload())
    })
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(false)
  })

  it('fails with an http error code on non-200 responses', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning({}, 503)
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_CHECK_HTTP_ERROR')
    expect(result.errorMessage).toContain('503')
  })

  it('fails on invalid payload shapes', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: fetchReturning({ channel: 'stable' })
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_CHECK_INVALID_RESPONSE')
  })

  it('fails on network errors', async () => {
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: (async () => {
        throw new Error('socket hang up')
      }) as unknown as typeof fetch
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_CHECK_FAILED')
    expect(result.errorMessage).toContain('socket hang up')
  })

  it('fails with a timeout code when the request is aborted', async () => {
    const abortingFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      })) as unknown as typeof fetch
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      timeoutMs: 20,
      fetchImpl: abortingFetch
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_CHECK_TIMEOUT')
  })

  it('fails when fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined)
    const result = await checkStableReleaseUpdate({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_FETCH_UNAVAILABLE')
  })
})

describe('app:check-for-updates ipc handler', () => {
  const registerHandlers = () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const fakeIpcMain = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener)
      }
    }
    registerAppUpdateIpc(fakeIpcMain, {
      getVersion: () => '0.1.0',
      getUserDataPath: () => '/tmp/aiopsterm-test',
      getPlatform: () => 'darwin',
      getArch: () => 'arm64'
    })
    return handlers
  }

  it('returns a structured success result', async () => {
    const handlers = registerHandlers()
    const handler = handlers.get('app:check-for-updates')
    expect(typeof handler).toBe('function')
    vi.stubGlobal('fetch', fetchReturning(stablePayload()))
    const result = (await handler!()) as OnlineCheckResult
    expect(result.ok).toBe(true)
    expect(result.data?.available).toBe(true)
    expect(result.data?.currentVersion).toBe('0.1.0')
    expect(result.data?.version).toBe('0.2.0')
    expect(result.data?.artifact?.platform).toBe('macos')
    expect(result.data?.artifact?.arch).toBe('arm64')
    expect(result.data?.downloadUrl).toBe(macArm64Artifact.urlGlobal)
    expect(result.data?.downloadPageUrl).toBe('https://aiopsterm.com/download')
  })

  it('returns a structured failure result on http errors', async () => {
    const handlers = registerHandlers()
    const handler = handlers.get('app:check-for-updates')
    vi.stubGlobal('fetch', fetchReturning({}, 500))
    const result = (await handler!()) as OnlineCheckResult
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('APP_UPDATE_CHECK_HTTP_ERROR')
  })
})
