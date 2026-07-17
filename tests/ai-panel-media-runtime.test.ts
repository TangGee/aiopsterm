import { describe, expect, it } from 'vitest'
import {
  aiPanelChatAttachmentFilters,
  aiPanelDropEffect,
  aiPanelImagePickerFilters,
  aiPanelPreferredVoiceMimeTypes,
  aiPanelTerminalTabDragType,
  bestVoiceMimeType,
  canAcceptAiPanelDrop,
  clipboardHasImageItems,
  docPartFromStagedAttachment,
  imagePartFromChatImagePrepareResult,
  parseAiopstermDragPayload,
  planAiPanelDrop,
  prepareVoiceTranscriptionCompletion,
  prepareVoiceTranscriptionInputFromBlob,
  stagedAttachmentMatchesRequest,
  voiceRecordingStartFailureMessage,
  voiceTextFromTranscriptionResult
} from '@/services/ai/aiPanelMediaRuntime'

const transferFrom = (data: Record<string, string>) => ({
  getData: (type: string) => data[type] || ''
})

describe('aiPanelMediaRuntime', () => {
  it('projects image prepare results and exported picker filters without renderer file reads', () => {
    expect(aiPanelImagePickerFilters).toEqual([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }])
    expect(aiPanelChatAttachmentFilters[0].extensions).toEqual(expect.arrayContaining(['txt', 'md', 'js', 'ts', 'py', 'log', 'csv', 'tsv']))
    expect(clipboardHasImageItems([{ type: 'text/plain' }, { type: 'image/png' }])).toBe(true)

    expect(
      imagePartFromChatImagePrepareResult({
        ok: true,
        data: { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'diagram.png', size: 4 }
      })
    ).toEqual({ ok: true, data: { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'diagram.png' } })
    expect(imagePartFromChatImagePrepareResult({ ok: false, errorCode: 'BAD_IMAGE', errorMessage: 'bad image' })).toEqual({ ok: false, message: 'bad image' })
    expect(imagePartFromChatImagePrepareResult({ ok: true, data: { type: 'image', mediaType: 'image/png', data: '', size: 4 } } as any)).toEqual({
      ok: false,
      message: 'AI 服务返回数据无效'
    })
  })

  it('validates staged chat attachments against the requested task/source/ref boundary', () => {
    const staged = {
      mode: 'local' as const,
      taskId: 'conv-attachment-normalized',
      srcAbsPath: '/tmp/normalized-task.log',
      refPath: 'aiopsterm://chat-attachment/conv-attachment-normalized/normalized-task.log',
      name: 'normalized-task.log',
      size: 128,
      stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-normalized/normalized-task.log'
    }
    expect(stagedAttachmentMatchesRequest(staged, 'conv:attachment/normalized', '/tmp/normalized-task.log')).toBe(true)
    expect(docPartFromStagedAttachment(staged, 'conv:attachment/normalized', '/tmp/normalized-task.log')).toEqual({
      ok: true,
      data: {
        displayName: 'normalized-task.log',
        part: {
          type: 'chip',
          chipType: 'doc',
          ref: {
            absPath: staged.refPath,
            relPath: staged.refPath,
            name: 'normalized-task.log',
            type: 'file'
          }
        }
      }
    })
    expect(stagedAttachmentMatchesRequest({ ...staged, taskId: 'other-conversation' }, 'conv:attachment/normalized', staged.srcAbsPath)).toBe(false)
    expect(stagedAttachmentMatchesRequest({ ...staged, srcAbsPath: '/tmp/other.log' }, 'conv:attachment/normalized', staged.srcAbsPath)).toBe(false)
    expect(stagedAttachmentMatchesRequest({ ...staged, refPath: 'aiopsterm://chat-attachment/other/normalized-task.log' }, 'conv:attachment/normalized', staged.srcAbsPath)).toBe(false)
    expect(stagedAttachmentMatchesRequest({ ...staged, name: '../bad.log' }, 'conv:attachment/normalized', staged.srcAbsPath)).toBe(false)
    expect(docPartFromStagedAttachment({ ...staged, name: '' }, 'conv:attachment/normalized', staged.srcAbsPath)).toEqual({
      ok: false,
      message: 'AI 服务返回数据无效'
    })
  })

  it('plans browser voice recording, transcription result, completion, and start-failure state', async () => {
    expect(aiPanelPreferredVoiceMimeTypes[0]).toBe('audio/webm')
    expect(bestVoiceMimeType((format) => format === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus')
    expect(voiceRecordingStartFailureMessage(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))).toContain('麦克风权限被拒绝')
    expect(voiceTextFromTranscriptionResult({ ok: false, errorCode: 'NO_AUDIO' })).toEqual({ ok: false, message: 'NO_AUDIO' })
    expect(voiceTextFromTranscriptionResult({ ok: true, data: { text: 'transcript', provider: 'aiopsterm-local' } })).toEqual({ ok: true, data: 'transcript' })
    expect(voiceTextFromTranscriptionResult({ ok: true, data: { text: 'bad', provider: 'unknown-provider' } } as any)).toEqual({
      ok: false,
      message: 'AI 服务返回数据无效'
    })

    expect(prepareVoiceTranscriptionCompletion('  deploy now  ', 'existing', true)).toEqual({
      ok: true,
      data: { insertionText: ' deploy now', notice: '语音转写完成：deploy now', autoSend: true }
    })
    expect(prepareVoiceTranscriptionCompletion('   ', '', false)).toEqual({ ok: false, message: '语音识别结果为空。' })

    expect(
      await prepareVoiceTranscriptionInputFromBlob(300, {
        audioBlob: { size: 512, type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(512) } as Blob
      })
    ).toEqual({
      ok: false,
      message: '录制时间过短，请录制更长的语音内容。'
    })
    const input = await prepareVoiceTranscriptionInputFromBlob(300, {
      audioBlob: { size: 2048, type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(2048) } as Blob
    })
    expect(input.ok).toBe(true)
    if (input.ok) {
      expect(input.data).toEqual(
        expect.objectContaining({
          source: 'browser',
          durationMs: 300,
          audioFormat: 'audio/webm',
          audioSize: 2048
        })
      )
      expect(input.data.audioBytes).toBeInstanceOf(ArrayBuffer)
    }
  })

  it('parses AI panel drag payloads and plans classic/Codex drops', () => {
    const knowledgeTransfer = transferFrom({
      'application/x-aiopsterm-context': JSON.stringify({ contextType: 'doc', relPath: 'Runbooks/rollback.md', name: 'Rollback.md' })
    })
    expect(parseAiopstermDragPayload(knowledgeTransfer)).toEqual({ contextType: 'doc', relPath: 'Runbooks/rollback.md', name: 'Rollback.md' })
    expect(planAiPanelDrop('classic', knowledgeTransfer)).toEqual({
      kind: 'classic-knowledge',
      relPath: 'Runbooks/rollback.md',
      draftText: '引用知识库：Rollback.md',
      payload: { contextType: 'doc', relPath: 'Runbooks/rollback.md', name: 'Rollback.md' }
    })
    expect(canAcceptAiPanelDrop('classic', knowledgeTransfer)).toBe(true)
    expect(aiPanelDropEffect('classic')).toBe('copy')

    const hostPayload = encodeURIComponent(JSON.stringify({ contextType: 'host', id: 'asset-1', host: '10.0.0.8', username: 'ops', name: 'Prod' }))
    const hostTransfer = transferFrom({ 'text/html': `<div data-aiopsterm-context="${hostPayload}"></div>` })
    expect(planAiPanelDrop('codex', hostTransfer)).toEqual({
      kind: 'codex-host',
      context: {
        id: 'asset-1',
        kind: 'hosts',
        label: 'Prod',
        detail: '10.0.0.8',
        host: '10.0.0.8',
        username: 'ops',
        assetName: 'Prod'
      }
    })
    expect(aiPanelDropEffect('codex')).toBe('move')

    const terminalTransfer = transferFrom({ [aiPanelTerminalTabDragType]: 'panel-1' })
    expect(planAiPanelDrop('codex', terminalTransfer)).toEqual({ kind: 'codex-terminal', panelId: 'panel-1' })
    expect(planAiPanelDrop('classic', terminalTransfer)).toEqual({ kind: 'none' })
    expect(parseAiopstermDragPayload(transferFrom({ 'application/x-aiopsterm-context': '{bad-json' }))).toBeNull()
  })
})
