import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let backend: any
let tempRoot = ''

beforeEach(async () => {
  const modulePath = '../src/main/backend/zmodem'
  backend = await import(modulePath)
  backend.resetZmodemRuntimeForTests()
  tempRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-zmodem-'))
})

afterEach(async () => {
  backend.resetZmodemRuntimeForTests()
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('zmodem backend boundary', () => {
  it('reads selected upload files through the main-process runtime', async () => {
    const source = join(tempRoot, 'upload.bin')
    await writeFile(source, Buffer.from([0, 1, 2, 255]))

    const result = await backend.pickZmodemUploadFiles({
      showOpenDialog: async () => ({ canceled: false, filePaths: [source] })
    })

    expect(result).toEqual({
      ok: true,
      data: {
        files: [
          expect.objectContaining({
            name: 'upload.bin',
            size: 4,
            data: [0, 1, 2, 255]
          })
        ]
      }
    })
    expect(result.data?.files[0].lastModified).toEqual(expect.any(Number))
  })

  it('returns cancellation instead of fabricating upload files', async () => {
    await expect(
      backend.pickZmodemUploadFiles({
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      })
    ).resolves.toEqual({ ok: true, data: { files: [], canceled: true } })
  })

  it('rejects unavailable or invalid upload sources', async () => {
    await expect(backend.pickZmodemUploadFiles()).resolves.toMatchObject({
      ok: false,
      errorCode: 'ZMODEM_UPLOAD_DIALOG_UNAVAILABLE'
    })

    await expect(
      backend.pickZmodemUploadFiles({
        showOpenDialog: async () => ({ canceled: false, filePaths: ['relative.bin'] })
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'ZMODEM_UPLOAD_PATH_INVALID'
    })
  })

  it('picks save paths through the backend dialog runtime', async () => {
    const output = join(tempRoot, 'download.bin')
    await expect(
      backend.pickZmodemSavePath('../download.bin', {
        showSaveDialog: async (name: string) => {
          expect(name).toBe('download.bin')
          return { canceled: false, filePath: output }
        }
      })
    ).resolves.toEqual({ ok: true, data: { filePath: output } })
  })

  it('writes and closes backend-owned ZMODEM download streams', async () => {
    const output = join(tempRoot, 'received.bin')
    const opened = await backend.openZmodemStream(output)
    expect(opened.ok).toBe(true)
    const streamId = opened.data!.streamId

    await expect(backend.writeZmodemChunk(streamId, [0, 1, 2])).resolves.toEqual({
      ok: true,
      data: { streamId, bytes: 3, totalBytes: 3 }
    })
    await expect(backend.writeZmodemChunk(streamId, new Uint8Array([3, 4]))).resolves.toEqual({
      ok: true,
      data: { streamId, bytes: 2, totalBytes: 5 }
    })

    await expect(backend.closeZmodemStream(streamId)).resolves.toEqual({
      ok: true,
      data: { streamId, filePath: output, bytes: 5 }
    })
    await expect(readFile(output)).resolves.toEqual(Buffer.from([0, 1, 2, 3, 4]))
    await expect(stat(output)).resolves.toMatchObject({ size: 5 })
  })

  it('fails closed for missing streams and empty chunks', async () => {
    await expect(backend.writeZmodemChunk('missing-stream', [1])).resolves.toMatchObject({
      ok: false,
      errorCode: 'ZMODEM_STREAM_NOT_FOUND'
    })

    const output = join(tempRoot, 'empty.bin')
    const opened = await backend.openZmodemStream(output)
    expect(opened.ok).toBe(true)
    await expect(backend.writeZmodemChunk(opened.data!.streamId, [])).resolves.toMatchObject({
      ok: false,
      errorCode: 'ZMODEM_CHUNK_EMPTY'
    })
    await backend.closeZmodemStream(opened.data!.streamId)
  })
})
