import { createHash } from 'crypto'
import { createReadStream, createWriteStream, readFileSync, statSync } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type { AppUpdateCheckResult, AppUpdateDownloadResult, AppUpdateInstallResult, AppUpdateProgressEvent } from '@shared/preload'

type AppUpdateManifest = {
  version?: unknown
  channel?: unknown
  path?: unknown
  filePath?: unknown
  packagePath?: unknown
  sha256?: unknown
  size?: unknown
  notes?: unknown
}

type ResolvedUpdateManifest = {
  manifestPath: string
  version: string
  channel: AppUpdateCheckResult['channel']
  packagePath: string
  fileName: string
  size: number
  sha256?: string
  notes?: string
}

type DownloadedUpdate = {
  version: string
  filePath: string
  size: number
  sha256?: string
  downloadedAt: string
}

type AppUpdateOptions = {
  currentVersion?: string
  manifestPath?: string
  cacheDir?: string
}

type AppUpdateProgressEmitter = (event: AppUpdateProgressEvent) => void

let downloadedUpdate: DownloadedUpdate | null = null

const normalizeVersion = (value: unknown) => String(value || '').trim().replace(/^v/i, '')

const normalizeText = (value: unknown) => String(value || '').trim()

const normalizeChannel = (value: unknown): AppUpdateCheckResult['channel'] => {
  const channel = normalizeText(value)
  return channel === 'auto' || channel === 'local' ? channel : 'manual'
}

const compareVersions = (left: string, right: string) => {
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

const mutationError = <T extends { ok: false; errorCode: string; errorMessage: string }>(errorCode: string, errorMessage: string): T => ({
  ok: false,
  errorCode,
  errorMessage
} as T)

const configuredManifestPath = (options: AppUpdateOptions) => {
  const explicitPath = normalizeText(options.manifestPath)
  if (explicitPath) return isAbsolute(explicitPath) ? explicitPath : resolve(explicitPath)

  const envManifestPath = normalizeText(process.env.AIOPSTERM_UPDATE_MANIFEST)
  if (envManifestPath) return isAbsolute(envManifestPath) ? envManifestPath : resolve(envManifestPath)

  const envUpdateDir = normalizeText(process.env.AIOPSTERM_UPDATE_DIR)
  if (!envUpdateDir) return ''
  const updateDir = isAbsolute(envUpdateDir) ? envUpdateDir : resolve(envUpdateDir)
  return join(updateDir, 'latest.json')
}

const resolvePackagePath = (manifestPath: string, value: unknown) => {
  const packagePath = normalizeText(value)
  if (!packagePath) return ''
  return isAbsolute(packagePath) ? packagePath : resolve(dirname(manifestPath), packagePath)
}

const readManifest = (options: AppUpdateOptions = {}): ResolvedUpdateManifest | null => {
  const manifestPath = configuredManifestPath(options)
  if (!manifestPath) return null

  let rawManifest: AppUpdateManifest
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppUpdateManifest
  } catch (error) {
    throw new Error(`Unable to read aiopsterm update manifest: ${error instanceof Error ? error.message : String(error)}`)
  }

  const version = normalizeVersion(rawManifest.version)
  if (!version) throw new Error('aiopsterm update manifest must include a version.')

  const packagePath = resolvePackagePath(manifestPath, rawManifest.packagePath || rawManifest.filePath || rawManifest.path)
  if (!packagePath) throw new Error('aiopsterm update manifest must include a package path.')

  let packageStats: ReturnType<typeof statSync>
  try {
    packageStats = statSync(packagePath)
  } catch (error) {
    throw new Error(`aiopsterm update package is not readable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!packageStats.isFile()) throw new Error('aiopsterm update package must be a file.')

  const declaredSizeText = normalizeText(rawManifest.size)
  const declaredSize = Number(declaredSizeText)
  if (declaredSizeText) {
    if (!Number.isFinite(declaredSize) || declaredSize < 0) {
      throw new Error('aiopsterm update manifest size must be a positive number.')
    }
    if (declaredSize !== packageStats.size) {
      throw new Error('aiopsterm update package size does not match the manifest.')
    }
  }

  const sha256 = normalizeText(rawManifest.sha256).toLowerCase()
  const notes = normalizeText(rawManifest.notes)
  return {
    manifestPath,
    version,
    channel: normalizeChannel(rawManifest.channel),
    packagePath,
    fileName: basename(packagePath),
    size: packageStats.size,
    ...(sha256 ? { sha256 } : {}),
    ...(notes ? { notes } : {})
  }
}

const packageInfoFor = (manifest: ResolvedUpdateManifest) => ({
  version: manifest.version,
  channel: manifest.channel,
  fileName: manifest.fileName,
  size: manifest.size,
  ...(manifest.sha256 ? { sha256: manifest.sha256 } : {}),
  ...(manifest.notes ? { notes: manifest.notes } : {})
})

const defaultCacheDir = (options: AppUpdateOptions) => {
  const optionCacheDir = normalizeText(options.cacheDir)
  if (optionCacheDir) return isAbsolute(optionCacheDir) ? optionCacheDir : resolve(optionCacheDir)
  const envCacheDir = normalizeText(process.env.AIOPSTERM_UPDATE_CACHE_DIR)
  if (envCacheDir) return isAbsolute(envCacheDir) ? envCacheDir : resolve(envCacheDir)
  return join(tmpdir(), 'aiopsterm-updates')
}

const cachedFilePathFor = (manifest: ResolvedUpdateManifest, cacheDir: string) => {
  const safeVersion = manifest.version.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(cacheDir, `${safeVersion}-${manifest.fileName}`)
}

const hashFile = (filePath: string) =>
  new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const reader = createReadStream(filePath)
    reader.on('data', (chunk) => hash.update(chunk))
    reader.on('error', rejectHash)
    reader.on('end', () => resolveHash(hash.digest('hex')))
  })

const copyPackageToCache = async (
  manifest: ResolvedUpdateManifest,
  targetPath: string,
  emit?: AppUpdateProgressEmitter
): Promise<{ sha256: string }> => {
  const tempPath = `${targetPath}.tmp`
  await rm(tempPath, { force: true })

  return new Promise((resolveCopy, rejectCopy) => {
    const hash = createHash('sha256')
    const reader = createReadStream(manifest.packagePath)
    const writer = createWriteStream(tempPath)
    let transferred = 0
    let lastPercent = 0

    const cleanup = async () => {
      reader.destroy()
      writer.destroy()
      await rm(tempPath, { force: true }).catch(() => undefined)
    }

    reader.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      transferred += buffer.length
      hash.update(buffer)
      const percent = manifest.size > 0 ? Math.min(100, Math.max(1, Math.floor((transferred / manifest.size) * 100))) : 100
      if (percent > lastPercent && percent < 100) {
        lastPercent = percent
        emit?.({
          status: 'downloading',
          version: manifest.version,
          percent,
          message: `Downloading update ${manifest.version}.`
        })
      }
    })

    reader.on('error', async (error) => {
      await cleanup()
      rejectCopy(error)
    })
    writer.on('error', async (error) => {
      await cleanup()
      rejectCopy(error)
    })
    writer.on('finish', () => {
      resolveCopy({ sha256: hash.digest('hex') })
    })
    reader.pipe(writer)
  })
}

const validateCachedUpdate = async (update: DownloadedUpdate) => {
  const packageStats = await stat(update.filePath)
  if (!packageStats.isFile()) throw new Error('Cached update package must be a file.')
  if (packageStats.size !== update.size) throw new Error('Cached update package size changed.')
  if (update.sha256) {
    const actualSha256 = await hashFile(update.filePath)
    if (actualSha256 !== update.sha256) throw new Error('Cached update package checksum changed.')
  }
}

export const resetAppUpdateStateForTests = () => {
  downloadedUpdate = null
}

export const checkAppUpdate = (currentVersion: string, options: AppUpdateOptions = {}): AppUpdateCheckResult => {
  const version = normalizeVersion(currentVersion) || normalizeVersion(options.currentVersion) || '0.1.0'
  const manifest = readManifest(options)
  const available = Boolean(manifest && compareVersions(manifest.version, version) > 0)

  return {
    available,
    channel: available && manifest ? manifest.channel : 'local',
    isUpdateAvailable: available,
    versionInfo: {
      version,
      channel: available && manifest ? manifest.channel : 'local'
    },
    updateInfo: available && manifest ? packageInfoFor(manifest) : null
  }
}

export const downloadAppUpdate = async (
  input: { version?: string } = {},
  emit?: AppUpdateProgressEmitter,
  options: AppUpdateOptions = {}
): Promise<AppUpdateDownloadResult> => {
  const version = normalizeVersion(input.version)
  if (!version) return mutationError('APP_UPDATE_VERSION_REQUIRED', 'Update version is required.')
  downloadedUpdate = null

  let manifest: ResolvedUpdateManifest | null = null
  try {
    manifest = readManifest(options)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Update manifest is invalid.'
    emit?.({ status: 'error', version, percent: 0, message: errorMessage })
    return mutationError('APP_UPDATE_MANIFEST_INVALID', errorMessage)
  }
  if (!manifest) return mutationError('APP_UPDATE_MANIFEST_REQUIRED', 'Update manifest is not configured.')
  if (manifest.version !== version) {
    return mutationError('APP_UPDATE_VERSION_MISMATCH', 'Requested update version does not match the manifest.')
  }

  const cacheDir = defaultCacheDir(options)
  const targetPath = cachedFilePathFor(manifest, cacheDir)
  try {
    await mkdir(cacheDir, { recursive: true })
    await rm(targetPath, { force: true })
    const copied = await copyPackageToCache(manifest, targetPath, emit)
    if (manifest.sha256 && copied.sha256 !== manifest.sha256) {
      await rm(`${targetPath}.tmp`, { force: true })
      const message = 'Update package checksum does not match the manifest.'
      emit?.({ status: 'error', version, percent: 0, message })
      return mutationError('APP_UPDATE_CHECKSUM_MISMATCH', message)
    }
    await rename(`${targetPath}.tmp`, targetPath)

    downloadedUpdate = {
      version,
      filePath: targetPath,
      size: manifest.size,
      sha256: copied.sha256,
      downloadedAt: new Date().toISOString()
    }

    emit?.({
      status: 'downloaded',
      version,
      percent: 100,
      message: `Update ${version} downloaded to aiopsterm update cache.`
    })
    return {
      ok: true,
      data: {
        version,
        status: 'downloaded',
        percent: 100,
        filePath: targetPath,
        size: manifest.size,
        sha256: copied.sha256,
        message: `Update ${version} downloaded to aiopsterm update cache.`
      }
    }
  } catch (error) {
    await rm(`${targetPath}.tmp`, { force: true }).catch(() => undefined)
    const errorMessage = error instanceof Error ? error.message : 'Update package download failed.'
    emit?.({ status: 'error', version, percent: 0, message: errorMessage })
    return mutationError('APP_UPDATE_DOWNLOAD_FAILED', errorMessage)
  }
}

export const installAppUpdate = async (input: { version?: string } = {}): Promise<AppUpdateInstallResult> => {
  const version = normalizeVersion(input.version) || downloadedUpdate?.version || ''
  if (!version) return mutationError('APP_UPDATE_VERSION_REQUIRED', 'Downloaded update version is required.')
  if (!downloadedUpdate) return mutationError('APP_UPDATE_DOWNLOAD_REQUIRED', 'Update package must be downloaded before install.')
  if (version !== downloadedUpdate.version) {
    return mutationError('APP_UPDATE_VERSION_MISMATCH', 'Downloaded update version does not match.')
  }

  try {
    await validateCachedUpdate(downloadedUpdate)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Cached update package is invalid.'
    return mutationError('APP_UPDATE_PACKAGE_INVALID', errorMessage)
  }

  return {
    ok: true,
    data: {
      version,
      status: 'install-requested',
      filePath: downloadedUpdate.filePath,
      size: downloadedUpdate.size,
      ...(downloadedUpdate.sha256 ? { sha256: downloadedUpdate.sha256 } : {}),
      requestedAt: new Date().toISOString(),
      message: `Update ${version} install requested with cached package.`
    }
  }
}
