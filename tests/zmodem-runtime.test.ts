import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalZmodemRuntime, type TerminalZmodemProgress } from '@/services/zmodemRuntime'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type FakeDetection = {
  confirm: () => any
}

type FakeSentryOptions = {
  on_detect: (detection: FakeDetection) => void | Promise<void>
  to_terminal: (octets: Uint8Array) => void
  sender: (octets: Uint8Array) => void
  on_retract?: () => void
}

const sentryState = vi.hoisted(() => ({
  instances: [] as Array<{ options: FakeSentryOptions; consume: ReturnType<typeof vi.fn> }>
}))

vi.mock('zmodem.js', () => {
  class FakeSentry {
    options: FakeSentryOptions
    consume = vi.fn()

    constructor(options: FakeSentryOptions) {
      this.options = options
      sentryState.instances.push(this)
    }
  }

  return {
    default: { Sentry: FakeSentry },
    Sentry: FakeSentry
  }
})

const terminalEvent = {
  id: 'terminal-zmodem-unit',
  data: '**\x18B',
  raw: [0x2a, 0x2a, 0x18, 0x42]
}

const flushAsync = async (cycles = 4) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
}

const latestSentry = () => {
  const sentry = sentryState.instances.at(-1)
  if (!sentry) throw new Error('Expected zmodem sentry to be created.')
  return sentry
}

const byteLength = (value: number[] | Uint8Array | ArrayBuffer) => {
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return value.length
}

const createRuntimeHarness = (apiOverrides: Partial<AiopsPreloadApi> = {}) => {
  const progressEvents: Array<{ sessionId: string; progress: TerminalZmodemProgress }> = []
  const notices: string[] = []
  const appendData = vi.fn()
  const api = {
    writeTerminalBinary: vi.fn(async (id: string, data: number[] | Uint8Array | ArrayBuffer) => ({
      ok: true,
      data: { id, bytes: byteLength(data) }
    })),
    pickZmodemUploadFiles: vi.fn(async () => ({ ok: true, data: { files: [], canceled: true } })),
    pickZmodemSavePath: vi.fn(async (name: string) => ({ ok: true, data: { filePath: `/tmp/${name || 'zmodem-download'}` } })),
    openZmodemStream: vi.fn(async (filePath: string) => ({ ok: true, data: { streamId: 'stream-1', filePath } })),
    writeZmodemChunk: vi.fn(async (streamId: string, chunk: number[] | Uint8Array | ArrayBuffer) => ({
      ok: true,
      data: { streamId, bytes: byteLength(chunk), totalBytes: byteLength(chunk) }
    })),
    closeZmodemStream: vi.fn(async (streamId: string) => ({ ok: true, data: { streamId, filePath: '/tmp/download.bin', bytes: 0 } })),
    ...apiOverrides
  } as unknown as AiopsPreloadApi

  const runtime = createTerminalZmodemRuntime({
    getApi: () => api,
    appendData,
    onProgress: (sessionId, progress) => {
      progressEvents.push({ sessionId, progress })
    },
    onNotice: (message) => {
      notices.push(message)
    }
  })

  return { api, appendData, notices, progressEvents, runtime }
}

const detectSession = async (runtime: ReturnType<typeof createTerminalZmodemRuntime>, session: any) => {
  expect(runtime.handleTerminalData(terminalEvent)).toBe(true)
  await latestSentry().options.on_detect({ confirm: () => session })
  await flushAsync()
}

const createSendSession = (overrides: Record<string, unknown> = {}) => ({
  type: 'send',
  close: vi.fn(async () => undefined),
  send_offer: vi.fn(async () => ({
    send: vi.fn(),
    end: vi.fn(async () => undefined)
  })),
  ...overrides
})

const createReceiveSession = () => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const session = {
    type: 'receive',
    allow_missing_OO: vi.fn(),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      handlers.set(event, callback)
    }),
    start: vi.fn(),
    close: vi.fn(async () => undefined)
  }
  return { handlers, session }
}

const createDownloadTransfer = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const transfer = {
    get_details: vi.fn(() => ({ name: 'download.bin', size: 3 })),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      handlers.set(event, callback)
    }),
    accept: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
    ...overrides
  }
  return { handlers, transfer }
}

beforeEach(() => {
  sentryState.instances.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('terminal zmodem runtime boundary', () => {
  it('uploads only structurally valid picker files', async () => {
    const transfer = {
      send: vi.fn(),
      end: vi.fn(async () => undefined)
    }
    const sendSession = createSendSession({
      send_offer: vi.fn(async () => transfer)
    })
    const { api, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemUploadFiles: vi.fn(async () => ({
        ok: true,
        data: {
          files: [{ name: 'upload.bin', size: 3, lastModified: 1717200000000, data: [1, 2, 3] }]
        }
      }))
    })

    await detectSession(runtime, sendSession)

    expect(api.pickZmodemUploadFiles).toHaveBeenCalledTimes(1)
    expect(sendSession.send_offer).toHaveBeenCalledWith({
      name: 'upload.bin',
      size: 3,
      mtime: new Date(1717200000000),
      mode: 0o100644
    })
    expect(Array.from(transfer.send.mock.calls[0][0])).toEqual([1, 2, 3])
    expect(transfer.end).toHaveBeenCalledWith(new Uint8Array())
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'upload',
      fileName: 'upload.bin',
      transferred: 3,
      total: 3,
      status: 'success',
      message: 'Upload complete'
    })
  })

  it('fails upload when the remote session does not accept the offered file', async () => {
    const sendSession = createSendSession({
      send_offer: vi.fn(async () => undefined)
    })
    const { notices, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemUploadFiles: vi.fn(async () => ({
        ok: true,
        data: {
          files: [{ name: 'upload.bin', size: 3, lastModified: 1717200000000, data: [1, 2, 3] }]
        }
      }))
    })

    await detectSession(runtime, sendSession)

    expect(sendSession.send_offer).toHaveBeenCalledWith({
      name: 'upload.bin',
      size: 3,
      mtime: new Date(1717200000000),
      mode: 0o100644
    })
    expect(sendSession.close).toHaveBeenCalledTimes(1)
    expect(notices).toContain('ZMODEM upload offer was not accepted by the remote session.')
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'upload',
      status: 'error',
      message: 'ZMODEM upload offer was not accepted by the remote session.'
    })
    expect(progressEvents.some(({ progress }) => progress.status === 'success')).toBe(false)
  })

  it('rejects malformed successful upload picker results before offering files', async () => {
    const sendSession = createSendSession()
    const { notices, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemUploadFiles: vi.fn(async () => ({
        ok: true,
        data: {
          files: [{ name: 'bad.bin', size: 4, lastModified: 1717200000000, data: [1] }]
        }
      }))
    })

    await detectSession(runtime, sendSession)

    expect(sendSession.send_offer).not.toHaveBeenCalled()
    expect(sendSession.close).toHaveBeenCalledTimes(1)
    expect(notices).toContain('ZMODEM upload picker returned malformed result.')
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'upload',
      status: 'error',
      message: 'ZMODEM upload picker returned malformed result.'
    })
  })

  it('rejects malformed successful save path results instead of treating them as cancellation', async () => {
    const { handlers, session } = createReceiveSession()
    const { transfer } = createDownloadTransfer()
    const { api, notices, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemSavePath: vi.fn(async () => ({ ok: true, data: {} }) as any)
    })

    await detectSession(runtime, session)
    handlers.get('offer')?.(transfer)
    await flushAsync()

    expect(api.openZmodemStream).not.toHaveBeenCalled()
    expect(transfer.accept).not.toHaveBeenCalled()
    expect(transfer.skip).toHaveBeenCalledTimes(1)
    expect(notices).toContain('ZMODEM save path picker returned malformed result.')
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'download',
      status: 'error',
      message: 'ZMODEM save path picker returned malformed result.'
    })
  })

  it('rejects stream open results that do not match the requested save path', async () => {
    const { handlers, session } = createReceiveSession()
    const { transfer } = createDownloadTransfer()
    const { api, notices, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemSavePath: vi.fn(async () => ({ ok: true, data: { filePath: '/tmp/download.bin' } })),
      openZmodemStream: vi.fn(async () => ({ ok: true, data: { streamId: 'stream-1', filePath: '/tmp/other.bin' } }))
    })

    await detectSession(runtime, session)
    handlers.get('offer')?.(transfer)
    await flushAsync()

    expect(api.openZmodemStream).toHaveBeenCalledWith('/tmp/download.bin')
    expect(api.writeZmodemChunk).not.toHaveBeenCalled()
    expect(transfer.accept).not.toHaveBeenCalled()
    expect(transfer.skip).toHaveBeenCalledTimes(1)
    expect(notices).toContain('ZMODEM stream open failed.')
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'download',
      status: 'error',
      message: 'ZMODEM stream open failed.'
    })
  })

  it('rejects stream close results that do not match the accepted transfer', async () => {
    const { handlers, session } = createReceiveSession()
    const transferState = createDownloadTransfer()
    const { transfer } = transferState
    transfer.accept = vi.fn(async () => {
      transferState.handlers.get('input')?.(new Uint8Array([1, 2, 3]))
      transferState.handlers.get('complete')?.()
    })
    const { api, notices, progressEvents, runtime } = createRuntimeHarness({
      pickZmodemSavePath: vi.fn(async () => ({ ok: true, data: { filePath: '/tmp/download.bin' } })),
      openZmodemStream: vi.fn(async () => ({ ok: true, data: { streamId: 'stream-1', filePath: '/tmp/download.bin' } })),
      closeZmodemStream: vi.fn(async (streamId: string) => ({
        ok: true,
        data: { streamId, filePath: '/tmp/other.bin', bytes: 3 }
      }))
    })

    await detectSession(runtime, session)
    handlers.get('offer')?.(transfer)
    await flushAsync(6)

    expect(api.writeZmodemChunk).toHaveBeenCalledWith('stream-1', [1, 2, 3])
    expect(api.closeZmodemStream).toHaveBeenCalledWith('stream-1')
    expect(transfer.skip).toHaveBeenCalledTimes(1)
    expect(notices).toContain('ZMODEM stream close failed.')
    expect(progressEvents.at(-1)?.progress).toMatchObject({
      type: 'download',
      status: 'error',
      message: 'ZMODEM stream close failed.'
    })
    expect(progressEvents.some(({ progress }) => progress.status === 'success')).toBe(false)
  })
})
