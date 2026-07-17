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
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseAiResponseLanguage,
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
  normalizeDatabaseAiResponseLanguage,
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
  deleteDatabaseAiPaneSessionProjection,
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
const databaseAiLanguageText = (language: DatabaseAiResponseLanguage | undefined, zhCN: string, enUS: string) =>
  normalizeDatabaseAiResponseLanguage(language) === 'zh-CN' ? zhCN : enUS

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
  loadDatabaseContext?: (input: DatabaseAiContextLoadInput) => Promise<string>
  localBackendDouble?: boolean
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
}

export type DatabaseAiContextLoadInput = {
  surface: 'pane' | 'drawer'
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']
  action?: DatabaseAiDrawerAction
  sql?: string
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

export function deleteDatabaseAiPaneSession(conversationId: string) {
  databaseAiEnsureStateLoaded()
  const deleted = deleteDatabaseAiPaneSessionProjection(conversationId)
  if (deleted) databaseAiPersistState()
  return deleted
}

const databaseAiPaneContextSummary = (input: DatabaseAiPaneResponseInput) =>
  trim(input.context.contextSummary) ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneStateContext = (
  context: DatabaseAiPaneRequestInput['context'] | DatabaseAiPaneResponseInput['context']
): DatabaseAiPaneStateContext => ({
  connectionId: trim(context.connectionId),
  catalogName: trim(context.databaseName),
  schemaName: trim(context.schemaName),
  dbType: context.dbType || ''
})

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
            createdAt: startedAt,
            responseLanguage: input.responseLanguage,
            context: databaseAiPaneStateContext(input.context)
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

const databaseAiPaneDiscardedResponse = (
  existing: DatabaseAiPaneMessageRecord,
  requestId: string,
  startedAt: number,
  provider: DatabaseAiResponseProvider
): DatabaseAiPaneResponseResult => {
  const assistantMessage: DatabaseAiPaneMessageRecord = {
    ...existing,
    status: 'cancelled',
    content: existing.content || databaseAiLanguageText(
      existing.responseLanguage,
      '由于会话已重置，响应已丢弃。',
      'Response discarded because the conversation was reset.'
    ),
    updatedAt: databaseAiNow()
  }
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiPaneMissingLifecycleResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number
): DatabaseAiPaneResponseResult => {
  const requestId = trim(input.requestId)
  const now = databaseAiNow()
  return databaseAiPaneDiscardedResponse(
    {
      id: trim(input.assistantMessageId),
      requestId,
      role: 'assistant',
      status: 'cancelled',
      content: databaseAiLanguageText(input.responseLanguage, '由于会话已重置，响应已丢弃。', 'Response discarded because the conversation was reset.'),
      contextSummary: databaseAiPaneContextSummary(input),
      createdAt: startedAt,
      updatedAt: now,
      responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage),
      context: databaseAiPaneStateContext(input.context)
    },
    requestId,
    startedAt,
    'aiopsterm-local'
  )
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
  const responseLanguage = normalizeDatabaseAiResponseLanguage(existing?.responseLanguage ?? input.responseLanguage)
  const text = `${responseLanguage === 'zh-CN' ? '分析' : 'Reasoning'}\n- ${errorMessage}`
  let request: DatabaseAiDrawerRequestRecord
  if (existing && existing.status !== 'cancelled') {
    request = updateDatabaseAiDrawerRequest({ requestId: existing.id }, { status: 'error', text, targetDialect }, databaseAiNow) ?? existing
  } else {
    request =
      existing ??
      storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        ...(trim(input.conversationId) ? { conversationId: trim(input.conversationId) } : {}),
        action: input.action,
        label: databaseAiDrawerActionName(input.action, responseLanguage),
        status: 'error',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect,
        responseLanguage,
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

const databaseAiLoadedContext = async (input: DatabaseAiContextLoadInput) => {
  const loadDatabaseContext = databaseAiRuntime.loadDatabaseContext
  if (!loadDatabaseContext) return ''
  try {
    return trim(await loadDatabaseContext(input))
  } catch {
    return ''
  }
}

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
          createdAt: existing?.createdAt ?? startedAt,
          responseLanguage: existing?.responseLanguage ?? input.responseLanguage,
          context: databaseAiPaneStateContext(input.context)
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

  const metadata = databaseAiTableMetadata()
  const systemPrompt = databaseAiPaneProviderSystemPrompt(input)
  const loadedContext = await databaseAiLoadedContext(
    {
      surface: 'pane',
      context: input.context,
      ...(input.action ? { action: input.action } : {}),
      ...(trim(input.activeSql) ? { sql: input.activeSql } : {})
    }
  )
  const cancelledAfterContext = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (cancelledAfterContext?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: cancelledAfterContext,
        text: cancelledAfterContext.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  const providerResponse = await generateText({
    surface: 'pane',
    conversationId: trim(input.conversationId) || undefined,
    responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage),
    modelName,
    prompt,
    context: input.context,
    requestId,
    assistantMessageId: input.assistantMessageId,
    action: input.action,
    activeSql: input.activeSql,
    systemPrompt,
    messages: databaseAiPaneProviderMessages(input, prompt, metadata, loadedContext),
    maxTokens: 1800
  })
  const existingAfter = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingBefore && !existingAfter) {
    return databaseAiPaneDiscardedResponse(
      existingBefore,
      requestId,
      startedAt,
      providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local'
    )
  }
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
        ...(trim(input.conversationId) ? { conversationId: trim(input.conversationId) } : {}),
        action: input.action,
        label: databaseAiDrawerActionName(input.action, normalizeDatabaseAiResponseLanguage(input.responseLanguage)),
        status: 'done',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect: dialect,
        responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage),
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

  const metadata = databaseAiTableMetadata()
  const systemPrompt = databaseAiDrawerProviderSystemPrompt(input, dialect)
  const loadedContext = await databaseAiLoadedContext(
    {
      surface: 'drawer',
      context: input.context,
      action: input.action,
      ...(trim(input.sourceSql) ? { sql: input.sourceSql } : {})
    }
  )
  const cancelledAfterContext = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (cancelledAfterContext?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: cancelledAfterContext,
        text: cancelledAfterContext.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  const providerResponse = await generateText({
    surface: 'drawer',
    ...(trim(input.conversationId) ? { conversationId: trim(input.conversationId) } : {}),
    responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage),
    modelName,
    prompt: databaseAiDrawerActionName(input.action, normalizeDatabaseAiResponseLanguage(input.responseLanguage)),
    context: input.context,
    requestId,
    action: input.action,
    sourceSql: input.sourceSql,
    targetDialect: dialect,
    errorMessage: input.errorMessage,
    systemPrompt,
    messages: databaseAiDrawerProviderMessages(input, dialect, metadata, loadedContext),
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
  const reasoning = parsed.reasoning || databaseAiLanguageText(
    input.responseLanguage,
    `分析\n- Provider 已为${databaseAiDrawerActionName(input.action, 'zh-CN')}返回 SQL。`,
    `Reasoning\n- Provider returned SQL for ${databaseAiDrawerActionName(input.action, 'en-US')}.`
  )
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
  const responseLanguage = normalizeDatabaseAiResponseLanguage(input.responseLanguage)
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
      createdAt: userCreatedAt,
      responseLanguage,
      context: databaseAiPaneStateContext(input.context)
    })
  )
  const assistantMessage = storeDatabaseAiPaneMessage(
    createDatabaseAiPaneMessageRecord({
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary,
      createdAt: userCreatedAt + 1,
      responseLanguage,
      context: databaseAiPaneStateContext(input.context)
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
    content: existing.content || databaseAiLanguageText(
      existing.responseLanguage,
      '响应已在第一个内容片段返回前取消。',
      'Response cancelled before the first chunk.'
    )
  }, databaseAiNow)
  if (assistantMessage) databaseAiPersistState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export async function generateDatabaseAiPaneResponse(input: DatabaseAiPaneResponseInput): Promise<DatabaseAiPaneResponseResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = databaseAiNow()
  input = { ...input, responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage) }
  const explicitRequestId = trim(input.requestId)
  const explicitAssistantMessageId = trim(input.assistantMessageId)
  const lifecycleMessage = explicitRequestId
    ? findDatabaseAiPaneAssistantMessage({ requestId: explicitRequestId, assistantMessageId: explicitAssistantMessageId })
    : null
  if (
    explicitRequestId &&
    explicitAssistantMessageId &&
    !lifecycleMessage
  ) {
    return databaseAiPaneMissingLifecycleResponse(input, startedAt)
  }
  if (lifecycleMessage?.responseLanguage) {
    input = { ...input, responseLanguage: normalizeDatabaseAiResponseLanguage(lifecycleMessage.responseLanguage) }
  }
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
  const zhCN = input.responseLanguage === 'zh-CN'
  const lines = zhCN
    ? [`上下文：${contextLine}`, '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。', `最近用户轮次：${recentTurns}`]
    : [`Context: ${contextLine}`, 'This response was generated by the local aiopsterm DB AI backend without a remote database AI service.', `Recent user turns: ${recentTurns}`]

  if (promptLower.includes('explain') || promptLower.includes('解释')) {
    lines.push(...(zhCN
      ? [
          '',
          '我已读取当前 SQL 编辑器内容和数据库上下文。',
          '执行注意事项：',
          '- 从工作台运行前，请保持查询只读。',
          '- 扩大结果集前，请检查 WHERE 条件。',
          '- 如果延迟上升，请检查连接列和过滤列上的索引。',
          '',
          '建议的下一条 SQL：',
          '```sql',
          selectSql,
          '```'
        ]
      : [
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
        ]))
  } else if (promptLower.includes('schema') || promptLower.includes('table') || promptLower.includes('表') || promptLower.includes('结构')) {
    lines.push(
      '',
      zhCN ? '数据库结构摘要：' : 'Schema summary:',
      ...databaseAiPaneSchemaSummaryForContext(input, metadata),
      '',
      zhCN ? '建议的起始查询：' : 'Recommended starting point:',
      '```sql',
      selectSql,
      '```'
    )
  } else if (promptLower.includes('select') || promptLower.includes('query') || promptLower.includes('sql')) {
    const tableName = databaseAiFirstTableNameForPaneContext(input, metadata)
    lines.push('', zhCN
      ? `已生成一条保守的只读查询${tableName ? `，目标 table 为 ${tableName}` : ''}。`
      : `Generated a conservative read-only query${tableName ? ` for ${tableName}` : ''}.`, '', '```sql', selectSql, '```')
  } else {
    lines.push(
      '',
      zhCN
        ? '我可以在此数据库工作区中帮助检查数据库结构元数据、草拟只读 SQL、解释编辑器中的 SQL，并建议优化检查项。'
        : 'I can help inspect schema metadata, draft read-only SQL, explain editor SQL, and suggest optimization checks in this database workspace.',
      '',
      '```sql',
      selectSql,
      '```'
    )
  }

  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const existingBefore = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const text = lines.join('\n')
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingBefore && !existing) {
    return databaseAiPaneDiscardedResponse(existingBefore, requestId, startedAt, 'aiopsterm-local')
  }
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
          createdAt: existing?.createdAt ?? startedAt,
          responseLanguage: existing?.responseLanguage ?? input.responseLanguage,
          context: databaseAiPaneStateContext(input.context)
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
  const responseLanguage = normalizeDatabaseAiResponseLanguage(input.responseLanguage)
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
    ...(trim(input.conversationId) ? { conversationId: trim(input.conversationId) } : {}),
    action,
    label: databaseAiDrawerActionName(action, responseLanguage),
    status: 'queued',
    contextSummary: trim(input.context.contextSummary),
    sourceSql: input.sourceSql,
    text: '',
    targetDialect: databaseAiDrawerTargetDialect(input),
    responseLanguage,
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
  const requestId = trim(input.requestId)
  const storedRequest = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  input = {
    ...input,
    ...(storedRequest?.conversationId ? { conversationId: storedRequest.conversationId } : {}),
    responseLanguage: normalizeDatabaseAiResponseLanguage(storedRequest?.responseLanguage ?? input.responseLanguage)
  }
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
          ...(trim(input.conversationId) ? { conversationId: trim(input.conversationId) } : {}),
          action,
          label: databaseAiDrawerActionName(action, input.responseLanguage),
          status: 'done',
          contextSummary: trim(input.context.contextSummary),
          sourceSql: input.sourceSql,
          text,
          targetDialect: dialect,
          responseLanguage: input.responseLanguage,
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
  const responseLanguage = normalizeDatabaseAiResponseLanguage(input.responseLanguage)
  if (!sourceSql) return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  if (!errorMessage) return { ok: false, errorCode: 'DB_AI_ERROR_REQUIRED', errorMessage: 'SQL error message is required.' }

  const created = await createDatabaseAiDrawerRequest({
    requestId,
    action: 'diagnose',
    responseLanguage,
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
    responseLanguage: created.data.responseLanguage ?? responseLanguage,
    sourceSql: created.data.sourceSql,
    targetDialect: created.data.targetDialect,
    context: created.data.backendContext,
    errorMessage
  })
}
