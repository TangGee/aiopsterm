import { createHash } from 'crypto'
import { mkdirSync, statSync } from 'fs'
import { copyFile, readFile, stat } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import type { AiopsMutationResult } from '@shared/contracts/common'
import type { AiopsUserAvatarPrepareInput, AiopsUserAvatarPrepareResult } from '@shared/contracts/userAccount'

export type UserAccountAvatarRuntimeConfig = {
  stateFilePath: string
}

export type UserAccountAvatarRuntime = {
  prepare(input: AiopsUserAvatarPrepareInput): Promise<AiopsUserAvatarPrepareResult>
  resolveAssetPath(avatarImageUrl: string): string
  assetExists(avatarImageUrl: string): boolean
}

const maxAvatarBytes = 2 * 1024 * 1024
const avatarAssetScheme = 'aiopsterm-user-avatar'
const avatarAssetUrlPrefix = `${avatarAssetScheme}://`

const avatarMimeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

const avatarExtensionByMime: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg'
}

const trimText = (value: unknown) => String(value || '').trim()

const errorResult = <T>(errorCode: string, errorMessage: string): AiopsMutationResult<T> => ({
  ok: false,
  errorCode,
  errorMessage
})

const safeAvatarAssetName = (value: string) => /^[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i.test(value)

const avatarAssetUrl = (fileName: string) => `${avatarAssetUrlPrefix}${fileName}`

const avatarAssetNameFromUrl = (value: string) => {
  const trimmed = trimText(value)
  if (!trimmed.startsWith(avatarAssetUrlPrefix)) return ''
  const fileName = trimmed.slice(avatarAssetUrlPrefix.length).replace(/^\/+|\/+$/g, '')
  return safeAvatarAssetName(fileName) ? fileName : ''
}

const avatarMimeFromHeader = (buffer: Buffer, filePath: string) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const gifHeader = buffer.subarray(0, 6).toString('ascii')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  const extensionMime = avatarMimeByExtension[extname(filePath).toLowerCase()] || ''
  if (extensionMime === 'image/svg+xml') {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf-8').trimStart().toLowerCase()
    if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return extensionMime
  }
  return ''
}

export function createUserAccountAvatarRuntime(getConfig: () => UserAccountAvatarRuntimeConfig): UserAccountAvatarRuntime {
  const avatarAssetDirectory = () => resolve(dirname(getConfig().stateFilePath), 'avatars')

  const resolveAssetPath = (avatarImageUrl: string) => {
    const fileName = avatarAssetNameFromUrl(avatarImageUrl)
    if (!fileName) return ''
    return resolve(avatarAssetDirectory(), fileName)
  }

  const assetExists = (avatarImageUrl: string) => {
    const assetPath = resolveAssetPath(avatarImageUrl)
    if (!assetPath) return false
    try {
      return statSync(assetPath).isFile()
    } catch {
      return false
    }
  }

  return {
    resolveAssetPath,
    assetExists,
    async prepare(input) {
      const filePath = trimText(input?.filePath)
      if (!filePath) return errorResult('USER_AVATAR_PATH_REQUIRED', '请选择头像图片')
      try {
        const info = await stat(filePath)
        if (!info.isFile()) return errorResult('USER_AVATAR_NOT_FILE', '请选择图片文件')
        if (info.size <= 0) return errorResult('USER_AVATAR_EMPTY', '头像图片不能为空')
        if (info.size > maxAvatarBytes) return errorResult('USER_AVATAR_TOO_LARGE', '头像图片不能超过 2MB')
        const content = await readFile(filePath)
        const mimeType = avatarMimeFromHeader(content, filePath)
        if (!mimeType) return errorResult('USER_AVATAR_INVALID_IMAGE', '请选择图片文件')
        const digest = createHash('sha256').update(content).digest('hex')
        const assetFileName = `${digest}${avatarExtensionByMime[mimeType] || extname(filePath).toLowerCase()}`
        if (!safeAvatarAssetName(assetFileName)) return errorResult('USER_AVATAR_INVALID_IMAGE', '请选择图片文件')
        const assetPath = join(avatarAssetDirectory(), assetFileName)
        mkdirSync(dirname(assetPath), { recursive: true })
        if (resolve(filePath) !== assetPath) await copyFile(filePath, assetPath)
        return {
          ok: true,
          data: {
            filePath,
            name: basename(filePath),
            mimeType,
            size: content.byteLength,
            dataUrl: `data:${mimeType};base64,${content.toString('base64')}`,
            avatarImageUrl: avatarAssetUrl(assetFileName),
            assetFileName,
            message: '头像图片已读取'
          }
        }
      } catch (error) {
        return errorResult('USER_AVATAR_READ_FAILED', error instanceof Error ? error.message : '图片读取失败')
      }
    }
  }
}
