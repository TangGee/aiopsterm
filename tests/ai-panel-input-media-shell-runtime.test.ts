import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { aiPanelTerminalTabDragType } from '@/services/ai/aiPanelMediaRuntime'
import { createAiPanelInputMediaShellRuntime } from '@/services/ai/aiPanelInputMediaShellRuntime'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import type { AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'
import type { ChatAttachmentStageResult, ChatImageAttachmentPrepareResult } from '@shared/contracts/localFiles'

const transferFrom = (data: Record<string, string>) => ({
  dropEffect: 'none',
  getData: (type: string) => data[type] || ''
})

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

const stagedAttachment = (taskId: string, srcAbsPath: string, name = srcAbsPath.split('/').pop() || 'task.log'): ChatAttachmentStageResult => ({
  mode: 'local',
  taskId: taskId.replace(/[^a-zA-Z0-9_-]/g, '-'),
  srcAbsPath,
  refPath: `aiopsterm://chat-attachment/${taskId.replace(/[^a-zA-Z0-9_-]/g, '-')}/${name}`,
  name,
  size: 128,
  stagedPath: `/tmp/aiopsterm/chat-attachments/${taskId.replace(/[^a-zA-Z0-9_-]/g, '-')}/${name}`
})

const createHarness = (
  overrides: Partial<Parameters<typeof createAiPanelInputMediaShellRuntime<{ id: string; sessionId?: string | null }>>[0]> = {}
) => {
  const mode = ref<AiPanelMode>('classic')
  const selectedConversationId = ref('')
  const usage = ref({ used: 1536, contextWindow: 128000, percent: 72 })
  const draft = ref('')
  const editingMessageId = ref<string | null>(null)
  const timers = new Map<number, () => void>()
  let timerId = 0
  const calls = {
    addedKnowledge: [] as string[][],
    boundPanels: [] as Array<{ panelId: string; source: string }>,
    boundHosts: [] as string[],
    closedPopups: 0,
    caretMoves: 0,
    createdConversations: 0,
    clearedTimers: [] as number[],
    restoredSelections: 0,
    insertedMainImages: [] as AiImageContentPart[],
    insertedEditImages: [] as AiImageContentPart[],
    insertedMainFiles: [] as AiDocChipContentPart[],
    insertedEditFiles: [] as AiDocChipContentPart[],
    insertedVoiceText: [] as string[],
    sentAfterVoice: 0
  }
  const runtime = createAiPanelInputMediaShellRuntime<{ id: string; sessionId?: string | null }>({
    mode: () => mode.value,
    contextUsageSnapshot: () => usage.value,
    selectedConversationId: () => selectedConversationId.value,
    panels: () => [{ id: 'panel-1', sessionId: 'session-1' }, { id: 'panel-2' }],
    createConversation: async () => {
      calls.createdConversations += 1
      selectedConversationId.value = 'created-chat'
      return { id: 'created-chat' }
    },
    addKnowledgeFilesToChat: async (relPaths) => {
      calls.addedKnowledge.push(relPaths)
    },
    bindTerminalPanelToCodex: async (panel, source) => {
      calls.boundPanels.push({ panelId: panel.id, source })
    },
    bindHostContextToCodex: async (context) => {
      calls.boundHosts.push(context.id)
    },
    draftText: () => draft.value,
    setDraft: (value) => {
      draft.value = value
    },
    closePopups: () => {
      calls.closedPopups += 1
    },
    moveCaretToEnd: () => {
      calls.caretMoves += 1
    },
    streaming: () => false,
    editingMessageId: () => editingMessageId.value,
    insertImageAtMainCursor: (part) => {
      calls.insertedMainImages.push(part)
      return true
    },
    insertImageAtEditCursor: (part) => {
      calls.insertedEditImages.push(part)
      return true
    },
    insertFileChipAtMainCursor: (part) => {
      calls.insertedMainFiles.push(part)
      return true
    },
    insertFileChipAtEditCursor: (part) => {
      calls.insertedEditFiles.push(part)
      return true
    },
    restoreMainSelection: () => {
      calls.restoredSelections += 1
      return true
    },
    insertVoiceTranscription: (text) => {
      calls.insertedVoiceText.push(text)
    },
    sendAfterVoiceTranscription: () => {
      calls.sentAfterVoice += 1
    },
    requestFrame: (callback) => {
      callback()
      return 1
    },
    setNoticeTimer: (callback) => {
      timerId += 1
      timers.set(timerId, callback)
      return timerId
    },
    clearNoticeTimer: (timer) => {
      calls.clearedTimers.push(timer)
      timers.delete(timer)
    },
    ...overrides
  })

  return {
    calls,
    draft,
    editingMessageId,
    mode,
    runtime,
    selectedConversationId,
    timers,
    usage
  }
}

describe('aiPanelInputMediaShellRuntime', () => {
  it('projects context usage and owns input placeholder notice state', async () => {
    const { calls, runtime, timers, usage } = createHarness()

    expect(runtime.contextUsage.value).toEqual({ used: 1536, contextWindow: 128000, percent: 72 })
    expect(runtime.contextUsageColor.value).toBe('#f59e0b')
    expect(runtime.contextUsageTrackColor.value).toBe('rgba(128, 128, 128, 0.2)')
    expect(runtime.contextUsageTooltip.value).toBe('72% - 1.5K / 128.0K context used')

    usage.value = { used: 120000, contextWindow: 128000, percent: 94 }
    expect(runtime.contextUsageColor.value).toBe('#ef4444')

    runtime.showInputPlaceholderNotice('first')
    expect(runtime.inputPlaceholderNotice.value).toBe('first')
    runtime.showInputPlaceholderNotice('second')
    expect(calls.clearedTimers).toEqual([1])
    expect(runtime.inputPlaceholderNotice.value).toBe('second')

    timers.get(2)?.()
    expect(runtime.inputPlaceholderNotice.value).toBe('')
    expect(await runtime.ensureAttachmentConversationId()).toBe('created-chat')
    expect(calls.createdConversations).toBe(1)

    runtime.showInputPlaceholderNotice('third')
    runtime.dispose()
    expect(calls.clearedTimers).toEqual([1, 3])
  })

  it('routes classic and Codex drag/drop behavior through the shell', async () => {
    const { calls, draft, mode, runtime } = createHarness()
    const knowledgeTransfer = transferFrom({
      'application/x-aiopsterm-context': JSON.stringify({ contextType: 'doc', relPath: 'Runbooks/rollback.md', name: 'Rollback.md' })
    })

    runtime.handleDragEnter({ dataTransfer: knowledgeTransfer } as DragEvent)
    expect(runtime.dropActive.value).toBe(true)
    runtime.handleDragOver({ dataTransfer: knowledgeTransfer } as DragEvent)
    expect(knowledgeTransfer.dropEffect).toBe('copy')
    await runtime.handleDrop({ dataTransfer: knowledgeTransfer } as DragEvent)

    expect(runtime.dropActive.value).toBe(false)
    expect(calls.addedKnowledge).toEqual([['Runbooks/rollback.md']])
    expect(draft.value).toBe('引用知识库：Rollback.md')
    expect(calls.caretMoves).toBe(1)
    expect(calls.closedPopups).toBe(1)

    mode.value = 'codex'
    await runtime.handleDrop({ dataTransfer: transferFrom({ [aiPanelTerminalTabDragType]: 'panel-1' }) } as DragEvent)
    expect(calls.boundPanels).toEqual([{ panelId: 'panel-1', source: 'drop-terminal-tab' }])

    await runtime.handleDrop({
      dataTransfer: transferFrom({
        'application/x-aiopsterm-context': JSON.stringify({ contextType: 'host', id: 'host-1', host: '10.0.0.8', name: 'Prod' })
      })
    } as DragEvent)
    expect(calls.boundHosts).toEqual(['host-1'])
  })

  it('routes image and file attachments to main or edit inputs', async () => {
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/input.png'] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/task.log'] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/edit.log'] })
    const prepareImageFromFile = vi.fn(async () => imageResult('input.png'))
    const prepareClipboardImage = vi.fn(async () => imageResult('clipboard.png'))
    const stageAttachment = vi.fn(async ({ taskId, srcAbsPath }) => stagedAttachment(taskId, srcAbsPath))
    const { calls, editingMessageId, runtime } = createHarness({
      attachmentServices: {
        showOpenDialog: () => showOpenDialog,
        prepareImageFromFile: () => prepareImageFromFile,
        prepareImageFromClipboard: () => prepareClipboardImage,
        stageAttachment: () => stageAttachment
      }
    })

    await runtime.openImagePicker()
    await runtime.insertPastedImageIntoEdit()
    await runtime.handleFileUpload()
    editingMessageId.value = 'message-1'
    await runtime.handleFileUpload()

    expect(prepareImageFromFile).toHaveBeenCalledWith({ filePath: '/tmp/input.png' })
    expect(prepareClipboardImage).toHaveBeenCalledTimes(1)
    expect(calls.insertedMainImages).toEqual([{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'input.png' }])
    expect(calls.insertedEditImages).toEqual([{ type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'clipboard.png' }])
    expect(stageAttachment).toHaveBeenNthCalledWith(1, { taskId: 'created-chat', srcAbsPath: '/tmp/task.log' })
    expect(stageAttachment).toHaveBeenNthCalledWith(2, { taskId: 'created-chat', srcAbsPath: '/tmp/edit.log' })
    expect(calls.insertedMainFiles.map((part) => part.ref.name)).toEqual(['task.log'])
    expect(calls.insertedEditFiles.map((part) => part.ref.name)).toEqual(['edit.log'])
    expect(runtime.inputPlaceholderNotice.value).toBe('已添加文件：edit.log')
  })

  it('delegates voice input through the same notice and selection boundary', async () => {
    const { calls, runtime } = createHarness({
      voiceServices: {
        getMediaRecorder: () => undefined
      }
    })

    runtime.toggleVoiceInput()

    await vi.waitFor(() => expect(runtime.inputPlaceholderNotice.value).toContain('麦克风不可用'))
    expect(calls.closedPopups).toBe(1)
    expect(calls.restoredSelections).toBe(1)
    expect(runtime.voiceRecording.value).toBe(false)
    expect(runtime.voiceButtonTitle.value).toBe('开始语音输入')
  })
})
