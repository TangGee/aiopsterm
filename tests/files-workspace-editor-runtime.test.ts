import { describe, expect, it, vi } from 'vitest'
import { createFilesWorkspaceEditorRuntime, filesWorkspaceEditorLanguage } from '@/services/files/filesWorkspaceEditorRuntime'
import { resolveMonacoLanguageId } from '@/services/common/monacoRuntime'
import type { FileSessionInfo, FileTransferTask } from '@shared/contracts/files'

const transferTask = (input: Partial<FileTransferTask> & Pick<FileTransferTask, 'id'>): FileTransferTask => ({
  type: 'upload',
  name: input.id,
  source: '/tmp/unit',
  target: '/remote/unit',
  progress: 100,
  speed: '',
  status: 'success',
  ...input
})

const session = (input: Partial<FileSessionInfo> & Pick<FileSessionInfo, 'id' | 'kind'>): FileSessionInfo => ({
  label: input.id,
  host: input.kind === 'local' ? 'localhost' : '10.0.0.1',
  group: 'Default',
  rootPath: input.kind === 'local' ? '/' : '/home/unit',
  status: 'active',
  ...input
})

describe('filesWorkspaceEditorRuntime', () => {
  it('resolves registered Monaco languages by filename, pattern, longest extension, and first line', () => {
    const languages = [
      { id: 'dockerfile', filenames: ['Dockerfile'] },
      { id: 'typescript', extensions: ['.ts', '.d.ts'] },
      { id: 'javascript', extensions: ['.js'], firstLine: '^#!.*\\bnode' },
      { id: 'python', extensions: ['.py'], firstLine: '^#!/.*\\bpython[0-9.-]*\\b' },
      { id: 'yaml', filenamePatterns: ['*.workflow.yml'], extensions: ['.yml'] },
      { id: 'html', extensions: ['.html'] },
      { id: 'css', extensions: ['.css'] }
    ]

    expect(resolveMonacoLanguageId(languages, '/work/Dockerfile')).toBe('dockerfile')
    expect(resolveMonacoLanguageId(languages, '/work/types/app.d.ts')).toBe('typescript')
    expect(resolveMonacoLanguageId(languages, '/work/build.workflow.yml')).toBe('yaml')
    expect(resolveMonacoLanguageId(languages, '/work/index.html')).toBe('html')
    expect(resolveMonacoLanguageId(languages, '/work/styles.css')).toBe('css')
    expect(resolveMonacoLanguageId(languages, '/work/tool', '#!/usr/bin/env python3\nprint(1)')).toBe('python')
    expect(resolveMonacoLanguageId(languages, '/work/README.unknown', 'plain text')).toBe('plaintext')
  })

  it('opens files through injected bridge dependencies, reuses existing editors, and saves backend-confirmed content', async () => {
    const task = transferTask({ id: 'save-task' })
    const readFileContent = vi.fn(async () => ({
      ok: true,
      data: { content: 'initial', action: 'edit', size: 7, mtimeMs: 100 }
    }))
    const writeFileContent = vi.fn(async () => ({
      ok: true,
      data: { size: 8, mtimeMs: 200, task }
    }))
    const pushFileTransferTask = vi.fn((nextTask: FileTransferTask) => nextTask)
    const runtime = createFilesWorkspaceEditorRuntime({
      getFileSessions: () => [session({ id: 'local', kind: 'local' })],
      readFileContent: () => readFileContent,
      writeFileContent: () => writeFileContent,
      pushFileTransferTask,
      getViewport: () => ({ width: 1200, height: 800 })
    })

    expect(filesWorkspaceEditorLanguage('/work/app.ts')).toBe('typescript')
    expect(filesWorkspaceEditorLanguage('/work/component.tsx')).toBe('typescript')
    expect(filesWorkspaceEditorLanguage('/work/component.jsx')).toBe('javascript')
    expect(filesWorkspaceEditorLanguage('/work/index.html')).toBe('html')
    expect(filesWorkspaceEditorLanguage('/work/styles.scss')).toBe('scss')
    await runtime.openFileEditor({ filePath: '/work/app.ts', sessionId: 'local', sessionLabel: 'Local', host: 'localhost' })
    await runtime.openFileEditor({ filePath: '/work/app.ts', sessionId: 'local', sessionLabel: 'Local', host: 'localhost' })

    expect(readFileContent).toHaveBeenCalledTimes(1)
    expect(readFileContent).toHaveBeenCalledWith('/work/app.ts', expect.objectContaining({ kind: 'local', rootPath: '/', sessionId: 'local' }))
    expect(runtime.fileEditors.value).toHaveLength(1)
    const editor = runtime.fileEditors.value[0]
    expect(editor.content).toBe('initial')
    expect(editor.loading).toBe(false)
    expect(editorGeometryText(runtime.editorGeometry(editor))).toContain('width: 900px')

    runtime.updateFileEditorContent(editor, 'changed')
    expect(editor.dirty).toBe(true)
    await runtime.saveFileEditor(editor.key, false)

    expect(writeFileContent).toHaveBeenCalledWith(
      '/work/app.ts',
      'changed',
      expect.objectContaining({ expectedAction: 'edit', expectedMtimeMs: 100, expectedSize: 7 })
    )
    expect(pushFileTransferTask).toHaveBeenCalledWith(task)
    expect(editor.dirty).toBe(false)
    expect(editor.saved).toBe(true)
    expect(editor.originContent).toBe('changed')
  })

  it('keeps dirty editors open when backend save payloads are malformed', async () => {
    const runtime = createFilesWorkspaceEditorRuntime({
      getFileSessions: () => [session({ id: 'remote-1', kind: 'remote' })],
      readFileContent: () => async () => ({ ok: true, data: { content: 'initial', action: 'edit', size: 7, mtimeMs: 100 } }),
      writeFileContent: () => async () => ({ ok: true, data: { size: 8, mtimeMs: 200 } }),
      pushFileTransferTask: (task) => task,
      getViewport: () => ({ width: 1000, height: 700 })
    })

    await runtime.openFileEditor({ filePath: '/srv/app.log', sessionId: 'remote-1', sessionLabel: 'Remote', host: '10.0.0.1' })
    const editor = runtime.fileEditors.value[0]
    runtime.updateFileEditorContent(editor, 'changed')
    await runtime.saveFileEditor(editor.key, true)

    expect(editor.error).toBe('文件服务返回数据无效')
    expect(editor.dirty).toBe(true)
    expect(runtime.fileEditors.value).toContain(editor)
  })

  it('tracks close confirmation and pointer geometry without owning Files workspace composition', async () => {
    const runtime = createFilesWorkspaceEditorRuntime({
      getFileSessions: () => [session({ id: 'local', kind: 'local' })],
      readFileContent: () => async () => ({ ok: true, data: { content: 'initial', action: 'edit', size: 7, mtimeMs: 100 } }),
      writeFileContent: () => undefined,
      pushFileTransferTask: (task) => task,
      getViewport: () => ({ width: 900, height: 620 })
    })

    await runtime.openFileEditor({ filePath: '/tmp/readme.md', sessionId: 'local', sessionLabel: 'Local', host: 'localhost' })
    const editor = runtime.fileEditors.value[0]
    runtime.updateFileEditorContent(editor, 'changed')
    runtime.requestCloseFileEditor(editor.key)
    expect(runtime.closeConfirm).toMatchObject({ visible: true, editorKey: editor.key, filePath: '/tmp/readme.md' })

    const dragEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 })
    runtime.startEditorDrag(dragEvent, editor)
    runtime.handleEditorPointerMove(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
    runtime.stopEditorPointer()
    expect(editor.x).toBeGreaterThanOrEqual(12)
    expect(editor.y).toBeGreaterThanOrEqual(12)

    runtime.discardFileEditor(editor.key)
    expect(runtime.fileEditors.value).toHaveLength(0)
  })
})

const editorGeometryText = (geometry: Record<string, string>) => Object.entries(geometry).map(([key, value]) => `${key}: ${value}`).join('; ')
