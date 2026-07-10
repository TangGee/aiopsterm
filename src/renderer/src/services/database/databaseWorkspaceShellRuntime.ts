import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from 'vue'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import type { EditorSettings } from '@/services/settings/workspaceConfigRuntime'

type DatabaseWorkspaceShellState = {
  editingGroupId: Ref<string | null>
  editorSettings: ComputedRef<EditorSettings>
}

type DatabaseWorkspaceShellDeps = {
  copyToClipboard?: (text: string) => Promise<boolean>
  setTimeoutFn?: (handler: () => void, timeout: number) => number
  clearTimeoutFn?: (timer: number) => void
  queryGroupEditInput?: () => Pick<HTMLInputElement, 'focus' | 'select'> | null
  nextTickFn?: () => Promise<void>
  onMountedFn?: (callback: () => void) => void
  onActivatedFn?: (callback: () => void) => void
  onDeactivatedFn?: (callback: () => void) => void
  onBeforeUnmountFn?: (callback: () => void) => void
  addWindowClickListener?: (handler: () => void) => void
  removeWindowClickListener?: (handler: () => void) => void
  noticeDurationMs?: number
}

type DatabaseWorkspaceStyleState = {
  dbAiPaneOpen: Ref<boolean> | ComputedRef<boolean>
  dbAiPaneWidth: Ref<number> | ComputedRef<number>
  sqlEditorLineHeight: Ref<number> | ComputedRef<number>
}

type DatabaseWorkspaceLifecycleHooks = {
  loadDatabaseCatalog: () => Promise<unknown>
  loadDbAiPaneState: () => unknown
  closeMenus: () => void
  stopSqlPaneResize: () => void
  stopDbAiPaneResize: () => void
  clearSqlDiagnoseTimers: () => void
  persistDbAiPaneState: () => unknown
}

export const createDatabaseWorkspaceShellRuntime = (
  { editingGroupId, editorSettings }: DatabaseWorkspaceShellState,
  deps: DatabaseWorkspaceShellDeps = {}
) => {
  const copyToClipboard = deps.copyToClipboard ?? copyTextToClipboard
  const setTimeoutFn = deps.setTimeoutFn ?? ((handler, timeout) => window.setTimeout(handler, timeout))
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((timer) => window.clearTimeout(timer))
  const queryGroupEditInput = deps.queryGroupEditInput ?? (() => document.querySelector<HTMLInputElement>('.db-tree-edit'))
  const nextTickFn = deps.nextTickFn ?? nextTick
  const onMountedFn = deps.onMountedFn ?? onMounted
  const onActivatedFn = deps.onActivatedFn ?? onActivated
  const onDeactivatedFn = deps.onDeactivatedFn ?? onDeactivated
  const onBeforeUnmountFn = deps.onBeforeUnmountFn ?? onBeforeUnmount
  const addWindowClickListener = deps.addWindowClickListener ?? ((handler) => window.addEventListener('click', handler))
  const removeWindowClickListener = deps.removeWindowClickListener ?? ((handler) => window.removeEventListener('click', handler))
  const noticeDurationMs = deps.noticeDurationMs ?? 1800

  const notice = ref('')
  const noticeTimer = ref<number | null>(null)

  const clearNoticeTimer = () => {
    if (!noticeTimer.value) return
    clearTimeoutFn(noticeTimer.value)
    noticeTimer.value = null
  }

  const showNotice = (text: string) => {
    notice.value = text
    clearNoticeTimer()
    noticeTimer.value = setTimeoutFn(() => {
      notice.value = ''
      noticeTimer.value = null
    }, noticeDurationMs)
  }

  const copyText = async (value: string) => {
    const text = String(value ?? '')
    const copied = await copyToClipboard(text)
    if (!copied) showNotice('Copy failed')
    return copied
  }

  const stopEditingGroupFocusWatch = watch(editingGroupId, async (id) => {
    if (!id) return
    await nextTickFn()
    const input = queryGroupEditInput()
    input?.focus()
    input?.select()
  })

  const createWorkspaceStyle = ({ dbAiPaneOpen, dbAiPaneWidth, sqlEditorLineHeight }: DatabaseWorkspaceStyleState) =>
    computed(() => ({
      '--db-ai-pane-width': dbAiPaneOpen.value ? `${dbAiPaneWidth.value}px` : '0px',
      '--db-sql-editor-line-height': `${sqlEditorLineHeight.value}px`,
      '--db-sql-editor-font-size': `${editorSettings.value.fontSize}px`,
      '--db-sql-editor-tab-size': `${editorSettings.value.tabSize}`
    }))

  const registerLifecycle = (hooks: DatabaseWorkspaceLifecycleHooks) => {
    let surfaceActive = false
    const handleWindowClick = () => {
      hooks.closeMenus()
    }

    const activateSurface = () => {
      if (surfaceActive) return
      surfaceActive = true
      addWindowClickListener(handleWindowClick)
    }

    const deactivateSurface = () => {
      if (!surfaceActive) return
      surfaceActive = false
      hooks.closeMenus()
      hooks.stopSqlPaneResize()
      hooks.stopDbAiPaneResize()
      removeWindowClickListener(handleWindowClick)
      hooks.persistDbAiPaneState()
    }

    onMountedFn(() => {
      void hooks.loadDatabaseCatalog().finally(() => hooks.loadDbAiPaneState())
      activateSurface()
    })

    onActivatedFn(activateSurface)
    onDeactivatedFn(deactivateSurface)

    onBeforeUnmountFn(() => {
      deactivateSurface()
      hooks.clearSqlDiagnoseTimers()
      clearNoticeTimer()
      stopEditingGroupFocusWatch()
    })
  }

  const dispose = () => {
    clearNoticeTimer()
    stopEditingGroupFocusWatch()
  }

  return {
    notice,
    showNotice,
    copyText,
    createWorkspaceStyle,
    registerLifecycle,
    dispose
  }
}

export type DatabaseWorkspaceShellRuntime = ReturnType<typeof createDatabaseWorkspaceShellRuntime>
