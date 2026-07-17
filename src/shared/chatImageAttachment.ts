import type {
  ChatImageAttachmentMediaType,
  ChatImageAttachmentPrepareInput,
  ChatImageAttachmentPrepareResult,
  ChatImageAttachmentValidateInput,
  ChatImageAttachmentValidateResult
} from './contracts/localFiles'

export const SUPPORTED_CHAT_IMAGE_ATTACHMENT_TYPES: ChatImageAttachmentMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE = 5

const supportedTypeSet = new Set<string>(SUPPORTED_CHAT_IMAGE_ATTACHMENT_TYPES)

const normalizeText = (value: unknown) => String(value || '').trim()

const normalizeImageData = (value: unknown) => {
  const raw = normalizeText(value)
  if (!raw) return ''
  const commaIndex = raw.indexOf(',')
  return commaIndex >= 0 ? raw.slice(commaIndex + 1).trim() : raw
}

export const chatImageAttachmentBase64ByteLength = (value: unknown) => {
  const data = normalizeImageData(value).replace(/\s+/g, '')
  if (!data || !/^[a-zA-Z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) return null
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

const normalizeSize = (value: unknown) => {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size < 0) return 0
  return Math.floor(size)
}

export const validateChatImageAttachment = (input: ChatImageAttachmentValidateInput = {}): ChatImageAttachmentValidateResult => {
  const mediaType = normalizeText(input.mediaType).toLowerCase()
  const name = normalizeText(input.name)
  const size = normalizeSize(input.size)

  if (!supportedTypeSet.has(mediaType)) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE',
      errorMessage: `不支持的图片类型：${mediaType || name || 'unknown'}`
    }
  }

  if (size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_TOO_LARGE',
      errorMessage: `图片超过 5 MiB：${name || mediaType}`
    }
  }

  return {
    ok: true,
    data: {
      mediaType: mediaType as ChatImageAttachmentMediaType,
      name: name || undefined,
      size
    }
  }
}

export const prepareChatImageAttachment = (input: ChatImageAttachmentPrepareInput = {}): ChatImageAttachmentPrepareResult => {
  const validation = validateChatImageAttachment(input)
  if (!validation.ok || !validation.data) {
    return {
      ok: false,
      errorCode: validation.errorCode,
      errorMessage: validation.errorMessage
    }
  }

  const data = normalizeImageData(input.data)
  if (!data) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_EMPTY_DATA',
      errorMessage: '图片数据为空。'
    }
  }

  const dataBytes = chatImageAttachmentBase64ByteLength(data)
  if (dataBytes === null) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_INVALID_DATA',
      errorMessage: '图片数据格式无效。'
    }
  }
  if (dataBytes > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    return {
      ok: false,
      errorCode: 'CHAT_IMAGE_TOO_LARGE',
      errorMessage: `图片超过 5 MiB：${validation.data.name || validation.data.mediaType}`
    }
  }

  return {
    ok: true,
    data: {
      type: 'image',
      mediaType: validation.data.mediaType,
      data,
      name: validation.data.name,
      size: validation.data.size
    }
  }
}
