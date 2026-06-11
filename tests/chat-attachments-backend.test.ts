import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type ChatAttachmentsBackend = {
  stageChatAttachment: (input: { taskId?: string; srcAbsPath?: string }, attachmentsRoot: string) => Promise<{
    mode: 'local'
    taskId: string
    srcAbsPath: string
    refPath: string
    name: string
    size: number
    stagedPath: string
  }>
}

let backend: ChatAttachmentsBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/chatAttachments'
  backend = (await import(modulePath)) as ChatAttachmentsBackend
})

describe('chat file attachment backend boundary', () => {
  it('stages local text attachments with backend-owned request identity fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-attachment-'))
    const srcAbsPath = join(dir, 'incident.log')
    const attachmentsRoot = join(dir, 'attachments')

    try {
      await writeFile(srcAbsPath, 'pod restarted\n', 'utf-8')
      const result = await backend.stageChatAttachment({ taskId: ' conv:prod/01 ', srcAbsPath }, attachmentsRoot)

      expect(result).toMatchObject({
        mode: 'local',
        taskId: 'conv-prod-01',
        srcAbsPath,
        refPath: 'aiopsterm://chat-attachment/conv-prod-01/incident.log',
        name: 'incident.log',
        size: Buffer.byteLength('pod restarted\n')
      })
      expect(result.stagedPath).toBe(join(attachmentsRoot, 'conv-prod-01', 'incident.log'))
      expect(await readFile(result.stagedPath, 'utf-8')).toBe('pod restarted\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns the unique staged filename when the task already has an attachment with the same name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-attachment-dupe-'))
    const srcAbsPath = join(dir, 'query.sql')
    const attachmentsRoot = join(dir, 'attachments')

    try {
      await writeFile(srcAbsPath, 'select 1;\n', 'utf-8')
      const first = await backend.stageChatAttachment({ taskId: 'conv-dupe', srcAbsPath }, attachmentsRoot)
      const second = await backend.stageChatAttachment({ taskId: 'conv-dupe', srcAbsPath }, attachmentsRoot)

      expect(first.name).toBe('query.sql')
      expect(second.name).toBe('query (1).sql')
      expect(second.refPath).toBe('aiopsterm://chat-attachment/conv-dupe/query%20(1).sql')
      expect(await readFile(second.stagedPath, 'utf-8')).toBe('select 1;\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects missing, relative, non-file, and unsupported attachment sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-attachment-invalid-'))
    const unsupportedPath = join(dir, 'image.png')

    try {
      await writeFile(unsupportedPath, 'png', 'utf-8')
      await expect(backend.stageChatAttachment({ taskId: '', srcAbsPath: unsupportedPath }, join(dir, 'attachments'))).rejects.toThrow('taskId is required')
      await expect(backend.stageChatAttachment({ taskId: 'conv', srcAbsPath: 'relative.log' }, join(dir, 'attachments'))).rejects.toThrow(
        'srcAbsPath must be absolute'
      )
      await expect(backend.stageChatAttachment({ taskId: 'conv', srcAbsPath: dir }, join(dir, 'attachments'))).rejects.toThrow('Attachment source must be a file')
      await expect(backend.stageChatAttachment({ taskId: 'conv', srcAbsPath: unsupportedPath }, join(dir, 'attachments'))).rejects.toThrow(
        'Attachment file type not allowed'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
