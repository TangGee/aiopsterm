import type { AppUpdateOnlineCheckResult, AppUpdateReleaseArtifact } from '@shared/contracts/appRuntime'

export const APP_UPDATE_RELEASES_URL = 'https://api.aiopsterm.com/v1/releases/stable'
export const APP_UPDATE_DOWNLOAD_PAGE_URL = 'https://aiopsterm.com/download'
export const APP_UPDATE_CHECK_TIMEOUT_MS = 10_000

type StableReleasePayload = {
  available?: unknown
  channel?: unknown
  version?: unknown
  releasedAt?: unknown
  artifacts?: unknown
}

type CheckStableReleaseUpdateInput = {
  currentVersion: string
  platform?: string
  arch?: string
  releasesUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeText = (value: unknown) => String(value || '').trim()

const normalizeVersion = (value: unknown) => normalizeText(value).replace(/^v/i, '')

export const compareReleaseVersions = (left: string, right: string) => {
  const parse = (value: string) =>
    normalizeVersion(value)
      .split(/[.-]/)
      .map((part) => Number(part) || 0)
  const leftParts = parse(left)
  const rightParts = parse(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const normalizeReleasePlatform = (platform: string): AppUpdateReleaseArtifact['platform'] | '' => {
  const normalized = normalizeText(platform).toLowerCase()
  if (normalized === 'darwin' || normalized === 'mac' || normalized === 'macos' || normalized === 'osx') return 'macos'
  if (normalized === 'win32' || normalized === 'windows') return 'windows'
  if (normalized === 'linux') return 'linux'
  return ''
}

const normalizeReleaseArch = (arch: string) => {
  const normalized = normalizeText(arch).toLowerCase()
  if (normalized === 'x86_64' || normalized === 'amd64') return 'x64'
  if (normalized === 'aarch64') return 'arm64'
  return normalized
}

const isReleaseArtifact = (source: unknown): source is AppUpdateReleaseArtifact =>
  isRecord(source) &&
  (source.platform === 'macos' || source.platform === 'windows' || source.platform === 'linux') &&
  typeof source.arch === 'string' &&
  Boolean(normalizeText(source.arch)) &&
  typeof source.kind === 'string' &&
  typeof source.sha256 === 'string' &&
  Boolean(normalizeText(source.urlGlobal)) &&
  typeof source.urlChina === 'string'

export const selectReleaseArtifact = (artifacts: AppUpdateReleaseArtifact[], platform: string, arch: string): AppUpdateReleaseArtifact | null => {
  const releasePlatform = normalizeReleasePlatform(platform)
  if (!releasePlatform) return null
  const candidates = artifacts.filter((artifact) => artifact.platform === releasePlatform)
  if (!candidates.length) return null
  const releaseArch = normalizeReleaseArch(arch)
  return (
    candidates.find((artifact) => normalizeReleaseArch(artifact.arch) === releaseArch) ||
    candidates.find((artifact) => normalizeReleaseArch(artifact.arch) === 'universal') ||
    null
  )
}

const checkError = (errorCode: string, errorMessage: string): AppUpdateOnlineCheckResult => ({
  ok: false,
  errorCode,
  errorMessage
})

export const checkStableReleaseUpdate = async (input: CheckStableReleaseUpdateInput): Promise<AppUpdateOnlineCheckResult> => {
  const currentVersion = normalizeVersion(input.currentVersion) || '0.1.0'
  const fetchImpl = input.fetchImpl || (typeof fetch === 'function' ? fetch : undefined)
  if (!fetchImpl) return checkError('APP_UPDATE_FETCH_UNAVAILABLE', 'Network fetch is not available in this runtime.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? APP_UPDATE_CHECK_TIMEOUT_MS)

  let response: Awaited<ReturnType<typeof fetch>>
  try {
    response = await fetchImpl(input.releasesUrl || APP_UPDATE_RELEASES_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      return checkError('APP_UPDATE_CHECK_TIMEOUT', `Update check timed out after ${input.timeoutMs ?? APP_UPDATE_CHECK_TIMEOUT_MS} ms.`)
    }
    return checkError('APP_UPDATE_CHECK_FAILED', error instanceof Error ? error.message : 'Update check request failed.')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return checkError('APP_UPDATE_CHECK_HTTP_ERROR', `Update check failed with HTTP ${response.status}.`)
  }

  let payload: StableReleasePayload
  try {
    payload = (await response.json()) as StableReleasePayload
  } catch {
    return checkError('APP_UPDATE_CHECK_INVALID_RESPONSE', 'Update check returned an invalid response.')
  }
  if (!isRecord(payload) || !normalizeVersion(payload.version)) {
    return checkError('APP_UPDATE_CHECK_INVALID_RESPONSE', 'Update check returned an invalid response.')
  }

  const version = normalizeVersion(payload.version)
  const artifacts = (Array.isArray(payload.artifacts) ? payload.artifacts : []).filter(isReleaseArtifact)
  const available = payload.available !== false && compareReleaseVersions(version, currentVersion) > 0
  const artifact = available ? selectReleaseArtifact(artifacts, input.platform || process.platform, input.arch || process.arch) : null

  return {
    ok: true,
    data: {
      available,
      currentVersion,
      version,
      channel: normalizeText(payload.channel) || 'stable',
      releasedAt: normalizeText(payload.releasedAt),
      downloadUrl: available ? normalizeText(artifact?.urlGlobal) || APP_UPDATE_DOWNLOAD_PAGE_URL : '',
      downloadPageUrl: APP_UPDATE_DOWNLOAD_PAGE_URL,
      artifact
    }
  }
}
