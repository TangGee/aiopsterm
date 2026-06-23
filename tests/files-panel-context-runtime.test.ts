import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createFilesPanelContextRuntime } from '@/services/filesPanelContextRuntime'
import type { FilesPanelGroup } from '@/services/filesPanelTreeRuntime'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'

const session = (input: Partial<FileSessionInfo> & Pick<FileSessionInfo, 'id' | 'label'>): FileSessionInfo => ({
  host: '10.0.0.1',
  group: 'Default',
  kind: 'remote',
  rootPath: '/home/unit',
  status: 'active',
  favorite: false,
  assetType: 'person',
  ...input
})

const folder: FileSessionFolderRecord = { uuid: 'folder-1', name: 'Folder 1', description: 'Unit', scope: 'bastion' }
const group: FilesPanelGroup = {
  key: 'folder-1',
  name: 'Folder 1',
  sessions: [],
  childGroups: [],
  originalCount: 0,
  type: 'custom-folder',
  folderUuid: 'folder-1'
}

describe('filesPanelContextRuntime', () => {
  it('owns Files panel context-menu positioning and target projection', () => {
    const activeTab = ref<'direct' | 'bastion'>('bastion')
    const selectedId = ref('')
    const clearSessionClickTimer = vi.fn()
    const runtime = createFilesPanelContextRuntime({
      activeTab,
      selectedId,
      getFileSessions: () => [session({ id: 'prod', label: 'Production' })],
      groupByKey: (key) => (key === group.key ? group : null),
      folderByGroup: (nextGroup) => (nextGroup?.folderUuid === folder.uuid ? folder : null),
      clearSessionClickTimer,
      getViewport: () => ({ width: 240, height: 160 })
    })

    runtime.openContextMenu(new MouseEvent('contextmenu', { clientX: 230, clientY: 150 }), 'prod')
    expect(clearSessionClickTimer).toHaveBeenCalled()
    expect(selectedId.value).toBe('prod')
    expect(runtime.contextMenu).toMatchObject({ visible: true, target: 'session', sessionId: 'prod' })
    expect(runtime.contextMenu.x).toBeLessThan(230)
    expect(runtime.contextMenu.y).toBeLessThan(150)
    expect(runtime.contextSession.value?.id).toBe('prod')
    expect(runtime.contextMenuOptions.value).toMatchObject({ favorite: true, comment: true, move: true })

    runtime.openFolderContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), 'folder-1')
    expect(runtime.contextMenu).toMatchObject({ visible: true, target: 'folder', folderUuid: 'folder-1', sessionId: '' })
    expect(runtime.contextFolder.value).toEqual(folder)
    expect(runtime.contextMenuOptions.value).toMatchObject({ editFolder: true, deleteFolder: true })

    runtime.closeContextMenu()
    expect(runtime.contextMenu).toMatchObject({ visible: false, target: '', sessionId: '', folderUuid: '' })
  })

  it('closes the menu when a target has no available actions', () => {
    const runtime = createFilesPanelContextRuntime({
      activeTab: ref('direct'),
      selectedId: ref(''),
      getFileSessions: () => [session({ id: 'local', label: 'Local', kind: 'local', favorite: undefined, assetType: 'local' })],
      groupByKey: () => null,
      folderByGroup: () => null,
      clearSessionClickTimer: vi.fn()
    })
    runtime.contextMenu.visible = true

    runtime.openContextMenu(new MouseEvent('contextmenu'), 'local')

    expect(runtime.contextMenu.visible).toBe(false)
  })
})
