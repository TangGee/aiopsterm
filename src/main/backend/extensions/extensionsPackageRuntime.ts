import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, type Dirent } from 'fs'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'path'
import { inflateRawSync } from 'zlib'
import type {
  ExtensionPackageInstallInput,
  ExtensionPluginOperation,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig
} from '@shared/contracts/extensions'
import {
  asRecord,
  clonePlugin,
  emitExtensionProgress,
  extensionPluginOperationError,
  extractPackageManifestSource,
  extractStoreManifestFlags,
  isVersionNewer,
  normalizeAbsoluteHttpUrl,
  normalizeExtensionIconKey,
  normalizeSha256,
  parseFirstContributedViewName,
  parseManifestFunctions,
  parseStringArray,
  trimText,
  type ExtensionFetchResponse,
  type ExtensionPackageRuntimeConfig,
  type ExtensionProgressEmitter,
  type LocalExtensionPackageConfig,
  type LocalExtensionPackageManifest,
  type LocalExtensionPackageParseOptions,
  type LocalZipEntry,
  type ParsedExtensionPackageInput,
  type StorePackageInput
} from './extensionsRuntimeCore'

type DownloadActiveOperation = {
  cancelled: boolean
  abortController?: AbortController
}

let runtimeConfig: ExtensionPackageRuntimeConfig = {
  extensionRootDir: '',
  storePackageDir: '',
  remotePackageCacheDir: '',
  fetch: async () => {
    throw new Error('Extension package runtime is not configured.')
  }
}

export const configureExtensionPackageRuntime = (config: ExtensionPackageRuntimeConfig) => {
  runtimeConfig = config
}

export const localPackageErrorResult = extensionPluginOperationError

export const installedExtensionDir = (pluginId: string, version: string) => join(runtimeConfig.extensionRootDir, 'installed', pluginId, version)

export const normalizePackageEntryName = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return ''
  if (normalized.split('/').some((part) => !part || part === '..')) return ''
  return normalized
}

const readUInt32LE = (buffer: Buffer, offset: number) => {
  if (offset + 4 > buffer.length) return -1
  return buffer.readUInt32LE(offset)
}

const readUInt16LE = (buffer: Buffer, offset: number) => {
  if (offset + 2 > buffer.length) return -1
  return buffer.readUInt16LE(offset)
}

const parseLocalZipEntries = (buffer: Buffer): LocalZipEntry[] => {
  const entries: LocalZipEntry[] = []
  let endOffset = -1
  const searchStart = Math.max(0, buffer.length - 0xffff - 22)
  for (let index = buffer.length - 22; index >= searchStart; index--) {
    if (readUInt32LE(buffer, index) === 0x06054b50) {
      endOffset = index
      break
    }
  }
  if (endOffset < 0) throw new Error('Invalid ZIP package.')

  const entryCount = readUInt16LE(buffer, endOffset + 10)
  const centralDirectoryOffset = readUInt32LE(buffer, endOffset + 16)
  if (entryCount < 0 || centralDirectoryOffset < 0 || centralDirectoryOffset >= buffer.length) {
    throw new Error('Invalid ZIP central directory.')
  }

  let cursor = centralDirectoryOffset
  for (let index = 0; index < entryCount; index++) {
    if (readUInt32LE(buffer, cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry.')
    const method = readUInt16LE(buffer, cursor + 10)
    const compressedSize = readUInt32LE(buffer, cursor + 20)
    const uncompressedSize = readUInt32LE(buffer, cursor + 24)
    const fileNameLength = readUInt16LE(buffer, cursor + 28)
    const extraLength = readUInt16LE(buffer, cursor + 30)
    const commentLength = readUInt16LE(buffer, cursor + 32)
    const localHeaderOffset = readUInt32LE(buffer, cursor + 42)
    if ([method, compressedSize, uncompressedSize, fileNameLength, extraLength, commentLength, localHeaderOffset].some((value) => value < 0)) {
      throw new Error('Invalid ZIP entry header.')
    }

    const nameStart = cursor + 46
    const nameEnd = nameStart + fileNameLength
    if (nameEnd > buffer.length) throw new Error('Invalid ZIP entry name.')
    const entryName = buffer.slice(nameStart, nameEnd).toString('utf8')

    if (readUInt32LE(buffer, localHeaderOffset) !== 0x04034b50) throw new Error('Invalid ZIP local file header.')
    const localNameLength = readUInt16LE(buffer, localHeaderOffset + 26)
    const localExtraLength = readUInt16LE(buffer, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataStart < 0 || dataEnd > buffer.length) throw new Error('Invalid ZIP entry data.')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const isDirectory = entryName.endsWith('/')

    entries.push({
      entryName,
      isDirectory,
      getData: () => {
        if (isDirectory) return Buffer.alloc(0)
        if (method === 0) return Buffer.from(compressedData)
        if (method === 8) return inflateRawSync(compressedData)
        throw new Error(`Unsupported ZIP compression method ${method}.`)
      }
    })

    cursor = nameEnd + extraLength + commentLength
  }

  return entries
}

export const findZipEntry = (zipEntries: LocalZipEntry[], entryName: string) => {
  const normalizedEntryName = normalizePackageEntryName(entryName)
  if (!normalizedEntryName) return null
  return zipEntries.find((entry) => !entry.isDirectory && entry.entryName.replace(/\\/g, '/') === normalizedEntryName) || null
}

export const findReadmeZipEntry = (zipEntries: LocalZipEntry[], manifest: LocalExtensionPackageManifest) => {
  const manifestReadme = trimText(manifest.readme)
  if (manifestReadme) {
    const entry = findZipEntry(zipEntries, manifestReadme)
    if (entry) return entry
  }
  return zipEntries.find((entry) => !entry.isDirectory && entry.entryName.replace(/\\/g, '/').toLowerCase() === 'readme.md') || null
}

export const readZipEntryText = (entry: { getData: () => Buffer }) => entry.getData().toString('utf8')

export const safePackagePathSegment = (value: string) => {
  const segment = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return !segment || segment === '.' || segment === '..' ? 'plugin' : segment
}

export const isPathInside = (rootDir: string, targetPath: string) => {
  const root = resolve(rootDir)
  const target = resolve(targetPath)
  return target === root || target.startsWith(`${root}${sep}`)
}

const extractLocalPackageEntries = (entries: LocalZipEntry[], targetDir: string) => {
  const resolvedTargetDir = resolve(targetDir)
  rmSync(resolvedTargetDir, { recursive: true, force: true })
  mkdirSync(resolvedTargetDir, { recursive: true })

  for (const entry of entries) {
    const normalizedName = normalizePackageEntryName(entry.entryName)
    if (!normalizedName) {
      if (entry.isDirectory) continue
      throw new Error(`Invalid package entry path "${entry.entryName}".`)
    }
    if (entry.isDirectory) {
      const targetPath = resolve(resolvedTargetDir, normalizedName)
      if (!isPathInside(resolvedTargetDir, targetPath)) throw new Error(`Invalid package entry path "${entry.entryName}".`)
      mkdirSync(targetPath, { recursive: true })
      continue
    }
    const targetPath = resolve(resolvedTargetDir, normalizedName)
    if (!isPathInside(resolvedTargetDir, targetPath)) throw new Error(`Invalid package entry path "${entry.entryName}".`)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, entry.getData())
  }
}

export const installLocalPackageToDisk = (packageConfig: LocalExtensionPackageConfig): ExtensionPluginRuntimeConfig | ExtensionPluginOperationResult => {
  const version = packageConfig.plugin.latestVersion || packageConfig.plugin.installedVersion || '1.0.0'
  const targetDir = installedExtensionDir(safePackagePathSegment(packageConfig.plugin.pluginId), safePackagePathSegment(version))
  try {
    extractLocalPackageEntries(packageConfig.entries, targetDir)
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_INSTALL_FAILED',
      error instanceof Error ? error.message : 'Plugin package could not be installed.'
    )
  }
  const installedAt = new Date().toISOString()
  return {
    ...packageConfig.plugin,
    packagePath: targetDir,
    installedAt,
    lastUpdated: installedAt
  }
}

export const removeInstalledExtensionPackageFiles = (plugin: ExtensionPluginRuntimeConfig) => {
  const packagePath = trimText(plugin.packagePath)
  if (!packagePath) return
  const installedRoot = join(runtimeConfig.extensionRootDir, 'installed')
  if (!isPathInside(installedRoot, packagePath)) return
  rmSync(packagePath, { recursive: true, force: true })
}

export const createPackageInputFromPath = (filePath: string): ExtensionPackageInstallInput | null => {
  const resolvedPath = resolve(filePath)
  if (!basename(resolvedPath).toLowerCase().endsWith('.external-reference')) return null
  return {
    fileName: basename(resolvedPath),
    filePath: resolvedPath
  }
}

const packageFileNameFromPlugin = (plugin: ExtensionPluginRuntimeConfig) => {
  const version = trimText(plugin.latestVersion) || trimText(plugin.installedVersion) || 'latest'
  return `${safePackagePathSegment(plugin.pluginId)}-${safePackagePathSegment(version)}.external-reference`
}

const resolveRemotePackageCachePath = (plugin: ExtensionPluginRuntimeConfig) =>
  join(runtimeConfig.remotePackageCacheDir, safePackagePathSegment(plugin.pluginId), packageFileNameFromPlugin(plugin))

export const resolveStorePackageInput = (plugin: ExtensionPluginRuntimeConfig): StorePackageInput | ExtensionPluginOperationResult => {
  const pluginId = trimText(plugin.pluginId)
  const version = trimText(plugin.latestVersion) || trimText(plugin.installedVersion) || 'latest'
  const candidates: string[] = []
  const packageUrl = normalizeAbsoluteHttpUrl(plugin.packageUrl)
  if (plugin.hasUpdate && packageUrl) {
    return {
      kind: 'remote',
      plugin,
      url: packageUrl,
      sha256: normalizeSha256(plugin.packageSha256) || undefined
    }
  }
  const storePackageDir = trimText(runtimeConfig.storePackageDir)
  if (storePackageDir) {
    candidates.push(
      join(storePackageDir, pluginId, `${version}.external-reference`),
      join(storePackageDir, `${pluginId}-${version}.external-reference`),
      join(storePackageDir, `${pluginId}.external-reference`)
    )
  }

  const explicitPackagePath = trimText(plugin.storePackagePath)
  if (explicitPackagePath) {
    candidates.push(
      isAbsolute(explicitPackagePath) || !runtimeConfig.storePackageDir
        ? explicitPackagePath
        : join(runtimeConfig.storePackageDir, explicitPackagePath)
    )
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const input = createPackageInputFromPath(candidate)
    if (input) return { kind: 'local', input }
  }

  if (packageUrl) {
    return {
      kind: 'remote',
      plugin,
      url: packageUrl,
      sha256: normalizeSha256(plugin.packageSha256) || undefined
    }
  }

  return localPackageErrorResult(
    'EXTENSION_STORE_PACKAGE_UNAVAILABLE',
    `${plugin.name} requires a real .external-reference package before it can be installed.`
  )
}

export const fetchExtensionPackageBuffer = async (
  url: string,
  options: {
    signal?: AbortSignal
    onProgress?: (receivedBytes: number, totalBytes: number) => void
  } = {}
) => {
  const response = await runtimeConfig.fetch(url, options.signal ? { signal: options.signal } : undefined)
  if (!response.ok) throw new Error(`Plugin package download failed: HTTP ${response.status}.`)
  const totalBytes = Number(response.headers?.get('content-length') || 0)
  const reader = response.body?.getReader?.()
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    options.onProgress?.(buffer.byteLength, totalBytes || buffer.byteLength)
    return {
      buffer,
      totalBytes: totalBytes || buffer.byteLength
    }
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const chunk = Buffer.from(value)
    chunks.push(chunk)
    receivedBytes += chunk.byteLength
    options.onProgress?.(receivedBytes, totalBytes)
  }
  return {
    buffer: Buffer.concat(chunks, receivedBytes),
    totalBytes: totalBytes || receivedBytes
  }
}

export const downloadStorePackage = async (
  packageInput: Extract<StorePackageInput, { kind: 'remote' }>,
  operation: ExtensionPluginOperation,
  activeOperation: DownloadActiveOperation,
  emit?: ExtensionProgressEmitter
): Promise<ParsedExtensionPackageInput | ExtensionPluginOperationResult> => {
  const pluginId = packageInput.plugin.pluginId
  const abortController = new AbortController()
  activeOperation.abortController = abortController
  const cancelledResult = () => {
    emitExtensionProgress(emit, pluginId, operation, 'cancelled', 0, 'Plugin operation cancelled.')
    return {
      ok: false as const,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    }
  }

  if (activeOperation.cancelled) return cancelledResult()
  emitExtensionProgress(emit, pluginId, operation, 'downloading', 0, 'Downloading plugin package.')

  let response: ExtensionFetchResponse
  try {
    response = await runtimeConfig.fetch(packageInput.url, { signal: abortController.signal })
  } catch (error) {
    if (activeOperation.cancelled || abortController.signal.aborted) return cancelledResult()
    return localPackageErrorResult(
      'EXTENSION_STORE_PACKAGE_DOWNLOAD_FAILED',
      error instanceof Error ? error.message : 'Plugin package download failed.'
    )
  }

  if (activeOperation.cancelled || abortController.signal.aborted) return cancelledResult()
  if (!response.ok) {
    return localPackageErrorResult(
      'EXTENSION_STORE_PACKAGE_DOWNLOAD_FAILED',
      `Plugin package download failed: HTTP ${response.status}.`
    )
  }

  let downloaded: { buffer: Buffer; totalBytes: number }
  try {
    const totalBytes = Number(response.headers?.get('content-length') || 0)
    const reader = response.body?.getReader?.()
    if (!reader) {
      const buffer = Buffer.from(await response.arrayBuffer())
      downloaded = { buffer, totalBytes: totalBytes || buffer.byteLength }
    } else {
      const chunks: Buffer[] = []
      let receivedBytes = 0
      for (;;) {
        if (activeOperation.cancelled || abortController.signal.aborted) return cancelledResult()
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const chunk = Buffer.from(value)
        chunks.push(chunk)
        receivedBytes += chunk.byteLength
        const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0
        emitExtensionProgress(emit, pluginId, operation, 'downloading', percent, `Downloaded ${receivedBytes} bytes.`)
      }
      downloaded = { buffer: Buffer.concat(chunks, receivedBytes), totalBytes: totalBytes || receivedBytes }
    }
  } catch (error) {
    if (activeOperation.cancelled || abortController.signal.aborted) return cancelledResult()
    return localPackageErrorResult(
      'EXTENSION_STORE_PACKAGE_DOWNLOAD_FAILED',
      error instanceof Error ? error.message : 'Plugin package download failed.'
    )
  }

  if (activeOperation.cancelled || abortController.signal.aborted) return cancelledResult()
  const { buffer, totalBytes } = downloaded
  emitExtensionProgress(emit, pluginId, operation, 'downloading', 100, `Downloaded ${buffer.byteLength} bytes.`)

  const expectedSha256 = normalizeSha256(packageInput.sha256)
  if (expectedSha256) {
    const actualSha256 = createHash('sha256').update(buffer).digest('hex')
    if (actualSha256 !== expectedSha256) {
      return localPackageErrorResult('EXTENSION_STORE_PACKAGE_CHECKSUM_MISMATCH', 'Plugin package checksum mismatch.')
    }
  }

  const cachePath = resolveRemotePackageCachePath(packageInput.plugin)
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, buffer)
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_STORE_PACKAGE_CACHE_FAILED',
      error instanceof Error ? error.message : 'Plugin package could not be cached.'
    )
  }

  const parsedPackage = parsePackageManifestFromBuffer(basename(cachePath), buffer, cachePath)
  if ('ok' in parsedPackage) return parsedPackage
  return {
    ...parsedPackage,
    packageSize: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : parsedPackage.packageSize
  }
}

export const parsePackageManifestFromInput = (
  input: ExtensionPackageInstallInput
): ParsedExtensionPackageInput | ExtensionPluginOperationResult => {
  const fileName = trimText(input?.fileName)
  if (!fileName) return localPackageErrorResult('EXTENSION_PACKAGE_REQUIRED', 'Plugin package file is required.')
  if (!fileName.toLowerCase().endsWith('.external-reference')) {
    return localPackageErrorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  const filePath = trimText(input?.filePath)
  if (!filePath) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_REQUIRED', 'Plugin package file path is required.')
  if (!isAbsolute(filePath)) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_INVALID', 'Plugin package file path must be absolute.')
  if (!basename(filePath).toLowerCase().endsWith('.external-reference')) {
    return localPackageErrorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  let packageSize = 0
  try {
    const fileStat = statSync(filePath)
    if (!fileStat.isFile()) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_INVALID', 'Plugin package path must point to a file.')
    packageSize = fileStat.size
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_READ_FAILED',
      error instanceof Error ? error.message : 'Plugin package file could not be read.'
    )
  }

  let zipEntries: LocalZipEntry[]
  try {
    zipEntries = parseLocalZipEntries(readFileSync(filePath))
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_READ_FAILED',
      error instanceof Error ? error.message : 'Plugin package file could not be opened.'
    )
  }

  const manifestEntry = findZipEntry(zipEntries, 'plugin.json')
  if (!manifestEntry) {
    return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_MISSING', 'Plugin package must contain plugin.json.')
  }

  try {
    const parsed = JSON.parse(readZipEntryText(manifestEntry))
    const manifestRecord = asRecord(parsed)
    if (!manifestRecord) {
      return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must be a JSON object.')
    }
    return {
      manifest: manifestRecord as LocalExtensionPackageManifest,
      entries: zipEntries,
      filePath,
      packageSize
    }
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_MANIFEST_INVALID',
      error instanceof Error ? error.message : 'plugin.json could not be parsed.'
    )
  }
}

const parsePackageManifestFromBuffer = (
  fileName: string,
  buffer: Buffer,
  packageFilePath = ''
): ParsedExtensionPackageInput | ExtensionPluginOperationResult => {
  const normalizedFileName = trimText(fileName)
  if (!normalizedFileName) return localPackageErrorResult('EXTENSION_PACKAGE_REQUIRED', 'Plugin package file is required.')
  if (!normalizedFileName.toLowerCase().endsWith('.external-reference')) {
    return localPackageErrorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  let zipEntries: LocalZipEntry[]
  try {
    zipEntries = parseLocalZipEntries(buffer)
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_READ_FAILED',
      error instanceof Error ? error.message : 'Plugin package file could not be opened.'
    )
  }

  const manifestEntry = findZipEntry(zipEntries, 'plugin.json')
  if (!manifestEntry) {
    return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_MISSING', 'Plugin package must contain plugin.json.')
  }

  try {
    const parsed = JSON.parse(readZipEntryText(manifestEntry))
    const manifestRecord = asRecord(parsed)
    if (!manifestRecord) {
      return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must be a JSON object.')
    }
    return {
      manifest: manifestRecord as LocalExtensionPackageManifest,
      entries: zipEntries,
      filePath: packageFilePath,
      packageSize: buffer.byteLength
    }
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_MANIFEST_INVALID',
      error instanceof Error ? error.message : 'plugin.json could not be parsed.'
    )
  }
}

export const parseLocalPackageManifest = (
  input: ExtensionPackageInstallInput | ParsedExtensionPackageInput,
  options: LocalExtensionPackageParseOptions = {}
): LocalExtensionPackageConfig | ExtensionPluginOperationResult => {
  const packageSource = options.source || 'local'
  const basePlugin = options.basePlugin ? clonePlugin(options.basePlugin) : undefined
  const allowedPluginId = trimText(options.allowExistingPluginId)
  const parsedPackage =
    'manifest' in input && 'entries' in input && 'packageSize' in input
      ? input
      : parsePackageManifestFromInput(input)
  if ('ok' in parsedPackage) return parsedPackage
  const { manifest, entries: zipEntries, filePath, packageSize } = parsedPackage

  const pluginId = trimText(manifest.id)
  const version = trimText(manifest.version)
  const mainEntryName = normalizePackageEntryName(trimText(manifest.main))
  if (!pluginId) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include an id.')
  if (!version) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include a version.')
  if (!mainEntryName) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include a valid main entry.')
  if (!findZipEntry(zipEntries, mainEntryName)) {
    return localPackageErrorResult('EXTENSION_PACKAGE_MAIN_MISSING', `Plugin package main entry "${mainEntryName}" was not found.`)
  }

  if (packageSource === 'store' && allowedPluginId && pluginId !== allowedPluginId) {
    return localPackageErrorResult(
      'EXTENSION_STORE_PACKAGE_MANIFEST_MISMATCH',
      `Store package id "${pluginId}" does not match catalog plugin "${allowedPluginId}".`
    )
  }

  const existingPlugin = options.findExistingPlugin?.(pluginId)
  if (existingPlugin && existingPlugin.source !== 'local' && existingPlugin.pluginId !== allowedPluginId) {
    return localPackageErrorResult('EXTENSION_PACKAGE_PLUGIN_CONFLICT', 'Plugin package id conflicts with an existing non-local extension.')
  }

  const displayName = trimText(manifest.displayName) || trimText(manifest.name) || pluginId
  const viewName = parseFirstContributedViewName(manifest)
  const categories = parseStringArray(manifest.categories)
  const functions = parseManifestFunctions(manifest.functions)
  const storeFlags = extractStoreManifestFlags(manifest)
  const packageDownloadSource = extractPackageManifestSource(manifest)
  const readmeEntry = findReadmeZipEntry(zipEntries, manifest)
  const fallbackReadme =
    packageSource === 'store'
      ? `${basePlugin?.name || displayName} installed from a verified .external-reference package through the aiopsterm backend boundary.`
      : 'Local package installed through the aiopsterm backend plugin boundary.'
  const readme = readmeEntry ? readZipEntryText(readmeEntry) : fallbackReadme
  const fallbackFunctions =
    packageSource === 'store' && basePlugin?.functions?.length
      ? basePlugin.functions.map((item) => ({ ...item }))
      : [{ title: packageSource === 'store' ? 'Store plugin' : 'Local plugin', desc: 'Installed from a .external-reference package through the backend boundary.' }]
  const fallbackCategories =
    packageSource === 'store' && basePlugin?.categories?.length ? [...basePlugin.categories] : [packageSource === 'store' ? 'Store' : 'Local']

  return {
    entries: zipEntries,
    plugin: {
      pluginId,
      name: packageSource === 'store' ? basePlugin?.name || displayName : displayName,
      description:
        trimText(manifest.description) ||
        basePlugin?.description ||
        (packageSource === 'store' ? 'Installed from a store .external-reference package.' : 'Installed from a local .external-reference package.'),
      iconKey: packageSource === 'store' ? normalizeExtensionIconKey(basePlugin?.iconKey || manifest.iconKey) : 'local',
      tabName: viewName || basePlugin?.tabName || displayName,
      show: true,
      isPlugin: true,
      installed: false,
      hasUpdate: false,
      installedVersion: '',
      latestVersion: version,
      installable: packageSource === 'store' ? storeFlags.installable : basePlugin?.installable === false ? false : true,
      required: basePlugin?.required,
      isPrivate: packageSource === 'store' ? storeFlags.isPrivate : basePlugin?.isPrivate,
      isDraggedOnly: packageSource === 'local',
      source: packageSource,
      lastUpdated: new Date().toISOString(),
      size: packageSize,
      readme,
      categories: categories.length ? categories : fallbackCategories,
      functions: functions.length ? functions : fallbackFunctions,
      storePackagePath: packageSource === 'store' ? filePath : undefined,
      packageUrl: packageSource === 'store' ? packageDownloadSource.packageUrl || basePlugin?.packageUrl : undefined,
      packageSha256: packageSource === 'store' ? packageDownloadSource.packageSha256 || basePlugin?.packageSha256 : undefined,
      subscriptionUrl: packageSource === 'store' ? storeFlags.subscriptionUrl || basePlugin?.subscriptionUrl : undefined
    }
  }
}

export const storePluginFromPackage = (filePath: string): ExtensionPluginRuntimeConfig | null => {
  const input = createPackageInputFromPath(filePath)
  if (!input) return null
  const parsedPackage = parsePackageManifestFromInput(input)
  if ('ok' in parsedPackage) return null
  const { manifest, entries, packageSize } = parsedPackage
  const pluginId = trimText(manifest.id)
  const version = trimText(manifest.version)
  const mainEntryName = normalizePackageEntryName(trimText(manifest.main))
  if (!pluginId || !version || !mainEntryName || !findZipEntry(entries, mainEntryName)) return null
  const displayName = trimText(manifest.displayName) || trimText(manifest.name) || pluginId
  const viewName = parseFirstContributedViewName(manifest)
  const categories = parseStringArray(manifest.categories)
  const functions = parseManifestFunctions(manifest.functions)
  const readmeEntry = findReadmeZipEntry(entries, manifest)
  const storeFlags = extractStoreManifestFlags(manifest)
  const packageSource = extractPackageManifestSource(manifest)
  return {
    pluginId,
    name: displayName,
    description: trimText(manifest.description) || 'Discovered from a real .external-reference package in the aiopsterm extension store directory.',
    iconKey: normalizeExtensionIconKey(manifest.iconKey),
    tabName: viewName || displayName,
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: version,
    installable: storeFlags.installable,
    isPrivate: storeFlags.isPrivate,
    source: 'store',
    lastUpdated: new Date(statSync(filePath).mtimeMs).toISOString(),
    size: packageSize,
    readme: readmeEntry ? readZipEntryText(readmeEntry) : `${displayName} is available from a verified .external-reference package.`,
    categories: categories.length ? categories : ['Store'],
    functions: functions.length ? functions : [{ title: 'Store plugin', desc: 'Discovered from a real .external-reference package through the backend boundary.' }],
    storePackagePath: filePath,
    packageUrl: packageSource.packageUrl || undefined,
    packageSha256: packageSource.packageSha256 || undefined,
    subscriptionUrl: storeFlags.subscriptionUrl || undefined
  }
}

export const walkStorePackageFiles = (rootDir: string, depth = 0): string[] => {
  if (!rootDir || depth > 2) return []
  let entries: Dirent[]
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkStorePackageFiles(fullPath, depth + 1))
      continue
    }
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.external-reference') continue
    files.push(fullPath)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

export const latestStorePluginsFromPackageDir = (storePackageDir: string): ExtensionPluginRuntimeConfig[] => {
  const rootDir = trimText(storePackageDir)
  if (!rootDir || !existsSync(rootDir)) return []
  const latestByPlugin = new Map<string, ExtensionPluginRuntimeConfig>()
  for (const filePath of walkStorePackageFiles(rootDir)) {
    const plugin = storePluginFromPackage(filePath)
    if (!plugin) continue
    const existing = latestByPlugin.get(plugin.pluginId)
    if (!existing || isVersionNewer(plugin.latestVersion || '', existing.latestVersion || '')) {
      latestByPlugin.set(plugin.pluginId, plugin)
    }
  }
  return [...latestByPlugin.values()].sort((left, right) => left.name.localeCompare(right.name))
}
