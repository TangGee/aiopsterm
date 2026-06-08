import { describe, expect, it } from 'vitest'
import { MAX_CHAT_IMAGE_ATTACHMENT_BYTES, prepareChatImageAttachment, validateChatImageAttachment } from '@shared/chatImageAttachment'

describe('chat image attachment backend boundary', () => {
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
})
