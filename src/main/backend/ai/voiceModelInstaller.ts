import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { VoiceInputPreferences, VoiceInstallProgress } from '../../../shared/contracts/voice'
import { validateVoicePreferences } from './voiceInputService'

const version = '1.12.14'
const modelName = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
const engines: Record<string, { name: string; sha256: string }> = {
  'linux-x64': { name: `sherpa-onnx-v${version}-linux-x64-shared-no-tts`, sha256: '47be6c12c030a45a5e4518980916a3da32148ace883f05f34f02042caaf2635b' },
  'linux-arm64': { name: `sherpa-onnx-v${version}-linux-aarch64-shared-cpu`, sha256: 'ad3e41f19899754735a074938db955a6818153b305fd2959bffc33405976e180' },
  'darwin-x64': { name: `sherpa-onnx-v${version}-osx-universal2-shared-no-tts`, sha256: '60fe212f37171107d4d8939cdfc4614e4591572d2c0b6e55e30edef5e9ed0c7f' },
  'darwin-arm64': { name: `sherpa-onnx-v${version}-osx-universal2-shared-no-tts`, sha256: '60fe212f37171107d4d8939cdfc4614e4591572d2c0b6e55e30edef5e9ed0c7f' },
  'win32-x64': { name: `sherpa-onnx-v${version}-win-x64-static-no-tts`, sha256: '7e1aa288f79c894025d777a62ac8e28be28112ea17e5fe6907256e076f862f7b' }
}
export const voiceInstallEnvironment = (platform = process.platform, arch: string = process.arch) => ({
  platform, arch, autoInstallSupported: Boolean(engines[`${platform}-${arch}`])
})
export const voiceInstallAssets = (platform = process.platform, arch: string = process.arch) => {
  const engine = engines[`${platform}-${arch}`]
  if (!engine) throw new Error(`Automatic installation is unavailable for ${platform}/${arch}. Use manual setup or an online speech service.`)
  return [
    { kind: 'engine' as const, ...engine, url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${version}/${engine.name}.tar.bz2` },
    { kind: 'model' as const, name: modelName, url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${modelName}.tar.bz2`, sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e' }
  ]
}
const digest = async (path: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const execute = (file: string, args: string[], signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const child = execFile(file, args, { signal, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  let failure: Error | undefined
  child.on('error', (error) => { failure = error })
  child.on('close', (code) => code === 0 && !failure ? resolve() : reject(failure || new Error(`Voice installation command failed (${file}, exit ${code}). Check system compatibility and available disk space.`)))
})
const findFile = async (directory: string, name: string): Promise<string> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return join(directory, name)
    if (entry.isDirectory()) {
      const found = await findFile(join(directory, entry.name), name)
      if (found) return found
    }
  }
  return ''
}
export const downloadVoiceArchive = async (
  url: string, destination: string, expectedHash: string, signal: AbortSignal,
  report: (received: number, total: number) => void, fetcher: typeof fetch = fetch
): Promise<void> => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const parts: string[] = []
  let completed = false
  try {
    const response = await fetcher(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}). Check network access to GitHub and retry.`)
    const total = Number(response.headers.get('content-length')) || 0
    if (total > 600 * 1024 * 1024) { await response.body.cancel(); throw new Error('Voice download exceeded the expected size.') }
    let received = 0
    let last = 0
    const tracker = () => new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > 600 * 1024 * 1024) { callback(new Error('Voice download exceeded the expected size.')); return }
      if (Date.now() - last > 150) { report(received, total); last = Date.now() }
      callback(null, chunk)
    } })
    if (total > 16 * 1024 * 1024 && response.headers.get('accept-ranges') === 'bytes') {
      await response.body.cancel()
      const partSize = 2 * 1024 * 1024
      const count = Math.ceil(total / partSize)
      for (let index = 0; index < count; index++) parts.push(`${destination}.${index}`)
      let nextPart = 0
      const downloads = Array.from({ length: Math.min(8, count) }, async () => {
        try {
          while (nextPart < count) {
            const index = nextPart++
            const start = index * partSize
            const end = Math.min(total - 1, start + partSize - 1)
            const part = await fetcher(response.url || url, { signal: controller.signal, headers: { Range: `bytes=${start}-${end}` } })
            if (part.status !== 206 || !part.body || part.headers.get('content-range') !== `bytes ${start}-${end}/${total}`) {
              await part.body?.cancel()
              throw new Error('The download server returned an invalid byte range. Retry the installation.')
            }
            await pipeline(Readable.fromWeb(part.body as Parameters<typeof Readable.fromWeb>[0]), tracker(), createWriteStream(parts[index], { mode: 0o600 }), { signal: controller.signal })
          }
        } catch (error) { controller.abort(); throw error }
      })
      const results = await Promise.allSettled(downloads)
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      await pipeline(Readable.from((async function* () {
        for (const path of parts) for await (const chunk of createReadStream(path)) yield chunk
      })()), createWriteStream(destination, { mode: 0o600 }), { signal: controller.signal })
    } else {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), tracker(), createWriteStream(destination, { mode: 0o600 }), { signal: controller.signal })
    }
    signal.throwIfAborted()
    if (total && received !== total) throw new Error('Voice download was incomplete. Retry installation.')
    if (await digest(destination) !== expectedHash) throw new Error('Voice download checksum mismatch. Retry the download.')
    report(received, total || received)
    completed = true
  } finally {
    signal.removeEventListener('abort', abort)
    await Promise.all(parts.map((path) => rm(path, { force: true })))
    if (!completed) await rm(destination, { force: true })
  }
}
export type InstalledVoiceModel = Pick<VoiceInputPreferences, 'mode' | 'localEngine' | 'executablePath' | 'modelPath' | 'tokensPath'>
const verifyInstalledVoiceModel = async (installed: InstalledVoiceModel, root: string, signal: AbortSignal) => {
  await validateVoicePreferences(installed as VoiceInputPreferences)
  const directory = await mkdtemp(join(root, '.check-'))
  try {
    // Load the model with a short silent WAV to verify the CPU binary and its libraries.
    const audio = Buffer.alloc(44 + 32000)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
    audio.write('data', 36); audio.writeUInt32LE(32000, 40)
    const probe = join(directory, 'check.wav')
    await writeFile(probe, audio)
    await execute(installed.executablePath, [`--sense-voice-model=${installed.modelPath}`, `--tokens=${installed.tokensPath}`, '--num-threads=2', probe], signal)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
export const installVoiceModel = async (
  root: string, signal: AbortSignal, report: (value: VoiceInstallProgress) => void,
  fetcher: typeof fetch = fetch
): Promise<InstalledVoiceModel> => {
  const assets = voiceInstallAssets()
  await mkdir(root, { recursive: true })
  const manifest = join(root, `sensevoice-${version}-${process.platform}-${process.arch}.json`)
  try {
    const installed = JSON.parse(await readFile(manifest, 'utf8')) as InstalledVoiceModel
    report({ phase: 'checking', received: 0, total: 0 })
    await verifyInstalledVoiceModel(installed, root, signal)
    signal.throwIfAborted()
    return installed
  } catch { signal.throwIfAborted() }
  const staging = await mkdtemp(join(root, '.install-'))
  let retained = false
  try {
    for (const asset of assets) {
      signal.throwIfAborted()
      const archive = join(root, `${asset.name}.tar.bz2`)
      const cached = await digest(archive).then((value) => value === asset.sha256, () => false)
      if (!cached) {
        const partial = join(staging, `${asset.kind}.part`)
        report({ phase: 'downloading', asset: asset.kind, received: 0, total: 0 })
        await downloadVoiceArchive(asset.url, partial, asset.sha256, signal, (received, total) => {
          report({ phase: 'downloading', asset: asset.kind, received, total })
        }, fetcher)
        await rm(archive, { force: true })
        await rename(partial, archive)
      }
      report({ phase: 'extracting', asset: asset.kind, received: 0, total: 0 })
      await execute('tar', ['-xf', archive, '-C', staging], signal)
    }
    report({ phase: 'checking', received: 0, total: 0 })
    const executablePath = await findFile(staging, process.platform === 'win32' ? 'sherpa-onnx-offline.exe' : 'sherpa-onnx-offline')
    const modelPath = await findFile(staging, 'model.int8.onnx')
    const tokensPath = await findFile(staging, 'tokens.txt')
    if (!executablePath || !modelPath || !tokensPath) throw new Error('The voice package is missing required files. Retry installation.')
    if (process.platform !== 'win32') await chmod(executablePath, 0o755)
    const installed: InstalledVoiceModel = { mode: 'local', localEngine: 'sensevoice', executablePath, modelPath, tokensPath }
    await verifyInstalledVoiceModel(installed, root, signal)
    signal.throwIfAborted()
    await writeFile(`${manifest}.tmp`, JSON.stringify(installed), { mode: 0o600 })
    await rename(`${manifest}.tmp`, manifest)
    retained = true
    return installed
  } finally {
    if (!retained) await rm(staging, { recursive: true, force: true })
  }
}
