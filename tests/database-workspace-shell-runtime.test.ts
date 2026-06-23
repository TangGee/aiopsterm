import { computed, ref, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseWorkspaceShellRuntime } from '@/services/databaseWorkspaceShellRuntime'
import { defaultEditorSettings } from '@/services/workspaceConfigRuntime'

const requireCallback = (callback: (() => void) | null) => {
  if (!callback) throw new Error('Expected callback to be registered')
  return callback
}

describe('databaseWorkspaceShellRuntime', () => {
  it('owns notices, clipboard fallback, and workspace style projection', async () => {
    let timeoutHandler: (() => void) | null = null
    const clearTimeoutFn = vi.fn()
    const editorSettings = ref({ ...defaultEditorSettings, fontSize: 18, tabSize: 2 })
    const runtime = createDatabaseWorkspaceShellRuntime(
      {
        editingGroupId: ref(null),
        editorSettings: computed(() => editorSettings.value)
      },
      {
        copyToClipboard: vi.fn(async () => false),
        setTimeoutFn: vi.fn((handler) => {
          timeoutHandler = handler
          return 7
        }),
        clearTimeoutFn
      }
    )

    runtime.showNotice('Saved')
    expect(runtime.notice.value).toBe('Saved')
    await expect(runtime.copyText('orders')).resolves.toBe(false)
    expect(clearTimeoutFn).toHaveBeenCalledWith(7)
    expect(runtime.notice.value).toBe('Copy failed')

    requireCallback(timeoutHandler)()
    expect(runtime.notice.value).toBe('')

    const style = runtime.createWorkspaceStyle({
      dbAiPaneOpen: ref(true),
      dbAiPaneWidth: ref(360),
      sqlEditorLineHeight: ref(21)
    })
    expect(style.value).toEqual({
      '--db-ai-pane-width': '360px',
      '--db-sql-editor-line-height': '21px',
      '--db-sql-editor-font-size': '18px',
      '--db-sql-editor-tab-size': '2'
    })
  })

  it('owns lifecycle hooks, menu close listener, cleanup, and group rename focus', async () => {
    const mountedCallbacks: Array<() => void> = []
    const unmountedCallbacks: Array<() => void> = []
    let clickHandler: (() => void) | null = null
    const hooks = {
      loadDatabaseCatalog: vi.fn(async () => 'loaded'),
      loadDbAiPaneState: vi.fn(),
      closeMenus: vi.fn(),
      stopSqlPaneResize: vi.fn(),
      stopDbAiPaneResize: vi.fn(),
      clearSqlDiagnoseTimers: vi.fn(),
      persistDbAiPaneState: vi.fn()
    }
    const input = {
      focus: vi.fn(),
      select: vi.fn()
    }
    const editingGroupId = ref<string | null>(null)
    const runtime = createDatabaseWorkspaceShellRuntime(
      {
        editingGroupId,
        editorSettings: computed(() => defaultEditorSettings)
      },
      {
        onMountedFn: (callback) => mountedCallbacks.push(callback),
        onBeforeUnmountFn: (callback) => unmountedCallbacks.push(callback),
        addWindowClickListener: vi.fn((handler) => {
          clickHandler = handler
        }),
        removeWindowClickListener: vi.fn((handler) => {
          if (clickHandler === handler) clickHandler = null
        }),
        queryGroupEditInput: () => input,
        nextTickFn: nextTick,
        clearTimeoutFn: vi.fn()
      }
    )

    runtime.registerLifecycle(hooks)
    expect(mountedCallbacks).toHaveLength(1)
    expect(unmountedCallbacks).toHaveLength(1)

    mountedCallbacks[0]()
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.loadDatabaseCatalog).toHaveBeenCalledTimes(1)
    expect(hooks.loadDbAiPaneState).toHaveBeenCalledTimes(1)

    requireCallback(clickHandler)()
    expect(hooks.closeMenus).toHaveBeenCalledTimes(1)

    editingGroupId.value = 'group-prod'
    await nextTick()
    await nextTick()
    expect(input.focus).toHaveBeenCalledTimes(1)
    expect(input.select).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]()
    expect(clickHandler).toBeNull()
    expect(hooks.stopSqlPaneResize).toHaveBeenCalledTimes(1)
    expect(hooks.stopDbAiPaneResize).toHaveBeenCalledTimes(1)
    expect(hooks.clearSqlDiagnoseTimers).toHaveBeenCalledTimes(1)
    expect(hooks.persistDbAiPaneState).toHaveBeenCalledTimes(1)
  })
})
