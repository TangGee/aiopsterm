import {
  isChatAttachmentStageData,
  isChatImageAttachmentPrepareData,
  isVoiceTranscriptionData,
  malformedAiBackendResultMessage
} from '@/services/ai/aiBackendGuards'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import { chatAttachmentPathSegments, normalizeChatAttachmentPath, normalizeChatAttachmentTaskId, parseChatAttachmentRef } from '@shared/chatAttachment'
import { managedAssetDisplayName, managedAssetEndpoint } from '@shared/assetDisplayRuntime'
import type { AiContextKind, AiContextOption, AiDocChipContentPart, AiImageContentPart } from '@shared/contracts/aiChat'
import type { ChatAttachmentStageResult, ChatImageAttachmentPrepareResult, FileDialogFilter } from '@shared/contracts/localFiles'
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

export const aiPanelVoiceRecordingLimitMs = 60_000
export const aiPanelVoiceRecordingMinimumMs = 220
export const aiPanelVoiceMaxAudioBytes = 50 * 1024 * 1024

export const aiPanelPreferredVoiceMimeTypes = [
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/mp3',
  'audio/m4a',
  'audio/aac',
  'audio/wav'
]

export const aiPanelImagePickerFilters: FileDialogFilter[] = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]

export const aiPanelChatAttachmentFilters: FileDialogFilter[] = [
  {
    name: 'Text',
    extensions: [
      'txt',
      'md',
      'js',
      'ts',
      'py',
      'java',
      'cpp',
      'c',
      'html',
      'css',
      'json',
      'xml',
      'yaml',
      'yml',
      'sql',
      'sh',
      'bat',
      'ps1',
      'log',
      'csv',
      'tsv'
    ]
  }
]

export const aiPanelTerminalTabDragType = 'application/x-aiopsterm-terminal-tab'

export type AiPanelMediaRuntimeResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      message: string
    }

export type AiopstermDragPayload = {
  contextType?: string
  relPath?: string
  name?: string
  id?: string
  kind?: AiContextKind
  label?: string
  detail?: string
  host?: string
  port?: number
  username?: string
  assetName?: string
  isLocalShell?: boolean
}

export type AiPanelDragDataTransfer = Pick<DataTransfer, 'getData'> | null

export type AiPanelDropPlan =
  | { kind: 'none' }
  | { kind: 'classic-knowledge'; relPath: string; draftText: string; payload: AiopstermDragPayload }
  | { kind: 'codex-terminal'; panelId: string }
  | { kind: 'codex-host'; context: AiContextOption }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const clipboardHasImageItems = (items: Iterable<{ type?: string }> | ArrayLike<{ type?: string }> | undefined | null) =>
  Array.from(items || []).some((item) => item.type?.startsWith('image/'))

export const imagePartFromChatImagePrepareResult = (
  result: ChatImageAttachmentPrepareResult | null | undefined,
  fallbackMessage = '图片处理失败'
): AiPanelMediaRuntimeResult<AiImageContentPart> => {
  if (!result?.ok) return { ok: false, message: result?.errorMessage || result?.errorCode || fallbackMessage }
  if (!isChatImageAttachmentPrepareData(result.data)) return { ok: false, message: malformedAiBackendResultMessage }
  return {
    ok: true,
    data: {
      type: 'image',
      mediaType: result.data.mediaType,
      data: result.data.data,
      name: result.data.name
    }
  }
}

export const stagedAttachmentMatchesRequest = (staged: unknown, taskId: string, srcAbsPath: string): staged is ChatAttachmentStageResult => {
  if (!isChatAttachmentStageData(staged)) return false
  const expectedTaskId = normalizeChatAttachmentTaskId(taskId)
  const expectedSource = normalizeChatAttachmentPath(srcAbsPath)
  if (staged.taskId !== expectedTaskId || normalizeChatAttachmentPath(staged.srcAbsPath) !== expectedSource) return false
  if (staged.name === '.' || staged.name === '..' || staged.name.includes('/') || staged.name.includes('\\')) return false
  const ref = parseChatAttachmentRef(staged.refPath)
  if (!ref || ref.taskId !== expectedTaskId || ref.name !== staged.name) return false
  const stagedParts = chatAttachmentPathSegments(staged.stagedPath)
  return stagedParts.at(-3) === 'chat-attachments' && stagedParts.at(-2) === expectedTaskId && stagedParts.at(-1) === staged.name
}

export const docPartFromStagedAttachment = (
  staged: unknown,
  taskId: string,
  srcAbsPath: string
): AiPanelMediaRuntimeResult<{ part: AiDocChipContentPart; displayName: string }> => {
  if (!stagedAttachmentMatchesRequest(staged, taskId, srcAbsPath)) return { ok: false, message: malformedAiBackendResultMessage }
  const displayName = staged.name || srcAbsPath.split(/[/\\]/).pop() || 'file'
  return {
    ok: true,
    data: {
      displayName,
      part: {
        type: 'chip',
        chipType: 'doc',
        ref: {
          absPath: staged.refPath,
          relPath: staged.refPath,
          name: displayName,
          type: 'file'
        }
      }
    }
  }
}

export const bestVoiceMimeType = (isTypeSupported?: (format: string) => boolean) =>
  isTypeSupported ? aiPanelPreferredVoiceMimeTypes.find((format) => isTypeSupported(format)) || '' : ''

export const voiceRecordingStartFailureMessage = (error: unknown) => {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') return '麦克风权限被拒绝，请允许麦克风访问后重试。'
    if (error.name === 'NotFoundError') return '未找到麦克风设备，无法开始语音输入。'
    if (error.name === 'NotReadableError') return '麦克风正被其他应用占用，无法开始语音输入。'
  }
  return '麦克风不可用，无法开始语音输入。'
}

export const voiceTextFromTranscriptionResult = (result: VoiceTranscriptionResult | null | undefined): AiPanelMediaRuntimeResult<string> => {
  if (!result?.ok) return { ok: false, message: result?.errorMessage || result?.errorCode || '识别结果为空' }
  if (!isVoiceTranscriptionData(result.data)) return { ok: false, message: malformedAiBackendResultMessage }
  return { ok: true, data: result.data.text }
}

export const prepareVoiceTranscriptionCompletion = (
  text: string,
  draft: string,
  autoSend: boolean
): AiPanelMediaRuntimeResult<{ insertionText: string; notice: string; autoSend: boolean }> => {
  const normalized = text.trim()
  if (!normalized) return { ok: false, message: '语音识别结果为空。' }
  const prefix = draft.trim() && !/\s$/.test(draft) ? ' ' : ''
  return {
    ok: true,
    data: {
      insertionText: `${prefix}${normalized}`,
      notice: `语音转写完成：${normalized}`,
      autoSend
    }
  }
}

export const prepareVoiceTranscriptionInputFromBlob = async (
  elapsed: number,
  options: { reachedLimit?: boolean; audioBlob?: Blob } = {}
): Promise<AiPanelMediaRuntimeResult<VoiceTranscriptionInput>> => {
  if (!options.audioBlob) return { ok: false, message: '未获取到录音音频，无法进行语音识别。' }
  if (!options.reachedLimit && elapsed < aiPanelVoiceRecordingMinimumMs) return { ok: false, message: '录制时间过短，请录制更长的语音内容。' }
  if (options.audioBlob.size < 1024) return { ok: false, message: '录制时间过短，请录制更长的语音内容。' }
  if (options.audioBlob.size > aiPanelVoiceMaxAudioBytes) return { ok: false, message: '音频文件超过 50 MiB，无法识别。' }
  try {
    const audioBytes = await options.audioBlob.arrayBuffer()
    return {
      ok: true,
      data: {
        durationMs: elapsed,
        source: 'browser',
        audioBytes,
        audioFormat: options.audioBlob.type,
        audioSize: options.audioBlob.size
      }
    }
  } catch (error) {
    return { ok: false, message: `语音识别失败：${errorMessage(error)}` }
  }
}

export const parseAiopstermDragPayload = (dataTransfer: AiPanelDragDataTransfer): AiopstermDragPayload | null => {
  if (!dataTransfer) return null
  const direct = dataTransfer.getData('application/x-aiopsterm-context')
  if (direct) {
    try {
      return JSON.parse(direct) as AiopstermDragPayload
    } catch {
      return null
    }
  }
  const html = dataTransfer.getData('text/html')
  if (!html) return null
  const match = html.match(/data-aiopsterm-context="([^"]+)"/)
  if (!match) return null
  try {
    return JSON.parse(decodeURIComponent(match[1])) as AiopstermDragPayload
  } catch {
    return null
  }
}

export const isKnowledgeDragPayload = (payload: AiopstermDragPayload | null | undefined) =>
  Boolean(payload?.relPath && (payload.contextType === 'doc' || payload.contextType === 'image'))

export const isHostDragPayload = (payload: AiopstermDragPayload | null | undefined): payload is AiopstermDragPayload & { id: string } =>
  Boolean(payload?.id && (payload.kind === 'hosts' || payload.contextType === 'host'))

export const draggedTerminalPanelId = (dataTransfer: AiPanelDragDataTransfer) => dataTransfer?.getData(aiPanelTerminalTabDragType) || ''

export const hostContextFromDragPayload = (payload: AiopstermDragPayload & { id: string }): AiContextOption => ({
  id: payload.id,
  kind: 'hosts',
  label: payload.label || managedAssetDisplayName(payload),
  detail: payload.detail || managedAssetEndpoint(payload),
  host: payload.host,
  port: payload.port,
  username: payload.username,
  assetName: payload.assetName || payload.name || payload.label,
  isLocalShell: payload.isLocalShell
})

export const planAiPanelDrop = (mode: AiPanelMode, dataTransfer: AiPanelDragDataTransfer): AiPanelDropPlan => {
  const terminalPanelId = draggedTerminalPanelId(dataTransfer)
  const payload = parseAiopstermDragPayload(dataTransfer)
  if (mode === 'codex') {
    if (terminalPanelId) return { kind: 'codex-terminal', panelId: terminalPanelId }
    if (isHostDragPayload(payload)) return { kind: 'codex-host', context: hostContextFromDragPayload(payload) }
    return { kind: 'none' }
  }
  if (!isKnowledgeDragPayload(payload) || !payload?.relPath) return { kind: 'none' }
  return {
    kind: 'classic-knowledge',
    relPath: payload.relPath,
    draftText: `引用知识库：${payload.name || payload.relPath}`,
    payload
  }
}

export const canAcceptAiPanelDrop = (mode: AiPanelMode, dataTransfer: AiPanelDragDataTransfer) => planAiPanelDrop(mode, dataTransfer).kind !== 'none'

export const aiPanelDropEffect = (mode: AiPanelMode) => (mode === 'codex' ? 'move' : 'copy')
