import { afterEach, describe, expect, it, vi } from 'vitest'
import { localFilesClient } from '@/services/localFilesClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('localFilesClient', () => {
  it('returns undefined for unavailable bridge methods and binds Local Files bridge methods', async () => {
    const file = new File(['hello'], 'note.md', { type: 'text/markdown' })

    window.aiops = {
      ...originalAiops,
      getPathForFile: vi.fn(() => '/tmp/note.md'),
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/note.md'] })),
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/tmp/query.sql' })),
      saveCustomBackground: vi.fn(async () => ({
        url: 'aiopsterm://background/custom.webp',
        filePath: '/tmp/custom.webp',
        name: 'custom.webp',
        size: 12,
        bytes: 12,
        mtimeMs: 1781884800000
      })),
      readLocalFile: vi.fn(async () => ({ content: 'hello', mtimeMs: 1781884800000, size: 5 })),
      writeLocalFile: vi.fn(async (filePath, content) => ({ ok: true, data: { filePath, bytes: content.length, size: content.length, mtimeMs: 1781884800000 } })),
      stageChatAttachment: vi.fn(async ({ taskId, srcAbsPath }) => ({
        mode: 'local' as const,
        taskId,
        srcAbsPath,
        refPath: `attachment://${taskId}/note.md`,
        name: 'note.md',
        size: 5,
        stagedPath: `/tmp/chat-attachments/${taskId}/note.md`
      })),
      validateChatImageAttachment: vi.fn(async () => ({ ok: true, data: { mediaType: 'image/png' as const, name: 'image.png', size: 4 } })),
      prepareChatImageAttachment: vi.fn(async () => ({ ok: true, data: { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'image.png', size: 4 } })),
      prepareChatImageAttachmentFromFile: vi.fn(async () => ({ ok: true, data: { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'image.png', size: 4 } })),
      prepareChatImageAttachmentFromClipboard: vi.fn(async () => ({ ok: true, data: { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'clipboard.png', size: 4 } }))
    }

    expect(localFilesClient.getPathForFile()?.(file)).toBe('/tmp/note.md')
    await expect(localFilesClient.showOpenDialog()?.({ properties: ['openFile'] })).resolves.toEqual({ canceled: false, filePaths: ['/tmp/note.md'] })
    await expect(localFilesClient.showSaveDialog()?.({ defaultPath: 'query.sql' })).resolves.toEqual({ canceled: false, filePath: '/tmp/query.sql' })
    await expect(localFilesClient.saveCustomBackground()?.('/tmp/custom.webp')).resolves.toEqual({
      url: 'aiopsterm://background/custom.webp',
      filePath: '/tmp/custom.webp',
      name: 'custom.webp',
      size: 12,
      bytes: 12,
      mtimeMs: 1781884800000
    })
    await expect(localFilesClient.readLocalFile()?.('/tmp/note.md')).resolves.toEqual({ content: 'hello', mtimeMs: 1781884800000, size: 5 })
    await expect(localFilesClient.writeLocalFile()?.('/tmp/query.sql', 'select 1;')).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ filePath: '/tmp/query.sql', bytes: 9 }) })
    )
    await expect(localFilesClient.stageChatAttachment()?.({ taskId: 'conv-1', srcAbsPath: '/tmp/note.md' })).resolves.toEqual(
      expect.objectContaining({ mode: 'local', taskId: 'conv-1', name: 'note.md' })
    )
    await expect(localFilesClient.validateChatImageAttachment()?.({ mediaType: 'image/png', name: 'image.png', size: 4 })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ mediaType: 'image/png' }) })
    )
    await expect(localFilesClient.prepareChatImageAttachment()?.({ mediaType: 'image/png', data: 'AAAA', name: 'image.png', size: 4 })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ type: 'image' }) })
    )
    await expect(localFilesClient.prepareChatImageAttachmentFromFile()?.({ filePath: '/tmp/image.png' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ type: 'image' }) })
    )
    await expect(localFilesClient.prepareChatImageAttachmentFromClipboard()?.()).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ name: 'clipboard.png' }) })
    )

    expect(window.aiops.getPathForFile).toHaveBeenCalledWith(file)
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile'] })
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'query.sql' })
    expect(window.aiops.saveCustomBackground).toHaveBeenCalledWith('/tmp/custom.webp')
    expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/note.md')
    expect(window.aiops.writeLocalFile).toHaveBeenCalledWith('/tmp/query.sql', 'select 1;')
    expect(window.aiops.stageChatAttachment).toHaveBeenCalledWith({ taskId: 'conv-1', srcAbsPath: '/tmp/note.md' })
    expect(window.aiops.validateChatImageAttachment).toHaveBeenCalledWith({ mediaType: 'image/png', name: 'image.png', size: 4 })
    expect(window.aiops.prepareChatImageAttachment).toHaveBeenCalledWith({ mediaType: 'image/png', data: 'AAAA', name: 'image.png', size: 4 })
    expect(window.aiops.prepareChatImageAttachmentFromFile).toHaveBeenCalledWith({ filePath: '/tmp/image.png' })
    expect(window.aiops.prepareChatImageAttachmentFromClipboard).toHaveBeenCalledWith()

    window.aiops = {
      ...originalAiops,
      getPathForFile: undefined as any,
      showOpenDialog: undefined as any,
      showSaveDialog: undefined as any,
      saveCustomBackground: undefined as any,
      readLocalFile: undefined as any,
      writeLocalFile: undefined as any,
      stageChatAttachment: undefined as any,
      validateChatImageAttachment: undefined as any,
      prepareChatImageAttachment: undefined as any,
      prepareChatImageAttachmentFromFile: undefined as any,
      prepareChatImageAttachmentFromClipboard: undefined as any
    }
    expect(localFilesClient.getPathForFile()).toBeUndefined()
    expect(localFilesClient.showOpenDialog()).toBeUndefined()
    expect(localFilesClient.showSaveDialog()).toBeUndefined()
    expect(localFilesClient.saveCustomBackground()).toBeUndefined()
    expect(localFilesClient.readLocalFile()).toBeUndefined()
    expect(localFilesClient.writeLocalFile()).toBeUndefined()
    expect(localFilesClient.stageChatAttachment()).toBeUndefined()
    expect(localFilesClient.validateChatImageAttachment()).toBeUndefined()
    expect(localFilesClient.prepareChatImageAttachment()).toBeUndefined()
    expect(localFilesClient.prepareChatImageAttachmentFromFile()).toBeUndefined()
    expect(localFilesClient.prepareChatImageAttachmentFromClipboard()).toBeUndefined()
  })
})
