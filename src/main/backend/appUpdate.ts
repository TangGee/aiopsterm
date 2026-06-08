import type { AppUpdateCheckResult, AppUpdateDownloadResult, AppUpdateInstallResult, AppUpdateProgressEvent } from '@shared/preload'

export const APP_UPDATE_DOWNLOAD_STEP_DELAY_MS = 90

type AppUpdateOptions = {
  currentVersion?: string
  latestVersion?: string
  channel?: AppUpdateCheckResult['channel']
  downloadStepDelayMs?: number
}

type AppUpdateProgressEmitter = (event: AppUpdateProgressEvent) => void

let downloadedVersion = ''

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

const normalizeVersion = (value: unknown) => String(value || '').trim()

const compareVersions = (left: string, right: string) => {
  const leftParts = left.split('.').map((part) => Number(part) || 0)
  const rightParts = right.split('.').map((part) => Number(part) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const defaultLatestVersionFor = (currentVersion: string) => process.env.AIOPSTERM_UPDATE_VERSION || currentVersion

export const checkAppUpdate = (currentVersion: string, options: AppUpdateOptions = {}): AppUpdateCheckResult => {
  const version = normalizeVersion(currentVersion) || normalizeVersion(options.currentVersion) || '0.1.0'
  const latestVersion = normalizeVersion(options.latestVersion) || defaultLatestVersionFor(version)
  const channel = options.channel || (latestVersion === version ? 'local' : 'manual')
  const available = compareVersions(latestVersion, version) > 0

  return {
    available,
    channel,
    isUpdateAvailable: available,
    versionInfo: {
      version: available ? version : latestVersion,
      channel
    },
    updateInfo: available
      ? {
          version: latestVersion,
          channel
        }
      : null
  }
}

export const downloadAppUpdate = async (
  input: { version?: string } = {},
  emit?: AppUpdateProgressEmitter,
  options: AppUpdateOptions = {}
): Promise<AppUpdateDownloadResult> => {
  const version = normalizeVersion(input.version)
  if (!version) return { ok: false, errorCode: 'APP_UPDATE_VERSION_REQUIRED', errorMessage: 'Update version is required.' }

  const stepDelayMs = Math.max(0, options.downloadStepDelayMs ?? APP_UPDATE_DOWNLOAD_STEP_DELAY_MS)
  const progressSteps = [8, 32, 56, 80, 100]

  for (const percent of progressSteps) {
    emit?.({
      status: percent >= 100 ? 'downloaded' : 'downloading',
      version,
      percent,
      message: percent >= 100 ? `Update ${version} downloaded by aiopsterm backend.` : `Downloading update ${version}.`
    })
    if (percent < 100 && stepDelayMs > 0) await wait(stepDelayMs)
  }

  downloadedVersion = version
  return {
    ok: true,
    data: {
      version,
      status: 'downloaded',
      percent: 100,
      message: `Update ${version} downloaded by aiopsterm backend.`
    }
  }
}

export const installAppUpdate = async (input: { version?: string } = {}): Promise<AppUpdateInstallResult> => {
  const version = normalizeVersion(input.version) || downloadedVersion
  if (!version) return { ok: false, errorCode: 'APP_UPDATE_VERSION_REQUIRED', errorMessage: 'Downloaded update version is required.' }
  if (downloadedVersion && version !== downloadedVersion) {
    return { ok: false, errorCode: 'APP_UPDATE_VERSION_MISMATCH', errorMessage: 'Downloaded update version does not match.' }
  }

  downloadedVersion = ''
  return {
    ok: true,
    data: {
      version,
      status: 'install-requested',
      message: `Update ${version} install requested by aiopsterm backend.`
    }
  }
}
