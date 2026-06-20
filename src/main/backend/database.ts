import {
  configureDatabaseAiRuntime,
  configureDatabaseRuntime,
  type DatabaseAiProviderTextInput,
  type DatabaseAiProviderTextResult,
  type DatabaseRuntimeConfig
} from '@shared/database'
import type { DatabaseConnectionTestInput } from '@shared/contracts/database'
import type { UserConfig } from '@shared/preload'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider, type AiProviderTextMessage } from './modelProviderText'
import { createSshProxySocket, type SshProxySocket } from './sshProxy'

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
  useSeedData?: boolean
}

const normalizeText = (value: unknown) => String(value || '').trim()

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
  if (!providerConfig) {
    return {
      ok: false,
      errorCode: 'DB_AI_PROVIDER_UNAVAILABLE',
      errorMessage: 'Database AI provider is unavailable.'
    }
  }
  const request = createProviderTextRequest(
    providerConfig,
    input.systemPrompt,
    input.messages.map(
      (message): AiProviderTextMessage => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      })
    ),
    input.maxTokens
  )
  if (!request) {
    return {
      ok: false,
      errorCode: 'DB_AI_PROVIDER_UNAVAILABLE',
      errorMessage: 'Database AI provider is unavailable.',
      provider: providerConfig.provider
    }
  }
  const response = await fetchProviderText(request, {
    fetch: config.fetch,
    timeoutMs: config.timeoutMs || 30_000,
    errorCodePrefix: 'DB_AI_PROVIDER'
  })
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
      provider: providerConfig.provider
    }
  }
  return {
    ok: true,
    text: response.text,
    provider: providerConfig.provider,
    model: providerConfig.modelName
  }
}

export function configureDatabaseBackendRuntime(config?: DatabaseBackendRuntimeConfig) {
  configureDatabaseRuntime(
    config
      ? {
          ...(config.stateFilePath ? { stateFilePath: config.stateFilePath } : {}),
          ...(config.credentialKeyPath ? { credentialKeyPath: config.credentialKeyPath } : {}),
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
          generateText: (input) => generateDatabaseProviderText(input, config)
        }
      : undefined
  )
}

export {
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
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
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  getDatabaseAiPaneState,
  getDatabaseTableDdl,
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
} from '@shared/database'
