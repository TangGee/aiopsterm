import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, posix, resolve, sep } from 'path'

const electronMock = vi.hoisted(() => ({
  clipboard: {
    readImage: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const ensureUniqueName = async (dirAbs: string, desiredName: string) => {
  const ext = desiredName.includes('.') ? desiredName.slice(desiredName.lastIndexOf('.')) : ''
  const stem = ext ? desiredName.slice(0, -ext.length) : desiredName
  let candidate = desiredName
  let index = 1
  while (await pathExists(join(dirAbs, candidate))) {
    candidate = `${stem} (${index})${ext}`
    index += 1
  }
  return candidate
}

const createRuntime = (root: string) => ({
  resolveKnowledgePath(relPath: string) {
    const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const rootAbs = resolve(root)
    const absPath = resolve(rootAbs, normalized)
    if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
      throw new Error('Path escapes knowledgebase root')
    }
    return { absPath, relPath: normalized }
  },
  ensureUniqueKnowledgeName: ensureUniqueName,
  syncKnowledgeBaseConfigFromDisk: vi.fn(async () => undefined),
  now: () => new Date('2026-06-09T12:34:56.000Z')
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/knowledge/knowledgeBaseImage'
  return import(modulePath)
}

describe('knowledge base pasted image backend boundary', () => {
  beforeEach(() => {
    electronMock.clipboard.readImage.mockReset()
  })

  it('writes pasted clipboard images into the knowledge base without renderer image bytes', async () => {
    const { writeKnowledgePastedImageFromClipboard } = await loadBackend()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-kb-image-'))
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22])
    electronMock.clipboard.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => bytes
    })

    try {
      const runtime = createRuntime(dir)
      const first = await writeKnowledgePastedImageFromClipboard({ relDir: 'runbooks' }, runtime)
      const second = await writeKnowledgePastedImageFromClipboard({ relDir: 'runbooks' }, runtime)

      expect(electronMock.clipboard.readImage).toHaveBeenCalledTimes(2)
      expect(first).toEqual({
        relPath: 'runbooks/pasted-image-2026-06-09T12-34-56.png',
        fileName: 'pasted-image-2026-06-09T12-34-56.png',
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        size: bytes.byteLength,
        mtimeMs: expect.any(Number)
      })
      expect(second.relPath).toBe('runbooks/pasted-image-2026-06-09T12-34-56 (1).png')
      expect(await readFile(join(dir, first.relPath))).toEqual(bytes)
      expect(await readFile(join(dir, second.relPath))).toEqual(bytes)
      expect(runtime.syncKnowledgeBaseConfigFromDisk).toHaveBeenCalledTimes(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('sanitizes requested names and rejects empty clipboard images', async () => {
    const { writeKnowledgePastedImageFromClipboard } = await loadBackend()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-kb-image-name-'))
    electronMock.clipboard.readImage.mockReturnValueOnce({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png-bytes')
    })

    try {
      const result = await writeKnowledgePastedImageFromClipboard({ relDir: 'notes', name: '../bad name.jpg' }, createRuntime(dir))

      expect(result.relPath).toBe(posix.join('notes', result.fileName))
      expect(result.fileName).toBe('bad-name.png')
      expect(basename(dirname(join(dir, result.relPath)))).toBe('notes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }

    electronMock.clipboard.readImage.mockReturnValueOnce({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0)
    })
    await expect(writeKnowledgePastedImageFromClipboard({}, createRuntime('/tmp/aiopsterm-kb-empty'))).rejects.toThrow('剪贴板中没有可用图片。')
  })
})
