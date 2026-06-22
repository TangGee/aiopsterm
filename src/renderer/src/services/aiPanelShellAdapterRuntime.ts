import { nextTick, type Component } from 'vue'
import {
  Bot,
  FileText,
  Image,
  Search,
  Server
} from 'lucide-vue-next'

import type { AiPanelPopupTarget } from '@/services/aiPanelPopupRuntime'

export type AiPanelShellBrowserAdapter = {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frame: number) => void
  setTimer: (callback: () => void, delay?: number) => number
  clearTimer: (timer: number) => void
  queryEditTarget: () => HTMLElement | null
}

export type AiPanelShellAdapterRuntimeOptions = {
  refreshClassicCatalog: () => Promise<unknown>
  hydrateClassicChatData: () => Promise<unknown>
  afterDomUpdate?: (callback?: () => void) => void | Promise<void>
  browser?: Partial<AiPanelShellBrowserAdapter>
}

export const aiPanelShellPresentationIcons: {
  hosts: Component
  docs: Component
  images: Component
  skills: Component
  chats: Component
  fallback: Component
} = {
  hosts: Server,
  docs: FileText,
  images: Image,
  skills: Bot,
  chats: Search,
  fallback: Search
}

const defaultBrowserAdapter = (): AiPanelShellBrowserAdapter => ({
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frame) => window.cancelAnimationFrame(frame),
  setTimer: (callback, delay = 0) => window.setTimeout(callback, delay),
  clearTimer: (timer) => window.clearTimeout(timer),
  queryEditTarget: () => document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null
})

export const createAiPanelShellAdapterRuntime = ({
  refreshClassicCatalog,
  hydrateClassicChatData,
  afterDomUpdate = (callback?: () => void) => (callback ? nextTick(callback) : nextTick()),
  browser = {}
}: AiPanelShellAdapterRuntimeOptions) => {
  let classicChatDataLoaded = false
  const resolvedBrowser = { ...defaultBrowserAdapter(), ...browser }

  const loadClassicChatData = async () => {
    if (classicChatDataLoaded) return
    classicChatDataLoaded = true
    await Promise.all([refreshClassicCatalog(), hydrateClassicChatData()])
  }

  const focusInputForTarget = (
    target: AiPanelPopupTarget,
    handlers: {
      restoreEditInputSelection: () => void
      restoreEditableSelection: () => void
    }
  ) => {
    resolvedBrowser.requestFrame(() => {
      if (target === 'edit') {
        handlers.restoreEditInputSelection()
        return
      }
      handlers.restoreEditableSelection()
    })
  }

  return {
    afterDomUpdate,
    afterRequiredDomUpdate: (callback: () => void) => afterDomUpdate(callback),
    cancelFrame: resolvedBrowser.cancelFrame,
    clearAnyTimer: (timer: unknown) => {
      if (typeof timer === 'number') resolvedBrowser.clearTimer(timer)
    },
    clearTimer: resolvedBrowser.clearTimer,
    defer: (callback: () => void) => {
      resolvedBrowser.setTimer(callback, 0)
    },
    focusInputForTarget,
    loadClassicChatData,
    maxHostContexts: 5,
    presentationIcons: aiPanelShellPresentationIcons,
    queryEditTarget: resolvedBrowser.queryEditTarget,
    requestFrame: resolvedBrowser.requestFrame,
    setTimer: resolvedBrowser.setTimer
  }
}
