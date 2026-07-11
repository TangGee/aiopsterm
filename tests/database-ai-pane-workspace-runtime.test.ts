import { computed, effectScope, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseAiPaneWorkspaceRuntime } from '@/services/database/databaseAiPaneWorkspaceRuntime'
import type { SqlTab } from '@/services/database/databaseAiRuntime'
import type {
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionInfo
} from '@shared/contracts/database'

const bridgeMocks = vi.hoisted(() => ({
  savePaneState: vi.fn(),
  createPaneRequest: vi.fn(),
  startPaneResponse: vi.fn(),
  generatePaneResponse: vi.fn()
}))

vi.mock('@/services/database/databaseClient', () => ({
  databaseClient: {
    saveDatabaseAiPaneState: () => bridgeMocks.savePaneState,
    createDatabaseAiPaneRequest: () => bridgeMocks.createPaneRequest,
    startDatabaseAiPaneResponse: () => bridgeMocks.startPaneResponse,
    generateDatabaseAiPaneResponse: () => bridgeMocks.generatePaneResponse
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

const cloneMessage = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({
  ...message,
  ...(message.context ? { context: { ...message.context } } : {}),
  ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
})

const cloneSnapshot = (snapshot: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  ...snapshot,
  context: { ...snapshot.context },
  messages: snapshot.messages.map(cloneMessage)
})

describe('database AI pane workspace request lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

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
})
