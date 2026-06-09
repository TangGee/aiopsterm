import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAX_CHAT_IMAGE_ATTACHMENT_BYTES, prepareChatImageAttachment, validateChatImageAttachment } from '@shared/chatImageAttachment'

const electronMock = vi.hoisted(() => ({
  clipboard: {
    readImage: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

type ChatImageBackend = {
  prepareChatImageAttachmentFromFile: (input: { filePath: string; name?: string }) => Promise<ReturnType<typeof prepareChatImageAttachment>>
  prepareChatImageAttachmentFromClipboard: (input?: { name?: string }) => ReturnType<typeof prepareChatImageAttachment>
}
let backend: ChatImageBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/chatImageAttachment'
  backend = (await import(modulePath)) as ChatImageBackend
})

describe('chat image attachment backend boundary', () => {
  beforeEach(() => {
    electronMock.clipboard.readImage.mockReset()
  })

  it('validates image metadata before renderer file reads', () => {
    expect(
      validateChatImageAttachment({
        mediaType: 'image/jpeg',
        name: 'photo.jpg',
        size: 4096
      })
    ).toEqual({
      ok: true,
      data: {
        mediaType: 'image/jpeg',
        name: 'photo.jpg',
        size: 4096
      }
    })
  })

  it('normalizes supported image data into a chat image part', () => {
    const result = prepareChatImageAttachment({
      mediaType: 'IMAGE/PNG',
      data: 'data:image/png;base64,aW1hZ2UtZGF0YQ==',
      name: 'diagram.png',
      size: 2048
    })

    expect(result).toEqual({
      ok: true,
      data: {
        type: 'image',
        mediaType: 'image/png',
        data: 'aW1hZ2UtZGF0YQ==',
        name: 'diagram.png',
        size: 2048
      }
    })
  })

  it('rejects unsupported, oversized, and empty image inputs', () => {
    expect(
      prepareChatImageAttachment({
        mediaType: 'text/plain',
        data: 'VEVYVA==',
        name: 'note.txt',
        size: 16
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE'
      })
    )

    expect(
      prepareChatImageAttachment({
        mediaType: 'image/webp',
        data: 'AAAA',
        name: 'large.webp',
        size: MAX_CHAT_IMAGE_ATTACHMENT_BYTES + 1
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'CHAT_IMAGE_TOO_LARGE'
      })
    )

    expect(
      prepareChatImageAttachment({
        mediaType: 'image/gif',
        data: '',
        name: 'empty.gif',
        size: 0
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'CHAT_IMAGE_EMPTY_DATA'
      })
    )
  })

  it('prepares image attachments from local file paths in the main backend', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-image-'))
    const filePath = join(dir, 'input.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])

    try {
      await writeFile(filePath, bytes)
      const result = await backend.prepareChatImageAttachmentFromFile({ filePath })

      expect(result).toEqual({
        ok: true,
        data: {
          type: 'image',
          mediaType: 'image/png',
          data: bytes.toString('base64'),
          name: 'input.png',
          size: bytes.byteLength
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects non-image local files before creating image parts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-image-invalid-'))
    const filePath = join(dir, 'note.txt')

    try {
      await writeFile(filePath, 'TEXT')
      const result = await backend.prepareChatImageAttachmentFromFile({ filePath })

      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE'
        })
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prepares pasted image attachments from the Electron clipboard boundary', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03, 0x04])
    electronMock.clipboard.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => bytes
    })

    const result = backend.prepareChatImageAttachmentFromClipboard()

    expect(electronMock.clipboard.readImage).toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      data: {
        type: 'image',
        mediaType: 'image/png',
        data: bytes.toString('base64'),
        name: 'clipboard.png',
        size: bytes.byteLength
      }
    })
  })

  it('rejects empty clipboard images without renderer-provided data', () => {
    electronMock.clipboard.readImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0)
    })

    expect(backend.prepareChatImageAttachmentFromClipboard()).toEqual({
      ok: false,
      errorCode: 'CHAT_IMAGE_CLIPBOARD_EMPTY',
      errorMessage: '剪贴板中没有可用图片。'
    })
  })
})
