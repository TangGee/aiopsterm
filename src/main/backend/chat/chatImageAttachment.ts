import type {
  ChatImageAttachmentClipboardInput,
  ChatImageAttachmentFileInput,
  ChatImageAttachmentMediaType,
  ChatImageAttachmentPrepareInput,
  ChatImageAttachmentPrepareResult,
  ChatImageAttachmentValidateInput,
  ChatImageAttachmentValidateResult
} from '@shared/contracts/localFiles'
import { prepareChatImageAttachment as prepareChatImageAttachmentFromData, validateChatImageAttachment } from '@shared/chatImageAttachment'
import { clipboard } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'

const imageMimeByExtension: Record<string, ChatImageAttachmentMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

const normalizePath = (value: unknown) => String(value || '').trim()

const imageMimeFromHeader = (buffer: Buffer, filePath: string): ChatImageAttachmentMediaType | '' => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const gifHeader = buffer.subarray(0, 6).toString('ascii')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return imageMimeByExtension[extname(filePath).toLowerCase()] || ''
}

export { validateChatImageAttachment }

export const prepareChatImageAttachment = (input: ChatImageAttachmentPrepareInput = {}): ChatImageAttachmentPrepareResult =>
  prepareChatImageAttachmentFromData(input)

export const prepareChatImageAttachmentFromFile = async (input: Partial<ChatImageAttachmentFileInput> = {}): Promise<ChatImageAttachmentPrepareResult> => {
  const filePath = normalizePath(input.filePath)
  if (!filePath) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_FILE_PATH_REQUIRED',
      errorMessage: '请选择图片文件。'
    }
  }

  try {
    const metadata = await stat(filePath)
    if (!metadata.isFile()) {
      return {
        ok: false,
        errorCode: 'CHAT_IMAGE_NOT_FILE',
        errorMessage: '请选择图片文件。'
      }
    }

    const bytes = await readFile(filePath)
    const mediaType = imageMimeFromHeader(bytes, filePath)
    const validation = validateChatImageAttachment({
      mediaType,
      name: input.name || basename(filePath),
      size: metadata.size
    })
    if (!validation.ok || !validation.data) {
      return {
        ok: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage
      }
    }

    return prepareChatImageAttachmentFromData({
      mediaType: validation.data.mediaType,
      data: bytes.toString('base64'),
      name: validation.data.name,
      size: validation.data.size
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_FILE_READ_FAILED',
      errorMessage: error instanceof Error ? error.message : '图片读取失败。'
    }
  }
}

export const prepareChatImageAttachmentFromClipboard = (input: ChatImageAttachmentClipboardInput = {}): ChatImageAttachmentPrepareResult => {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_CLIPBOARD_EMPTY',
      errorMessage: '剪贴板中没有可用图片。'
    }
  }

  const bytes = image.toPNG()
  const validation = validateChatImageAttachment({
    mediaType: 'image/png',
    name: input.name || 'clipboard.png',
    size: bytes.byteLength
  })
  if (!validation.ok || !validation.data) {
    return {
      ok: false,
      errorCode: validation.errorCode,
      errorMessage: validation.errorMessage
    }
  }

  return prepareChatImageAttachmentFromData({
    mediaType: validation.data.mediaType,
    data: bytes.toString('base64'),
    name: validation.data.name,
    size: validation.data.size
  })
}

export type { ChatImageAttachmentPrepareResult, ChatImageAttachmentValidateInput, ChatImageAttachmentValidateResult }
