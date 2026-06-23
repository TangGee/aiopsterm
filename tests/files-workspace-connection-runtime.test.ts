import { describe, expect, it, vi } from 'vitest'
import { createFilesWorkspaceConnectionRuntime } from '@/services/files/filesWorkspaceConnectionRuntime'
import type { FileSessionInfo } from '@shared/contracts/files'

const session = (input: Partial<FileSessionInfo> & Pick<FileSessionInfo, 'id' | 'label' | 'host'>): FileSessionInfo => ({
  group: 'Default',
  kind: 'remote',
  rootPath: '/home/unit',
  status: 'active',
  ...input
})

describe('filesWorkspaceConnectionRuntime', () => {
  it('owns add-connection filtering, keyboard selection, side choice, and default expansion state', () => {
    const sessions = [
      session({ id: 'local', label: 'Local', host: 'localhost', kind: 'local', rootPath: '/', group: 'Local' }),
      session({ id: 'prod', label: 'Production', host: '10.0.0.1', group: 'Prod' }),
      session({ id: 'stage', label: 'Staging', host: '10.0.0.2', group: 'Stage', status: 'idle' })
    ]
    let left: string | null = 'local'
    let right: string | null = null
    const openFileSession = vi.fn((sessionId: string, side: 'left' | 'right') => {
      if (side === 'left') left = sessionId
      else right = sessionId
    })
    const runtime = createFilesWorkspaceConnectionRuntime({
      getFileSessions: () => sessions,
      getSelectedLeftFileSessionId: () => left,
      getSelectedRightFileSessionId: () => right,
      openFileSession
    })

    expect(runtime.expandedDefault.value).toEqual(['local'])
    runtime.toggleDefaultSession('local')
    expect(runtime.expandedDefault.value).toEqual([])
    runtime.toggleDefaultSession('prod')
    expect(runtime.expandedDefault.value).toEqual(['prod'])

    runtime.openAddConn('right')
    expect(runtime.addConn.visible).toBe(true)
    expect(runtime.addConn.side).toBe('right')
    expect(runtime.addConnOptions.value.map((item) => item.id)).toEqual(['local', 'prod'])

    runtime.setAddConnTab('asset')
    runtime.addConn.query = 'stag'
    expect(runtime.addConnOptions.value.map((item) => item.id)).toEqual(['stage'])
    runtime.moveAddConnKeyboard(1)
    expect(runtime.addConn.keyboardSelectedId).toBe('stage')
    runtime.confirmAddConnKeyboard()

    expect(openFileSession).toHaveBeenCalledWith('stage', 'right')
    expect(runtime.addConn.visible).toBe(false)
    expect(right).toBe('stage')
  })
})
