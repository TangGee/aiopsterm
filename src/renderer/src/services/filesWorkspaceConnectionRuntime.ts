import { computed, reactive, ref } from 'vue'
import type { FileSessionInfo } from '@shared/contracts/files'

export type FilesWorkspaceConnectionSide = 'left' | 'right'
export type FilesWorkspaceConnectionTab = 'active' | 'asset'

export type FilesWorkspaceConnectionRuntimeDeps = {
  getFileSessions: () => FileSessionInfo[]
  getSelectedLeftFileSessionId: () => string | null
  getSelectedRightFileSessionId: () => string | null
  openFileSession: (sessionId: string, side: FilesWorkspaceConnectionSide) => unknown
}

export const createFilesWorkspaceConnectionRuntime = (deps: FilesWorkspaceConnectionRuntimeDeps) => {
  const expandedDefault = ref(['local'])
  const addConn = reactive<{
    visible: boolean
    side: FilesWorkspaceConnectionSide
    tab: FilesWorkspaceConnectionTab
    query: string
    keyboardSelectedId: string
  }>({
    visible: false,
    side: 'left',
    tab: 'active',
    query: '',
    keyboardSelectedId: ''
  })

  const isSelected = (sessionId: string) => deps.getSelectedLeftFileSessionId() === sessionId || deps.getSelectedRightFileSessionId() === sessionId

  const addConnOptions = computed(() => {
    const query = addConn.query.trim().toLowerCase()
    return deps.getFileSessions().filter((session) => {
      if (addConn.tab === 'active' && session.status !== 'active') return false
      if (addConn.tab === 'asset' && session.kind !== 'remote') return false
      if (!query) return true
      return [session.label, session.host, session.group].some((value) => value.toLowerCase().includes(query))
    })
  })

  const selectableAddConnOptions = computed(() => addConnOptions.value.filter((session) => !isSelected(session.id)))

  const openAddConn = (side: FilesWorkspaceConnectionSide) => {
    addConn.side = side
    addConn.visible = true
    addConn.tab = 'active'
    addConn.query = ''
    addConn.keyboardSelectedId = ''
  }

  const setAddConnTab = (tab: FilesWorkspaceConnectionTab) => {
    addConn.tab = tab
    addConn.query = ''
    addConn.keyboardSelectedId = ''
  }

  const pickAddConn = (sessionId: string) => {
    deps.openFileSession(sessionId, addConn.side)
    addConn.visible = false
    addConn.keyboardSelectedId = ''
  }

  const moveAddConnKeyboard = (delta: number) => {
    const options = selectableAddConnOptions.value
    if (!options.length) {
      addConn.keyboardSelectedId = ''
      return
    }
    const currentIndex = options.findIndex((session) => session.id === addConn.keyboardSelectedId)
    const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : options.length - 1) : (currentIndex + delta + options.length) % options.length
    addConn.keyboardSelectedId = options[nextIndex].id
  }

  const confirmAddConnKeyboard = () => {
    if (!addConn.keyboardSelectedId || isSelected(addConn.keyboardSelectedId)) return
    pickAddConn(addConn.keyboardSelectedId)
  }

  const toggleDefaultSession = (sessionId: string) => {
    expandedDefault.value = expandedDefault.value.includes(sessionId)
      ? expandedDefault.value.filter((id) => id !== sessionId)
      : [...expandedDefault.value, sessionId]
  }

  return {
    expandedDefault,
    addConn,
    addConnOptions,
    openAddConn,
    setAddConnTab,
    pickAddConn,
    isSelected,
    moveAddConnKeyboard,
    confirmAddConnKeyboard,
    toggleDefaultSession
  }
}

export type FilesWorkspaceConnectionRuntime = ReturnType<typeof createFilesWorkspaceConnectionRuntime>
