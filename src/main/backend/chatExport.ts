import { writeFile } from 'fs/promises'
import type { AiChatExportInput, AiChatExportResult } from '@shared/preload'
import { buildChatExportMarkdown, sanitizeChatExportFileName } from '@shared/chatExport'

type ChatExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<void>
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
    if (saveResult?.canceled || !saveResult?.filePath) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const markdown = buildChatExportMarkdown({ title: input.title, messages }, runtime.now?.() || new Date())
    await (runtime.writeFile || writeFile)(saveResult.filePath, markdown, 'utf-8')
    return {
      ok: true,
      data: {
        exported: messages.length,
        fileName,
        filePath: saveResult.filePath
      }
    }
  } catch (error) {
    return chatExportErrorResult(error)
  }
}
