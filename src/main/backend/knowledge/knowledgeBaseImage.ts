import { clipboard } from 'electron'
import { basename, extname, join, posix } from 'path'
import { mkdir, stat, writeFile } from 'fs/promises'
import type { KnowledgeBasePastedImageInput, KnowledgeBasePastedImageResult } from '@shared/contracts/knowledgeBase'

export type KnowledgeBasePathResolver = (relPath: string) => { absPath: string; relPath: string }

export type KnowledgeBasePastedImageRuntime = {
  resolveKnowledgePath: KnowledgeBasePathResolver
  ensureUniqueKnowledgeName: (dirAbs: string, desiredName: string) => Promise<string>
  syncKnowledgeBaseConfigFromDisk?: () => Promise<unknown>
  now?: () => Date
}

const maxKnowledgePastedImageBytes = 10 * 1024 * 1024

const sanitizeRequestedName = (value: string) => {
  const ext = extname(value)
  const stem = basename(value, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${stem || 'pasted-image'}.png`
}

const createDefaultPastedImageName = (date: Date) => `pasted-image-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`

export const writeKnowledgePastedImageFromClipboard = async (
  input: Partial<KnowledgeBasePastedImageInput> = {},
  runtime: KnowledgeBasePastedImageRuntime
): Promise<KnowledgeBasePastedImageResult> => {
  const image = clipboard.readImage()
  if (!image || image.isEmpty()) {
    throw new Error('剪贴板中没有可用图片。')
  }

  const bytes = image.toPNG()
  if (bytes.byteLength === 0) {
    throw new Error('剪贴板图片数据为空。')
  }
  if (bytes.byteLength > maxKnowledgePastedImageBytes) {
    throw new Error('粘贴图片超过 10 MiB。')
  }

  const relDir = typeof input.relDir === 'string' ? input.relDir : ''
  const { absPath: dirAbs, relPath: normalizedRelDir } = runtime.resolveKnowledgePath(relDir)
  await mkdir(dirAbs, { recursive: true })
  const requestedName = typeof input.name === 'string' && input.name.trim() ? sanitizeRequestedName(input.name) : createDefaultPastedImageName(runtime.now?.() || new Date())
  const fileName = await runtime.ensureUniqueKnowledgeName(dirAbs, requestedName)
  const absPath = join(dirAbs, fileName)
  await writeFile(absPath, bytes)
  const metadata = await stat(absPath)
  await runtime.syncKnowledgeBaseConfigFromDisk?.()

  return {
    relPath: posix.join(normalizedRelDir, fileName),
    fileName,
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs
  }
}
