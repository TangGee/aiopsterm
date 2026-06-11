import type { ChatAttachmentStageResult } from '@shared/preload'
import { normalizeChatAttachmentTaskId } from '@shared/chatAttachment'
import { basename, extname, isAbsolute, join } from 'path'
import { access, cp, mkdir, stat } from 'fs/promises'

export type ChatAttachmentStageInput = {
  taskId?: string
  srcAbsPath?: string
}

const maxChatAttachmentBytes = 10 * 1024 * 1024

const allowedChatAttachmentExtensions = new Set([
  '.txt',
  '.md',
  '.js',
  '.ts',
  '.py',
  '.java',
  '.cpp',
  '.c',
  '.html',
  '.css',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.sql',
  '.sh',
  '.bat',
  '.ps1',
  '.log',
  '.csv',
  '.tsv'
])

const sanitizeChatAttachmentName = (name: string) => {
  const cleaned = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : `attachment-${Date.now()}.txt`
}

const pathExists = async (absPath: string) => {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

const splitNameExt = (fileName: string) => {
  const ext = extname(fileName)
  return { base: ext ? fileName.slice(0, -ext.length) : fileName, ext }
}

const ensureUniqueName = async (dirAbs: string, desiredName: string) => {
  const { base, ext } = splitNameExt(desiredName)
  let candidate = desiredName
  let index = 1
  while (await pathExists(join(dirAbs, candidate))) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }
  return candidate
}

export const stageChatAttachment = async (input: ChatAttachmentStageInput, attachmentsRoot: string): Promise<ChatAttachmentStageResult> => {
  const taskId = normalizeChatAttachmentTaskId(typeof input?.taskId === 'string' ? input.taskId : '')
  const srcAbsPath = typeof input?.srcAbsPath === 'string' ? input.srcAbsPath : ''
  if (!taskId) throw new Error('taskId is required')
  if (!srcAbsPath || !isAbsolute(srcAbsPath)) throw new Error('srcAbsPath must be absolute')

  const metadata = await stat(srcAbsPath)
  if (!metadata.isFile()) throw new Error('Attachment source must be a file')
  if (metadata.size > maxChatAttachmentBytes) throw new Error('Attachment file too large')

  const ext = extname(srcAbsPath).toLowerCase()
  if (!allowedChatAttachmentExtensions.has(ext)) throw new Error('Attachment file type not allowed')

  const taskDir = join(attachmentsRoot, taskId)
  await mkdir(taskDir, { recursive: true })
  const finalName = await ensureUniqueName(taskDir, sanitizeChatAttachmentName(basename(srcAbsPath)))
  const stagedPath = join(taskDir, finalName)
  await cp(srcAbsPath, stagedPath)
  return {
    mode: 'local',
    taskId,
    srcAbsPath,
    refPath: `aiopsterm://chat-attachment/${encodeURIComponent(taskId)}/${encodeURIComponent(finalName)}`,
    name: finalName,
    size: metadata.size,
    stagedPath
  }
}
