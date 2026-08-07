import {
  cancelDatabaseAiDrawerResponse as cancelDatabaseAiDrawerResponseRuntime,
  cancelDatabaseAiPaneResponse as cancelDatabaseAiPaneResponseRuntime,
  configureDatabaseAiRuntime,
  configureDatabaseRuntime,
  type DatabaseAiProviderTextInput,
  type DatabaseAiProviderTextResult,
  type DatabaseRuntimeConfig
} from '@shared/databaseRuntime'
import type {
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneResponseInput,
  DatabaseConnectionTestInput
} from '@shared/contracts/database'
import type { UserConfig } from '@shared/contracts/userConfig'
import { resolveModelProvider } from '../ai/modelProviderText'
import {
  abortClineAgentTask,
  clineAgentSessionIdFor,
  runClineAgentTurn,
  type ClineAgentRunInput
} from '../agent/clineAgentRuntime'
import {
  databaseClineSeedMessages,
  databaseClineTools,
  databaseClineTurnPrompt
} from '../agent/clineAgentProfiles'
import { resolveClineAgentProvider } from '../agent/clineAgentProviderRuntime'
import { databaseClineAgentTaskIdentity } from '@shared/clineAgentTaskIdentity'
import { createSshProxySocket, type SshProxySocket } from '../ssh/sshProxy'
import { loadDatabaseAiMcpContext, redactDatabaseAiProviderError } from './databaseMcp'

type DatabaseBackendRuntimeConfig = {
  getConfig?: () => UserConfig
  localBackendDouble?: boolean
  mysqlDriver?: DatabaseRuntimeConfig['mysqlDriver']
  postgresDriver?: DatabaseRuntimeConfig['postgresDriver']
  oracleDriver?: DatabaseRuntimeConfig['oracleDriver']
  sqlServerDriver?: DatabaseRuntimeConfig['sqlServerDriver']
  fetch?: typeof fetch
  createSshProxySocket?: typeof createSshProxySocket
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
  stateFilePath?: string
  credentialKeyPath?: string
  credentialStorageBackend?: 'system' | 'local'
  useSeedData?: boolean
  runClineAgentTurn?: (input: ClineAgentRunInput) => ReturnType<typeof runClineAgentTurn>
  abortClineAgentTask?: typeof abortClineAgentTask
}

const normalizeText = (value: unknown) => String(value || '').trim()

export const databaseClineNativeBinding = (
  input: {
    conversationId?: string
    responseLanguage?: DatabaseAiProviderTextInput['responseLanguage']
    context: {
      connectionId?: string
      databaseName?: string
      schemaName?: string
    }
  }
) => {
  const scopeKey = normalizeText(input.conversationId) || 'legacy-pane'
  return {
    profile: 'database' as const,
    scopeKey,
    nativeSessionId: clineAgentSessionIdFor('database', scopeKey)
  }
}

const activeDatabaseAgentTasks = new Map<string, {
  taskId: string
  turnId: string
  cancelled: boolean
  abort: typeof abortClineAgentTask
}>()

const databaseProxyError = (message: string, code: string) => Object.assign(new Error(message), { code })

async function createDatabaseProxySocket(
  input: DatabaseConnectionTestInput,
  config: DatabaseBackendRuntimeConfig,
  targetHost: string,
  targetPort: number,
  options?: { timeoutMs?: number }
): Promise<{ proxyName: string; socket: SshProxySocket } | null> {
  const proxyName = normalizeText(input.proxyName)
  if (!proxyName) return null
  const proxyConfig = (config.getConfig?.().sshProxyConfigs || []).find((item) => normalizeText(item.name) === proxyName)
  if (!proxyConfig) {
    throw databaseProxyError(`Database SSH proxy config "${proxyName}" is not available.`, 'DB_PROXY_CONFIG_NOT_FOUND')
  }
  const socketFactory = config.createSshProxySocket || createSshProxySocket
  return {
    proxyName,
    socket: await socketFactory(proxyConfig, targetHost, targetPort, options)
  }
}

async function generateDatabaseProviderText(
  input: DatabaseAiProviderTextInput,
  config: DatabaseBackendRuntimeConfig
): Promise<DatabaseAiProviderTextResult> {
  const userConfig = config.getConfig?.()
  if (!userConfig) {
    return {
      ok: false,
      errorCode: 'DB_AI_PROVIDER_UNAVAILABLE',
      errorMessage: 'Database AI provider is unavailable.'
    }
  }
  const providerConfig = resolveModelProvider(userConfig, input.modelName)
  const clineProvider = resolveClineAgentProvider(userConfig, input.modelName)
  if (!providerConfig || !clineProvider) {
    return {
      ok: false,
      errorCode: 'DB_AI_PROVIDER_UNAVAILABLE',
      errorMessage: 'Database AI provider is unavailable.'
    }
  }
  const requestId = normalizeText(input.requestId) || normalizeText(input.assistantMessageId) || `${input.surface}-${Date.now()}`
  const { taskId, turnId } = databaseClineAgentTaskIdentity(requestId)
  const conversationKey = normalizeText(input.conversationId) || (input.surface === 'pane'
    ? databaseClineNativeBinding(input).scopeKey
    : `drawer:${requestId}`)
  const activeTask = {
    taskId,
    turnId,
    cancelled: false,
    abort: config.abortClineAgentTask || abortClineAgentTask
  }
  activeDatabaseAgentTasks.set(requestId, activeTask)
  try {
    const rawErrorMessage = String(input.errorMessage || '').trim()
    const redactedErrorMessage = rawErrorMessage
      ? await redactDatabaseAiProviderError(rawErrorMessage, input.context.connectionId, userConfig)
      : ''
    const providerMessages = rawErrorMessage
      ? input.messages.map((message, index) => index === input.messages.length - 1
        ? { ...message, content: message.content.replace(rawErrorMessage, () => redactedErrorMessage) }
        : message)
      : input.messages
    const sanitizedInput: DatabaseAiProviderTextInput = {
      ...input,
      messages: providerMessages,
      ...(rawErrorMessage ? { errorMessage: redactedErrorMessage } : {})
    }
    if (activeTask.cancelled) {
      return {
        ok: false,
        errorCode: 'DB_AI_CANCELLED',
        errorMessage: 'Database AI request was cancelled.',
        provider: providerConfig.provider
      }
    }
    const outcome = await (config.runClineAgentTurn || runClineAgentTurn)({
      profile: 'database',
      taskId,
      turnId,
      conversationKey,
      prompt: databaseClineTurnPrompt(sanitizedInput),
      systemPrompt: input.systemPrompt,
      provider: { ...clineProvider, maxTokensPerTurn: input.maxTokens },
      tools: databaseClineTools(),
      initialMessages: databaseClineSeedMessages(sanitizedInput),
      database: {
        connectionId: normalizeText(input.context.connectionId),
        databaseName: normalizeText(input.context.databaseName) || undefined,
        schemaName: normalizeText(input.context.schemaName) || undefined
      },
      metadata: {
        surface: input.surface,
        responseLanguage: input.responseLanguage,
        requestId
      },
      maxIterations: 8
    })
    if (outcome.status !== 'done') {
      return {
        ok: false,
        errorCode: 'DB_AI_APPROVAL_UNEXPECTED',
        errorMessage: 'A read-only DB AI tool unexpectedly requested operator approval.',
        provider: providerConfig.provider
      }
    }
    return {
      ok: true,
      text: outcome.result.text,
      provider: providerConfig.provider,
      model: providerConfig.modelName
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Database AI provider failed.')
    return {
      ok: false,
      errorCode: 'DB_AI_PROVIDER_REQUEST_FAILED',
      errorMessage: await redactDatabaseAiProviderError(message, input.context.connectionId, userConfig),
      provider: providerConfig.provider
    }
  } finally {
    const active = activeDatabaseAgentTasks.get(requestId)
    if (active?.taskId === taskId && active.turnId === turnId) activeDatabaseAgentTasks.delete(requestId)
  }
}

const abortDatabaseAgentTask = (requestId: string) => {
  const active = activeDatabaseAgentTasks.get(normalizeText(requestId))
  if (!active) return
  active.cancelled = true
  void active.abort({ taskId: active.taskId, turnId: active.turnId, reason: 'db_ai_cancelled' }).catch(() => undefined)
}

export const cancelDatabaseAiPaneResponse = (input: DatabaseAiPaneLifecycleInput) => {
  abortDatabaseAgentTask(input.requestId)
  return cancelDatabaseAiPaneResponseRuntime(input)
}

export const cancelDatabaseAiDrawerResponse = (input: DatabaseAiDrawerLifecycleInput) => {
  abortDatabaseAgentTask(input.requestId)
  return cancelDatabaseAiDrawerResponseRuntime(input)
}

export function configureDatabaseBackendRuntime(config?: DatabaseBackendRuntimeConfig) {
  if (!config && activeDatabaseAgentTasks.size) {
    for (const active of activeDatabaseAgentTasks.values()) {
      void active.abort({ taskId: active.taskId, turnId: active.turnId, reason: 'database_runtime_reconfigured' }).catch(() => undefined)
    }
    activeDatabaseAgentTasks.clear()
  }
  configureDatabaseRuntime(
    config
      ? {
          ...(config.stateFilePath ? { stateFilePath: config.stateFilePath } : {}),
          ...(config.credentialKeyPath ? { credentialKeyPath: config.credentialKeyPath } : {}),
          ...(config.credentialStorageBackend ? { credentialStorageBackend: config.credentialStorageBackend } : {}),
          ...(config.mysqlDriver ? { mysqlDriver: config.mysqlDriver } : {}),
          ...(config.postgresDriver ? { postgresDriver: config.postgresDriver } : {}),
          ...('oracleDriver' in config ? { oracleDriver: config.oracleDriver } : {}),
          ...('sqlServerDriver' in config ? { sqlServerDriver: config.sqlServerDriver } : {}),
          ...(config.fetch ? { fetch: config.fetch } : {}),
          createProxySocket: (input, targetHost, targetPort, options) => createDatabaseProxySocket(input, config, targetHost, targetPort, options),
          ...(typeof config.useSeedData === 'boolean' ? { useSeedData: config.useSeedData } : {})
        }
      : undefined
  )
  configureDatabaseAiRuntime(
    config
      ? {
          getModelName: () => normalizeText(config.getConfig?.().modelName) || 'aiopsterm-local-agent',
          localBackendDouble: config.localBackendDouble,
          wait: config.wait,
          now: config.now,
          loadDatabaseContext: loadDatabaseAiMcpContext,
          generateText: (input) => generateDatabaseProviderText(input, config)
        }
      : undefined
  )
}

export {
  connectDatabaseConnection,
  configureDatabaseAiRuntime,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  diagnoseDatabaseSqlError,
  disconnectDatabaseConnection,
  executeDatabaseSql,
  explainDatabaseTable,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  getDatabaseAiPaneState,
  getDatabaseTableDdl,
  inspectDatabaseTableIndexes,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  mutateDatabaseTable,
  planDatabaseTableMutation,
  queryDatabaseTable,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  resetDatabaseBackendSeed,
  saveDatabaseConnection,
  saveDatabaseAiPaneState,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse,
  testDatabaseConnection
} from '@shared/databaseRuntime'
