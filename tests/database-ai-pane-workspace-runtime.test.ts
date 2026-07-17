import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDatabaseAiPaneWorkspaceRuntime,
  DB_AI_PANE_CANCEL_BRIDGE_TIMEOUT_MS
} from '@/services/database/databaseAiPaneWorkspaceRuntime'
import type { SqlTab } from '@/services/database/databaseAiRuntime'
import type {
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneSessionSnapshot,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionInfo
} from '@shared/contracts/database'
import type { ProductSessionCloseResult, ProductSessionRecordResult } from '@shared/contracts/productSessions'

const bridgeMocks = vi.hoisted(() => ({
  savePaneState: vi.fn(),
  createPaneRequest: vi.fn(),
  startPaneResponse: vi.fn(),
  generatePaneResponse: vi.fn(),
  cancelPaneResponse: vi.fn(),
  cancelDrawerResponse: vi.fn()
}))

const defaultClineTaskEventSubscription = vi.mocked(window.aiops.onClineAgentTaskEvent).getMockImplementation()

vi.mock('@/services/database/databaseClient', () => ({
  databaseClient: {
    saveDatabaseAiPaneState: () => bridgeMocks.savePaneState,
    createDatabaseAiPaneRequest: () => bridgeMocks.createPaneRequest,
    startDatabaseAiPaneResponse: () => bridgeMocks.startPaneResponse,
    generateDatabaseAiPaneResponse: () => bridgeMocks.generatePaneResponse,
    cancelDatabaseAiPaneResponse: () => bridgeMocks.cancelPaneResponse,
    cancelDatabaseAiDrawerResponse: () => bridgeMocks.cancelDrawerResponse
  }
}))

const connection: DatabaseConnectionInfo = {
  id: 'conn-sqlite',
  name: 'metrics.db',
  dbType: 'sqlite',
  env: 'Development',
  groupId: 'group-default',
  host: 'local',
  port: null,
  authentication: 'UserAndPassword',
  user: '',
  database: 'main',
  filePath: '/tmp/metrics.db',
  status: 'connected',
  catalogs: [{ name: 'main', tables: [{ id: 'chart_demo_metrics', name: 'chart_demo_metrics', columns: [], primaryKey: [] }] }]
}

const sqlTab: SqlTab = {
  id: 'tab-sqlite',
  kind: 'sql',
  title: 'chart_demo_metrics',
  connectionId: connection.id,
  catalogName: 'main',
  schemaName: '',
  tableName: 'chart_demo_metrics',
  sql: 'select * from chart_demo_metrics;',
  savedSql: 'select * from chart_demo_metrics;',
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: []
}

const postgresConnection: DatabaseConnectionInfo = {
  ...connection,
  id: 'conn-postgres-orders',
  name: 'orders-postgres',
  dbType: 'postgresql',
  host: '10.24.8.20',
  port: 5432,
  user: 'ops',
  database: 'orders',
  catalogs: [
    {
      name: 'orders',
      schemas: [
        { name: 'public', tables: [], views: [] },
        { name: 'audit', tables: [], views: [] }
      ]
    },
    {
      name: 'analytics',
      schemas: [{ name: 'events', tables: [], views: [] }]
    }
  ]
}

const inventoryConnection: DatabaseConnectionInfo = {
  ...postgresConnection,
  id: 'conn-postgres-inventory',
  name: 'inventory-postgres',
  database: 'inventory',
  catalogs: [
    {
      name: 'inventory',
      schemas: [{ name: 'public', tables: [], views: [] }]
    }
  ]
}

const cloneMessage = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({
  ...message,
  ...(message.context ? { context: { ...message.context } } : {}),
  ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
})

const cloneSnapshot = (snapshot: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  ...snapshot,
  context: { ...snapshot.context },
  messages: snapshot.messages.map(cloneMessage),
  archivedSessions: (snapshot.archivedSessions || []).map((session) => ({
    ...session,
    context: { ...session.context },
    messages: session.messages.map(cloneMessage)
  }))
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const archivedSession = (conversationId: string, content: string): DatabaseAiPaneSessionSnapshot => ({
  conversationId,
  context: { connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' },
  draft: '',
  messages: [{
    id: `${conversationId}-assistant`,
    requestId: `${conversationId}-request`,
    role: 'assistant',
    status: 'done',
    content,
    contextSummary: 'orders-postgres · postgresql · orders · public',
    createdAt: 1,
    updatedAt: 2,
    responseLanguage: 'zh-CN'
  }],
  createdAt: 1,
  updatedAt: 2
})

const productSessionUpdateResult = (id: string): ProductSessionRecordResult => ({
  ok: true,
  data: {
    session: {
      id,
      surface: 'database',
      title: 'DB AI',
      isOpen: true,
      createdAt: 1,
      updatedAt: 2
    }
  }
})

describe('database AI pane workspace request lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.aiops.listProductSessionProjectionMessages = vi.fn()
    if (defaultClineTaskEventSubscription) {
      vi.mocked(window.aiops.onClineAgentTaskEvent).mockImplementation(defaultClineTaskEventSubscription)
    }
    vi.mocked(window.aiops.closeProductSession).mockImplementation(async (id): Promise<ProductSessionCloseResult> => ({
      ok: true,
      data: { id, stopped: true }
    }))
    vi.mocked(window.aiops.updateProductSession).mockImplementation(async (input) => productSessionUpdateResult(input.id))
    vi.mocked(window.aiops.getProductSession).mockImplementation(async (id) => ({
      ok: true,
      data: {
        session: {
          id,
          surface: 'database',
          title: 'DB AI',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders',
            schemaName: 'public'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    }))
  })

  afterEach(() => vi.useRealTimers())

  it('flushes the first context snapshot before creating an Explain SQL request', async () => {
    const callOrder: string[] = []
    const saveRecords: Array<{ afterCreate: boolean; requestIds: string[] }> = []
    const backendMessages = new Map<string, DatabaseAiPaneMessageRecord>()
    let requestCreated = false
    let mutatePaneDuringCreate = () => {}

    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => {
      callOrder.push(requestCreated ? 'save-after-create' : 'save-before-create')
      saveRecords.push({
        afterCreate: requestCreated,
        requestIds: snapshot.messages.map((message) => message.requestId)
      })
      backendMessages.clear()
      snapshot.messages.forEach((message) => backendMessages.set(message.id, cloneMessage(message)))
      return { ok: true, data: cloneSnapshot(snapshot) }
    })

    bridgeMocks.createPaneRequest.mockImplementation(async (input) => {
      callOrder.push('create')
      requestCreated = true
      const requestId = 'dbai-pane-request-first'
      const createdAt = 1_783_735_075_172
      const context = {
        connectionId: input.context.connectionId,
        catalogName: input.context.databaseName,
        schemaName: input.context.schemaName || '',
        dbType: input.context.dbType || ''
      }
      const userMessage: DatabaseAiPaneMessageRecord = {
        id: `${requestId}-user`,
        requestId,
        role: 'user',
        status: 'done',
        content: input.prompt,
        contextSummary: input.context.contextSummary || '',
        createdAt,
        updatedAt: createdAt,
        responseLanguage: input.responseLanguage,
        context
      }
      const assistantMessage: DatabaseAiPaneMessageRecord = {
        id: `${requestId}-assistant`,
        requestId,
        role: 'assistant',
        status: 'queued',
        content: '',
        contextSummary: input.context.contextSummary || '',
        createdAt: createdAt + 1,
        updatedAt: createdAt + 1,
        responseLanguage: input.responseLanguage,
        context
      }
      backendMessages.set(userMessage.id, cloneMessage(userMessage))
      backendMessages.set(assistantMessage.id, cloneMessage(assistantMessage))

      mutatePaneDuringCreate()
      await nextTick()
      return { ok: true, data: { requestId, userMessage, assistantMessage } }
    })

    bridgeMocks.startPaneResponse.mockImplementation(async ({ requestId, assistantMessageId }) => {
      callOrder.push('start')
      const existing = assistantMessageId ? backendMessages.get(assistantMessageId) : undefined
      if (!existing || existing.requestId !== requestId) {
        return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
      }
      const assistantMessage = { ...existing, status: 'streaming' as const, updatedAt: existing.updatedAt + 1 }
      backendMessages.set(assistantMessage.id, assistantMessage)
      return { ok: true, data: { assistantMessage } }
    })

    bridgeMocks.generatePaneResponse.mockImplementation(async ({ requestId, assistantMessageId }) => {
      callOrder.push('generate')
      const existing = assistantMessageId ? backendMessages.get(assistantMessageId) : undefined
      if (!existing || existing.requestId !== requestId) {
        return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
      }
      const text = '# SQL 解释\n\n该查询读取 chart_demo_metrics。'
      const assistantMessage = { ...existing, status: 'done' as const, content: text, updatedAt: existing.updatedAt + 1 }
      backendMessages.set(assistantMessage.id, assistantMessage)
      return {
        ok: true,
        data: { requestId, assistantMessage, text, provider: 'openai', durationMs: 1 }
      }
    })

    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([connection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => sqlTab),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === connection.id ? connection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: 'chart_demo_metrics' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    mutatePaneDuringCreate = () => {
      runtime.dbAiPaneWidth.value = 480
    }

    runtime.sendDbAiPaneQuickPrompt('explainActive')
    runtime.sendDbAiPaneQuickPrompt('explainActive')

    await vi.waitFor(() => {
      expect(runtime.dbAiPaneMessages.value.find((message) => message.role === 'assistant')?.status).toBe('done')
    })
    await vi.waitFor(() => expect(callOrder).toContain('save-after-create'))
    expect(callOrder.indexOf('save-before-create')).toBeLessThan(callOrder.indexOf('create'))
    expect(bridgeMocks.createPaneRequest).toHaveBeenCalledTimes(1)
    expect(saveRecords.filter((record) => record.afterCreate)).not.toHaveLength(0)
    expect(saveRecords.filter((record) => record.afterCreate).every((record) => record.requestIds.includes('dbai-pane-request-first'))).toBe(true)
    expect(showNotice).not.toHaveBeenCalledWith('DB AI pane request was not found.')
    expect(runtime.dbAiPaneMessages.value.find((message) => message.role === 'assistant')?.content).toContain('SQL 解释')

    scope.stop()
  })

  it('uses the shared Cline event lifecycle while keeping DB tool calls in one assistant message', async () => {
    const requestId = 'dbai-pane-shared-lifecycle'
    const assistantMessageId = `${requestId}-assistant`
    const context = { connectionId: connection.id, catalogName: 'main', schemaName: '', dbType: 'sqlite' as const }
    const responseGate = deferred<DatabaseAiPaneResponseResult>()
    const assistantMessage: DatabaseAiPaneMessageRecord = {
      id: assistantMessageId,
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary: 'metrics.db · sqlite · main',
      createdAt: 10,
      updatedAt: 10,
      responseLanguage: 'zh-CN',
      context
    }
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    bridgeMocks.createPaneRequest.mockResolvedValue({
      ok: true,
      data: {
        requestId,
        userMessage: {
          ...assistantMessage,
          id: `${requestId}-user`,
          role: 'user',
          status: 'done',
          content: '检查 table 结构'
        },
        assistantMessage
      }
    })
    bridgeMocks.startPaneResponse.mockResolvedValue({
      ok: true,
      data: { assistantMessage: { ...assistantMessage, status: 'streaming', updatedAt: 11 } }
    })
    bridgeMocks.generatePaneResponse.mockImplementation(() => responseGate.promise)

    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([connection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => sqlTab),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === connection.id ? connection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: 'chart_demo_metrics' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await runtime.sendDbAiPaneMessage('检查 table 结构')
    await vi.waitFor(() => expect(bridgeMocks.generatePaneResponse).toHaveBeenCalledTimes(1))

    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (event: any) => void
    const eventBase = {
      protocolVersion: 1,
      sessionId: 'database-cline-session',
      taskId: `dbai-${requestId}`,
      turnId: requestId,
      at: '2026-07-15T00:00:00.000Z'
    }
    emit({ ...eventBase, seq: 1, type: 'text-delta', text: '正在读取 table metadata。', accumulated: '正在读取 table metadata。' })
    emit({ ...eventBase, seq: 2, type: 'tool-call', toolCallId: 'db-tool-1', toolName: 'describe_database_table', input: { table: 'chart_demo_metrics' } })
    emit({ ...eventBase, seq: 3, type: 'tool-result', toolCallId: 'db-tool-1', toolName: 'describe_database_table', output: { columns: ['id'] } })
    await nextTick()

    expect(runtime.dbAiPaneMessages.value.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({
        id: assistantMessageId,
        status: 'streaming',
        content: '正在读取 table metadata。'
      })
    ])

    emit({ ...eventBase, seq: 4, type: 'done', text: 'table 结构检查完成。', finishReason: 'stop', iterations: 2 })
    await nextTick()
    expect(runtime.dbAiPaneMessages.value.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({
        id: assistantMessageId,
        status: 'done',
        content: 'table 结构检查完成。'
      })
    ])

    responseGate.resolve({
      ok: true,
      data: {
        requestId,
        assistantMessage: { ...assistantMessage, status: 'done', content: 'table 结构检查完成。', updatedAt: 12 },
        text: 'table 结构检查完成。',
        provider: 'openai',
        durationMs: 2
      }
    })
    await vi.waitFor(() => expect(runtime.dbAiPaneMessages.value.find((message) => message.id === assistantMessageId)?.status).toBe('done'))
    scope.stop()
  })

  it('keeps history from other response languages out of a new Cline session seed', async () => {
    const context = { connectionId: connection.id, catalogName: 'main', schemaName: '', dbType: 'sqlite' as const }
    const historyMessage = (
      id: string,
      role: DatabaseAiPaneMessageRecord['role'],
      content: string,
      responseLanguage: DatabaseAiPaneMessageRecord['responseLanguage'],
      createdAt: number
    ): DatabaseAiPaneMessageRecord => ({
      id,
      requestId: `${id}-request`,
      role,
      status: 'done',
      content,
      contextSummary: 'metrics.db · sqlite · main',
      createdAt,
      updatedAt: createdAt,
      responseLanguage,
      context: { ...context }
    })
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    bridgeMocks.createPaneRequest.mockImplementation(async (input) => {
      const requestId = 'dbai-pane-request-language'
      const createdAt = 100
      const requestContext = {
        connectionId: input.context.connectionId,
        catalogName: input.context.databaseName,
        schemaName: input.context.schemaName || '',
        dbType: input.context.dbType || ''
      }
      return {
        ok: true,
        data: {
          requestId,
          userMessage: {
            ...historyMessage(`${requestId}-user`, 'user', input.prompt, input.responseLanguage, createdAt),
            requestId,
            context: requestContext
          },
          assistantMessage: {
            ...historyMessage(`${requestId}-assistant`, 'assistant', '', input.responseLanguage, createdAt + 1),
            status: 'queued',
            requestId,
            context: requestContext
          }
        }
      }
    })
    bridgeMocks.startPaneResponse.mockImplementation(async ({ requestId, assistantMessageId }) => ({
      ok: true,
      data: {
        assistantMessage: {
          ...historyMessage(assistantMessageId, 'assistant', '', 'zh-CN', 101),
          requestId,
          status: 'streaming'
        }
      }
    }))
    bridgeMocks.generatePaneResponse.mockImplementation(async ({ requestId, assistantMessageId }) => ({
      ok: true,
      data: {
        requestId,
        assistantMessage: {
          ...historyMessage(assistantMessageId, 'assistant', '中文回答', 'zh-CN', 101),
          requestId
        },
        text: '中文回答',
        provider: 'openai',
        durationMs: 1
      }
    }))

    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([connection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => sqlTab),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === connection.id ? connection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: 'chart_demo_metrics' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.dbAiPaneMessages.value = [
      historyMessage('en-user', 'user', 'English question', 'en-US', 1),
      historyMessage('en-assistant', 'assistant', 'English answer', 'en-US', 2),
      historyMessage('zh-user', 'user', '中文问题', 'zh-CN', 3),
      historyMessage('zh-assistant', 'assistant', '中文历史回答', 'zh-CN', 4)
    ]

    await runtime.sendDbAiPaneMessage('新问题')
    await vi.waitFor(() => expect(bridgeMocks.generatePaneResponse).toHaveBeenCalledTimes(1))

    expect(bridgeMocks.createPaneRequest.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: '中文问题' },
      { role: 'assistant', content: '中文历史回答' }
    ])
    expect(bridgeMocks.generatePaneResponse.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: '中文问题' },
      { role: 'assistant', content: '中文历史回答' }
    ])
    scope.stop()
  })

  it.each([
    {
      mode: 'resolved-error' as const,
      expectedMessage: 'The second database tool failed.',
      expectedLocalizedMessage: 'DB AI 请求失败（DB_AI_PROVIDER_REQUEST_FAILED）。'
    },
    {
      mode: 'rejected-ipc' as const,
      expectedMessage: 'The Cline sidecar disconnected.',
      expectedLocalizedMessage: 'DB AI 面板回答失败。'
    }
  ])('leaves streaming when DB AI generation ends with $mode', async ({ mode, expectedMessage, expectedLocalizedMessage }) => {
    const requestId = `dbai-pane-${mode}`
    const assistantMessageId = `${requestId}-assistant`
    const generateGate = deferred<void>()
    let assistantMessage: DatabaseAiPaneMessageRecord | null = null
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    bridgeMocks.createPaneRequest.mockImplementation(async (input) => {
      const context = {
        connectionId: input.context.connectionId,
        catalogName: input.context.databaseName,
        schemaName: input.context.schemaName || '',
        dbType: input.context.dbType || ''
      }
      const userMessage: DatabaseAiPaneMessageRecord = {
        id: `${requestId}-user`,
        requestId,
        role: 'user',
        status: 'done',
        content: input.prompt,
        contextSummary: input.context.contextSummary || '',
        createdAt: 10,
        updatedAt: 10,
        responseLanguage: input.responseLanguage,
        context
      }
      assistantMessage = {
        id: assistantMessageId,
        requestId,
        role: 'assistant',
        status: 'queued',
        content: '',
        contextSummary: input.context.contextSummary || '',
        createdAt: 11,
        updatedAt: 11,
        responseLanguage: input.responseLanguage,
        context
      }
      return { ok: true, data: { requestId, userMessage, assistantMessage } }
    })
    bridgeMocks.startPaneResponse.mockImplementation(async () => ({
      ok: true,
      data: {
        assistantMessage: {
          ...assistantMessage!,
          status: 'streaming' as const,
          updatedAt: 12
        }
      }
    }))
    bridgeMocks.generatePaneResponse.mockImplementation(async () => {
      await generateGate.promise
      if (mode === 'rejected-ipc') throw new Error(expectedMessage)
      const failedAssistant: DatabaseAiPaneMessageRecord = {
        ...assistantMessage!,
        status: 'error',
        content: expectedMessage,
        updatedAt: 13
      }
      return {
        ok: false,
        errorCode: 'DB_AI_PROVIDER_REQUEST_FAILED',
        errorMessage: expectedMessage,
        data: {
          requestId,
          assistantMessage: failedAssistant,
          text: expectedMessage,
          provider: 'openai',
          durationMs: 2
        }
      }
    })

    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([connection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => sqlTab),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
        findConnection: (id) => id === connection.id ? connection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: connection.id, catalogName: 'main', schemaName: '', tableName: 'chart_demo_metrics' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await runtime.sendDbAiPaneMessage('检查 chart_demo_metrics')
    await vi.waitFor(() => expect(bridgeMocks.generatePaneResponse).toHaveBeenCalledTimes(1))
    expect(runtime.dbAiPaneMessages.value.find((message) => message.id === assistantMessageId)?.status).toBe('streaming')

    generateGate.resolve(undefined)
    await vi.waitFor(() => {
      expect(runtime.dbAiPaneMessages.value.find((message) => message.id === assistantMessageId)).toMatchObject({
        status: 'error',
        content: expectedLocalizedMessage
      })
    })
    expect(runtime.dbAiPaneIsStreaming.value).toBe(false)
    if (mode === 'rejected-ipc') expect(showNotice).toHaveBeenCalledWith(expectedLocalizedMessage)
    scope.stop()
  })

  it.each([
    {
      scope: 'connection',
      apply: (runtime: ReturnType<typeof createDatabaseAiPaneWorkspaceRuntime>) => runtime.updateDbAiPaneConnection({
        target: { value: inventoryConnection.id }
      } as unknown as Event),
      expectedContext: { connectionId: inventoryConnection.id, catalogName: 'inventory', schemaName: 'public' },
      responseLanguage: 'zh-CN' as const,
      expectedNotice: 'Database context 已变化，已创建新的 DB AI session'
    },
    {
      scope: 'database',
      apply: (runtime: ReturnType<typeof createDatabaseAiPaneWorkspaceRuntime>) => runtime.updateDbAiPaneCatalog({
        target: { value: 'analytics' }
      } as unknown as Event),
      expectedContext: { connectionId: postgresConnection.id, catalogName: 'analytics', schemaName: 'events' },
      responseLanguage: 'zh-CN' as const,
      expectedNotice: 'Database context 已变化，已创建新的 DB AI session'
    },
    {
      scope: 'schema',
      apply: (runtime: ReturnType<typeof createDatabaseAiPaneWorkspaceRuntime>) => runtime.updateDbAiPaneSchema({
        target: { value: 'audit' }
      } as unknown as Event),
      expectedContext: { connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'audit' },
      responseLanguage: 'en-US' as const,
      expectedNotice: 'Database context changed. A new DB AI session was created.'
    }
  ])('rotates and isolates the DB AI product session when the $scope changes', async ({
    apply,
    expectedContext,
    responseLanguage,
    expectedNotice
  }) => {
    const connections = [postgresConnection, inventoryConnection]
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref(connections),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => connections.find((item) => item.id === id),
        defaultSqlContextForConnection: (selected) => ({
          connectionId: selected.id,
          catalogName: selected.catalogs[0]?.name || '',
          schemaName: selected.catalogs[0]?.schemas?.[0]?.name || '',
          tableName: ''
        }),
        resolveSqlConsoleContext: () => ({
          connectionId: postgresConnection.id,
          catalogName: 'orders',
          schemaName: 'public',
          tableName: ''
        }),
        connectConnection: async () => true,
        getResponseLanguage: () => responseLanguage,
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.openDbAiPane()
    runtime.dbAiPaneMessages.value = [{
      id: 'dbai-history-assistant',
      requestId: 'dbai-history-request',
      role: 'assistant',
      status: 'done',
      content: 'Current database context summary',
      contextSummary: 'orders-postgres · postgresql · orders · public',
      createdAt: 1,
      updatedAt: 2,
      responseLanguage: 'zh-CN',
      context: {
        connectionId: postgresConnection.id,
        catalogName: 'orders',
        schemaName: 'public',
        dbType: 'postgresql'
      }
    }]
    await nextTick()
    await runtime.persistDbAiPaneState()
    const previousSnapshot = bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot

    apply(runtime)

    expect(runtime.dbAiPaneMessages.value).toEqual([])
    expect(runtime.dbAiPaneArchivedSessions.value).toEqual([
      expect.objectContaining({
        conversationId: previousSnapshot.conversationId,
        messages: [expect.objectContaining({ id: 'dbai-history-assistant' })]
      })
    ])
    expect(runtime.dbAiPaneDraft.value).toBe('')
    expect(runtime.dbAiPaneContext).toEqual(expect.objectContaining(expectedContext))
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(previousSnapshot.conversationId)
    expect(showNotice).toHaveBeenCalledWith(expectedNotice)

    await nextTick()
    await runtime.persistDbAiPaneState()
    const nextSnapshot = bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot
    expect(nextSnapshot.conversationId).not.toBe(previousSnapshot.conversationId)
    expect(nextSnapshot.context).toEqual(expect.objectContaining(expectedContext))
    expect(nextSnapshot.messages).toEqual([])
    expect(nextSnapshot.archivedSessions).toHaveLength(1)

    await expect(runtime.restoreDbAiPaneSession(previousSnapshot.conversationId!)).resolves.toBe(true)
    expect(runtime.dbAiPaneMessages.value).toEqual([
      expect.objectContaining({ id: 'dbai-history-assistant', content: 'Current database context summary' })
    ])
    expect(runtime.dbAiPaneContext).toEqual(expect.objectContaining({
      connectionId: postgresConnection.id,
      catalogName: 'orders',
      schemaName: 'public'
    }))
    expect(runtime.dbAiPaneArchivedSessions.value).toEqual([])
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({
      id: previousSnapshot.conversationId,
      isOpen: true
    })
    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
    expect(window.aiops.createCodexSession).not.toHaveBeenCalled()
    scope.stop()
  })

  it('starts cancellation and close together, then waits for both before restoring the same session', async () => {
    const cancelGate = deferred<DatabaseAiPaneLifecycleResult>()
    const closeGate = deferred<ProductSessionCloseResult>()
    const callOrder: string[] = []
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    bridgeMocks.cancelPaneResponse.mockImplementation((input) => {
      callOrder.push(`cancel:${input.requestId}`)
      return cancelGate.promise
    })
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({
          connectionId: postgresConnection.id,
          catalogName: 'orders',
          schemaName: 'public',
          tableName: ''
        }),
        resolveSqlConsoleContext: () => ({
          connectionId: postgresConnection.id,
          catalogName: 'orders',
          schemaName: 'public',
          tableName: ''
        }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.openDbAiPane()
    const streamingMessage: DatabaseAiPaneMessageRecord = {
      id: 'dbai-race-assistant',
      requestId: 'dbai-race-request',
      role: 'assistant',
      status: 'streaming',
      content: '',
      contextSummary: 'orders-postgres · postgresql · orders · public',
      createdAt: 1,
      updatedAt: 2,
      responseLanguage: 'zh-CN',
      context: { connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' }
    }
    runtime.dbAiPaneMessages.value = [streamingMessage]
    await nextTick()
    await runtime.persistDbAiPaneState()
    const previousId = (bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot).conversationId!
    vi.mocked(window.aiops.closeProductSession).mockImplementation((id) => {
      callOrder.push(`close:${id}`)
      return id === previousId
        ? closeGate.promise
        : Promise.resolve({ ok: true, data: { id, stopped: false } })
    })
    vi.mocked(window.aiops.updateProductSession).mockImplementation(async (input) => {
      callOrder.push(`open:${input.id}`)
      return productSessionUpdateResult(input.id)
    })

    runtime.updateDbAiPaneSchema({ target: { value: 'audit' } } as unknown as Event)
    const restorePromise = runtime.restoreDbAiPaneSession(previousId)

    expect(bridgeMocks.cancelPaneResponse).toHaveBeenCalledWith({
      requestId: streamingMessage.requestId,
      assistantMessageId: streamingMessage.id
    })
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(previousId)
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()

    closeGate.resolve({ ok: true, data: { id: previousId, stopped: true } })
    await nextTick()
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()

    cancelGate.resolve({
      ok: true,
      data: { assistantMessage: { ...streamingMessage, status: 'cancelled' } }
    })
    await expect(restorePromise).resolves.toBe(true)

    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: previousId, isOpen: true })
    expect(callOrder.indexOf(`close:${previousId}`)).toBeLessThan(callOrder.indexOf(`open:${previousId}`))
    scope.stop()
  })

  it('continues a DB AI restore with a local cancelled projection when the cancel bridge never settles', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    try {
      bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
        ok: true,
        data: cloneSnapshot(snapshot)
      }))
      bridgeMocks.cancelPaneResponse.mockImplementation(() => new Promise<DatabaseAiPaneLifecycleResult>(() => undefined))
      const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
        {
          connections: ref([postgresConnection]),
          expandedConnections: ref<string[]>([]),
          activeSqlTab: computed(() => null),
          databaseAiPanelsRef: ref(null)
        },
        {
          showNotice: vi.fn(),
          bridgeErrorMessage: (_error, fallback) => fallback,
          findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
          defaultSqlContextForConnection: () => ({
            connectionId: postgresConnection.id,
            catalogName: 'orders',
            schemaName: 'public',
            tableName: ''
          }),
          resolveSqlConsoleContext: () => ({
            connectionId: postgresConnection.id,
            catalogName: 'orders',
            schemaName: 'public',
            tableName: ''
          }),
          connectConnection: async () => true,
          getResponseLanguage: () => 'zh-CN',
          getSelectedSqlText: () => '',
          getSqlCursorOffset: () => 0
        }
      ))!
      runtime.openDbAiPane()
      const streamingMessage: DatabaseAiPaneMessageRecord = {
        id: 'dbai-timeout-assistant',
        requestId: 'dbai-timeout-request',
        role: 'assistant',
        status: 'streaming',
        content: 'partial answer',
        contextSummary: 'orders-postgres · postgresql · orders · public',
        createdAt: 1,
        updatedAt: 2,
        responseLanguage: 'zh-CN',
        context: { connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' }
      }
      runtime.dbAiPaneMessages.value = [streamingMessage]
      runtime.dbAiPaneArchivedSessions.value = [archivedSession('dbai-timeout-target', 'Restored answer')]
      await nextTick()
      await runtime.persistDbAiPaneState()
      const previousId = runtime.dbAiPaneConversationId.value

      const restorePromise = runtime.restoreDbAiPaneSession('dbai-timeout-target')
      await vi.advanceTimersByTimeAsync(0)

      expect(bridgeMocks.cancelPaneResponse).toHaveBeenCalledWith({
        requestId: streamingMessage.requestId,
        assistantMessageId: streamingMessage.id
      })
      expect(window.aiops.updateProductSession).not.toHaveBeenCalledWith({
        id: 'dbai-timeout-target',
        isOpen: true
      })

      await vi.advanceTimersByTimeAsync(DB_AI_PANE_CANCEL_BRIDGE_TIMEOUT_MS)
      await expect(restorePromise).resolves.toBe(true)

      expect(runtime.dbAiPaneMessages.value).toEqual([
        expect.objectContaining({ content: 'Restored answer' })
      ])
      expect(runtime.dbAiPaneArchivedSessions.value).toEqual([
        expect.objectContaining({
          conversationId: previousId,
          messages: [expect.objectContaining({ id: streamingMessage.id, status: 'cancelled' })]
        })
      ])
    } finally {
      scope.stop()
      vi.useRealTimers()
    }
  })

  it('opens a DB AI session in degraded mode when its saved connection is missing', async () => {
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: () => undefined,
        defaultSqlContextForConnection: () => ({ connectionId: '', catalogName: '', schemaName: '', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: '', catalogName: '', schemaName: '', tableName: '' }),
        connectConnection: vi.fn(async () => false),
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    const saved = archivedSession('dbai-missing-connection', 'Saved answer')
    runtime.dbAiPaneArchivedSessions.value = [saved]

    await expect(runtime.restoreDbAiPaneSession(saved.conversationId)).resolves.toBe(true)

    expect(runtime.dbAiPaneOpen.value).toBe(true)
    expect(runtime.dbAiPaneMessages.value).toEqual([expect.objectContaining({ content: 'Saved answer' })])
    expect(runtime.dbAiPaneRestoreIssues.value).toEqual(['原数据库连接已不存在，请在连接设置中处理。'])
    expect(runtime.dbAiPaneCanSend.value).toBe(false)
    expect(showNotice).toHaveBeenCalledWith(runtime.dbAiPaneRestoreIssues.value[0])
    scope.stop()
  })

  it('reconnects and validates the saved database before restoring DB AI', async () => {
    const restoredConnection: DatabaseConnectionInfo = { ...postgresConnection, status: 'idle' }
    const connectConnection = vi.fn(async () => {
      restoredConnection.status = 'connected'
      return true
    })
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([restoredConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === restoredConnection.id ? restoredConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: restoredConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: restoredConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection,
        getResponseLanguage: () => 'en-US',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    const saved = archivedSession('dbai-reconnect', 'Saved answer')
    runtime.dbAiPaneArchivedSessions.value = [saved]

    await expect(runtime.restoreDbAiPaneSession(saved.conversationId)).resolves.toBe(true)

    expect(connectConnection).toHaveBeenCalledWith(restoredConnection.id)
    expect(runtime.dbAiPaneRestoreIssues.value).toEqual([])
    expect(runtime.dbAiPaneOpen.value).toBe(true)
    scope.stop()
  })

  it('closes the active DB AI session into the Agents-only restore catalog', async () => {
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.openDbAiPane()
    const closedId = runtime.dbAiPaneConversationId.value
    runtime.dbAiPaneMessages.value = archivedSession(closedId, 'Saved DB answer').messages
    runtime.dbAiPaneDraft.value = 'unfinished follow-up'

    await expect(runtime.closeDbAiPane()).resolves.toBe(true)

    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(closedId)
    expect(runtime.dbAiPaneOpen.value).toBe(false)
    expect(runtime.dbAiPaneConversationId.value).not.toBe(closedId)
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    expect(runtime.dbAiPaneDraft.value).toBe('')
    expect(runtime.dbAiPaneArchivedSessions.value).toEqual([
      expect.objectContaining({ conversationId: closedId, draft: 'unfinished follow-up' })
    ])
    runtime.openDbAiPane()
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    expect(runtime.dbAiPaneConversationId.value).not.toBe(closedId)
    scope.stop()
  })

  it('waits for a pending open-state save before closing a blank DB AI session', async () => {
    const saveGate = deferred<{ ok: true; data: DatabaseAiPaneStateSnapshot }>()
    bridgeMocks.savePaneState.mockImplementation((snapshot: DatabaseAiPaneStateSnapshot) =>
      saveGate.promise.then(() => ({ ok: true as const, data: cloneSnapshot(snapshot) }))
    )
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.openDbAiPane()
    const openedId = runtime.dbAiPaneConversationId.value
    await nextTick()
    await vi.waitFor(() => expect(bridgeMocks.savePaneState).toHaveBeenCalled())

    const closePromise = runtime.closeDbAiPane()
    await Promise.resolve()
    expect(window.aiops.closeProductSession).not.toHaveBeenCalled()

    const pendingSnapshot = bridgeMocks.savePaneState.mock.calls[0][0] as DatabaseAiPaneStateSnapshot
    saveGate.resolve({ ok: true, data: cloneSnapshot(pendingSnapshot) })
    await expect(closePromise).resolves.toBe(true)
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(openedId)
    scope.stop()
  })

  it('restores an older DB AI session from product metadata when its UI projection was evicted', async () => {
    const sessionId = 'dbai-older-than-projection-cache'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Older DB AI',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders',
            schemaName: 'public'
          },
          nativeBinding: {
            engine: 'cline',
            nativeSessionId: 'cline-db-older'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    })
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)

    expect(window.aiops.getProductSession).toHaveBeenCalledWith(sessionId)
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: sessionId, isOpen: true })
    expect(runtime.dbAiPaneContext).toMatchObject({
      connectionId: postgresConnection.id,
      catalogName: 'orders',
      schemaName: 'public'
    })
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    expect(runtime.dbAiPaneCanSend.value).toBe(false)
    expect(runtime.dbAiPaneOpen.value).toBe(true)
    expect(showNotice).toHaveBeenCalledWith(
      '该 session 的较早界面消息已不在本地缓存中；数据库绑定和原生 AI 上下文已恢复。'
    )
    scope.stop()
  })

  it('uses Product Session database binding instead of a stale archived UI context', async () => {
    const sessionId = 'dbai-authoritative-binding'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Inventory DB AI',
          isOpen: false,
          database: {
            connectionId: inventoryConnection.id,
            databaseName: 'inventory',
            schemaName: 'public'
          },
          createdAt: 10,
          updatedAt: 20
        }
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection, inventoryConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => [postgresConnection, inventoryConnection].find((candidate) => candidate.id === id),
        defaultSqlContextForConnection: () => ({ connectionId: inventoryConnection.id, catalogName: 'inventory', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: inventoryConnection.id, catalogName: 'inventory', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.dbAiPaneArchivedSessions.value = [archivedSession(sessionId, 'stale orders answer')]

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)

    expect(runtime.dbAiPaneContext).toMatchObject({
      connectionId: inventoryConnection.id,
      catalogName: 'inventory',
      schemaName: 'public'
    })
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    scope.stop()
  })

  it('restores the latest SQLite projection page and loads older DB AI messages by cursor', async () => {
    const sessionId = 'dbai-sqlite-projection-pages'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Paged DB AI',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders',
            schemaName: 'public'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    })
    const paneMessage = (index: number): DatabaseAiPaneMessageRecord => ({
      id: `paged-message-${index}`,
      requestId: `paged-request-${Math.floor(index / 2)}`,
      role: index % 2 ? 'assistant' : 'user',
      status: 'done',
      content: `message ${index}`,
      contextSummary: 'orders-postgres · postgresql · orders · public',
      createdAt: index + 1,
      updatedAt: index + 1,
      responseLanguage: 'zh-CN'
    })
    vi.mocked(window.aiops.listProductSessionProjectionMessages).mockImplementation(async (_id, input) => {
      const start = input?.beforeOrdinal === 40 ? 0 : 40
      const count = input?.beforeOrdinal === 40 ? 40 : 80
      return {
        ok: true,
        data: {
          messages: Array.from({ length: count }, (_, offset) => {
            const index = start + offset
            return {
              messageId: `paged-message-${index}`,
              ordinal: index,
              payload: paneMessage(index),
              createdAt: 1,
              updatedAt: 1
            }
          }),
          hasMore: start > 0,
          nextBeforeOrdinal: start > 0 ? start : null,
          totalMessages: 120
        }
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)
    expect(runtime.dbAiPaneMessages.value).toHaveLength(80)
    expect(runtime.dbAiPaneMessages.value[0].id).toBe('paged-message-40')
    await expect(runtime.loadOlderDbAiPaneMessages()).resolves.toBe(40)
    expect(runtime.dbAiPaneMessages.value).toHaveLength(120)
    expect(runtime.dbAiPaneMessages.value[0].id).toBe('paged-message-0')
    expect(runtime.dbAiPaneMessagesForAgentContext()).toHaveLength(80)
    expect(runtime.dbAiPaneMessagesForAgentContext()[0].id).toBe('paged-message-40')
    expect(window.aiops.listProductSessionProjectionMessages).toHaveBeenNthCalledWith(2, sessionId, {
      beforeOrdinal: 40,
      limit: 80
    })
    scope.stop()
  })

  it('closes and rotates a restored DB AI session even when its UI projection is empty', async () => {
    const sessionId = 'dbai-empty-restored-session'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Empty restored DB AI',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders',
            schemaName: 'public'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    })
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    await expect(runtime.closeDbAiPane()).resolves.toBe(true)

    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(sessionId)
    expect(runtime.dbAiPaneConversationId.value).not.toBe(sessionId)
    expect(runtime.dbAiPaneOpen.value).toBe(false)
    runtime.openDbAiPane()
    expect(runtime.dbAiPaneConversationId.value).not.toBe(sessionId)
    scope.stop()
  })

  it('degrades a requiresSchema restore when product metadata has no schema', async () => {
    const sessionId = 'dbai-restore-without-schema'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Missing schema',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)
    runtime.dbAiPaneDraft.value = 'inspect orders'

    expect(runtime.dbAiPaneRestoreIssues.value).toEqual(['原 schema 已不存在或当前账号无权访问。'])
    expect(runtime.dbAiPaneCanSend.value).toBe(false)
    scope.stop()
  })

  it('rotates a product-backed DB AI session before changing context without cached messages', async () => {
    const sessionId = 'dbai-product-backed-context-change'
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          id: sessionId,
          surface: 'database',
          title: 'Evicted projection',
          isOpen: false,
          database: {
            connectionId: postgresConnection.id,
            databaseName: 'orders',
            schemaName: 'public'
          },
          nativeBinding: {
            engine: 'cline',
            nativeSessionId: 'cline-db-product-backed'
          },
          createdAt: 1,
          updatedAt: 2
        }
      }
    })
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!

    await expect(runtime.restoreDbAiPaneSession(sessionId)).resolves.toBe(true)
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    runtime.updateDbAiPaneSchema({ target: { value: 'audit' } } as unknown as Event)

    expect(runtime.dbAiPaneConversationId.value).not.toBe(sessionId)
    expect(runtime.dbAiPaneContext.schemaName).toBe('audit')
    await vi.waitFor(() => expect(window.aiops.closeProductSession).toHaveBeenCalledWith(sessionId))
    scope.stop()
  })

  it('rejects a concurrent DB AI history restore while the first restore is closing the current session', async () => {
    const closeGate = deferred<ProductSessionCloseResult>()
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.dbAiPaneArchivedSessions.value = [
      archivedSession('dbai-history-a', 'History A'),
      archivedSession('dbai-history-b', 'History B')
    ]
    vi.mocked(window.aiops.closeProductSession).mockImplementation(() => closeGate.promise)

    const firstRestore = runtime.restoreDbAiPaneSession('dbai-history-a')
    await expect(runtime.restoreDbAiPaneSession('dbai-history-b')).resolves.toBe(false)

    expect(showNotice).toHaveBeenCalledWith('DB AI session 正在恢复，请稍候。')
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()

    const closingId = vi.mocked(window.aiops.closeProductSession).mock.calls[0][0]
    closeGate.resolve({ ok: true, data: { id: closingId, stopped: false } })
    await expect(firstRestore).resolves.toBe(true)

    expect(runtime.dbAiPaneMessages.value).toEqual([
      expect.objectContaining({ content: 'History A' })
    ])
    expect(window.aiops.updateProductSession).toHaveBeenCalledTimes(1)
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: 'dbai-history-a', isOpen: true })
    scope.stop()
  })

  it('rejects reset while a DB AI history restore is reopening its target session', async () => {
    const reopenGate = deferred<ProductSessionRecordResult>()
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.dbAiPaneArchivedSessions.value = [archivedSession('dbai-history-reset-race', 'History')]
    vi.mocked(window.aiops.updateProductSession).mockImplementation(() => reopenGate.promise)

    const restorePromise = runtime.restoreDbAiPaneSession('dbai-history-reset-race')
    await vi.waitFor(() => expect(window.aiops.updateProductSession).toHaveBeenCalledWith({
      id: 'dbai-history-reset-race',
      isOpen: true
    }))

    expect(runtime.resetDbAiPaneConversation()).toBe(false)
    expect(showNotice).toHaveBeenCalledWith('DB AI session 正在恢复，请稍候。')

    reopenGate.resolve(productSessionUpdateResult('dbai-history-reset-race'))
    await expect(restorePromise).resolves.toBe(true)
    expect(runtime.dbAiPaneMessages.value).toEqual([
      expect.objectContaining({ content: 'History' })
    ])
    scope.stop()
  })

  it('reports structured product-session close and reopen failures', async () => {
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const showNotice = vi.fn()
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice,
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.openDbAiPane()
    runtime.dbAiPaneMessages.value = archivedSession('source', 'History').messages
    await nextTick()
    await runtime.persistDbAiPaneState()
    const previousId = (bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot).conversationId!
    vi.mocked(window.aiops.closeProductSession).mockResolvedValue({
      ok: false,
      errorCode: 'PRODUCT_SESSION_CLOSE_FAILED',
      errorMessage: 'close rejected'
    })
    vi.mocked(window.aiops.updateProductSession).mockResolvedValue({
      ok: false,
      errorCode: 'PRODUCT_SESSION_UPDATE_FAILED',
      errorMessage: 'reopen rejected'
    })

    runtime.updateDbAiPaneSchema({ target: { value: 'audit' } } as unknown as Event)
    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith('DB AI session 关闭失败。'))
    await expect(runtime.restoreDbAiPaneSession(previousId)).resolves.toBe(false)

    expect(showNotice).toHaveBeenCalledWith('DB AI session 更新失败。')
    expect(runtime.dbAiPaneContext).toMatchObject({ catalogName: 'orders', schemaName: 'audit' })
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    expect(runtime.dbAiPaneArchivedSessions.value).toEqual([
      expect.objectContaining({ conversationId: previousId })
    ])
    scope.stop()
  })

  it('clears DB AI state after cancellation times out when the active product session is permanently deleted', async () => {
    vi.useFakeTimers()
    let emitDeleted: ((id: string) => void) | undefined
    const unsubscribe = vi.fn()
    vi.mocked(window.aiops.onProductSessionChanged).mockImplementation((listener) => {
      emitDeleted = (id) => listener({ type: 'deleted', id })
      return unsubscribe
    })
    bridgeMocks.savePaneState.mockImplementation(async (snapshot: DatabaseAiPaneStateSnapshot) => ({
      ok: true,
      data: cloneSnapshot(snapshot)
    }))
    const scope = effectScope()
    const runtime = scope.run(() => createDatabaseAiPaneWorkspaceRuntime(
      {
        connections: ref([postgresConnection]),
        expandedConnections: ref<string[]>([]),
        activeSqlTab: computed(() => null),
        databaseAiPanelsRef: ref(null)
      },
      {
        showNotice: vi.fn(),
        bridgeErrorMessage: (_error, fallback) => fallback,
        findConnection: (id) => id === postgresConnection.id ? postgresConnection : undefined,
        defaultSqlContextForConnection: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        resolveSqlConsoleContext: () => ({ connectionId: postgresConnection.id, catalogName: 'orders', schemaName: 'public', tableName: '' }),
        connectConnection: async () => true,
        getResponseLanguage: () => 'zh-CN',
        getSelectedSqlText: () => '',
        getSqlCursorOffset: () => 0
      }
    ))!
    runtime.dbAiPaneMessages.value = archivedSession('active', 'Active message').messages.map((message) => ({
      ...message,
      status: 'streaming' as const
    }))
    bridgeMocks.cancelPaneResponse.mockImplementation(() => new Promise<DatabaseAiPaneLifecycleResult>(() => undefined))
    runtime.dbAiPaneArchivedSessions.value = [archivedSession('dbai-archived-deleted', 'Archived message')]
    await runtime.persistDbAiPaneState()
    const activeId = (bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot).conversationId!

    emitDeleted?.(activeId)
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.dbAiPaneMessages.value).not.toEqual([])
    await vi.advanceTimersByTimeAsync(DB_AI_PANE_CANCEL_BRIDGE_TIMEOUT_MS)
    await nextTick()
    expect(runtime.dbAiPaneMessages.value).toEqual([])
    const clearedSnapshot = bridgeMocks.savePaneState.mock.calls.at(-1)?.[0] as DatabaseAiPaneStateSnapshot
    expect(clearedSnapshot.conversationId).not.toBe(activeId)

    emitDeleted?.('dbai-archived-deleted')
    await nextTick()
    await runtime.persistDbAiPaneState()
    expect(runtime.dbAiPaneArchivedSessions.value).toEqual([])
    scope.stop()
    vi.useRealTimers()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
