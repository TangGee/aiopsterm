import Zmodem, { type ZmodemSession, type ZmodemTransfer } from 'zmodem.js'
import type {
  AiopsPreloadApi,
  TerminalDataEvent,
  ZmodemSavePathPickResult,
  ZmodemStreamCloseResult,
  ZmodemStreamOpenResult,
  ZmodemUploadFile,
  ZmodemUploadPickResult
} from '@shared/preload'

export type TerminalZmodemProgress = {
  visible: boolean
  type: 'upload' | 'download'
  fileName: string
  transferred: number
  total: number
  status: 'running' | 'success' | 'error' | 'cancelled'
  message: string
}

type TerminalZmodemRuntimeOptions = {
  getApi: () => AiopsPreloadApi | undefined
  appendData: (sessionId: string, data: string) => void
  onProgress: (sessionId: string, progress: TerminalZmodemProgress) => void
  onNotice?: (message: string) => void
}

type TerminalZmodemSessionState = {
  sentry: InstanceType<typeof Zmodem.Sentry>
  active: boolean
  decoder: TextDecoder
  transferAbort?: () => void
}

const zmodemMagicBytes = [0x2a, 0x2a, 0x18, 0x42]
const abortBytes = new Uint8Array([...Array(10).fill(0x18), ...Array(10).fill(0x08)])

const bytesFrom = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value.map((item) => Number(item) & 0xff))
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array()
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text)

const containsMagic = (bytes: Uint8Array, text: string) => {
  if (text.includes('**\x18B')) return true
  for (let index = 0; index <= bytes.length - zmodemMagicBytes.length; index += 1) {
    if (zmodemMagicBytes.every((byte, offset) => bytes[index + offset] === byte)) return true
  }
  return false
}

const validateBinaryWrite = async (api: AiopsPreloadApi, sessionId: string, bytes: Uint8Array) => {
  if (typeof api.writeTerminalBinary !== 'function') return false
  const result = await api.writeTerminalBinary(sessionId, Array.from(bytes))
  return result?.ok === true && result.data?.id === sessionId && result.data.bytes === bytes.byteLength
}

const validStreamWrite = (result: Awaited<ReturnType<AiopsPreloadApi['writeZmodemChunk']>>, streamId: string, bytes: number) =>
  result?.ok === true && result.data?.streamId === streamId && result.data.bytes === bytes

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isValidTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const isZmodemUploadFile = (value: unknown): value is ZmodemUploadFile => {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ZmodemUploadFile>
  if (!isNonEmptyString(file.name)) return false
  if (!isNonNegativeInteger(file.size)) return false
  if (!isValidTimestamp(file.lastModified)) return false
  const bytes = bytesFrom(file.data)
  return bytes.byteLength === file.size
}

const validUploadPickData = (data: ZmodemUploadPickResult['data'] | undefined): data is NonNullable<ZmodemUploadPickResult['data']> =>
  !!data &&
  typeof data === 'object' &&
  Array.isArray(data.files) &&
  data.files.every(isZmodemUploadFile) &&
  (data.canceled === undefined || typeof data.canceled === 'boolean') &&
  (!data.canceled || data.files.length === 0)

const validSavePathPickData = (data: ZmodemSavePathPickResult['data'] | undefined): data is NonNullable<ZmodemSavePathPickResult['data']> => {
  if (!data || typeof data !== 'object') return false
  if (data.canceled === true) return data.filePath === undefined || data.filePath === ''
  return isNonEmptyString(data.filePath) && (data.canceled === undefined || data.canceled === false)
}

const validStreamOpen = (
  result: ZmodemStreamOpenResult,
  filePath: string
): result is ZmodemStreamOpenResult & { ok: true; data: { streamId: string; filePath: string } } =>
  result?.ok === true && isNonEmptyString(result.data?.streamId) && result.data.filePath === filePath

const validStreamClose = (
  result: ZmodemStreamCloseResult,
  streamId: string,
  filePath: string,
  bytes: number
): result is ZmodemStreamCloseResult & { ok: true; data: { streamId: string; filePath: string; bytes: number } } =>
  result?.ok === true && result.data?.streamId === streamId && result.data.filePath === filePath && isNonNegativeInteger(result.data.bytes) && result.data.bytes === bytes

const progress = (
  type: TerminalZmodemProgress['type'],
  fileName: string,
  transferred: number,
  total: number,
  status: TerminalZmodemProgress['status'],
  message: string
): TerminalZmodemProgress => ({
  visible: true,
  type,
  fileName,
  transferred,
  total,
  status,
  message
})

export const createTerminalZmodemRuntime = (options: TerminalZmodemRuntimeOptions) => {
  const sessions = new Map<string, TerminalZmodemSessionState>()

  const notice = (message: string) => options.onNotice?.(message)

  const writeBinary = async (sessionId: string, bytes: Uint8Array) => {
    const api = options.getApi()
    if (!api || !(await validateBinaryWrite(api, sessionId, bytes))) {
      throw new Error('ZMODEM binary terminal write failed.')
    }
  }

  const appendOctets = (sessionId: string, state: TerminalZmodemSessionState, bytes: Uint8Array) => {
    if (!bytes.byteLength) return
    const text = state.decoder.decode(bytes, { stream: true })
    if (text) options.appendData(sessionId, text)
  }

  const closeSession = async (session: ZmodemSession | null | undefined) => {
    try {
      await session?.close?.()
    } catch {
      /* Protocol close errors are already reflected by transfer progress. */
    }
  }

  const update = (sessionId: string, nextProgress: TerminalZmodemProgress) => {
    options.onProgress(sessionId, nextProgress)
  }

  const uploadFiles = async (sessionId: string, zsession: ZmodemSession, state: TerminalZmodemSessionState, files: ZmodemUploadFile[]) => {
    const total = files.reduce((sum, file) => sum + Math.max(0, file.size || file.data.length), 0) || 1
    let transferred = 0
    for (const file of files) {
      const bytes = bytesFrom(file.data)
      const name = file.name || 'zmodem-upload'
      update(sessionId, progress('upload', name, transferred, total, 'running', 'Uploading'))
      const transfer = await zsession.send_offer?.({
        name,
        size: bytes.byteLength,
        mtime: new Date(file.lastModified || Date.now()),
        mode: 0o100644
      })
      if (!transfer) continue
      const chunkSize = 128 * 1024
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize))
        transfer.send?.(chunk)
        transferred += chunk.byteLength
        update(sessionId, progress('upload', name, transferred, total, 'running', 'Uploading'))
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      await transfer.end?.(new Uint8Array())
    }
    update(sessionId, progress('upload', files.at(-1)?.name || 'zmodem-upload', total, total, 'success', 'Upload complete'))
  }

  const handleSendSession = async (sessionId: string, zsession: ZmodemSession, state: TerminalZmodemSessionState) => {
    const api = options.getApi()
    if (!api?.pickZmodemUploadFiles) throw new Error('ZMODEM upload picker is unavailable.')
    const picked = await api.pickZmodemUploadFiles()
    if (!picked?.ok) throw new Error(picked?.errorMessage || 'ZMODEM upload picker failed.')
    if (!validUploadPickData(picked.data)) throw new Error('ZMODEM upload picker returned malformed result.')
    const files = picked.data.files
    if (!files.length) {
      update(sessionId, progress('upload', '', 0, 0, 'cancelled', 'Upload cancelled'))
      await writeBinary(sessionId, abortBytes)
      await closeSession(zsession)
      state.active = false
      return
    }
    await uploadFiles(sessionId, zsession, state, files)
    await closeSession(zsession)
    state.active = false
  }

  const handleDownloadOffer = async (sessionId: string, xfer: ZmodemTransfer) => {
    const api = options.getApi()
    if (!api?.pickZmodemSavePath || !api.openZmodemStream || !api.writeZmodemChunk || !api.closeZmodemStream) {
      throw new Error('ZMODEM download stream bridge is unavailable.')
    }
    const details = xfer.get_details?.() || {}
    const fileName = details.name || 'zmodem-download'
    const total = Math.max(0, Number(details.size) || 0)
    const save = await api.pickZmodemSavePath(fileName)
    if (!save?.ok) throw new Error(save?.errorMessage || 'ZMODEM save path picker failed.')
    if (!validSavePathPickData(save.data)) throw new Error('ZMODEM save path picker returned malformed result.')
    if (save.data.canceled) {
      update(sessionId, progress('download', fileName, 0, total, 'cancelled', 'Download skipped'))
      await xfer.skip?.()
      return
    }
    const filePath = save.data.filePath
    if (!isNonEmptyString(filePath)) throw new Error('ZMODEM save path picker returned malformed result.')
    const opened = await api.openZmodemStream(filePath)
    if (!validStreamOpen(opened, filePath)) throw new Error(opened?.errorMessage || 'ZMODEM stream open failed.')
    const streamId = opened.data.streamId
    let transferred = 0
    let pending = Promise.resolve()
    update(sessionId, progress('download', fileName, 0, total, 'running', 'Downloading'))
    xfer.on?.('input', (payload: unknown) => {
      const bytes = bytesFrom(payload)
      if (!bytes.byteLength) return
      pending = pending.then(async () => {
        const written = await api.writeZmodemChunk(streamId, Array.from(bytes))
        if (!validStreamWrite(written, streamId, bytes.byteLength)) {
          throw new Error(written?.errorMessage || 'ZMODEM stream write failed.')
        }
        transferred += bytes.byteLength
        update(sessionId, progress('download', fileName, transferred, total, 'running', 'Downloading'))
      })
    })
    xfer.on?.('complete', () => {
      pending = pending.then(async () => {
        const closed = await api.closeZmodemStream(streamId)
        if (!validStreamClose(closed, streamId, filePath, transferred)) {
          throw new Error(closed?.errorMessage || 'ZMODEM stream close failed.')
        }
        update(sessionId, progress('download', fileName, transferred, total || transferred, 'success', 'Download complete'))
      })
    })
    await xfer.accept?.()
    await pending
  }

  const handleReceiveSession = async (sessionId: string, zsession: ZmodemSession, state: TerminalZmodemSessionState) => {
    zsession.allow_missing_OO?.(true)
    zsession.on?.('session_end', () => {
      state.active = false
    })
    zsession.on?.('offer', (xfer: unknown) => {
      const transfer = xfer as ZmodemTransfer
      void handleDownloadOffer(sessionId, transfer).catch(async (error) => {
        update(sessionId, progress('download', '', 0, 0, 'error', error instanceof Error ? error.message : 'Download failed'))
        notice(error instanceof Error ? error.message : 'ZMODEM download failed')
        await transfer.skip?.()
      })
    })
    zsession.start?.()
  }

  const createSessionState = (sessionId: string): TerminalZmodemSessionState => {
    const state = {
      active: false,
      decoder: new TextDecoder('utf-8', { fatal: false }),
      sentry: null as unknown as InstanceType<typeof Zmodem.Sentry>
    }
    state.sentry = new Zmodem.Sentry({
      to_terminal: (octets: Uint8Array) => appendOctets(sessionId, state, octets),
      sender: (octets: Uint8Array) => {
        void writeBinary(sessionId, octets).catch((error) => {
          notice(error instanceof Error ? error.message : 'ZMODEM terminal write failed')
        })
      },
      on_retract: () => {
        state.active = false
      },
      on_detect: async (detection) => {
        const zsession = detection.confirm()
        state.active = true
        try {
          if (zsession.type === 'send') await handleSendSession(sessionId, zsession, state)
          else await handleReceiveSession(sessionId, zsession, state)
        } catch (error) {
          state.active = false
          const message = error instanceof Error ? error.message : 'ZMODEM transfer failed'
          update(sessionId, progress(zsession.type === 'send' ? 'upload' : 'download', '', 0, 0, 'error', message))
          notice(message)
          await closeSession(zsession)
        }
      }
    })
    sessions.set(sessionId, state)
    return state
  }

  const stateFor = (sessionId: string) => sessions.get(sessionId) || createSessionState(sessionId)

  const handleTerminalData = (event: TerminalDataEvent) => {
    const sessionId = event.id
    if (!sessionId) return false
    const raw = event.raw?.length ? bytesFrom(event.raw) : utf8Bytes(event.data || '')
    const state = stateFor(sessionId)
    if (!state.active && !containsMagic(raw, event.data || '')) return false
    try {
      state.sentry.consume(raw)
      return true
    } catch (error) {
      state.active = false
      notice(error instanceof Error ? error.message : 'ZMODEM protocol parse failed')
      return false
    }
  }

  const cancel = async (sessionId: string) => {
    if (!sessionId) return
    const state = sessions.get(sessionId)
    if (!state?.active) return
    state.active = false
    await writeBinary(sessionId, abortBytes)
    update(sessionId, progress('download', '', 0, 0, 'cancelled', 'Transfer cancelled'))
  }

  const dispose = () => {
    sessions.clear()
  }

  return { handleTerminalData, cancel, dispose }
}
