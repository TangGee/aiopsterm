import { computed, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseConnectionFormRuntime } from '@/services/databaseConnectionFormRuntime'
import type { DatabaseConnectionDraft, DatabaseCreateDatabaseModalState } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseEngineInfo,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const connection: DatabaseConnectionInfo = {
  id: 'conn-prod',
  name: 'prod-postgres',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  hasPassword: true,
  database: 'app',
  status: 'connected',
  catalogs: [{ name: 'app', schemas: [{ name: 'public', tables: [] }] }]
}

const catalog: DatabaseWorkspaceCatalog = {
  engines: [{ code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [{ id: 'group-default', name: 'Default Group' }],
  groupParents: { 'group-default': null },
  connections: [connection],
  defaults: {
    selectedNodeId: connection.id,
    expandedGroupIds: ['group-default'],
    expandedConnectionIds: [connection.id],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
}

const reportingCatalog = { name: 'reporting', schemas: [{ name: 'public', tables: [] }] }
const savedConnection = (overrides: Partial<DatabaseConnectionInfo> = {}): DatabaseConnectionInfo => ({
  ...connection,
  ...overrides
})

const makeDraft = (): DatabaseConnectionDraft => reactive({
  id: '',
  dbType: 'mysql',
  name: '',
  env: 'Development',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 3306,
  authentication: 'UserAndPassword',
  user: 'root',
  password: '',
  database: '',
  filePath: '',
  readonly: false,
  sslMode: '',
  needProxy: false,
  proxyName: '',
  url: ''
})

const makeCreateDatabaseModal = (): DatabaseCreateDatabaseModalState => reactive({
  open: false,
  connectionId: '',
  dbType: 'mysql',
  name: '',
  sql: '',
  userEditedSql: false,
  lastAppliedTemplate: '',
  submitting: false,
  feedback: '',
  feedbackKind: 'info'
})

const createRuntime = (overrides: Partial<{
  engines: DatabaseEngineInfo[]
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  testConnection: ReturnType<typeof vi.fn>
  saveConnection: ReturnType<typeof vi.fn>
  createDatabase: ReturnType<typeof vi.fn>
}> = {}) => {
  const appliedCatalogs: DatabaseWorkspaceCatalog[] = []
  const notices: string[] = []
  const closeMenus = vi.fn()
  const state = {
    databaseEngines: ref(overrides.engines ?? catalog.engines),
    connectionModalOpen: ref(false),
    connectionModalMode: ref<'create' | 'edit'>('create'),
    connectionFeedback: ref(''),
    connectionFeedbackKind: ref<'info' | 'error'>('info'),
    connectionErrors: ref<string[]>([]),
    connectionUrlDirty: ref(false),
    passwordVisible: ref(false),
    connectionTesting: ref(false),
    connectionSaving: ref(false),
    connectionDraft: makeDraft(),
    createDatabaseModal: makeCreateDatabaseModal(),
    databaseSshProxyOptions: computed(() => [{ name: 'bastion' }]),
    databaseSshProxyNames: computed(() => new Set(['bastion']))
  }
  const runtime = createDatabaseConnectionFormRuntime(state, {
    findConnection: overrides.findConnection ?? ((id) => (id === connection.id ? connection : undefined)),
    applyDatabaseCatalog: (next) => appliedCatalogs.push(next),
    showNotice: (text) => notices.push(text),
    closeMenus,
    openSshProxyConfig: vi.fn(),
    openAddSshProxyConfig: vi.fn(),
    testConnection: overrides.testConnection ?? vi.fn(async () => ({ ok: true, data: { dbType: 'postgresql', serverVersion: '15.0', endpoint: '127.0.0.1:5432', durationMs: 5 } })),
    saveConnection: overrides.saveConnection ?? vi.fn(async () => ({ ok: true, data: { ...catalog, connection, connections: [connection], message: 'saved' } })),
    createDatabase: overrides.createDatabase ?? vi.fn(async () => ({
      ok: true,
      data: {
        ...catalog,
        connection: savedConnection({ catalogs: [...connection.catalogs, reportingCatalog] }),
        connections: [savedConnection({ catalogs: [...connection.catalogs, reportingCatalog] })],
        catalog: reportingCatalog,
        message: 'created'
      }
    }))
  })
  return { runtime, state, appliedCatalogs, notices, closeMenus }
}

describe('databaseConnectionFormRuntime', () => {
  it('owns connection draft defaults, validation, save flow, and proxy cleanup', async () => {
    const saveConnection = vi.fn(async () => {
      const nextConnection = savedConnection({
        name: 'postgresql-connection',
        env: 'Development',
        user: 'root',
        needProxy: true,
        proxyName: 'bastion',
        database: '',
        hasPassword: false,
        catalogs: []
      })
      return { ok: true, data: { ...catalog, connection: nextConnection, connections: [nextConnection], message: 'saved' } }
    })
    const testConnection = vi.fn(async () => ({ ok: true, data: { dbType: 'postgresql' as const, serverVersion: '15.0', endpoint: '127.0.0.1:5432', durationMs: 5 } }))
    const { runtime, state, appliedCatalogs, notices, closeMenus } = createRuntime({ testConnection, saveConnection })

    runtime.openConnectionModal('postgresql', 'group-default')

    expect(state.connectionModalOpen.value).toBe(true)
    expect(state.connectionDraft).toMatchObject({
      dbType: 'postgresql',
      name: 'postgresql-connection',
      port: 5432,
      user: 'root',
      groupId: 'group-default'
    })
    expect(runtime.databaseProxyAvailable.value).toBe(true)
    expect(runtime.connectionUrl.value).toBe('jdbc:postgresql://127.0.0.1:5432')
    expect(closeMenus).toHaveBeenCalled()

    state.connectionDraft.needProxy = true
    state.connectionDraft.proxyName = 'missing'
    await Promise.resolve()
    expect(state.connectionDraft.proxyName).toBe('')

    state.connectionDraft.proxyName = 'bastion'
    expect(runtime.validateConnectionDraft()).toBe(true)
    await runtime.saveConnectionDraft()

    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ dbType: 'postgresql', proxyName: 'bastion' }))
    expect(saveConnection).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'create',
      connection: expect.objectContaining({ dbType: 'postgresql', groupId: 'group-default', proxyName: 'bastion' })
    }))
    expect(appliedCatalogs).toHaveLength(1)
    expect(notices).toEqual(['saved'])
    expect(state.connectionModalOpen.value).toBe(false)
  })

  it('owns create-database modal validation, SQL template sync, and catalog application', async () => {
    const createDatabase = vi.fn(async () => ({
      ok: true,
      data: {
        ...catalog,
        connection: savedConnection({ catalogs: [...connection.catalogs, reportingCatalog] }),
        connections: [savedConnection({ catalogs: [...connection.catalogs, reportingCatalog] })],
        catalog: reportingCatalog,
        message: 'created'
      }
    }))
    const { runtime, state, appliedCatalogs, notices } = createRuntime({ createDatabase })

    runtime.openCreateDatabaseModal(connection.id)
    expect(state.createDatabaseModal.open).toBe(true)
    expect(runtime.createDatabaseCanSubmit.value).toBe(false)

    runtime.updateCreateDatabaseName({ target: { value: 'reporting' } } as unknown as Event)
    expect(runtime.createDatabaseSql.value).toBe('CREATE DATABASE "reporting";')
    expect(runtime.createDatabaseCanSubmit.value).toBe(true)

    const selectedNodeId = await runtime.createDatabase()
    expect(createDatabase).toHaveBeenCalledWith(connection.id, 'CREATE DATABASE "reporting";', 'reporting')
    expect(appliedCatalogs).toHaveLength(1)
    expect(notices).toEqual(['created'])
    expect(selectedNodeId).toBe('conn-prod:reporting')
    expect(state.createDatabaseModal.open).toBe(false)
  })

  it('keeps invalid connection and duplicate database feedback local to the form state', async () => {
    const { runtime, state } = createRuntime()

    runtime.openConnectionModal('sqlite', 'group-default')
    expect(runtime.validateConnectionDraft()).toBe(false)
    expect(state.connectionErrors.value).toEqual(['filePath'])

    runtime.openCreateDatabaseModal(connection.id)
    runtime.updateCreateDatabaseName({ target: { value: 'app' } } as unknown as Event)
    await runtime.createDatabase()
    expect(state.createDatabaseModal.feedbackKind).toBe('error')
    expect(state.createDatabaseModal.feedback).toBe('Database already exists.')
  })
})
