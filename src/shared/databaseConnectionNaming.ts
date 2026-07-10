import type { DatabaseEngineCode } from './contracts/database'

export type DatabaseConnectionNameSource = {
  dbType: DatabaseEngineCode
  host?: string
  port?: number | null
  database?: string
  filePath?: string
  url?: string
}

const normalizedNamePart = (value: unknown) => String(value ?? '').trim()

const oracleConnectStringParts = (value: string) => {
  const rawUrl = normalizedNamePart(value)
  if (!rawUrl) return { endpoint: '', service: '' }

  const connectString = rawUrl
    .replace(/^jdbc:oracle:thin:@/i, '')
    .replace(/^oracle:\/\//i, '//')
  if (connectString.startsWith('(')) return { endpoint: '', service: '' }

  const match = connectString.match(/^(?:\/\/)?(\[[^\]]+\]|[^/:;?#]+)(?::(\d+))?(?:[/:]([^/:?#;]+))?/)
  if (!match) return { endpoint: '', service: '' }
  return {
    endpoint: `${match[1]}${match[2] ? `:${match[2]}` : ''}`,
    service: match[3] ?? ''
  }
}

const endpointFromUrl = (value: string, dbType: DatabaseEngineCode) => {
  const rawUrl = normalizedNamePart(value)
  if (!rawUrl) return ''

  if (dbType === 'oracle') {
    const oracleEndpoint = oracleConnectStringParts(rawUrl).endpoint
    if (oracleEndpoint) return oracleEndpoint
  }

  try {
    return new URL(rawUrl.replace(/^jdbc:/i, '')).host
  } catch {
    return ''
  }
}

export const oracleServiceNameFromUrl = (value: string) => {
  const rawUrl = normalizedNamePart(value)
  if (!rawUrl) return ''
  const connectStringParts = oracleConnectStringParts(rawUrl)
  if (connectStringParts.service) return connectStringParts.service
  if (connectStringParts.endpoint) return ''

  try {
    const pathParts = new URL(rawUrl.replace(/^jdbc:/i, '')).pathname.split('/').filter(Boolean)
    return pathParts.at(-1) ?? ''
  } catch {
    return ''
  }
}

export const defaultDatabaseConnectionName = (dbType: DatabaseEngineCode) => `${dbType}-connection`

export const databaseFileNameFromPath = (filePath: string) =>
  normalizedNamePart(filePath).replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''

export const sqliteConnectionNameFromFilePath = (filePath: string) => {
  const fileName = databaseFileNameFromPath(filePath)
  return fileName
}

const sqliteConnectionNameFromSource = (source: DatabaseConnectionNameSource) => {
  const fileName = sqliteConnectionNameFromFilePath(source.filePath ?? '')
  if (fileName) return fileName
  const urlFileName = sqliteConnectionNameFromFilePath(normalizedNamePart(source.url).replace(/^sqlite:\/\//i, ''))
  if (urlFileName) return urlFileName
  const databaseName = normalizedNamePart(source.database)
  return databaseName.toLowerCase() === 'main' ? '' : databaseFileNameFromPath(databaseName)
}

export const databaseConnectionEndpoint = (source: DatabaseConnectionNameSource) => {
  const urlEndpoint = endpointFromUrl(source.url ?? '', source.dbType)
  const host = normalizedNamePart(source.host)
  const port = typeof source.port === 'number' && Number.isFinite(source.port) && source.port > 0 ? source.port : null
  const hostEndpoint = host ? `${host}${port ? `:${port}` : ''}` : ''
  if (source.dbType === 'oracle' || source.dbType === 'clickhouse' || source.dbType === 'presto') {
    return urlEndpoint || hostEndpoint
  }
  return hostEndpoint || urlEndpoint
}

export const suggestedDatabaseConnectionName = (source: DatabaseConnectionNameSource) => {
  if (source.dbType === 'sqlite') {
    return sqliteConnectionNameFromSource(source) || defaultDatabaseConnectionName(source.dbType)
  }

  const endpoint = databaseConnectionEndpoint(source)
  if (!endpoint) return defaultDatabaseConnectionName(source.dbType)
  const scope =
    (source.dbType === 'oracle' ? oracleServiceNameFromUrl(source.url ?? '') : '') ||
    normalizedNamePart(source.database) ||
    source.dbType
  return `${scope}@${endpoint}`
}

export const isLegacyDefaultDatabaseConnectionName = (name: string, dbType: DatabaseEngineCode) =>
  normalizedNamePart(name) === defaultDatabaseConnectionName(dbType)

export const uniqueDatabaseConnectionName = (name: string, existingNames: Iterable<string>) => {
  const baseName = normalizedNamePart(name) || 'database-connection'
  const usedNames = new Set(Array.from(existingNames, (item) => normalizedNamePart(item).toLowerCase()).filter(Boolean))
  if (!usedNames.has(baseName.toLowerCase())) return baseName

  let suffix = 2
  while (usedNames.has(`${baseName}-${suffix}`.toLowerCase())) suffix += 1
  return `${baseName}-${suffix}`
}
