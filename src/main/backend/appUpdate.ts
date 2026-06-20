import { createHash, verify as verifyCryptoSignature } from 'crypto'
import { createReadStream, createWriteStream, readFileSync, statSync } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type { AppUpdateCheckResult, AppUpdateDownloadResult, AppUpdateInstallResult, AppUpdateProgressEvent } from '@shared/contracts/appRuntime'

type AppUpdateManifest = {
  version?: unknown
  channel?: unknown
  path?: unknown
  filePath?: unknown
  packagePath?: unknown
  sha256?: unknown
  size?: unknown
  notes?: unknown
  signature?: unknown
  signatureAlgorithm?: unknown
  signatureKeyId?: unknown
}

type AppUpdateSignatureAlgorithm = 'ed25519' | 'rsa-sha256'

type AppUpdateSignatureInfo = {
  algorithm: AppUpdateSignatureAlgorithm
  verified: true
  keyId?: string
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
  signature?: AppUpdateSignatureInfo
}

type DownloadedUpdate = {
  version: string
  filePath: string
  size: number
  sha256?: string
  signature?: AppUpdateSignatureInfo
  downloadedAt: string
}

type AppUpdateOptions = {
  currentVersion?: string
  manifestPath?: string
  cacheDir?: string
  trustedPublicKey?: string
  trustedPublicKeyPath?: string
}

type AppUpdateProgressEmitter = (event: AppUpdateProgressEvent) => void

type AppUpdateInstallerInput = {
  version: string
  filePath: string
  size: number
  sha256?: string
  signature?: AppUpdateSignatureInfo
}

type AppUpdateInstallerResult = {
  handoff: NonNullable<AppUpdateInstallResult['data']>['handoff']
  message?: string
}

type AppUpdateInstallOptions = {
  installer?: (input: AppUpdateInstallerInput) => Promise<AppUpdateInstallerResult> | AppUpdateInstallerResult
}

type AppUpdateRuntimeConfig = {
  installer?: AppUpdateInstallOptions['installer']
}

let downloadedUpdate: DownloadedUpdate | null = null
let runtimeConfig: AppUpdateRuntimeConfig = {}

const normalizeVersion = (value: unknown) => String(value || '').trim().replace(/^v/i, '')

const normalizeText = (value: unknown) => String(value || '').trim()

const normalizeChannel = (value: unknown): AppUpdateCheckResult['channel'] => {
  const channel = normalizeText(value)
  return channel === 'auto' || channel === 'local' ? channel : 'manual'
}

const normalizeSignatureAlgorithm = (value: unknown): AppUpdateSignatureAlgorithm | '' => {
  const algorithm = normalizeText(value).toLowerCase().replace(/_/g, '-')
  if (algorithm === 'ed25519') return 'ed25519'
  if (algorithm === 'rsa-sha256' || algorithm === 'rs256') return 'rsa-sha256'
  return ''
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
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

const configuredTrustedPublicKey = (options: AppUpdateOptions) => {
  const inlineKey = normalizeText(options.trustedPublicKey) || normalizeText(process.env.AIOPSTERM_UPDATE_PUBLIC_KEY)
  if (inlineKey) return inlineKey

  const configuredPath = normalizeText(options.trustedPublicKeyPath) || normalizeText(process.env.AIOPSTERM_UPDATE_PUBLIC_KEY_FILE)
  if (!configuredPath) return ''
  const publicKeyPath = isAbsolute(configuredPath) ? configuredPath : resolve(configuredPath)
  try {
    return readFileSync(publicKeyPath, 'utf-8')
  } catch (error) {
    throw new Error(`Unable to read aiopsterm update public key: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const appUpdateSignaturePayload = (metadata: {
  version: string
  channel: AppUpdateCheckResult['channel']
  fileName: string
  size: number
  sha256?: string
  notes?: string
}) =>
  stableJson({
    version: metadata.version,
    channel: metadata.channel,
    fileName: metadata.fileName,
    size: metadata.size,
    ...(metadata.sha256 ? { sha256: metadata.sha256 } : {}),
    ...(metadata.notes ? { notes: metadata.notes } : {})
  })

const signatureBufferFromManifest = (value: unknown) => {
  const signature = normalizeText(value)
  if (!signature) return null
  const normalized = signature.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null
  return Buffer.from(normalized, 'base64')
}

const verifyManifestSignature = (input: {
  manifest: AppUpdateManifest
  version: string
  channel: AppUpdateCheckResult['channel']
  fileName: string
  size: number
  sha256?: string
  notes?: string
  options: AppUpdateOptions
}): AppUpdateSignatureInfo | undefined => {
  const rawAlgorithm = normalizeText(input.manifest.signatureAlgorithm)
  const rawSignature = normalizeText(input.manifest.signature)
  const algorithm = normalizeSignatureAlgorithm(rawAlgorithm)
  const signature = signatureBufferFromManifest(input.manifest.signature)
  const keyId = normalizeText(input.manifest.signatureKeyId)
  const hasSignatureFields = Boolean(rawAlgorithm || rawSignature || keyId)
  const trustedPublicKey = configuredTrustedPublicKey(input.options)

  if (!hasSignatureFields && !trustedPublicKey) return undefined
  if (!algorithm) throw new Error('aiopsterm update manifest signature algorithm is required.')
  if (!signature?.length) throw new Error('aiopsterm update manifest signature is required.')
  if (!trustedPublicKey) throw new Error('aiopsterm update trusted public key is not configured.')
  if (!input.sha256) throw new Error('Signed aiopsterm update manifests must include a package SHA-256 checksum.')

  const payload = Buffer.from(
    appUpdateSignaturePayload({
      version: input.version,
      channel: input.channel,
      fileName: input.fileName,
      size: input.size,
      sha256: input.sha256,
      notes: input.notes
    }),
    'utf-8'
  )
  const verified =
    algorithm === 'ed25519'
      ? verifyCryptoSignature(null, payload, trustedPublicKey, signature)
      : verifyCryptoSignature('sha256', payload, trustedPublicKey, signature)
  if (!verified) throw new Error('aiopsterm update manifest signature is invalid.')

  return {
    algorithm,
    verified: true,
    ...(keyId ? { keyId } : {})
  }
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
  const channel = normalizeChannel(rawManifest.channel)
  const signature = verifyManifestSignature({
    manifest: rawManifest,
    version,
    channel,
    fileName: basename(packagePath),
    size: packageStats.size,
    sha256,
    notes,
    options
  })
  return {
    manifestPath,
    version,
    channel,
    packagePath,
    fileName: basename(packagePath),
    size: packageStats.size,
    ...(sha256 ? { sha256 } : {}),
    ...(notes ? { notes } : {}),
    ...(signature ? { signature } : {})
  }
}

const packageInfoFor = (manifest: ResolvedUpdateManifest) => ({
  version: manifest.version,
  channel: manifest.channel,
  fileName: manifest.fileName,
  size: manifest.size,
  ...(manifest.sha256 ? { sha256: manifest.sha256 } : {}),
  ...(manifest.notes ? { notes: manifest.notes } : {}),
  ...(manifest.signature ? { signature: manifest.signature } : {})
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
  runtimeConfig = {}
}

export const configureAppUpdateRuntime = (config: AppUpdateRuntimeConfig = {}) => {
  runtimeConfig = {
    installer: config.installer
  }
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
      ...(manifest.signature ? { signature: manifest.signature } : {}),
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
        ...(manifest.signature ? { signature: manifest.signature } : {}),
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

export const installAppUpdate = async (input: { version?: string } = {}, options: AppUpdateInstallOptions = {}): Promise<AppUpdateInstallResult> => {
  const version = normalizeVersion(input.version) || downloadedUpdate?.version || ''
  if (!version) return mutationError('APP_UPDATE_VERSION_REQUIRED', 'Downloaded update version is required.')
  if (!downloadedUpdate) return mutationError('APP_UPDATE_DOWNLOAD_REQUIRED', 'Update package must be downloaded before install.')
  if (version !== downloadedUpdate.version) {
    return mutationError('APP_UPDATE_VERSION_MISMATCH', 'Downloaded update version does not match.')
  }
  const installer = options.installer || runtimeConfig.installer
  if (typeof installer !== 'function') {
    return mutationError('APP_UPDATE_INSTALLER_UNAVAILABLE', 'Update installer handoff is not configured.')
  }

  try {
    await validateCachedUpdate(downloadedUpdate)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Cached update package is invalid.'
    return mutationError('APP_UPDATE_PACKAGE_INVALID', errorMessage)
  }

  let installResult: AppUpdateInstallerResult
  try {
    installResult = await installer({
      version,
      filePath: downloadedUpdate.filePath,
      size: downloadedUpdate.size,
      ...(downloadedUpdate.sha256 ? { sha256: downloadedUpdate.sha256 } : {}),
      ...(downloadedUpdate.signature ? { signature: downloadedUpdate.signature } : {})
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Update installer handoff failed.'
    return mutationError('APP_UPDATE_INSTALL_HANDOFF_FAILED', errorMessage)
  }

  if (installResult?.handoff?.kind !== 'os-open' || installResult.handoff.accepted !== true) {
    return mutationError('APP_UPDATE_INSTALL_HANDOFF_FAILED', 'Update installer handoff was not accepted by the operating system.')
  }

  return {
    ok: true,
    data: {
      version,
      status: 'install-requested',
      filePath: downloadedUpdate.filePath,
      size: downloadedUpdate.size,
      ...(downloadedUpdate.sha256 ? { sha256: downloadedUpdate.sha256 } : {}),
      ...(downloadedUpdate.signature ? { signature: downloadedUpdate.signature } : {}),
      handoff: installResult.handoff,
      requestedAt: new Date().toISOString(),
      message: installResult.message || `Update ${version} handed off to the operating system installer.`
    }
  }
}
