import { describe, expect, it, vi } from 'vitest'
import { createAiPanelAttachmentRuntime } from '@/services/ai/aiPanelAttachmentRuntime'
import type { AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'
import type { ChatAttachmentStageResult, ChatImageAttachmentPrepareResult } from '@shared/contracts/localFiles'

const imageResult = (name = 'input.png'): ChatImageAttachmentPrepareResult => ({
  ok: true,
  data: {
    type: 'image',
    mediaType: 'image/png',
    data: 'AAAA',
    name,
    size: 4
  }
})

const stagedAttachment = (taskId: string, srcAbsPath: string, name = 'task.log'): ChatAttachmentStageResult => ({
  mode: 'local',
  taskId: taskId.replace(/[^a-zA-Z0-9_-]/g, '-'),
  srcAbsPath,
  refPath: `aiopsterm://chat-attachment/${taskId.replace(/[^a-zA-Z0-9_-]/g, '-')}/${name}`,
  name,
  size: 128,
  stagedPath: `/tmp/aiopsterm/chat-attachments/${taskId.replace(/[^a-zA-Z0-9_-]/g, '-')}/${name}`
})

const createRuntime = (overrides: Partial<Parameters<typeof createAiPanelAttachmentRuntime>[0]> = {}) => {
  const notices: string[] = []
  const insertedImages: AiImageContentPart[] = []
  const insertedEditImages: AiImageContentPart[] = []
  const insertedFiles: AiDocChipContentPart[] = []
  const insertedEditFiles: AiDocChipContentPart[] = []
  const runtime = createAiPanelAttachmentRuntime({
    streaming: () => false,
    editingMessageId: () => null,
    ensureConversationId: vi.fn(async () => 'conv-attachment'),
    insertImageAtMainCursor: (part) => {
      insertedImages.push(part)
    },
    insertImageAtEditCursor: (part) => {
      insertedEditImages.push(part)
    },
    insertFileChipAtMainCursor: (part) => {
      insertedFiles.push(part)
      return true
    },
    insertFileChipAtEditCursor: (part) => {
      insertedEditFiles.push(part)
      return true
    },
    imageCount: (target) => (target === 'main' ? insertedImages.length : insertedEditImages.length),
    imageLimitMessage: () => '每条消息最多添加 5 张图片。',
    notify: (message) => notices.push(message),
    ...overrides
  })
  return {
    runtime,
    notices,
    insertedImages,
    insertedEditImages,
    insertedFiles,
    insertedEditFiles
  }
}

describe('aiPanelAttachmentRuntime', () => {
  it('opens image picker, prepares selected images, and inserts successful image parts', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/input.png', '/tmp/bad.txt'] }))
    const prepareImageFromFile = vi
      .fn()
      .mockResolvedValueOnce(imageResult('input.png'))
      .mockResolvedValueOnce({ ok: false, errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE', errorMessage: '不支持的图片类型：bad.txt' })
    const { runtime, insertedImages, notices } = createRuntime({
      showOpenDialog: () => showOpenDialog,
      prepareImageFromFile: () => prepareImageFromFile
    })

    await runtime.openImagePicker()

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    })
    expect(prepareImageFromFile).toHaveBeenNthCalledWith(1, { filePath: '/tmp/input.png' })
    expect(prepareImageFromFile).toHaveBeenNthCalledWith(2, { filePath: '/tmp/bad.txt' })
    expect(insertedImages).toEqual([{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'input.png' }])
    expect(notices.at(-1)).toBe('图片上传失败：不支持的图片类型：bad.txt')
  })

  it('prepares pasted images for main and edit targets and fails closed when bridges are missing', async () => {
    const prepareClipboard = vi.fn(async () => imageResult('clipboard.png'))
    const { runtime, insertedImages, insertedEditImages } = createRuntime({
      prepareImageFromClipboard: () => prepareClipboard
    })

    await runtime.insertPastedImage()
    await runtime.insertPastedImageIntoEdit()

    expect(prepareClipboard).toHaveBeenCalledTimes(2)
    expect(insertedImages).toEqual([{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'clipboard.png' }])
    expect(insertedEditImages).toEqual([{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'clipboard.png' }])

    const missing = createRuntime({
      prepareImageFromClipboard: () => undefined,
      prepareImageFromFile: () => undefined,
      showOpenDialog: () => undefined
    })
    await missing.runtime.insertPastedImage()
    expect(missing.notices.at(-1)).toBe('图片上传失败：剪贴板图片服务不可用')
    await missing.runtime.processImageFilePath('/tmp/input.png')
    expect(missing.notices.at(-1)).toBe('图片上传失败：图片读取服务不可用')
    await missing.runtime.openImagePicker()
    expect(missing.notices.at(-1)).toBe('图片上传失败：文件选择服务不可用')
  })

  it('accepts five selected images in one message', async () => {
    const filePaths = Array.from({ length: 5 }, (_, index) => `/tmp/input-${index + 1}.png`)
    const prepareImageFromFile = vi.fn(async ({ filePath }: { filePath: string }) => imageResult(filePath.split('/').at(-1)))
    const { runtime, insertedImages, notices } = createRuntime({
      prepareImageFromFile: () => prepareImageFromFile
    })

    await runtime.insertImageFilePaths(filePaths)

    expect(prepareImageFromFile).toHaveBeenCalledTimes(5)
    expect(insertedImages.map((part) => part.name)).toEqual([
      'input-1.png',
      'input-2.png',
      'input-3.png',
      'input-4.png',
      'input-5.png'
    ])
    expect(notices).toEqual([])
  })

  it('rejects selections and pasted images that would become the sixth image', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/tmp/fifth.png', '/tmp/sixth.png']
    }))
    const prepareImageFromFile = vi.fn(async () => imageResult())
    const prepareImageFromClipboard = vi.fn(async () => imageResult('clipboard.png'))
    const main = createRuntime({
      imageCount: () => 4,
      showOpenDialog: () => showOpenDialog,
      prepareImageFromFile: () => prepareImageFromFile,
      prepareImageFromClipboard: () => prepareImageFromClipboard
    })

    await main.runtime.openImagePicker()

    expect(prepareImageFromFile).not.toHaveBeenCalled()
    expect(main.insertedImages).toEqual([])
    expect(main.notices.at(-1)).toBe('每条消息最多添加 5 张图片。')

    const full = createRuntime({
      imageCount: () => 5,
      prepareImageFromClipboard: () => prepareImageFromClipboard
    })
    await full.runtime.insertPastedImage()
    await full.runtime.insertPastedImageIntoEdit()

    expect(prepareImageFromClipboard).not.toHaveBeenCalled()
    expect(full.insertedImages).toEqual([])
    expect(full.insertedEditImages).toEqual([])
    expect(full.notices).toEqual([
      '每条消息最多添加 5 张图片。',
      '每条消息最多添加 5 张图片。'
    ])
  })

  it('stages file attachments, targets main or edit insertion, and reports malformed or unavailable services', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/task.log'] }))
    const stageAttachment = vi.fn(async ({ taskId, srcAbsPath }) => stagedAttachment(taskId, srcAbsPath, 'task.log'))
    const { runtime, insertedFiles, notices } = createRuntime({
      showOpenDialog: () => showOpenDialog,
      stageAttachment: () => stageAttachment
    })

    await runtime.handleFileUpload()

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [
        {
          name: 'Text',
          extensions: expect.arrayContaining(['txt', 'md', 'js', 'ts', 'py', 'log', 'csv', 'tsv'])
        }
      ]
    })
    expect(stageAttachment).toHaveBeenCalledWith({ taskId: 'conv-attachment', srcAbsPath: '/tmp/task.log' })
    expect(insertedFiles[0]).toEqual({
      type: 'chip',
      chipType: 'doc',
      ref: {
        absPath: 'aiopsterm://chat-attachment/conv-attachment/task.log',
        relPath: 'aiopsterm://chat-attachment/conv-attachment/task.log',
        name: 'task.log',
        type: 'file'
      }
    })
    expect(notices.at(-1)).toBe('已添加文件：task.log')

    const edit = createRuntime({
      editingMessageId: () => 'message-1',
      showOpenDialog: () => showOpenDialog,
      stageAttachment: () => stageAttachment
    })
    await edit.runtime.handleFileUpload()
    expect(edit.insertedEditFiles).toHaveLength(1)

    const missingStage = createRuntime({ stageAttachment: () => undefined })
    await missingStage.runtime.handleFileUpload()
    expect(missingStage.notices.at(-1)).toBe('文件上传失败：文件暂存服务不可用')

    const malformed = createRuntime({
      showOpenDialog: () => vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/bad.log'] })),
      stageAttachment: () =>
        vi.fn(async () => ({
          ...stagedAttachment('conv-attachment', '/tmp/bad.log', 'bad.log'),
          refPath: ''
        }))
    })
    await malformed.runtime.handleFileUpload()
    expect(malformed.notices.at(-1)).toBe('文件上传失败：AI 服务返回数据无效')

    const noConversation = createRuntime({
      ensureConversationId: vi.fn(async () => ''),
      showOpenDialog: () => showOpenDialog,
      stageAttachment: () => stageAttachment
    })
    await noConversation.runtime.handleFileUpload()
    expect(noConversation.notices.at(-1)).toBe('请先创建会话后再上传文件。')
  })

  it('skips picker and attachment side effects while streaming', async () => {
    const showOpenDialog = vi.fn()
    const prepareImageFromFile = vi.fn()
    const stageAttachment = vi.fn()
    const { runtime, insertedImages, insertedFiles, notices } = createRuntime({
      streaming: () => true,
      showOpenDialog: () => showOpenDialog,
      prepareImageFromFile: () => prepareImageFromFile,
      stageAttachment: () => stageAttachment
    })

    await runtime.openImagePicker()
    await runtime.insertImageFilePaths(['/tmp/input.png'])
    await runtime.handleFileUpload()

    expect(showOpenDialog).not.toHaveBeenCalled()
    expect(prepareImageFromFile).not.toHaveBeenCalled()
    expect(stageAttachment).not.toHaveBeenCalled()
    expect(insertedImages).toEqual([])
    expect(insertedFiles).toEqual([])
    expect(notices).toEqual([])
  })
})
