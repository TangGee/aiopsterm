import {
  aiPanelChatAttachmentFilters,
  aiPanelImagePickerFilters,
  docPartFromStagedAttachment,
  imagePartFromChatImagePrepareResult
} from '@/services/ai/aiPanelMediaRuntime'
import { localFilesClient } from '@/services/app/localFilesClient'
import { MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE } from '@shared/chatImageAttachment'
import type { AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'
import type { ChatAttachmentStageResult, ChatImageAttachmentPrepareResult, OpenDialogOptions, OpenDialogResult } from '@shared/contracts/localFiles'

type ShowOpenDialog = (options: OpenDialogOptions) => Promise<OpenDialogResult | null | undefined>
type PrepareImageFromFile = (input: { filePath: string }) => Promise<ChatImageAttachmentPrepareResult>
type PrepareImageFromClipboard = () => Promise<ChatImageAttachmentPrepareResult>
type StageChatAttachment = (input: { taskId: string; srcAbsPath: string }) => Promise<ChatAttachmentStageResult>

export type AiPanelAttachmentRuntimeOptions = {
  streaming: () => boolean
  editingMessageId: () => string | null
  ensureConversationId: () => Promise<string>
  insertImageAtMainCursor: (part: AiImageContentPart) => boolean | void
  insertImageAtEditCursor: (part: AiImageContentPart) => boolean | void
  insertFileChipAtMainCursor: (part: AiDocChipContentPart) => boolean
  insertFileChipAtEditCursor: (part: AiDocChipContentPart) => boolean
  imageCount?: (target: 'main' | 'edit') => number
  imageLimitMessage?: () => string
  notify: (message: string) => void
  showOpenDialog?: () => ShowOpenDialog | undefined
  prepareImageFromFile?: () => PrepareImageFromFile | undefined
  prepareImageFromClipboard?: () => PrepareImageFromClipboard | undefined
  stageAttachment?: () => StageChatAttachment | undefined
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const createAiPanelAttachmentRuntime = (options: AiPanelAttachmentRuntimeOptions) => {
  const showOpenDialog = options.showOpenDialog ?? localFilesClient.showOpenDialog
  const prepareImageFromFile = options.prepareImageFromFile ?? localFilesClient.prepareChatImageAttachmentFromFile
  const prepareImageFromClipboard = options.prepareImageFromClipboard ?? localFilesClient.prepareChatImageAttachmentFromClipboard
  const stageAttachment = options.stageAttachment ?? localFilesClient.stageChatAttachment
  const imageCount = options.imageCount ?? (() => 0)
  const hasImageCapacity = (target: 'main' | 'edit', incoming = 1) => {
    if (imageCount(target) + incoming <= MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE) return true
    options.notify(options.imageLimitMessage?.() || `Each message can include up to ${MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE} images.`)
    return false
  }

  const processImageFilePath = async (filePath: string): Promise<AiImageContentPart | null> => {
    const prepareImage = prepareImageFromFile()
    if (!prepareImage) {
      options.notify('图片上传失败：图片读取服务不可用')
      return null
    }
    try {
      const result = await prepareImage({ filePath })
      const imagePart = imagePartFromChatImagePrepareResult(result)
      if (imagePart.ok) return imagePart.data
      options.notify(`图片上传失败：${imagePart.message}`)
      return null
    } catch (error) {
      options.notify(`图片上传失败：${errorMessage(error)}`)
      return null
    }
  }

  const preparePastedImagePart = async (): Promise<AiImageContentPart | null> => {
    const prepareClipboardImage = prepareImageFromClipboard()
    if (!prepareClipboardImage) {
      options.notify('图片上传失败：剪贴板图片服务不可用')
      return null
    }
    try {
      const result = await prepareClipboardImage()
      const imagePart = imagePartFromChatImagePrepareResult(result)
      if (imagePart.ok) return imagePart.data
      options.notify(`图片上传失败：${imagePart.message}`)
      return null
    } catch (error) {
      options.notify(`图片上传失败：${errorMessage(error)}`)
      return null
    }
  }

  const insertImageFilePaths = async (filePaths: string[]) => {
    if (options.streaming()) return
    if (!hasImageCapacity('main', filePaths.length)) return
    for (const filePath of filePaths) {
      const part = await processImageFilePath(filePath)
      if (part && hasImageCapacity('main')) options.insertImageAtMainCursor(part)
    }
  }

  const insertPastedImage = async () => {
    if (!hasImageCapacity('main')) return
    const part = await preparePastedImagePart()
    if (part && hasImageCapacity('main')) options.insertImageAtMainCursor(part)
  }

  const insertPastedImageIntoEdit = async () => {
    if (!hasImageCapacity('edit')) return
    const part = await preparePastedImagePart()
    if (part && hasImageCapacity('edit')) options.insertImageAtEditCursor(part)
  }

  const openImagePicker = async () => {
    if (options.streaming()) return
    const openDialog = showOpenDialog()
    if (!openDialog) {
      options.notify('图片上传失败：文件选择服务不可用')
      return
    }
    try {
      const result = await openDialog({
        properties: ['openFile', 'multiSelections'],
        filters: aiPanelImagePickerFilters
      })
      if (!result || result.canceled || !result.filePaths?.length) return
      await insertImageFilePaths(result.filePaths)
    } catch (error) {
      options.notify(`图片上传失败：${errorMessage(error)}`)
    }
  }

  const handleFileUpload = async () => {
    if (options.streaming()) return
    const openDialog = showOpenDialog()
    if (!openDialog) {
      options.notify('文件上传失败：文件选择服务不可用')
      return
    }
    const stage = stageAttachment()
    if (!stage) {
      options.notify('文件上传失败：文件暂存服务不可用')
      return
    }
    const taskId = await options.ensureConversationId()
    if (!taskId) {
      options.notify('请先创建会话后再上传文件。')
      return
    }
    try {
      const result = await openDialog({
        properties: ['openFile'],
        filters: aiPanelChatAttachmentFilters
      })
      if (!result || result.canceled || !result.filePaths?.length) return
      const srcAbsPath = result.filePaths[0]
      const staged = await stage({ taskId, srcAbsPath })
      const stagedPart = docPartFromStagedAttachment(staged, taskId, srcAbsPath)
      if (!stagedPart.ok) throw new Error(stagedPart.message)
      const inserted = options.editingMessageId()
        ? options.insertFileChipAtEditCursor(stagedPart.data.part)
        : options.insertFileChipAtMainCursor(stagedPart.data.part)
      if (!inserted) throw new Error('文件输入框不可用')
      options.notify(`已添加文件：${stagedPart.data.displayName}`)
    } catch (error) {
      options.notify(`文件上传失败：${errorMessage(error)}`)
    }
  }

  return {
    imagePickerFilters: aiPanelImagePickerFilters,
    chatAttachmentFilters: aiPanelChatAttachmentFilters,
    processImageFilePath,
    preparePastedImagePart,
    insertImageFilePaths,
    insertPastedImage,
    insertPastedImageIntoEdit,
    openImagePicker,
    handleFileUpload
  }
}
