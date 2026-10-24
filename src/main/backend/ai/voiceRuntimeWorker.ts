import { createRequire } from 'node:module'
import { createZipformerPipeline, type SherpaModule } from './zipformerPipeline'
import type { VoiceInputPreferences } from '@shared/contracts/voice'

let pipeline: ReturnType<typeof createZipformerPipeline> | undefined
process.parentPort.on('message', ({ data }) => {
  const { id, method, sessionId, preferences, samples, sequence } = data
  try {
    let result: unknown
    if (method === 'load') {
      const config = preferences as VoiceInputPreferences
      const requireRuntime = createRequire(config.executablePath)
      pipeline = createZipformerPipeline(requireRuntime(config.executablePath) as SherpaModule, config)
      result = { ready: true }
    } else {
      if (!pipeline) throw new Error('Voice models have not loaded.')
      if (method === 'start') result = pipeline.start(sessionId)
      else if (method === 'push') result = pipeline.push(sessionId, new Float32Array(samples), sequence)
      else if (method === 'finish') result = pipeline.finish(sessionId)
      else if (method === 'cancel') result = pipeline.cancel(sessionId)
      else throw new Error('Unknown voice operation.')
    }
    process.parentPort.postMessage({ id, result })
  } catch (error) {
    process.parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
