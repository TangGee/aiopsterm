import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

// Windows 10 tar has no built-in bzip2 decoder. Decode in a worker so model
// archives do not require extra system tools or block the Electron main thread.
const decoderSource = String.raw`
const { workerData } = require('node:worker_threads');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const decode = require(workerData.decoder);
pipeline(createReadStream(workerData.archive), decode(),
  createWriteStream(workerData.output, { flags: 'wx', mode: 0o600 }))
  .catch(error => { throw error; });
`

const decompressBzip2 = (archive: string, output: string, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted()
  const worker = new Worker(decoderSource, {
    eval: true,
    workerData: { archive, output, decoder: createRequire(__filename).resolve('unbzip2-stream') }
  })
  let failure: Error | undefined
  const abort = () => { void worker.terminate() }
  signal.addEventListener('abort', abort, { once: true })
  worker.once('error', error => { failure = error })
  worker.once('exit', code => {
    signal.removeEventListener('abort', abort)
    // Wait for exit before removing the temporary file: the worker may still
    // hold it open when an error or cancellation is first reported.
    if (signal.aborted) reject(signal.reason)
    else if (failure || code !== 0) reject(failure || new Error(`Voice archive decoder exited (${code}).`))
    else resolve()
  })
  if (signal.aborted) abort()
})

export const extractVoiceArchive = async (
  archive: string, directory: string, strip: boolean, signal: AbortSignal,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  signal.throwIfAborted()
  const decoded = platform === 'win32' && archive.endsWith('.tar.bz2')
    ? join(directory, `.voice-unpacked-${randomUUID()}.tar`) : undefined
  try {
    if (decoded) await decompressBzip2(archive, decoded, signal)
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      execFile('tar', ['-xf', decoded || archive, '-C', directory, ...(strip ? ['--strip-components', '1'] : [])],
        { signal, timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, _stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message, { cause: error })) : resolve())
    })
  } catch (error) {
    signal.throwIfAborted()
    throw new Error(`Voice extraction failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    if (decoded) await rm(decoded, { force: true, maxRetries: 5, retryDelay: 100 })
  }
}
