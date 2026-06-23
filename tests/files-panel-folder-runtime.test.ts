import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createFilesPanelFolderRuntime } from '@/services/filesPanelFolderRuntime'
import type { FilesPanelContextMenuState } from '@/services/filesPanelContextRuntime'
import type { FilesPanelGroup } from '@/services/filesPanelTreeRuntime'
import type { FileSessionFolderRecord, FileSessionFolderSaveInput, FileSessionInfo, FileSessionPatch } from '@shared/contracts/files'

const folder = (input: Partial<FileSessionFolderRecord> & Pick<FileSessionFolderRecord, 'uuid' | 'name'>): FileSessionFolderRecord => ({
  description: '',
  scope: 'bastion',
  ...input
})

const session = (input: Partial<FileSessionInfo> & Pick<FileSessionInfo, 'id' | 'label'>): FileSessionInfo => ({
  host: '10.0.0.1',
  group: 'Default',
  kind: 'remote',
  rootPath: '/home/unit',
  status: 'active',
  assetType: 'person',
  ...input
})

const group = (input: Partial<FilesPanelGroup> & Pick<FilesPanelGroup, 'key' | 'name'>): FilesPanelGroup => ({
  sessions: [],
  childGroups: [],
  originalCount: 0,
  type: 'custom-folder',
  ...input
})

describe('filesPanelFolderRuntime', () => {
  it('owns Files panel folder create, edit, move, delete confirmation, and expansion repair', async () => {
    const folders = [folder({ uuid: 'folder-1', name: 'Folder 1', description: 'old' })]
    const sessions = [session({ id: 'prod', label: 'Production', folderUuid: 'folder-1' })]
    const sourceGroups = ref([group({ key: 'folder-1', name: 'Folder 1', folderUuid: 'folder-1', sessions })])
    const contextMenu: FilesPanelContextMenuState = { visible: true, x: 0, y: 0, target: 'folder', sessionId: '', folderUuid: 'folder-1' }
    const savedFolders: FileSessionFolderSaveInput[] = []
    const removedExpanded: string[] = []
    const replacedExpanded: Array<[string, string]> = []
    const updates: Array<{ id: string; patch: FileSessionPatch }> = []
    const runtime = createFilesPanelFolderRuntime({
      activeTab: ref('bastion'),
      contextMenu,
      contextFolder: computed(() => folders[0]),
      moveModal: { visible: true, sessionId: 'prod' },
      currentFolders: computed(() => folders),
      bastionFolders: computed(() => folders),
      organizationSessions: computed(() => [session({ id: 'org-1', label: 'Org', assetType: 'organization', organizationId: 'org-1' })]),
      sourceGroups: computed(() => sourceGroups.value),
      getFileSessions: () => sessions,
      updateFileSession: vi.fn(async (id, patch) => {
        updates.push({ id, patch })
        Object.assign(sessions[0], patch)
        return sessions[0]
      }),
      saveFileSessionFolder: vi.fn(async (nextFolder) => {
        savedFolders.push(nextFolder)
        const saved = folder({ uuid: nextFolder.uuid || 'folder-new', name: nextFolder.name, description: nextFolder.description || '', scope: nextFolder.scope })
        folders[0] = saved
        return saved
      }),
      deleteFileSessionFolder: vi.fn(async () => true),
      closeMoveModal: vi.fn(),
      removeExpandedGroup: vi.fn(async (key) => {
        removedExpanded.push(key)
        return true
      }),
      replaceExpandedGroup: vi.fn(async (oldKey, newKey) => {
        replacedExpanded.push([oldKey, newKey])
        return true
      })
    })

    await runtime.moveAssetToFolder('folder-1')
    expect(updates.at(-1)).toEqual({ id: 'prod', patch: { folderUuid: 'folder-1', organizationId: 'org-1' } })

    runtime.createFolderFromMoveModal()
    runtime.createFolderForm.name = ''
    await runtime.saveCreatedFolder()
    expect(runtime.folderFormError.value).toBe('请输入文件夹名称')
    runtime.createFolderForm.name = 'New Folder'
    runtime.createFolderForm.description = 'new'
    await runtime.saveCreatedFolder()
    expect(savedFolders.at(-1)).toMatchObject({ name: 'New Folder', description: 'new', scope: 'bastion' })
    expect(runtime.createFolderModal.visible).toBe(false)

    runtime.editContextFolder()
    expect(runtime.editFolderModal.visible).toBe(true)
    runtime.editFolderForm.name = 'Renamed'
    await runtime.saveEditedFolder()
    expect(savedFolders.at(-1)).toMatchObject({ uuid: 'folder-new', name: 'Renamed' })

    runtime.deleteContextFolder()
    expect(runtime.deleteFolderModal).toMatchObject({ visible: true, folderUuid: 'folder-new' })
    sourceGroups.value = [group({ key: 'folder-new', name: 'Renamed', folderUuid: 'folder-new', sessions })]
    await runtime.confirmDeleteFolder()
    expect(removedExpanded).toEqual(['folder-new'])
    expect(runtime.deleteFolderModal.visible).toBe(false)
  })
})
