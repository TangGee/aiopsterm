import { utilityProcess, type UtilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import type { VoiceInputPreferences, VoiceStreamResult } from '@shared/contracts/voice'
import { logRuntimeEvent } from '../app/runtimeLog'

const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let child: UtilityProcess | undefined
let ready: Promise<void> | undefined
let key = ''
let nextId = 0
const modelKey = (p: VoiceInputPreferences) => [p.executablePath, p.modelPath, p.decoderPath, p.joinerPath, p.tokensPath, p.punctuationPath].join('\n')
const rejectPending = (error: Error) => {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error) }
  pending.clear()
}
export const shutdownZipformerRuntime = () => {
  const previous = child
  child = undefined; ready = undefined; key = ''
  rejectPending(new Error('Voice engine stopped or settings changed.'))
  return new Promise<void>((resolve) => {
    if (!previous) { resolve(); return }
    const timer = setTimeout(resolve, 5000)
    previous.once('exit', () => { clearTimeout(timer); resolve() })
    if (!previous.kill()) { clearTimeout(timer); resolve() }
  })
}
const call = (method: string, fields: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
  if (!child) { reject(new Error('Voice engine is unavailable.')); return }
  const id = ++nextId
  const timer = setTimeout(() => {
    logRuntimeEvent('error', 'voice.runtime.timeout', { method })
    shutdownZipformerRuntime()
  }, method === 'load' ? 90_000 : 30_000)
  pending.set(id, { resolve, reject, timer })
  try { child.postMessage({ id, method, ...fields }) } catch (error) {
    clearTimeout(timer); pending.delete(id); reject(error)
  }
})
export const preloadZipformer = (preferences: VoiceInputPreferences): Promise<void> => {
  const requested = modelKey(preferences)
  if (child && ready && key === requested) return ready
  shutdownZipformerRuntime()
  key = requested
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const libraries = join(dirname(dirname(preferences.executablePath)), `sherpa-onnx-${platform}-${process.arch}`)
  const env = { ...process.env }
  if (process.platform === 'linux') env.LD_LIBRARY_PATH = `${libraries}${env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : ''}`
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = `${libraries}${env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : ''}`
  if (process.platform === 'win32') {
    const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path') || 'PATH'
    env[pathKey] = `${libraries};${env[pathKey] || ''}`
  }
  const current = utilityProcess.fork(join(__dirname, 'voiceRuntimeWorker.js'), [], {
    env, stdio: 'pipe', serviceName: 'Local voice recognition',
    allowLoadingUnsignedLibraries: process.platform === 'darwin'
  })
  child = current
  let stderr = ''
  current.stderr?.on('data', (data) => { stderr = (stderr + String(data)).slice(-4000) })
  current.on('message', (message) => {
    if (child !== current) return
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id); clearTimeout(task.timer)
    if (message.error) task.reject(new Error(message.error))
    else task.resolve(message.result)
  })
  current.on('exit', (code) => {
    if (child !== current) return
    logRuntimeEvent('error', 'voice.runtime.exited', { code, diagnostic: stderr })
    child = undefined; ready = undefined; key = ''
    rejectPending(new Error(`Voice engine exited (${code}). Check the installation and runtime log.`))
  })
  const started = Date.now()
  logRuntimeEvent('info', 'voice.runtime.loading', { engine: 'sherpa-onnx', version: '1.12.40', provider: 'cpu' })
  ready = call('load', { preferences }).then(() => {
    logRuntimeEvent('info', 'voice.runtime.ready', { elapsedMs: Date.now() - started })
  }).catch((error) => {
    if (child === current) shutdownZipformerRuntime()
    throw error
  })
  return ready
}
export const startZipformerStream = async (preferences: VoiceInputPreferences, sessionId: string) => {
  await preloadZipformer(preferences)
  await call('start', { sessionId })
}
export const pushZipformerStream = (sessionId: string, samples: Float32Array, sequence: number): Promise<VoiceStreamResult> => call('push', { sessionId, samples, sequence })
export const finishZipformerStream = (sessionId: string): Promise<VoiceStreamResult> => call('finish', { sessionId })
export const cancelZipformerStream = async (sessionId: string) => { if (child) await call('cancel', { sessionId }) }
