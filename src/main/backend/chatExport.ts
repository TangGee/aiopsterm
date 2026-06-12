import { stat, writeFile } from 'fs/promises'
import { isAbsolute } from 'path'
import type { AiChatExportInput, AiChatExportResult } from '@shared/preload'
import { buildChatExportMarkdown, sanitizeChatExportFileName } from '@shared/chatExport'

type ChatExportWriteResult =
  | void
  | {
      filePath?: string
      bytes?: number
    }

type ChatExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<ChatExportWriteResult>
  now?: () => Date
}

class ChatExportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'ChatExportError'
  }
}

const chatExportErrorResult = (error: unknown): AiChatExportResult => ({
  ok: false,
  errorCode: error instanceof ChatExportError ? error.errorCode : 'AI_CHAT_EXPORT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || '聊天导出失败。')
})

const isChatExportWriteMetadata = (value: ChatExportWriteResult): value is Exclude<ChatExportWriteResult, void> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const exportChat = async (input: AiChatExportInput, runtime: ChatExportRuntime): Promise<AiChatExportResult> => {
  try {
    if (!runtime?.showSaveDialog) throw new ChatExportError('AI_CHAT_EXPORT_SAVE_DIALOG_UNAVAILABLE', '聊天导出保存服务不可用。')
    const messages = Array.isArray(input?.messages) ? input.messages : []
    if (!messages.length) throw new ChatExportError('AI_CHAT_EXPORT_EMPTY', '当前会话为空，无法导出。')
    const fileName = sanitizeChatExportFileName(input.title || 'Chat Export')
    const saveResult = await runtime.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'Markdown Files', extensions: ['md'] }]
    })
    if (saveResult?.canceled) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const filePath = typeof saveResult.filePath === 'string' ? saveResult.filePath : ''
    if (!filePath.trim() || !isAbsolute(filePath)) throw new ChatExportError('AI_CHAT_EXPORT_SAVE_PATH_INVALID', '聊天导出保存路径必须是绝对路径。')
    const markdown = buildChatExportMarkdown({ title: input.title, messages }, runtime.now?.() || new Date())
    const expectedBytes = Buffer.byteLength(markdown, 'utf8')
    const writeResult = await (runtime.writeFile || writeFile)(filePath, markdown, 'utf-8')
    if (isChatExportWriteMetadata(writeResult)) {
      if (writeResult.filePath !== filePath) throw new ChatExportError('AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID', '聊天导出写入路径确认失败。')
      if (writeResult.bytes !== expectedBytes) throw new ChatExportError('AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID', '聊天导出写入字节数确认失败。')
    }
    let writtenSize = -1
    try {
      writtenSize = (await stat(filePath)).size
    } catch {
      throw new ChatExportError('AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID', '聊天导出文件写入后无法确认。')
    }
    if (writtenSize !== expectedBytes) throw new ChatExportError('AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID', '聊天导出文件大小与生成内容不一致。')
    return {
      ok: true,
      data: {
        exported: messages.length,
        fileName,
        filePath,
        bytes: expectedBytes,
        markdown
      }
    }
  } catch (error) {
    return chatExportErrorResult(error)
  }
}
