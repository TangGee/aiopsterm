import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectFileEditor from '@/components/files/ProjectFileEditor.vue'
import {
  flushProjectFileEditor,
  resetProjectFileEditorSaveRegistryForTests
} from '@/services/files/projectFileEditorSaveRegistry'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { ProjectFileWatchEvent } from '@shared/contracts/projectFiles'

const projectFiles = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  startWatch: vi.fn(),
  stopWatch: vi.fn(),
  listeners: [] as Array<(event: ProjectFileWatchEvent) => void>
}))

vi.mock('@/services/files/projectFilesClient', () => ({
  projectFilesClient: {
    readFile: () => projectFiles.read,
    writeFile: () => projectFiles.write,
    startWatch: () => projectFiles.startWatch,
    stopWatch: () => projectFiles.stopWatch,
    onWatchEvent: () => (listener: (event: ProjectFileWatchEvent) => void) => {
      projectFiles.listeners.push(listener)
      return () => {
        const index = projectFiles.listeners.indexOf(listener)
        if (index >= 0) projectFiles.listeners.splice(index, 1)
      }
    }
  }
}))

const EditorStub = defineComponent({
  props: ['modelValue', 'readonly', 'language', 'filePath', 'minimap'],
  emits: ['update:modelValue', 'save', 'blur'],
  template: `
    <div
      data-testid="editor-stub"
      :data-file-path="filePath"
      :data-minimap="String(minimap)"
    >
      <textarea
        data-testid="editor-input"
        :value="modelValue"
        :readonly="readonly"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <button data-testid="editor-save" @click="$emit('save')" />
      <button data-testid="editor-blur" @click="$emit('blur')" />
    </div>
  `
})

const panel = (): TerminalPanel => ({
  id: 'project-panel-1',
  title: 'main.ts',
  cwd: '/work/project',
  kind: 'project-file',
  status: 'ready',
  output: '',
  outputSegments: [],
  projectFile: {
    source: 'codex',
    sessionId: 'session-1',
    projectRoot: '/work/project',
    relativePath: 'src/main.ts'
  }
})

const readResult = (content: string, contentHash: string, mtimeMs: number) => ({
  ok: true,
  data: {
    projectRoot: '/work/project',
    relativePath: 'src/main.ts',
    content,
    contentHash,
    size: content.length,
    mtimeMs
  }
})

const writeResult = (content: string, contentHash: string, mtimeMs: number) => ({
  ok: true,
  data: {
    projectRoot: '/work/project',
    relativePath: 'src/main.ts',
    contentHash,
    size: content.length,
    mtimeMs,
    created: false
  }
})

const mountEditor = async (targetPanel = panel()) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ProjectFileEditor, {
    props: { panel: targetPanel },
    global: {
      plugins: [pinia],
      stubs: { FilesMonacoEditor: EditorStub }
    }
  })
  await flushPromises()
  return { wrapper, targetPanel }
}

describe('ProjectFileEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetProjectFileEditorSaveRegistryForTests()
    projectFiles.read.mockReset()
    projectFiles.write.mockReset()
    projectFiles.startWatch.mockReset()
    projectFiles.stopWatch.mockReset()
    projectFiles.listeners.splice(0)
    projectFiles.read.mockResolvedValue(readResult('initial\n', 'hash-initial', 100))
    projectFiles.write.mockImplementation(async (input: { content: string }) =>
      writeResult(input.content, `hash-${input.content}`, 200)
    )
    projectFiles.startWatch.mockResolvedValue({ ok: true, data: { watched: true, fallback: false } })
    projectFiles.stopWatch.mockResolvedValue({ ok: true, data: { watched: false, fallback: false } })
  })

  afterEach(() => {
    resetProjectFileEditorSaveRegistryForTests()
    vi.useRealTimers()
  })

  it('saves only after a real editor change and uses the loaded content revision', async () => {
    const { wrapper, targetPanel } = await mountEditor()
    expect(projectFiles.write).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="editor-stub"]').attributes('data-file-path')).toBe('src/main.ts')
    expect(wrapper.get('[data-testid="editor-stub"]').attributes('data-minimap')).toBe('false')

    await wrapper.get('[data-testid="editor-input"]').setValue('changed\n')
    expect(targetPanel.projectFile?.dirty).toBe(true)
    expect(wrapper.find('footer').text()).toContain('Unsaved')
    await vi.advanceTimersByTimeAsync(999)
    expect(projectFiles.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(projectFiles.write).toHaveBeenCalledWith(expect.objectContaining({
      content: 'changed\n',
      expectedMtimeMs: 100,
      expectedSize: 8,
      expectedContentHash: 'hash-initial',
      overwrite: false
    }))
    expect(targetPanel.projectFile?.dirty).toBe(false)
    expect(wrapper.find('footer').text()).toContain('Saved')
  })

  it('keeps edits made during a save dirty and writes them as a later snapshot', async () => {
    let finishFirstSave!: (value: ReturnType<typeof writeResult>) => void
    const firstSave = new Promise<ReturnType<typeof writeResult>>((resolve) => {
      finishFirstSave = resolve
    })
    projectFiles.write
      .mockImplementationOnce(() => firstSave)
      .mockImplementationOnce(async (input: { content: string }) => writeResult(input.content, 'hash-second', 300))
    const { wrapper } = await mountEditor()

    await wrapper.get('[data-testid="editor-input"]').setValue('first edit\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(projectFiles.write).toHaveBeenCalledTimes(1)
    expect(projectFiles.write.mock.calls[0][0].content).toBe('first edit\n')

    await wrapper.get('[data-testid="editor-input"]').setValue('second edit\n')
    finishFirstSave(writeResult('first edit\n', 'hash-first', 200))
    await flushPromises()
    expect(wrapper.find('footer').text()).toContain('Unsaved')

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(projectFiles.write).toHaveBeenCalledTimes(2)
    expect(projectFiles.write.mock.calls[1][0]).toEqual(expect.objectContaining({
      content: 'second edit\n',
      expectedContentHash: 'hash-first'
    }))
  })

  it('cancels pending autosave when an Agent changes a dirty file', async () => {
    const { wrapper } = await mountEditor()
    await wrapper.get('[data-testid="editor-input"]').setValue('local edit\n')

    projectFiles.listeners[0]?.({
      watchId: 'project-file-editor-project-panel-1',
      projectRoot: '/work/project',
      relativePath: 'src/main.ts',
      kind: 'modified',
      changedAt: Date.now()
    })
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(projectFiles.write).not.toHaveBeenCalled()
    expect(wrapper.find('.project-file-conflict').text()).toContain('changed on disk')
    expect(wrapper.find('footer').text()).toContain('Conflict')
  })

  it('flushes pending content through the panel close registry', async () => {
    const { wrapper } = await mountEditor()
    await wrapper.get('[data-testid="editor-input"]').setValue('close flush\n')

    await expect(flushProjectFileEditor('project-panel-1')).resolves.toBe(true)
    expect(projectFiles.write).toHaveBeenCalledTimes(1)
    expect(projectFiles.write).toHaveBeenCalledWith(expect.objectContaining({ content: 'close flush\n' }))
  })

  it('rebinds its file watcher after an open file is renamed or moved', async () => {
    const { wrapper, targetPanel } = await mountEditor()
    expect(projectFiles.startWatch).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'src/main.ts',
      watchId: 'project-file-editor-project-panel-1'
    }))

    await wrapper.setProps({
      panel: {
        ...targetPanel,
        projectFile: {
          ...targetPanel.projectFile!,
          relativePath: 'lib/renamed.ts'
        }
      }
    })
    await flushPromises()

    expect(projectFiles.stopWatch).toHaveBeenCalledWith('project-file-editor-project-panel-1')
    expect(projectFiles.startWatch).toHaveBeenLastCalledWith(expect.objectContaining({
      relativePath: 'lib/renamed.ts',
      watchId: 'project-file-editor-project-panel-1'
    }))
  })
})
