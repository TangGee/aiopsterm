import { randomUUID } from 'crypto'
import type {
  DatabaseAiResponseProvider,
  DatabaseAiDrawerAction,
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiTargetDialect,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneStateResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlErrorDiagnosisResult
} from './contracts/database'
import {
  buildDatabaseAiDrawerGeneratedSql,
  buildDatabaseAiDrawerReasoning,
  composeDatabaseAiDrawerResponseText,
  databaseAiDrawerActionName,
  databaseAiDrawerTargetDialect,
  databaseAiFirstTableNameForPaneContext,
  databaseAiPaneSchemaSummaryForContext,
  suggestedDatabaseAiReadOnlySqlForContext,
  type DatabaseAiTableContext
} from './databaseAiSqlRuntime'
import {
  databaseAiDrawerProviderSystemPrompt,
  databaseAiDrawerProviderMessages,
  databaseAiPaneProviderMessages,
  databaseAiPaneProviderSystemPrompt,
  extractDatabaseAiFencedSqlBlock,
  normalizeDatabaseAiProviderText,
  type DatabaseAiProviderTextInput,
  type DatabaseAiProviderTextResult
} from './databaseAiProviderRuntime'
import {
  createDatabaseAiPaneMessageRecord,
  findDatabaseAiDrawerRequest,
  findDatabaseAiPaneAssistantMessage,
  getDatabaseAiPaneStateSnapshot,
  replaceDatabaseAiPaneState,
  storeDatabaseAiDrawerRequest,
  storeDatabaseAiPaneMessage,
  updateDatabaseAiDrawerRequest,
  updateDatabaseAiPaneAssistantMessage
} from './databaseAiStateRuntime'
import { shouldUseDatabaseAiBackendDouble } from './runtimeSwitches'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export type DatabaseAiBackendContext = {
  ensureStateLoaded?: () => void
  persistState?: () => void
  tableKeysForContext?: (input: Omit<DatabaseAiTableContext, 'tableName'>) => string[]
  tableKeyForContext?: (input: DatabaseAiTableContext) => string
  columnsForTableKey?: (key: string) => string[]
}

let databaseAiBackendContext: DatabaseAiBackendContext = {}

export function configureDatabaseAiBackendContext(context?: DatabaseAiBackendContext) {
  databaseAiBackendContext = context ? { ...context } : {}
}

const databaseAiEnsureStateLoaded = () => {
  databaseAiBackendContext.ensureStateLoaded?.()
}

const databaseAiPersistState = () => {
  databaseAiBackendContext.persistState?.()
}

export const DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS = 500
export const DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS = 260

export type {
  DatabaseAiProviderTextInput,
  DatabaseAiProviderTextMessage,
  DatabaseAiProviderTextResult
} from './databaseAiProviderRuntime'

type DatabaseAiRuntimeConfig = {
  getModelName?: () => string | undefined
  generateText?: (input: DatabaseAiProviderTextInput) => Promise<DatabaseAiProviderTextResult>
  localBackendDouble?: boolean
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
}

let databaseAiRuntime: DatabaseAiRuntimeConfig = {}

export function configureDatabaseAiRuntime(config?: DatabaseAiRuntimeConfig) {
  databaseAiRuntime = config ? { ...config } : {}
}

export {
  getDatabaseAiPaneStateSnapshot,
  normalizeDatabaseAiPaneState,
  replaceDatabaseAiPaneState,
  resetDatabaseAiState as resetDatabaseAiBackendState
} from './databaseAiStateRuntime'

export function getDatabaseAiPaneState(): DatabaseAiPaneStateResult {
  databaseAiEnsureStateLoaded()
  return {
    ok: true,
    data: getDatabaseAiPaneStateSnapshot()
  }
}

export function saveDatabaseAiPaneState(input: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateResult {
  databaseAiEnsureStateLoaded()
  replaceDatabaseAiPaneState(input)
  databaseAiPersistState()
  return {
    ok: true,
    data: getDatabaseAiPaneStateSnapshot()
  }
}

const databaseAiPaneContextSummary = (input: DatabaseAiPaneResponseInput) =>
  trim(input.context.contextSummary) ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneErrorResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiPaneResponseResult => {
  const requestId = trim(input.requestId) || `dbai-pane-request-${randomUUID()}`
  const contextSummary = databaseAiPaneContextSummary(input)
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  let assistantMessage: DatabaseAiPaneMessageRecord
  if (existing && existing.status !== 'cancelled') {
    assistantMessage =
      updateDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: existing.id }, { status: 'error', content: errorMessage }, databaseAiNow) ??
      existing
  } else {
    assistantMessage =
      existing ??
      storeDatabaseAiPaneMessage(
        createDatabaseAiPaneMessageRecord(
          {
            requestId,
            role: 'assistant',
            status: 'error',
            content: errorMessage,
            contextSummary,
            createdAt: startedAt
          },
          input.assistantMessageId || `dbai-pane-message-${randomUUID()}`
        )
      )
  }

  databaseAiPersistState()
  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiDrawerErrorResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiDrawerResponseResult => {
  const requestId = trim(input.requestId)
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  const targetDialect = databaseAiDrawerTargetDialect(input)
  const text = `Reasoning\n- ${errorMessage}`
  let request: DatabaseAiDrawerRequestRecord
  if (existing && existing.status !== 'cancelled') {
    request = updateDatabaseAiDrawerRequest({ requestId: existing.id }, { status: 'error', text, targetDialect }, databaseAiNow) ?? existing
  } else {
    request =
      existing ??
      storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'error',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
  }

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      request,
      text: request.text,
      reasoning: request.text,
      sql: '',
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const wait = (durationMs: number) => {
  if (databaseAiRuntime.wait) return databaseAiRuntime.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const databaseAiNow = () => (databaseAiRuntime.now ? databaseAiRuntime.now() : Date.now())

const databaseAiModelName = () => trim(databaseAiRuntime.getModelName?.()) || 'aiopsterm-local-agent'

const shouldUseDatabaseAiProvider = (modelName: string) => trim(modelName) !== '' && trim(modelName) !== 'aiopsterm-local-agent'

const isDatabaseAiLocalDoubleEnabled = () => databaseAiRuntime.localBackendDouble === true || shouldUseDatabaseAiBackendDouble()

const databaseAiTableMetadata = () => ({
  tableKeysForContext: (input: Omit<DatabaseAiTableContext, 'tableName'>) => databaseAiBackendContext.tableKeysForContext?.(input) ?? [],
  tableKeyForContext: (input: DatabaseAiTableContext) => databaseAiBackendContext.tableKeyForContext?.(input) || '',
  columnsForTableKey: (key: string) => (databaseAiBackendContext.columnsForTableKey?.(key) ?? []).slice()
})

const storeDatabaseAiPaneDoneResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  requestId: string,
  text: string,
  contextLine: string
) => {
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  const assistantMessage = storeDatabaseAiPaneMessage(
    {
      ...createDatabaseAiPaneMessageRecord(
        {
          requestId,
          role: 'assistant',
          status: 'done',
          content: text,
          contextSummary: contextLine,
          createdAt: existing?.createdAt ?? startedAt
        },
        input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
      ),
      updatedAt: databaseAiNow()
    }
  )
  return assistantMessage
}

async function generateProviderDatabaseAiPaneResponse(
  input: DatabaseAiPaneResponseInput,
  modelName: string,
  startedAt: number,
  prompt: string
): Promise<DatabaseAiPaneResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const contextLine = databaseAiPaneContextSummary(input)
  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const existingBefore = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingBefore,
        text: existingBefore.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'pane',
    modelName,
    prompt,
    context: input.context,
    requestId,
    assistantMessageId: input.assistantMessageId,
    activeSql: input.activeSql,
    systemPrompt: databaseAiPaneProviderSystemPrompt(input, databaseAiTableMetadata()),
    messages: databaseAiPaneProviderMessages(input, prompt),
    maxTokens: 1800
  })
  const existingAfter = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingAfter,
        text: existingAfter.content,
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiPaneErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const text = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!text) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const assistantMessage = storeDatabaseAiPaneDoneResponse(input, startedAt, requestId, text, contextLine)
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const storeDatabaseAiDrawerDoneResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  requestId: string,
  dialect: DatabaseAiTargetDialect,
  text: string
) => {
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  return existing && requestId
    ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect }, databaseAiNow)
    : storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'done',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect: dialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
}

async function generateProviderDatabaseAiDrawerResponse(
  input: DatabaseAiDrawerResponseInput,
  modelName: string,
  startedAt: number,
  dialect: DatabaseAiTargetDialect
): Promise<DatabaseAiDrawerResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const requestId = trim(input.requestId)
  const existingBefore = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingBefore,
        text: existingBefore.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'drawer',
    modelName,
    prompt: databaseAiDrawerActionName(input.action),
    context: input.context,
    requestId,
    action: input.action,
    sourceSql: input.sourceSql,
    targetDialect: dialect,
    errorMessage: input.errorMessage,
    systemPrompt: databaseAiDrawerProviderSystemPrompt(input, dialect, databaseAiTableMetadata()),
    messages: databaseAiDrawerProviderMessages(input, dialect),
    maxTokens: 1400
  })
  const existingAfter = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingAfter,
        text: existingAfter.text,
        reasoning: '',
        sql: '',
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const providerText = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!providerText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const parsed = extractDatabaseAiFencedSqlBlock(providerText)
  if (!parsed.sql) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      'DB_AI_PROVIDER_SQL_MISSING',
      'Database AI provider response did not include a fenced SQL block.',
      providerResponse.provider
    )
  }
  const reasoning = parsed.reasoning || `Reasoning\n- Provider returned SQL for ${databaseAiDrawerActionName(input.action)}.`
  const text = composeDatabaseAiDrawerResponseText(reasoning, parsed.sql)
  const request = storeDatabaseAiDrawerDoneResponse(input, startedAt, requestId, dialect, text)
  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: parsed.sql,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function createDatabaseAiPaneRequest(input: DatabaseAiPaneRequestInput): Promise<DatabaseAiPaneRequestResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = Date.now()
  const prompt = trim(input.prompt)
  if (!prompt) return { ok: false, errorCode: 'DB_AI_PROMPT_REQUIRED', errorMessage: 'Prompt is required.' }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.context.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  const requestId = `dbai-pane-request-${randomUUID()}`
  const contextSummary =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')
  const userCreatedAt = startedAt
  const userMessage = storeDatabaseAiPaneMessage(
    createDatabaseAiPaneMessageRecord({
      requestId,
      role: 'user',
      status: 'done',
      content: prompt,
      contextSummary,
      createdAt: userCreatedAt
    })
  )
  const assistantMessage = storeDatabaseAiPaneMessage(
    createDatabaseAiPaneMessageRecord({
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary,
      createdAt: userCreatedAt + 1
    })
  )
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      userMessage,
      assistantMessage
    }
  }
}

export function startDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'cancelled' || existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, { status: 'streaming' }, databaseAiNow)
  if (assistantMessage) databaseAiPersistState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export function cancelDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, {
    status: 'cancelled',
    content: existing.content || 'Response cancelled before the first chunk.'
  }, databaseAiNow)
  if (assistantMessage) databaseAiPersistState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export async function generateDatabaseAiPaneResponse(input: DatabaseAiPaneResponseInput): Promise<DatabaseAiPaneResponseResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = databaseAiNow()
  const prompt = trim(input.prompt)
  if (!prompt) return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROMPT_REQUIRED', 'Prompt is required.')
  if (!trim(input.context.connectionId)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }
  if (!trim(input.context.databaseName)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_DATABASE_REQUIRED', 'Database name is required.')
  }

  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiPaneResponse(input, modelName, startedAt, prompt)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const promptLower = prompt.toLowerCase()
  const contextLine = databaseAiPaneContextSummary(input)
  const recentTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-4).length
  const metadata = databaseAiTableMetadata()
  const selectSql = suggestedDatabaseAiReadOnlySqlForContext(input, metadata)
  const lines = [`Context: ${contextLine}`, '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。', `Recent user turns: ${recentTurns}`]

  if (promptLower.includes('explain') || promptLower.includes('解释')) {
    lines.push(
      '',
      'I read the active SQL editor and current database context.',
      'Execution notes:',
      '- Keep the query read-only before running it from the workbench.',
      '- Verify WHERE clauses before widening result sets.',
      '- Check indexes on join/filter columns if latency grows.',
      '',
      'Suggested next SQL:',
      '```sql',
      selectSql,
      '```'
    )
  } else if (promptLower.includes('schema') || promptLower.includes('table') || promptLower.includes('表')) {
    lines.push('', 'Schema summary:', ...databaseAiPaneSchemaSummaryForContext(input, metadata), '', 'Recommended starting point:', '```sql', selectSql, '```')
  } else if (promptLower.includes('select') || promptLower.includes('query') || promptLower.includes('sql')) {
    const tableName = databaseAiFirstTableNameForPaneContext(input, metadata)
    lines.push('', `Generated a conservative read-only query${tableName ? ` for ${tableName}` : ''}.`, '', '```sql', selectSql, '```')
  } else {
    lines.push(
      '',
      'I can help inspect schema metadata, draft read-only SQL, explain editor SQL, and suggest optimization checks in this database workspace.',
      '',
      '```sql',
      selectSql,
      '```'
    )
  }

  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const text = lines.join('\n')
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existing,
        text: existing.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  const assistantMessage = storeDatabaseAiPaneMessage(
    {
      ...createDatabaseAiPaneMessageRecord(
        {
          requestId,
          role: 'assistant',
          status: 'done',
          content: text,
          contextSummary: contextLine,
          createdAt: existing?.createdAt ?? startedAt
        },
        input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
      ),
      updatedAt: databaseAiNow()
    }
  )
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function createDatabaseAiDrawerRequest(input: DatabaseAiDrawerRequestInput): Promise<DatabaseAiDrawerRequestResult> {
  databaseAiEnsureStateLoaded()
  const now = Date.now()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return { ok: false, errorCode: 'DB_AI_ACTION_INVALID', errorMessage: 'DB AI action is not supported.' }
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }

  const requestId = trim(input.requestId) || `dbai-drawer-request-${randomUUID()}`
  const existing = findDatabaseAiDrawerRequest({ requestId })
  if (existing) {
    return { ok: false, errorCode: 'DB_AI_REQUEST_DUPLICATE', errorMessage: 'DB AI drawer request id already exists.' }
  }

  const request: DatabaseAiDrawerRequestRecord = {
    id: requestId,
    action,
    label: databaseAiDrawerActionName(action),
    status: 'queued',
    contextSummary: trim(input.context.contextSummary),
    sourceSql: input.sourceSql,
    text: '',
    targetDialect: databaseAiDrawerTargetDialect(input),
    backendContext: {
      connectionId: trim(input.context.connectionId),
      dbType: input.context.dbType || '',
      databaseName: trim(input.context.databaseName),
      schemaName: trim(input.context.schemaName) || undefined,
      tableName: trim(input.context.tableName) || undefined,
      contextSummary: trim(input.context.contextSummary) || undefined
    },
    createdAt: now,
    updatedAt: now
  }
  return { ok: true, data: storeDatabaseAiDrawerRequest(request) }
}

export function startDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'cancelled') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'streaming', text: '' }, databaseAiNow)
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export function cancelDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'done' || existing.status === 'error') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'cancelled' }, databaseAiNow)
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export async function generateDatabaseAiDrawerResponse(input: DatabaseAiDrawerResponseInput): Promise<DatabaseAiDrawerResponseResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = databaseAiNow()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_ACTION_INVALID', 'DB AI action is not supported.')
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_SQL_REQUIRED', 'SQL is required.')
  }
  if (!trim(input.context.connectionId)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }

  const dialect = databaseAiDrawerTargetDialect(input)
  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiDrawerResponse(input, modelName, startedAt, dialect)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const generatedSql = buildDatabaseAiDrawerGeneratedSql(input, dialect, databaseAiTableMetadata())
  const reasoning = buildDatabaseAiDrawerReasoning(input, generatedSql, dialect)
  const requestId = trim(input.requestId)
  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existing,
        text: existing.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const text = composeDatabaseAiDrawerResponseText(reasoning, generatedSql)
  const request =
    existing && requestId
      ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect }, databaseAiNow)
      : storeDatabaseAiDrawerRequest({
          id: requestId || `dbai-drawer-request-${randomUUID()}`,
          action,
          label: databaseAiDrawerActionName(action),
          status: 'done',
          contextSummary: trim(input.context.contextSummary),
          sourceSql: input.sourceSql,
          text,
          targetDialect: dialect,
          backendContext: {
            connectionId: trim(input.context.connectionId),
            dbType: input.context.dbType || '',
            databaseName: trim(input.context.databaseName),
            schemaName: trim(input.context.schemaName) || undefined,
            tableName: trim(input.context.tableName) || undefined,
            contextSummary: trim(input.context.contextSummary) || undefined
          },
          createdAt: startedAt,
          updatedAt: databaseAiNow()
        })

  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }

  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: generatedSql,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function diagnoseDatabaseSqlError(input: DatabaseSqlErrorDiagnosisInput): Promise<DatabaseSqlErrorDiagnosisResult> {
  databaseAiEnsureStateLoaded()
  const requestId = trim(input.requestId) || `dbai-diagnose-request-${randomUUID()}`
  const sourceSql = trim(input.sourceSql)
  const errorMessage = trim(input.errorMessage)
  if (!sourceSql) return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  if (!errorMessage) return { ok: false, errorCode: 'DB_AI_ERROR_REQUIRED', errorMessage: 'SQL error message is required.' }

  const created = await createDatabaseAiDrawerRequest({
    requestId,
    action: 'diagnose',
    sourceSql,
    targetDialect: input.targetDialect,
    context: input.context,
    errorMessage
  })
  if (!created.ok || !created.data) {
    return { ok: false, errorCode: created.errorCode, errorMessage: created.errorMessage }
  }

  const started = startDatabaseAiDrawerResponse({ requestId: created.data.id })
  if (!started.ok || !started.data) {
    return { ok: false, errorCode: started.errorCode, errorMessage: started.errorMessage }
  }

  return generateDatabaseAiDrawerResponse({
    requestId,
    action: 'diagnose',
    sourceSql: created.data.sourceSql,
    targetDialect: created.data.targetDialect,
    context: created.data.backendContext,
    errorMessage
  })
}
