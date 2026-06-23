import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseCatalogTreeRuntime } from '@/services/databaseCatalogTreeRuntime'
import type {
  ContextMenu,
  DatabaseOperationConfirmState,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseEngineInfo,
  DatabaseGroupInfo,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const engine = {
  code: 'postgresql',
  connectionCode: 'postgresql',
  name: 'PostgreSQL',
  enabled: true,
  accent: '#336791'
} satisfies DatabaseEngineInfo

const disabledEngine = {
  code: 'mongodb',
  name: 'MongoDB',
  enabled: false,
  accent: '#d82c20'
} satisfies DatabaseEngineInfo

const groupRoot = { id: 'group-default', name: 'Default Group' } satisfies DatabaseGroupInfo
const groupOps = { id: 'group-ops', name: 'Ops' } satisfies DatabaseGroupInfo
const groupChild = { id: 'group-child', name: 'Child' } satisfies DatabaseGroupInfo

const connection = (overrides: Partial<DatabaseConnectionInfo> = {}): DatabaseConnectionInfo => ({
  id: 'conn-orders',
  name: 'orders-db',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'idle',
  catalogs: [],
  ...overrides
})

const catalog = (groups: DatabaseGroupInfo[], connections: DatabaseConnectionInfo[]): DatabaseWorkspaceCatalog => ({
  engines: [engine],
  groups,
  groupParents: Object.fromEntries(groups.map((group) => [group.id, group.id === groupChild.id ? groupOps.id : null])),
  connections,
  defaults: {
    selectedNodeId: null,
    expandedGroupIds: ['group-default'],
    expandedConnectionIds: [],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
})

const makeOperationConfirm = (): DatabaseOperationConfirmState => ({
  open: false,
  action: '',
  targetId: '',
  title: '',
  message: '',
  detail: '',
  confirmLabel: 'Delete'
})

const sqlTab = (): Extract<WorkspaceTab, { kind: 'sql' }> => ({
  id: 'tab-sql',
  kind: 'sql',
  title: 'Query 1',
  connectionId: 'conn-orders',
  catalogName: 'orders',
  schemaName: 'public',
  sql: '',
  savedSql: '',
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: []
})

const makeRuntime = () => {
  let currentConnection = connection()
  let currentGroups = [groupRoot, groupOps, groupChild]
  const state = {
    databaseEngines: ref<DatabaseEngineInfo[]>([engine, disabledEngine]),
    groups: ref<DatabaseGroupInfo[]>(currentGroups),
    groupParentById: { 'group-default': null, 'group-ops': null, 'group-child': 'group-ops' },
    connections: ref<DatabaseConnectionInfo[]>([currentConnection]),
    keyword: ref('orders'),
    sidebarCollapsed: ref(true),
    databaseSidebarTreeRef: ref({
      focusSearch: vi.fn(),
      addButtonRect: () => ({ right: 240, bottom: 40 }) as DOMRect
    }),
    expandedGroups: ref<string[]>(['group-default']),
    expandedConnections: ref<string[]>([]),
    expandedCatalogs: ref<string[]>(['conn-orders:stale']),
    expandedSchemas: ref<string[]>(['conn-orders:stale:public']),
    expandedSchemaObjectFolders: ref<string[]>(['conn-orders:stale:public:tables']),
    selectedNodeId: ref<string | null>(null),
    overflowOpen: ref(true),
    addMenuOpen: ref(false),
    addMenuPosition: ref({ x: 0, y: 0 }),
    contextMenu: ref<ContextMenu | null>(null),
    contextSubmenu: ref<'groupConnection' | 'groupMove' | 'connectionMove' | 'tableCopy' | null>('groupMove'),
    editingGroupId: ref<string | null>(null),
    editingGroupName: ref(''),
    tabs: ref<WorkspaceTab[]>([{ id: 'tab-overview', kind: 'overview', title: 'Overview' }, sqlTab()]),
    activeTabId: ref('tab-sql'),
    operationConfirm: makeOperationConfirm()
  }
  const appliedCatalogs: DatabaseWorkspaceCatalog[] = []
  const notices: string[] = []
  const applyDatabaseCatalog = vi.fn((nextCatalog: DatabaseWorkspaceCatalog) => {
    appliedCatalogs.push(nextCatalog)
    currentGroups = nextCatalog.groups
    state.groups.value = nextCatalog.groups
    currentConnection = nextCatalog.connections[0] ?? currentConnection
    state.connections.value = nextCatalog.connections
  })
  const deps = {
    showNotice: vi.fn((text: string) => notices.push(text)),
    copyText: vi.fn(async () => true),
    findConnection: vi.fn((id: string) => (id === currentConnection.id ? currentConnection : undefined)),
    applyDatabaseCatalog,
    applyDatabaseCatalogMutationResult: <T extends DatabaseWorkspaceCatalog>(
      result: { ok: boolean; data?: unknown; errorMessage?: string },
      fallbackError: string,
      isData?: (value: unknown) => value is T,
      malformedError?: string
    ) => {
      if (!result.ok) {
        notices.push(result.errorMessage || fallbackError)
        return false
      }
      if (isData && !isData(result.data)) {
        notices.push(malformedError || fallbackError)
        return false
      }
      applyDatabaseCatalog(result.data as DatabaseWorkspaceCatalog)
      return true
    },
    databaseCatalogMutationData: <T extends DatabaseWorkspaceCatalog>(
      result: { ok: boolean; data?: unknown; errorMessage?: string },
      fallbackError: string,
      isData?: (value: unknown) => value is T,
      malformedError?: string
    ) => {
      if (!result.ok) {
        notices.push(result.errorMessage || fallbackError)
        return null
      }
      if (isData && !isData(result.data)) {
        notices.push(malformedError || fallbackError)
        return null
      }
      return result.data as T
    },
    repairTabsForConnection: vi.fn(),
    openConnectionModal: vi.fn(),
    editConnectionDraft: vi.fn()
  }
  const backend = {
    createGroup: vi.fn(async ({ parentId }: { name: string; parentId?: string | null }) => {
      const group = { id: 'group-new', name: 'New Group' }
      return {
        ok: true,
        data: {
          ...catalog([...currentGroups, group], [currentConnection]),
          group,
          groupParents: { ...state.groupParentById, 'group-new': parentId ?? null },
          message: 'Group created'
        }
      }
    }),
    renameGroup: vi.fn(async ({ id, name }: { id: string; name: string }) => {
      const groups = currentGroups.map((group) => (group.id === id ? { ...group, name } : group))
      return { ok: true, data: { ...catalog(groups, [currentConnection]), group: groups.find((group) => group.id === id)!, message: 'Group renamed' } }
    }),
    moveGroup: vi.fn(async ({ id, parentId }: { id: string; parentId?: string | null }) => {
      const nextCatalog = catalog(currentGroups, [currentConnection])
      nextCatalog.groupParents[id] = parentId ?? null
      return { ok: true, data: { ...nextCatalog, group: currentGroups.find((group) => group.id === id)!, message: 'Group moved' } }
    }),
    deleteGroup: vi.fn(async (id: string) => {
      const groups = currentGroups.filter((group) => group.id !== id)
      return { ok: true, data: { ...catalog(groups, [currentConnection]), deletedGroupId: id, message: 'Group deleted' } }
    }),
    moveConnection: vi.fn(async ({ connectionId, groupId }: { connectionId: string; groupId: string }) => {
      currentConnection = { ...currentConnection, id: connectionId, groupId }
      return { ok: true, data: { ...catalog(currentGroups, [currentConnection]), connection: currentConnection, message: 'Connection moved' } }
    }),
    removeConnection: vi.fn(async (connectionId: string) => ({ ok: true, data: { ...catalog(currentGroups, []), connectionId, message: 'Connection removed' } })),
    connectConnection: vi.fn(async (connectionId: string) => {
      currentConnection = { ...currentConnection, id: connectionId, status: 'connected', catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [], views: [] }] }] }
      return { ok: true, data: { ...catalog(currentGroups, [currentConnection]), connection: currentConnection, message: 'Connection opened' } }
    }),
    disconnectConnection: vi.fn(async (connectionId: string) => {
      currentConnection = { ...currentConnection, id: connectionId, status: 'idle', catalogs: [] }
      return { ok: true, data: { ...catalog(currentGroups, [currentConnection]), connection: currentConnection, message: 'Connection closed' } }
    }),
    refreshConnection: vi.fn(async (connectionId: string) => {
      currentConnection = { ...currentConnection, id: connectionId, catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [], views: [] }] }] }
      return { ok: true, data: { ...catalog(currentGroups, [currentConnection]), connection: currentConnection, message: 'Connection refreshed' } }
    })
  }
  const runtime = createDatabaseCatalogTreeRuntime(state, deps, backend)

  return { appliedCatalogs, backend, deps, notices, runtime, state }
}

describe('databaseCatalogTreeRuntime', () => {
  it('owns database tree menus, search focus, engine entry, and group mutation flow', async () => {
    const { appliedCatalogs, backend, deps, notices, runtime, state } = makeRuntime()

    runtime.toggleAddMenu()
    expect(state.addMenuOpen.value).toBe(true)
    expect(state.addMenuPosition.value).toEqual({ x: 80, y: 46 })
    await runtime.clearDatabaseSearch()
    expect(state.keyword.value).toBe('')
    expect(state.databaseSidebarTreeRef.value?.focusSearch).toHaveBeenCalled()

    runtime.openOverviewEngine(disabledEngine)
    expect(notices).toContain('MongoDB connection is unavailable')
    runtime.openOverviewEngine(engine)
    expect(deps.openConnectionModal).toHaveBeenCalledWith('postgresql', 'group-default')

    await runtime.addGroup('group-ops')
    expect(backend.createGroup).toHaveBeenCalledWith({ name: 'New Group', parentId: 'group-ops' })
    expect(appliedCatalogs).toHaveLength(1)
    expect(state.expandedGroups.value).toEqual(expect.arrayContaining(['group-ops', 'group-new']))
    expect(state.editingGroupId.value).toBe('group-new')
    expect(state.editingGroupName.value).toBe('New Group')

    runtime.startGroupRename('group-new')
    state.editingGroupName.value = 'Renamed'
    await runtime.commitGroupRename()
    expect(backend.renameGroup).toHaveBeenCalledWith({ id: 'group-new', name: 'Renamed' })

    await runtime.moveGroupTo('group-child', 'group-default')
    expect(backend.moveGroup).toHaveBeenCalledWith({ id: 'group-child', parentId: 'group-default' })
    expect(notices).toContain('Group moved to Default Group')

    runtime.requestDeleteGroup('group-child')
    expect(state.operationConfirm).toMatchObject({
      open: true,
      action: 'deleteGroup',
      targetId: 'group-child',
      title: 'Delete Group',
      confirmLabel: 'Delete'
    })
    await runtime.confirmOperation()
    expect(backend.deleteGroup).toHaveBeenCalledWith('group-child')
  })

  it('owns connection context operations, refresh cleanup, and remove confirmation side effects', async () => {
    const { backend, deps, notices, runtime, state } = makeRuntime()

    runtime.openContextMenu({ clientX: 100, clientY: 120 }, { type: 'connection', connectionId: 'conn-orders', label: 'orders-db' })
    expect(state.selectedNodeId.value).toBe('conn-orders')
    expect(state.contextMenu.value).toMatchObject({ x: 100, y: 120, type: 'connection' })
    await runtime.copyContextName()
    expect(deps.copyText).toHaveBeenCalledWith('orders-db')
    expect(notices).toContain('Name copied')
    expect(state.contextMenu.value).toBeNull()

    await runtime.connectFromMenu('conn-orders')
    expect(backend.connectConnection).toHaveBeenCalledWith('conn-orders')
    expect(state.expandedConnections.value).toContain('conn-orders')
    expect(notices).toContain('Connection opened')

    await runtime.moveConnectionToGroup('conn-orders', 'group-ops')
    expect(backend.moveConnection).toHaveBeenCalledWith({ connectionId: 'conn-orders', groupId: 'group-ops' })
    expect(state.expandedGroups.value).toContain('group-ops')
    expect(notices).toContain('Connection moved to Ops')

    await runtime.refreshConnectionFromMenu('conn-orders')
    expect(backend.refreshConnection).toHaveBeenCalledWith('conn-orders')
    expect(state.expandedCatalogs.value).not.toContain('conn-orders:stale')
    expect(deps.repairTabsForConnection).toHaveBeenCalledWith('conn-orders')

    runtime.requestRemoveConnection('conn-orders')
    expect(state.operationConfirm).toMatchObject({
      open: true,
      action: 'removeConnection',
      targetId: 'conn-orders',
      confirmLabel: 'Remove'
    })
    await runtime.confirmOperation()
    expect(backend.removeConnection).toHaveBeenCalledWith('conn-orders')
    expect(state.expandedConnections.value).not.toContain('conn-orders')
    expect(state.tabs.value).toEqual([{ id: 'tab-overview', kind: 'overview', title: 'Overview' }])
    expect(state.activeTabId.value).toBe('tab-overview')
    expect(notices).toContain('Connection removed')
  })

  it('fails closed on malformed backend envelopes and protects default group operations', async () => {
    const { backend, notices, runtime, state } = makeRuntime()

    runtime.requestDeleteGroup('group-default')
    expect(notices).toContain('Default Group cannot be deleted')
    expect(state.operationConfirm.open).toBe(false)

    await runtime.moveGroupTo('group-default', 'group-ops')
    expect(notices).toContain('Default Group cannot be moved')
    expect(backend.moveGroup).not.toHaveBeenCalled()

    backend.connectConnection.mockResolvedValueOnce({ ok: true, data: { bad: true } } as any)
    await runtime.toggleConnectionStatus('conn-orders')
    expect(notices).toContain('Database connection backend returned malformed result data.')
    expect(state.expandedConnections.value).toEqual([])

    runtime.requestRemoveConnection('conn-orders')
    backend.removeConnection.mockResolvedValueOnce({ ok: true, data: { bad: true } } as any)
    await runtime.confirmOperation()
    expect(notices).toContain('Database connection backend returned malformed result data.')
    expect(state.tabs.value).toHaveLength(2)
  })
})
