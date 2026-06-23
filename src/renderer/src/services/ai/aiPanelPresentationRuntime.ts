import { computed } from 'vue'
import {
  aiPanelChipLabel,
  type AiPanelEditableRenderOptions
} from '@/services/ai/aiPanelEditableRuntime'
import { clipboardHasImageItems } from '@/services/ai/aiPanelMediaRuntime'
import type { AiChipContentPart, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelChatMode = 'agent' | 'cmd'

export type AiPanelPresentationRuntimeOptions<TIcon = unknown> = {
  icons: {
    hosts: TIcon
    docs: TIcon
    images: TIcon
    skills: TIcon
    chats: TIcon
    fallback: TIcon
  }
  selectedContexts: () => AiContextOption[]
  measureText?: (text: string) => number
}

export const defaultAiPanelChatModeOptions: Array<{ id: AiPanelChatMode; label: string; detail: string }> = [
  { id: 'agent', label: 'Agent', detail: '上下文辅助与工具调用' },
  { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
]

export const aiPanelCommandIconMarkup =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path></svg>'

export const aiPanelIconMarkupByContextKind: Record<AiContextKind, string> = {
  hosts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>',
  docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>',
  images: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20"></path></svg>',
  skills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z"></path><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"></path></svg>',
  chats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>'
}

export const aiPanelIconMarkupByChipType: Record<AiChipContentPart['chipType'], string> = {
  doc: aiPanelIconMarkupByContextKind.docs,
  chat: aiPanelIconMarkupByContextKind.chats,
  command: aiPanelCommandIconMarkup,
  skill: aiPanelIconMarkupByContextKind.skills
}

export const measureAiPanelUiTextWidthPx = (text: string) => {
  if (!text) return 0
  if (typeof document === 'undefined') return text.length * 7
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return text.length * 7
  context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
  return context.measureText(text).width
}

export const createAiPanelPresentationRuntime = <TIcon = unknown>(options: AiPanelPresentationRuntimeOptions<TIcon>) => {
  const aiContextCategoryIcons: Record<AiContextKind, TIcon> = {
    hosts: options.icons.hosts,
    docs: options.icons.docs,
    images: options.icons.images,
    skills: options.icons.skills,
    chats: options.icons.chats
  }

  const editableRenderOptions = computed<AiPanelEditableRenderOptions>(() => ({
    iconMarkupByContextKind: aiPanelIconMarkupByContextKind,
    commandIconMarkup: aiPanelCommandIconMarkup
  }))

  return {
    aiChatModeOptions: defaultAiPanelChatModeOptions,
    aiContextCategoryIcons,
    clipboardHasImage: (event: ClipboardEvent) => clipboardHasImageItems(event.clipboardData?.items),
    contextById: (id: string) => options.selectedContexts().find((item) => item.id === id) || null,
    editableRenderOptions,
    getChipLabel: aiPanelChipLabel,
    iconForKind: (kind: AiContextKind) => aiContextCategoryIcons[kind] || options.icons.fallback,
    iconMarkupByChipType: aiPanelIconMarkupByChipType,
    measureText: options.measureText ?? measureAiPanelUiTextWidthPx
  }
}
