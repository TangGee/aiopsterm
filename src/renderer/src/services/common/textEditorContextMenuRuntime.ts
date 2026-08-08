import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { useI18n } from '@/i18n'
import { copyTextToClipboard, readTextFromClipboard } from '@/services/app/clipboardRuntime'

export type TextEditorContextMenuIcon =
  | 'align'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'play'
  | 'redo'
  | 'replace'
  | 'runAll'
  | 'save'
  | 'search'
  | 'selectAll'
  | 'undo'

export type TextEditorContextMenuPosition = { x: number; y: number }

export type TextEditorContextMenuItem = {
  id: string
  label: string
  icon: TextEditorContextMenuIcon
  group: string
  shortcut?: string
  disabled?: boolean
}

type MonacoEditor = monaco.editor.IStandaloneCodeEditor

type TextEditorContextMenuOptions = {
  getEditor: () => MonacoEditor | null
  isReadonly?: () => boolean
  canSave?: () => boolean
  onSave?: () => void | Promise<void>
  onFind?: (replace: boolean) => void | Promise<void>
  extraItems?: () => TextEditorContextMenuItem[]
  onExtraAction?: (action: string) => void | Promise<void>
}

type SelectionSnapshot = monaco.IRange

const modelCanUndo = (model: monaco.editor.ITextModel | null | undefined) =>
  typeof model?.canUndo === 'function' && model.canUndo()

const modelCanRedo = (model: monaco.editor.ITextModel | null | undefined) =>
  typeof model?.canRedo === 'function' && model.canRedo()

const modelHasText = (model: monaco.editor.ITextModel | null | undefined) => {
  if (!model) return false
  if (typeof model.getValueLength === 'function') return model.getValueLength() > 0
  if (typeof model.getValue === 'function') return model.getValue().length > 0
  return true
}

const selectionSnapshotFromEditor = (editor: MonacoEditor): SelectionSnapshot | null => {
  const selection = editor.getSelection()
  if (!selection) return null
  return {
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber,
    endColumn: selection.endColumn
  }
}

const selectionIsEmpty = (selection: SelectionSnapshot | null) =>
  !selection || (
    selection.startLineNumber === selection.endLineNumber
    && selection.startColumn === selection.endColumn
  )

export const textEditorShortcutModifier = () =>
  typeof navigator !== 'undefined' && /mac/i.test(String(navigator.platform || '')) ? '⌘' : 'Ctrl+'

export const useTextEditorContextMenu = (options: TextEditorContextMenuOptions) => {
  const { t } = useI18n()
  const menu = reactive({ visible: false, x: 0, y: 0 })
  const revision = ref(0)
  let selectionSnapshot: SelectionSnapshot | null = null

  const readonly = () => Boolean(options.isReadonly?.())
  const modifier = textEditorShortcutModifier()
  const replaceShortcut = modifier === '⌘' ? '⌥⌘F' : 'Ctrl+H'

  const items = computed<TextEditorContextMenuItem[]>(() => {
    revision.value
    const editor = options.getEditor()
    const model = editor?.getModel()
    const emptySelection = selectionIsEmpty(selectionSnapshot)
    const base: TextEditorContextMenuItem[] = [
      { id: 'undo', label: t('editor.context.undo'), icon: 'undo', group: 'history', shortcut: `${modifier}Z`, disabled: readonly() || !modelCanUndo(model) },
      { id: 'redo', label: t('editor.context.redo'), icon: 'redo', group: 'history', shortcut: modifier === '⌘' ? '⇧⌘Z' : 'Ctrl+Y', disabled: readonly() || !modelCanRedo(model) },
      { id: 'cut', label: t('editor.context.cut'), icon: 'cut', group: 'clipboard', shortcut: `${modifier}X`, disabled: readonly() || emptySelection },
      { id: 'copy', label: t('editor.context.copy'), icon: 'copy', group: 'clipboard', shortcut: `${modifier}C`, disabled: emptySelection },
      { id: 'paste', label: t('editor.context.paste'), icon: 'paste', group: 'clipboard', shortcut: `${modifier}V`, disabled: readonly() },
      { id: 'selectAll', label: t('editor.context.selectAll'), icon: 'selectAll', group: 'selection', shortcut: `${modifier}A`, disabled: !modelHasText(model) },
      { id: 'find', label: t('editor.context.find'), icon: 'search', group: 'find', shortcut: `${modifier}F`, disabled: !model },
      { id: 'replace', label: t('editor.context.replace'), icon: 'replace', group: 'find', shortcut: replaceShortcut, disabled: readonly() || !model }
    ]
    if (options.onSave) {
      base.push({
        id: 'save',
        label: t('editor.context.save'),
        icon: 'save',
        group: 'file',
        shortcut: `${modifier}S`,
        disabled: readonly() || options.canSave?.() === false
      })
    }
    return [...base, ...(options.extraItems?.() || [])]
  })

  const open = (event: MouseEvent) => {
    const editor = options.getEditor()
    if (!editor) return
    event.preventDefault()
    event.stopPropagation()
    selectionSnapshot = selectionSnapshotFromEditor(editor)
    menu.x = event.clientX
    menu.y = event.clientY
    menu.visible = true
    revision.value += 1
  }

  const close = (refocus = false) => {
    if (!menu.visible) return
    menu.visible = false
    if (refocus) options.getEditor()?.focus()
  }

  const restoreSelection = (editor: MonacoEditor) => {
    if (selectionSnapshot) editor.setSelection(selectionSnapshot)
    editor.focus()
  }

  const replaceSelection = (editor: MonacoEditor, text: string, source: string) => {
    const model = editor.getModel()
    if (!model || !selectionSnapshot) return
    const startOffset = model.getOffsetAt({
      lineNumber: selectionSnapshot.startLineNumber,
      column: selectionSnapshot.startColumn
    })
    editor.pushUndoStop()
    editor.executeEdits(source, [{ range: selectionSnapshot, text, forceMoveMarkers: true }])
    editor.pushUndoStop()
    const cursor = model.getPositionAt(startOffset + text.length)
    editor.setPosition(cursor)
    selectionSnapshot = selectionSnapshotFromEditor(editor)
  }

  const execute = async (action: string) => {
    const editor = options.getEditor()
    const model = editor?.getModel()
    if (!editor || !model) {
      close()
      return
    }
    restoreSelection(editor)
    try {
      if (action === 'undo' && !readonly() && modelCanUndo(model)) await model.undo()
      else if (action === 'redo' && !readonly() && modelCanRedo(model)) await model.redo()
      else if (action === 'copy' && selectionSnapshot && !selectionIsEmpty(selectionSnapshot)) {
        await copyTextToClipboard(model.getValueInRange(selectionSnapshot))
      }
      else if (action === 'cut' && !readonly() && selectionSnapshot && !selectionIsEmpty(selectionSnapshot)) {
        const copied = await copyTextToClipboard(model.getValueInRange(selectionSnapshot))
        if (copied) replaceSelection(editor, '', 'aiopsterm-context-cut')
      }
      else if (action === 'paste' && !readonly()) {
        const clipboard = await readTextFromClipboard()
        if (clipboard.ok) replaceSelection(editor, clipboard.text, 'aiopsterm-context-paste')
      }
      else if (action === 'selectAll') {
        editor.setSelection(model.getFullModelRange())
        selectionSnapshot = selectionSnapshotFromEditor(editor)
      }
      else if (action === 'find') {
        if (options.onFind) await options.onFind(false)
        else await editor.getAction('actions.find')?.run()
      }
      else if (action === 'replace' && !readonly()) {
        if (options.onFind) await options.onFind(true)
        else await editor.getAction('editor.action.startFindReplaceAction')?.run()
      }
      else if (action === 'save' && !readonly() && options.canSave?.() !== false) await options.onSave?.()
      else await options.onExtraAction?.(action)
    } finally {
      close()
    }
  }

  const closeFromPointer = () => close()
  const closeFromViewport = () => close()
  const closeFromKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !menu.visible) return
    event.preventDefault()
    close(true)
  }

  onMounted(() => {
    document.addEventListener('pointerdown', closeFromPointer)
    document.addEventListener('keydown', closeFromKey, true)
    window.addEventListener('resize', closeFromViewport)
    window.addEventListener('scroll', closeFromViewport, true)
    window.addEventListener('blur', closeFromViewport)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', closeFromPointer)
    document.removeEventListener('keydown', closeFromKey, true)
    window.removeEventListener('resize', closeFromViewport)
    window.removeEventListener('scroll', closeFromViewport, true)
    window.removeEventListener('blur', closeFromViewport)
  })

  return { menu, items, open, close, execute }
}
