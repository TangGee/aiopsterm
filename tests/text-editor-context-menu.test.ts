import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextEditorContextMenu from '@/components/common/TextEditorContextMenu.vue'
import {
  useTextEditorContextMenu,
  type TextEditorContextMenuItem
} from '@/services/common/textEditorContextMenuRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const clipboard = vi.hoisted(() => ({
  copy: vi.fn(),
  read: vi.fn()
}))

vi.mock('@/services/app/clipboardRuntime', () => ({
  copyTextToClipboard: clipboard.copy,
  readTextFromClipboard: clipboard.read
}))

type Range = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

const createEditor = (initialValue = 'hello world') => {
  let value = initialValue
  let selection: Range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }
  let undoValue = ''
  let redoValue = ''
  const undo = vi.fn(() => {
    if (!undoValue) return
    redoValue = value
    value = undoValue
    undoValue = ''
  })
  const redo = vi.fn(() => {
    if (!redoValue) return
    undoValue = value
    value = redoValue
    redoValue = ''
  })
  const find = vi.fn()
  const replace = vi.fn()

  const model = {
    canUndo: () => Boolean(undoValue),
    canRedo: () => Boolean(redoValue),
    undo,
    redo,
    getValueLength: () => value.length,
    getValueInRange: (range: Range) => value.slice(range.startColumn - 1, range.endColumn - 1),
    getOffsetAt: (position: { column: number }) => position.column - 1,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: value.length + 1 })
  }
  const editor = {
    getModel: () => model,
    getSelection: () => selection,
    setSelection: (range: Range) => { selection = { ...range } },
    setPosition: (position: { lineNumber: number; column: number }) => {
      selection = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      }
    },
    focus: vi.fn(),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn((_source: string, edits: Array<{ range: Range; text: string }>) => {
      const edit = edits[0]
      undoValue = value
      redoValue = ''
      value = `${value.slice(0, edit.range.startColumn - 1)}${edit.text}${value.slice(edit.range.endColumn - 1)}`
      return true
    }),
    getAction: (id: string) => ({ run: id === 'actions.find' ? find : replace })
  }

  return {
    editor,
    model,
    find,
    replace,
    undo,
    redo,
    value: () => value,
    selection: () => selection,
    setSelection: (next: Range) => { selection = next }
  }
}

const mountHarness = (options?: { readonly?: boolean; extraItems?: TextEditorContextMenuItem[] }) => {
  const fake = createEditor()
  const readonly = ref(Boolean(options?.readonly))
  const save = vi.fn()
  const extra = vi.fn()
  const pinia = createPinia()
  setActivePinia(pinia)
  useWorkspaceStore().config.language = 'zh-CN'
  const Harness = defineComponent({
    components: { TextEditorContextMenu },
    setup() {
      const editorMenu = useTextEditorContextMenu({
        getEditor: () => fake.editor as never,
        isReadonly: () => readonly.value,
        onSave: save,
        extraItems: () => options?.extraItems || [],
        onExtraAction: extra
      })
      return { editorMenu }
    },
    template: `
      <button data-testid="target" @contextmenu="editorMenu.open($event)">target</button>
      <TextEditorContextMenu
        :visible="editorMenu.menu.visible"
        :x="editorMenu.menu.x"
        :y="editorMenu.menu.y"
        :items="editorMenu.items.value"
        @select="editorMenu.execute"
        @close="editorMenu.close(true)"
      />
    `
  })
  const wrapper = mount(Harness, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, fake, readonly, save, extra }
}

const openMenu = async (wrapper: ReturnType<typeof mountHarness>['wrapper']) => {
  await wrapper.get('[data-testid="target"]').trigger('contextmenu', { clientX: 120, clientY: 80 })
  await flushPromises()
  return document.querySelector<HTMLElement>('[data-testid="text-editor-context-menu"]')!
}

const choose = async (menu: HTMLElement, action: string) => {
  menu.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!.click()
  await flushPromises()
}

describe('text editor context menu', () => {
  beforeEach(() => {
    clipboard.copy.mockReset()
    clipboard.copy.mockResolvedValue(true)
    clipboard.read.mockReset()
    clipboard.read.mockResolvedValue({ ok: true, text: 'paste' })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('copies, cuts and pastes the captured Monaco selection', async () => {
    const { wrapper, fake } = mountHarness()
    let menu = await openMenu(wrapper)
    expect(menu.textContent).toContain('撤销')
    expect(menu.textContent).toContain('复制')
    await choose(menu, 'copy')
    expect(clipboard.copy).toHaveBeenCalledWith('hello')

    menu = await openMenu(wrapper)
    await choose(menu, 'cut')
    expect(fake.value()).toBe(' world')
    expect(fake.editor.executeEdits).toHaveBeenCalledWith(
      'aiopsterm-context-cut',
      expect.arrayContaining([expect.objectContaining({ text: '' })])
    )

    menu = await openMenu(wrapper)
    await choose(menu, 'paste')
    expect(fake.value()).toBe('paste world')
    expect(fake.model.canUndo()).toBe(true)
    wrapper.unmount()
  })

  it('disables writing actions in readonly editors while keeping copy and find available', async () => {
    const { wrapper } = mountHarness({ readonly: true })
    const menu = await openMenu(wrapper)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="cut"]')!.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="paste"]')!.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="replace"]')!.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="save"]')!.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="copy"]')!.disabled).toBe(false)
    expect(menu.querySelector<HTMLButtonElement>('button[data-action="find"]')!.disabled).toBe(false)
    wrapper.unmount()
  })

  it('supports select all, find, replace, save and editor-specific actions', async () => {
    const runItem: TextEditorContextMenuItem = {
      id: 'sql-run-current',
      label: '运行当前语句',
      icon: 'play',
      group: 'sql'
    }
    const { wrapper, fake, save, extra } = mountHarness({ extraItems: [runItem] })

    let menu = await openMenu(wrapper)
    await choose(menu, 'selectAll')
    expect(fake.selection()).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 })

    menu = await openMenu(wrapper)
    await choose(menu, 'find')
    expect(fake.find).toHaveBeenCalledOnce()

    menu = await openMenu(wrapper)
    await choose(menu, 'replace')
    expect(fake.replace).toHaveBeenCalledOnce()

    menu = await openMenu(wrapper)
    await choose(menu, 'save')
    expect(save).toHaveBeenCalledOnce()

    menu = await openMenu(wrapper)
    await choose(menu, 'sql-run-current')
    expect(extra).toHaveBeenCalledWith('sql-run-current')
    wrapper.unmount()
  })

  it('focuses enabled items, supports arrow navigation and closes on Escape', async () => {
    const { wrapper, fake } = mountHarness()
    const menu = await openMenu(wrapper)
    const enabled = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    expect(document.activeElement).toBe(enabled[0])
    enabled[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(enabled[1])
    enabled[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[data-testid="text-editor-context-menu"]')).toBeNull()
    expect(fake.editor.focus).toHaveBeenCalled()
    wrapper.unmount()
  })
})
