import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import { backgroundStyleVars } from '@/services/app/backgroundRuntime'
import { managedAiClient } from '@/services/ai/managedAiClient'
import { terminalClient } from '@/services/terminal/terminalClient'
import { layoutWidthLimits, useWorkspaceStore } from '@/stores/workspace'
import { applyDocumentLocale, useI18n, type I18nKey, type SupportedLocale } from '@/i18n'
import { installStaticTextI18n } from '@/i18n/staticText'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
import type { AiAgentSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { TerminalKeyboardInteractiveRequest, TerminalKeyboardInteractiveResult } from '@shared/contracts/terminalSessions'

type ResizeSide = 'left' | 'right' | 'agents-left'
type TerminalMfaPrompt = TerminalKeyboardInteractiveRequest['prompts'][number]
type TerminalMfaDialogState = {
  open: boolean
  request: TerminalKeyboardInteractiveRequest | null
  responses: string[]
  rememberPassword: boolean
  submitting: boolean
  error: string
}

type AppShellWorkspace = Pick<
  ReturnType<typeof useWorkspaceStore>,
  | 'activeModule'
  | 'agentsLeftOpen'
  | 'agentsLeftWidth'
  | 'config'
  | 'handleDeepLink'
  | 'hydrateConfig'
  | 'installShortcutRuntime'
  | 'isLeftVisible'
  | 'isRightVisible'
  | 'leftPanelWidth'
  | 'mode'
  | 'quickCloseLeftPanel'
  | 'quickCloseRightPanel'
  | 'refreshManagedAiSessions'
  | 'refreshManagedAiSessionsDebounced'
  | 'resizeLeftPanel'
  | 'resizeRightPanel'
  | 'rightPanelWidth'
  | 'uninstallShortcutRuntime'
  | 'upsertManagedAiSession'
  | 'focusManagedAiSessionRequest'
>

type AppShellWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth'>

type AppShellBridgeClients = {
  appRuntime: Pick<typeof appRuntimeClient, 'consumeDeepLinks' | 'onDeepLink'>
  terminal: Pick<
    typeof terminalClient,
    | 'cancelTerminalKeyboardInteractive'
    | 'onTerminalKeyboardInteractiveRequest'
    | 'onTerminalKeyboardInteractiveResult'
    | 'respondTerminalKeyboardInteractive'
  >
  managedAi: Pick<typeof managedAiClient, 'onAiAgentSessionEvent' | 'onManagedAiSessionEvent' | 'onManagedAiSessionFocusRequest'>
}

export type AppShellRuntimeOptions = {
  workspace: AppShellWorkspace
  t: (key: I18nKey) => string
  applyLocale: (locale: SupportedLocale) => void
  clients: AppShellBridgeClients
  afterDomUpdate: () => Promise<unknown>
  windowRef: AppShellWindow
  bodyClassList: Pick<DOMTokenList, 'add' | 'remove'>
}

export const createAppShellRuntime = (options: AppShellRuntimeOptions) => {
  const { workspace } = options
  const draggingSide = ref<ResizeSide | null>(null)
  const draftLeftPanelWidth = ref<number | null>(null)
  const draftRightPanelWidth = ref<number | null>(null)
  const draftAgentsLeftWidth = ref<number | null>(null)
  const terminalMfaInputRefs = ref<HTMLInputElement[]>([])
  const terminalMfaDialog = ref<TerminalMfaDialogState>({
    open: false,
    request: null,
    responses: [],
    rememberPassword: false,
    submitting: false,
    error: ''
  })
  let resizeStartX = 0
  let resizeStartWidth = 0
  let resizeQuickClosed = false
  let stopDeepLink: (() => void) | undefined
  let stopKeyboardInteractiveRequest: (() => void) | undefined
  let stopKeyboardInteractiveResult: (() => void) | undefined
  let stopAiAgentSessionEvent: (() => void) | undefined
  let stopManagedAiSessionEvent: (() => void) | undefined
  let stopManagedAiSessionFocusRequest: (() => void) | undefined

  const showAgentsLeftPane = computed(() => workspace.mode === 'agents' && workspace.agentsLeftOpen)
  const showTerminalLeftPane = computed(
    () => workspace.mode === 'terminal' && workspace.isLeftVisible && !['assets', 'settings', 'database', 'user'].includes(workspace.activeModule)
  )
  const showTerminalRightPane = computed(
    () => workspace.mode === 'terminal' && workspace.isRightVisible && !['assets', 'database', 'user'].includes(workspace.activeModule)
  )
  const hasLeftPane = computed(() => showAgentsLeftPane.value || showTerminalLeftPane.value)
  const hasRightPane = computed(() => showTerminalRightPane.value)
  const displayLeftPanelWidth = computed(() => draftLeftPanelWidth.value ?? workspace.leftPanelWidth)
  const displayRightPanelWidth = computed(() => draftRightPanelWidth.value ?? workspace.rightPanelWidth)
  const displayAgentsLeftWidth = computed(() => draftAgentsLeftWidth.value ?? workspace.agentsLeftWidth)
  const appBackgroundStyle = computed(() => backgroundStyleVars(workspace.config.background))
  const isTerminalPasswordPrompt = computed(() => terminalMfaDialog.value.request?.purpose === 'password')
  const showTerminalPasswordRemember = computed(
    () => isTerminalPasswordPrompt.value && terminalMfaDialog.value.request?.canRememberPassword === true
  )
  const isTerminalPasswordRetry = computed(() => isTerminalPasswordPrompt.value && Number(terminalMfaDialog.value.request?.attempts || 1) > 1)
  const terminalMfaTarget = computed(() => {
    const request = terminalMfaDialog.value.request
    return request ? `${request.username}@${request.host}:${request.port}` : ''
  })
  const terminalAuthTitle = computed(() => options.t(isTerminalPasswordPrompt.value ? 'terminal.passwordTitle' : 'terminal.mfaTitle'))
  const terminalAuthRequired = computed(() => options.t(isTerminalPasswordPrompt.value ? 'terminal.passwordRequired' : 'terminal.mfaRequired'))
  const terminalAuthPromptFallback = computed(() =>
    options.t(isTerminalPasswordPrompt.value ? 'terminal.passwordPromptFallback' : 'terminal.mfaPromptFallback')
  )
  const terminalMfaPrompts = computed<TerminalMfaPrompt[]>(() => {
    const prompts = terminalMfaDialog.value.request?.prompts || []
    return prompts.length ? prompts : [{ prompt: terminalAuthPromptFallback.value, echo: false }]
  })
  const terminalAuthDescription = computed(() => {
    const key = isTerminalPasswordPrompt.value
      ? isTerminalPasswordRetry.value
        ? 'terminal.passwordRejectedDescription'
        : 'terminal.passwordDescription'
      : 'terminal.mfaDescription'
    return formatMessage(key, { target: terminalMfaTarget.value })
  })

  const formatMessage = (key: I18nKey, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), options.t(key))

  const clampLayoutWidth = (width: number) => Math.min(layoutWidthLimits.max, Math.max(layoutWidthLimits.min, Math.round(width)))

  const setDraftWidth = (side: ResizeSide, width: number | null) => {
    if (side === 'left') draftLeftPanelWidth.value = width
    if (side === 'right') draftRightPanelWidth.value = width
    if (side === 'agents-left') draftAgentsLeftWidth.value = width
  }

  const setTerminalMfaInputRef = (element: unknown, index: number) => {
    if (element instanceof HTMLInputElement) terminalMfaInputRefs.value[index] = element
  }

  const resetTerminalMfaDialog = () => {
    terminalMfaInputRefs.value = []
    terminalMfaDialog.value = {
      open: false,
      request: null,
      responses: [],
      rememberPassword: false,
      submitting: false,
      error: ''
    }
  }

  const handleTerminalMfaRequest = (request: TerminalKeyboardInteractiveRequest) => {
    const promptCount = request.prompts.length || 1
    terminalMfaInputRefs.value = []
    terminalMfaDialog.value = {
      open: true,
      request,
      responses: Array.from({ length: promptCount }, () => ''),
      rememberPassword: false,
      submitting: false,
      error: ''
    }
    void options.afterDomUpdate().then(() => terminalMfaInputRefs.value[0]?.focus())
  }

  const submitTerminalMfa = () => {
    const request = terminalMfaDialog.value.request
    if (!request || terminalMfaDialog.value.submitting) return
    const responses = terminalMfaPrompts.value.map((_prompt, index) => terminalMfaDialog.value.responses[index] || '')
    if (responses.some((value) => !value.trim())) {
      terminalMfaDialog.value.error = options.t('terminal.mfaEmpty')
      return
    }
    terminalMfaDialog.value.submitting = true
    terminalMfaDialog.value.error = ''
    options.clients.terminal.respondTerminalKeyboardInteractive()?.(
      request.id,
      isTerminalPasswordPrompt.value
        ? {
            responses,
            rememberPassword: terminalMfaDialog.value.rememberPassword
          }
        : responses
    )
  }

  const cancelTerminalMfa = () => {
    const request = terminalMfaDialog.value.request
    if (request) options.clients.terminal.cancelTerminalKeyboardInteractive()?.(request.id)
    resetTerminalMfaDialog()
  }

  const handleTerminalMfaResult = (result: TerminalKeyboardInteractiveResult) => {
    const request = terminalMfaDialog.value.request
    if (!request || result.id !== request.id) return
    if (result.status === 'success') {
      resetTerminalMfaDialog()
      return
    }
    if (result.status === 'failed' && !result.final) {
      terminalMfaDialog.value.submitting = false
      terminalMfaDialog.value.error = result.errorMessage || options.t('terminal.mfaFailed')
      terminalMfaInputRefs.value[0]?.focus()
      return
    }
    resetTerminalMfaDialog()
  }

  const getCurrentWidth = (side: ResizeSide) => {
    if (side === 'left') return workspace.leftPanelWidth
    if (side === 'right') return workspace.rightPanelWidth
    return workspace.agentsLeftWidth
  }

  const persistResize = async (side: ResizeSide, width: number) => {
    if (side === 'right') return workspace.resizeRightPanel(width)
    return workspace.resizeLeftPanel(width)
  }

  const quickClose = async (side: ResizeSide) => {
    if (side === 'right') return workspace.quickCloseRightPanel()
    return workspace.quickCloseLeftPanel()
  }

  const applyDeepLinkPayload = (payload: unknown) => {
    if (!isAiopstermDeepLinkPayload(payload)) {
      workspace.handleDeepLink(payload)
      return false
    }
    return workspace.handleDeepLink(payload)
  }

  const consumePendingDeepLinks = async () => {
    const consumeDeepLinks = options.clients.appRuntime.consumeDeepLinks()
    if (typeof consumeDeepLinks !== 'function') return
    try {
      const payloads = await consumeDeepLinks()
      if (!Array.isArray(payloads)) {
        applyDeepLinkPayload(payloads)
        return
      }
      payloads.forEach((payload) => applyDeepLinkPayload(payload))
    } catch {
      applyDeepLinkPayload(null)
    }
  }

  const endResize = async () => {
    const side = draggingSide.value
    if (!side) return
    options.windowRef.removeEventListener('mousemove', handleResizeMove)
    options.windowRef.removeEventListener('mouseup', endResize)
    draggingSide.value = null
    options.bodyClassList.remove('layout-resizing')
    const width = side === 'left' ? draftLeftPanelWidth.value : side === 'right' ? draftRightPanelWidth.value : draftAgentsLeftWidth.value
    setDraftWidth(side, null)
    if (resizeQuickClosed) {
      resizeQuickClosed = false
      return
    }
    if (typeof width === 'number') void persistResize(side, width)
  }

  const handleResizeMove = (event: MouseEvent) => {
    const side = draggingSide.value
    if (!side) return
    if (side === 'right') {
      const distanceFromRight = options.windowRef.innerWidth - event.clientX
      if (distanceFromRight < layoutWidthLimits.quickCloseThreshold) {
        resizeQuickClosed = true
        setDraftWidth(side, null)
        void quickClose(side)
        void endResize()
        return
      }
      setDraftWidth(side, clampLayoutWidth(resizeStartWidth - (event.clientX - resizeStartX)))
      return
    }
    if (event.clientX < layoutWidthLimits.quickCloseThreshold) {
      resizeQuickClosed = true
      setDraftWidth(side, null)
      void quickClose(side)
      void endResize()
      return
    }
    setDraftWidth(side, clampLayoutWidth(resizeStartWidth + (event.clientX - resizeStartX)))
  }

  const startResize = (side: ResizeSide, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    draggingSide.value = side
    resizeStartX = event.clientX
    resizeStartWidth = getCurrentWidth(side)
    resizeQuickClosed = false
    setDraftWidth(side, resizeStartWidth)
    options.bodyClassList.add('layout-resizing')
    options.windowRef.addEventListener('mousemove', handleResizeMove)
    options.windowRef.addEventListener('mouseup', endResize)
  }

  const mount = () => {
    workspace.installShortcutRuntime()
    workspace.hydrateConfig()
    void workspace.refreshManagedAiSessions({ silent: true })
    stopDeepLink = options.clients.appRuntime.onDeepLink()?.((payload) => {
      applyDeepLinkPayload(payload)
    })
    stopKeyboardInteractiveRequest = options.clients.terminal.onTerminalKeyboardInteractiveRequest()?.(handleTerminalMfaRequest)
    stopKeyboardInteractiveResult = options.clients.terminal.onTerminalKeyboardInteractiveResult()?.(handleTerminalMfaResult)
    stopAiAgentSessionEvent = options.clients.managedAi.onAiAgentSessionEvent()?.((event: AiAgentSessionEvent) => {
      workspace.upsertManagedAiSession(event)
    })
    stopManagedAiSessionEvent = options.clients.managedAi.onManagedAiSessionEvent()?.(() => {
      workspace.refreshManagedAiSessionsDebounced()
    })
    stopManagedAiSessionFocusRequest = options.clients.managedAi.onManagedAiSessionFocusRequest()?.((request: ManagedAiSessionFocusRequest) => {
      void workspace.focusManagedAiSessionRequest(request)
    })
    void consumePendingDeepLinks()
  }

  const dispose = () => {
    stopDeepLink?.()
    stopKeyboardInteractiveRequest?.()
    stopKeyboardInteractiveResult?.()
    stopAiAgentSessionEvent?.()
    stopManagedAiSessionEvent?.()
    stopManagedAiSessionFocusRequest?.()
    options.windowRef.removeEventListener('mousemove', handleResizeMove)
    options.windowRef.removeEventListener('mouseup', endResize)
    options.bodyClassList.remove('layout-resizing')
    workspace.uninstallShortcutRuntime()
  }

  const applyCurrentLocale = (locale: SupportedLocale) => {
    options.applyLocale(locale)
  }

  return {
    appBackgroundStyle,
    applyCurrentLocale,
    cancelTerminalMfa,
    displayAgentsLeftWidth,
    displayLeftPanelWidth,
    displayRightPanelWidth,
    dispose,
    draggingSide,
    handleResizeMove,
    handleTerminalMfaRequest,
    handleTerminalMfaResult,
    hasLeftPane,
    hasRightPane,
    mount,
    setTerminalMfaInputRef,
    showAgentsLeftPane,
    showTerminalLeftPane,
    showTerminalPasswordRemember,
    showTerminalRightPane,
    startResize,
    submitTerminalMfa,
    terminalAuthDescription,
    terminalAuthPromptFallback,
    terminalAuthRequired,
    terminalAuthTitle,
    terminalMfaDialog,
    terminalMfaPrompts
  }
}

export const useAppShellRuntime = () => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const staticTextI18n = installStaticTextI18n({
    root: document.body,
    locale: () => locale.value
  })
  const runtime = createAppShellRuntime({
    workspace,
    t,
    applyLocale: applyDocumentLocale,
    clients: {
      appRuntime: appRuntimeClient,
      terminal: terminalClient,
      managedAi: managedAiClient
    },
    afterDomUpdate: nextTick,
    windowRef: window,
    bodyClassList: document.body.classList
  })

  onMounted(() => {
    runtime.mount()
    staticTextI18n.start()
  })
  onUnmounted(() => {
    staticTextI18n.dispose()
    runtime.dispose()
  })
  watch(
    locale,
    (nextLocale) => {
      runtime.applyCurrentLocale(nextLocale)
      staticTextI18n.refresh()
    },
    { immediate: true }
  )

  return {
    ...runtime,
    locale,
    t,
    workspace
  }
}

export type AppShellRuntime = ReturnType<typeof createAppShellRuntime>
export type { ResizeSide, TerminalMfaDialogState, TerminalMfaPrompt }
