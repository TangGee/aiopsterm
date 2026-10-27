import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { VoiceInputPreferences, VoiceInstallProgress } from '../../../shared/contracts/voice'
import { validateVoicePreferences } from './voiceInputService'
import { preloadZipformer, shutdownZipformerRuntime } from './zipformerRuntime'
import { downloadVoiceArchive } from './voiceModelDownload'
import { createVoiceInstallLog, voiceInstallError } from './voiceInstallDiagnostics'
import { voiceInstallAssets, voiceEngineVersion, zipformerModelName, punctuationModelName } from './voiceZipformerAssets'
import { extractVoiceArchive } from './voiceArchiveExtraction'
export { voiceInstallAssets, voiceInstallEnvironment } from './voiceZipformerAssets'
export { downloadVoiceArchive } from './voiceModelDownload'

const digest = async (path: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export type InstalledVoiceModel = Pick<VoiceInputPreferences, 'mode' | 'localEngine' | 'executablePath' | 'modelPath' | 'tokensPath' | 'decoderPath' | 'joinerPath' | 'punctuationPath'>
const modelFields = ['executablePath', 'modelPath', 'tokensPath', 'decoderPath', 'joinerPath', 'punctuationPath'] as const
const verify = async (installed: InstalledVoiceModel, signal: AbortSignal) => {
  await validateVoicePreferences(installed as VoiceInputPreferences)
  signal.throwIfAborted()
  const abort = () => { void shutdownZipformerRuntime() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await preloadZipformer(installed as VoiceInputPreferences)
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
export const installVoiceModel = async (
  root: string, signal: AbortSignal, report: (value: VoiceInstallProgress) => void,
  fetcher: typeof fetch = fetch, installationId = randomUUID()
): Promise<InstalledVoiceModel> => {
  const log = createVoiceInstallLog({ installationId })
  const assets = voiceInstallAssets()
  await mkdir(root, { recursive: true })
  const manifest = join(root, `zipformer-${voiceEngineVersion}-${process.platform}-${process.arch}.json`)
  try {
    const installed = JSON.parse(await readFile(manifest, 'utf8')) as InstalledVoiceModel
    if (installed.localEngine !== 'zipformer') throw new Error('The saved voice model requires migration.')
    report({ phase: 'checking', received: 0, total: 0 })
    await verify(installed, signal)
    log('info', 'cache.reused')
    return installed
  } catch (error) { signal.throwIfAborted(); log('info', 'cache.unavailable', { error: voiceInstallError(error) }) }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.download-')) await rm(join(root, entry.name), { recursive: true, force: true })
  }
  const staging = await mkdtemp(join(root, '.download-'))
  let workingDirectory = staging
  let retained = false
  try {
    for (const asset of assets) {
      signal.throwIfAborted()
      const archive = join(root, asset.name)
      const cached = await digest(archive).then(value => value === asset.sha256, () => false)
      log('info', 'archive.checked', { asset: asset.kind, name: asset.name, cached })
      if (!cached) {
        const partial = join(staging, `${asset.kind}.part`)
        report({ phase: 'downloading', asset: asset.kind, received: 0, total: 0 })
        const progress = (received: number, total: number) => report({ phase: 'downloading', asset: asset.kind, received, total })
        try {
          await downloadVoiceArchive(asset.url, partial, asset.sha256, signal, progress, fetcher, undefined, { installationId, asset: asset.kind })
        } catch (error) {
          signal.throwIfAborted()
          if (!asset.assetId) throw error
          log('warn', 'download.fallback', { asset: asset.kind, error: voiceInstallError(error) })
          await downloadVoiceArchive(`https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/${asset.assetId}`, partial, asset.sha256, signal, progress, fetcher, undefined, { installationId, asset: asset.kind })
        }
        await rm(archive, { force: true }); await rename(partial, archive)
      }
      report({ phase: 'extracting', asset: asset.kind, received: 0, total: 0 })
      const start = Date.now()
      log('info', 'extraction.started', { asset: asset.kind })
      const destination = asset.packageName ? join(staging, 'runtime', 'node_modules', asset.packageName) : staging
      await mkdir(destination, { recursive: true })
      await extractVoiceArchive(archive, destination, Boolean(asset.packageName), signal)
      log('info', 'extraction.completed', { asset: asset.kind, elapsedMs: Date.now() - start })
    }
    const installed: InstalledVoiceModel = {
      mode: 'local', localEngine: 'zipformer',
      executablePath: join(staging, 'runtime', 'node_modules', 'sherpa-onnx-node', 'sherpa-onnx.js'),
      modelPath: join(staging, zipformerModelName, 'encoder.int8.onnx'),
      decoderPath: join(staging, zipformerModelName, 'decoder.onnx'),
      joinerPath: join(staging, zipformerModelName, 'joiner.int8.onnx'),
      tokensPath: join(staging, zipformerModelName, 'tokens.txt'),
      punctuationPath: join(staging, punctuationModelName, 'model.int8.onnx')
    }
    signal.throwIfAborted()
    const destination = join(root, `zipformer-${voiceEngineVersion}-${randomUUID()}`)
    await rename(staging, destination)
    workingDirectory = destination
    for (const field of modelFields) installed[field] = join(destination, relative(staging, installed[field]!))
    report({ phase: 'checking', received: 0, total: 0 })
    log('info', 'validation.started')
    await verify(installed, signal)
    log('info', 'validation.completed')
    await writeFile(`${manifest}.tmp`, JSON.stringify(installed), { mode: 0o600 })
    await rename(`${manifest}.tmp`, manifest)
    retained = true
    return installed
  } finally {
    if (!retained) {
      await shutdownZipformerRuntime()
      await rm(workingDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}
