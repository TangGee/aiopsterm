import { describe, expect, it, vi } from 'vitest'
import {
  aiPanelCommandIconMarkup,
  aiPanelIconMarkupByChipType,
  aiPanelIconMarkupByContextKind,
  createAiPanelPresentationRuntime,
  defaultAiPanelChatModeOptions,
  measureAiPanelUiTextWidthPx
} from '@/services/aiPanelPresentationRuntime'
import type { AiContextOption } from '@shared/contracts/aiChat'

const hostContext: AiContextOption = {
  id: 'host-1',
  kind: 'hosts',
  label: 'prod',
  detail: 'Production'
}

const docContext: AiContextOption = {
  id: 'doc-1',
  kind: 'docs',
  label: 'Runbook.md',
  detail: 'Knowledge Base',
  contextType: 'doc',
  relPath: 'Runbook.md'
}

describe('aiPanelPresentationRuntime', () => {
  it('owns static AI panel presentation options and editable icon markup', () => {
    expect(defaultAiPanelChatModeOptions).toEqual([
      { id: 'agent', label: 'Agent', detail: '上下文辅助与工具调用' },
      { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
    ])
    expect(aiPanelCommandIconMarkup).toContain('<svg')
    expect(aiPanelIconMarkupByContextKind.docs).toContain('M14 2')
    expect(aiPanelIconMarkupByChipType.doc).toBe(aiPanelIconMarkupByContextKind.docs)
    expect(aiPanelIconMarkupByChipType.command).toBe(aiPanelCommandIconMarkup)
  })

  it('adapts icons, selected contexts, chip labels, clipboard images, and render options', () => {
    const contexts = [hostContext, docContext]
    const runtime = createAiPanelPresentationRuntime({
      icons: {
        hosts: 'host-icon',
        docs: 'doc-icon',
        images: 'image-icon',
        skills: 'skill-icon',
        chats: 'chat-icon',
        fallback: 'fallback-icon'
      },
      selectedContexts: () => contexts,
      measureText: (text) => text.length * 12
    })

    expect(runtime.aiChatModeOptions).toBe(defaultAiPanelChatModeOptions)
    expect(runtime.iconForKind('hosts')).toBe('host-icon')
    expect(runtime.iconForKind('docs')).toBe('doc-icon')
    expect(runtime.contextById('doc-1')).toBe(docContext)
    expect(runtime.contextById('missing')).toBeNull()
    expect(runtime.getChipLabel({ type: 'chip', chipType: 'doc', ref: { absPath: '/tmp/runbook.md', name: 'runbook.md', type: 'file' } })).toBe('runbook.md')
    expect(runtime.clipboardHasImage({ clipboardData: { items: [{ type: 'text/plain' }, { type: 'image/png' }] } } as unknown as ClipboardEvent)).toBe(true)
    expect(runtime.clipboardHasImage({ clipboardData: { items: [{ type: 'text/plain' }] } } as unknown as ClipboardEvent)).toBe(false)
    expect(runtime.editableRenderOptions.value).toEqual({
      iconMarkupByContextKind: aiPanelIconMarkupByContextKind,
      commandIconMarkup: aiPanelCommandIconMarkup
    })
    expect(runtime.iconMarkupByChipType).toBe(aiPanelIconMarkupByChipType)
    expect(runtime.measureText('Agent')).toBe(60)
  })

  it('measures text through canvas when available and keeps SSR fallback deterministic', () => {
    const originalDocument = globalThis.document
    const measureText = vi.fn((text: string) => ({ width: text.length * 9 }))
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          getContext: () => ({ font: '', measureText })
        } as unknown as HTMLCanvasElement
      }
      return originalDocument.createElement(tagName)
    }) as typeof document.createElement)

    expect(measureAiPanelUiTextWidthPx('model')).toBe(45)
    expect(measureText).toHaveBeenCalledWith('model')

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: undefined
    })
    try {
      expect(measureAiPanelUiTextWidthPx('model')).toBe(35)
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument
      })
    }
  })
})
