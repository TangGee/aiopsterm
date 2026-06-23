import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createFilesPanelSessionRuntime, filesPanelSftpDragPayload } from '@/services/filesPanelSessionRuntime'
import type { FilesPanelContextMenuState } from '@/services/filesPanelContextRuntime'
import type { FileSessionInfo, FileSessionPatch } from '@shared/contracts/files'

const session = (input: Partial<FileSessionInfo> & Pick<FileSessionInfo, 'id' | 'label'>): FileSessionInfo => ({
  host: '10.0.0.1',
  username: 'ops',
  group: 'Default',
  kind: 'remote',
  rootPath: '/home/unit',
  status: 'active',
  favorite: false,
  assetType: 'person',
  ...input
})

describe('filesPanelSessionRuntime', () => {
  it('owns session open, delayed click, drag payload, comments, favorite, move, and remove actions', async () => {
    vi.useFakeTimers()
    try {
      const sessions = [session({ id: 'prod', label: 'Production', folderUuid: 'folder-1', comment: 'old' })]
      const selectedId = ref('')
      const contextMenu: FilesPanelContextMenuState = { visible: true, x: 0, y: 0, target: 'session', sessionId: 'prod', folderUuid: '' }
      const updates: Array<{ id: string; patch: FileSessionPatch }> = []
      const runtime = createFilesPanelSessionRuntime({
        selectedId,
        contextMenu,
        contextSession: computed(() => sessions[0]),
        getFileSessions: () => sessions,
        getSelectedLeftFileSessionId: () => null,
        setFilesUiMode: vi.fn(),
        openFileSession: vi.fn(),
        updateFileSession: vi.fn(async (id, patch) => {
          updates.push({ id, patch })
          Object.assign(sessions[0], patch)
          return sessions[0]
        })
      })

      runtime.handleSessionClick('prod')
      expect(selectedId.value).toBe('prod')
      vi.runOnlyPendingTimers()

      const setData = vi.fn()
      const event = { dataTransfer: { setData, effectAllowed: '' } } as unknown as DragEvent
      runtime.onDragStart(event, 'prod')
      expect(setData).toHaveBeenCalledWith('application/x-aiopsterm-file-session', 'prod')
      expect(filesPanelSftpDragPayload(sessions[0])).toMatchObject({ uuid: 'prod', host: '10.0.0.1', username: 'ops', asset_type: 'person' })

      runtime.commentContextSession()
      expect(runtime.commentSessionId.value).toBe('prod')
      expect(runtime.editingComment.value).toBe('old')
      runtime.editingComment.value = 'new'
      await runtime.saveComment('prod')
      expect(updates.at(-1)).toEqual({ id: 'prod', patch: { comment: 'new' } })
      expect(runtime.commentSessionId.value).toBe('')

      runtime.toggleContextFavorite()
      expect(updates.at(-1)).toEqual({ id: 'prod', patch: { favorite: true } })
      runtime.moveContextSession()
      expect(runtime.moveModal).toMatchObject({ visible: true, sessionId: 'prod' })
      await runtime.removeFromFolderContextSession()
      expect(updates.at(-1)).toEqual({ id: 'prod', patch: { folderUuid: undefined } })
    } finally {
      vi.useRealTimers()
    }
  })
})
