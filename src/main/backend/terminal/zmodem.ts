import { basename, isAbsolute } from 'path'
import { createWriteStream } from 'fs'
import { readFile, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import type {
  ZmodemSavePathPickResult,
  ZmodemStreamCloseResult,
  ZmodemStreamOpenResult,
  ZmodemStreamWriteResult,
  ZmodemUploadPickResult
} from '@shared/contracts/zmodem'

type OpenDialogResult = {
  canceled?: boolean
  filePaths?: string[]
}

type SaveDialogResult = {
  canceled?: boolean
  filePath?: string
}

export type ZmodemRuntime = {
  showOpenDialog?: () => Promise<OpenDialogResult>
  showSaveDialog?: (defaultName: string) => Promise<SaveDialogResult>
}

type ActiveZmodemStream = {
  filePath: string
  bytes: number
  stream: ReturnType<typeof createWriteStream>
}

const maxZmodemUploadBytes = 256 * 1024 * 1024
const activeStreams = new Map<string, ActiveZmodemStream>()

let runtimeConfig: ZmodemRuntime = {}

const errorResult = <T>(errorCode: string, errorMessage: string): { ok: false; errorCode: string; errorMessage: string; data?: T } => ({
  ok: false,
  errorCode,
  errorMessage
})

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const chunkToBuffer = (chunk: unknown): Buffer => {
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk)
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  if (Array.isArray(chunk)) return Buffer.from(chunk)
  return Buffer.alloc(0)
}

export const configureZmodemRuntime = (runtime: ZmodemRuntime = {}) => {
  runtimeConfig = { ...runtimeConfig, ...runtime }
}

export const resetZmodemRuntimeForTests = () => {
  for (const stream of activeStreams.values()) {
    stream.stream.destroy()
  }
  activeStreams.clear()
  runtimeConfig = {}
}

export const pickZmodemUploadFiles = async (runtime?: ZmodemRuntime): Promise<ZmodemUploadPickResult> => {
  try {
    const activeRuntime = runtime || runtimeConfig
    if (!activeRuntime.showOpenDialog) {
      return errorResult('ZMODEM_UPLOAD_DIALOG_UNAVAILABLE', 'ZMODEM upload file picker is unavailable.')
    }
    const result = await activeRuntime.showOpenDialog()
    const filePaths = result?.canceled ? [] : result?.filePaths || []
    if (!filePaths.length) {
      return { ok: true, data: { files: [], canceled: true } }
    }
    const files = []
    for (const filePath of filePaths) {
      const normalizedPath = normalizeText(filePath)
      if (!normalizedPath || !isAbsolute(normalizedPath)) {
        return errorResult('ZMODEM_UPLOAD_PATH_INVALID', 'ZMODEM upload requires absolute local file paths.')
      }
      const metadata = await stat(normalizedPath)
      if (!metadata.isFile()) {
        return errorResult('ZMODEM_UPLOAD_NOT_FILE', 'ZMODEM upload source must be a file.')
      }
      if (metadata.size > maxZmodemUploadBytes) {
        return errorResult('ZMODEM_UPLOAD_TOO_LARGE', 'ZMODEM upload file is too large.')
      }
      const data = await readFile(normalizedPath)
      files.push({
        name: basename(normalizedPath),
        size: metadata.size,
        lastModified: metadata.mtimeMs,
        data: Array.from(data)
      })
    }
    return { ok: true, data: { files } }
  } catch (error) {
    return errorResult('ZMODEM_UPLOAD_READ_FAILED', error instanceof Error ? error.message : 'Failed to read ZMODEM upload file.')
  }
}

export const pickZmodemSavePath = async (name: string, runtime?: ZmodemRuntime): Promise<ZmodemSavePathPickResult> => {
  try {
    const activeRuntime = runtime || runtimeConfig
    if (!activeRuntime.showSaveDialog) {
      return errorResult('ZMODEM_SAVE_DIALOG_UNAVAILABLE', 'ZMODEM save dialog is unavailable.')
    }
    const safeName = basename(normalizeText(name) || 'zmodem-download')
    const result = await activeRuntime.showSaveDialog(safeName)
    if (result?.canceled || !result?.filePath) {
      return { ok: true, data: { canceled: true } }
    }
    const filePath = normalizeText(result.filePath)
    if (!filePath || !isAbsolute(filePath)) {
      return errorResult('ZMODEM_SAVE_PATH_INVALID', 'ZMODEM save path must be absolute.')
    }
    return { ok: true, data: { filePath } }
  } catch (error) {
    return errorResult('ZMODEM_SAVE_DIALOG_FAILED', error instanceof Error ? error.message : 'Failed to pick ZMODEM save path.')
  }
}

export const openZmodemStream = async (savePath: string): Promise<ZmodemStreamOpenResult> => {
  try {
    const filePath = normalizeText(savePath)
    if (!filePath || !isAbsolute(filePath)) {
      return errorResult('ZMODEM_STREAM_PATH_INVALID', 'ZMODEM stream path must be absolute.')
    }
    const streamId = randomUUID()
    const stream = createWriteStream(filePath)
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    activeStreams.set(streamId, { filePath, bytes: 0, stream })
    stream.on('error', () => {
      activeStreams.delete(streamId)
    })
    return { ok: true, data: { streamId, filePath } }
  } catch (error) {
    return errorResult('ZMODEM_STREAM_OPEN_FAILED', error instanceof Error ? error.message : 'Failed to open ZMODEM stream.')
  }
}

export const writeZmodemChunk = async (streamId: string, chunk: unknown): Promise<ZmodemStreamWriteResult> => {
  try {
    const id = normalizeText(streamId)
    const active = id ? activeStreams.get(id) : null
    if (!active) {
      return errorResult('ZMODEM_STREAM_NOT_FOUND', 'ZMODEM stream is not active.')
    }
    const buffer = chunkToBuffer(chunk)
    if (!buffer.byteLength) {
      return errorResult('ZMODEM_CHUNK_EMPTY', 'ZMODEM chunk is empty.')
    }
    await new Promise<void>((resolve, reject) => {
      active.stream.write(buffer, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    active.bytes += buffer.byteLength
    return { ok: true, data: { streamId: id, bytes: buffer.byteLength, totalBytes: active.bytes } }
  } catch (error) {
    activeStreams.delete(normalizeText(streamId))
    return errorResult('ZMODEM_STREAM_WRITE_FAILED', error instanceof Error ? error.message : 'Failed to write ZMODEM stream.')
  }
}

export const closeZmodemStream = async (streamId: string): Promise<ZmodemStreamCloseResult> => {
  try {
    const id = normalizeText(streamId)
    const active = id ? activeStreams.get(id) : null
    if (!active) {
      return errorResult('ZMODEM_STREAM_NOT_FOUND', 'ZMODEM stream is not active.')
    }
    activeStreams.delete(id)
    await new Promise<void>((resolve, reject) => {
      active.stream.once('error', reject)
      active.stream.end(resolve)
    })
    const metadata = await stat(active.filePath)
    if (metadata.size !== active.bytes) {
      return errorResult('ZMODEM_STREAM_SIZE_MISMATCH', 'ZMODEM saved file size does not match the transferred byte count.')
    }
    return { ok: true, data: { streamId: id, filePath: active.filePath, bytes: active.bytes } }
  } catch (error) {
    return errorResult('ZMODEM_STREAM_CLOSE_FAILED', error instanceof Error ? error.message : 'Failed to close ZMODEM stream.')
  }
}
