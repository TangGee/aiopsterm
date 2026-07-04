import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

type ExportMcpTokenRuntimeConfig = {
  userDataPath?: string
  getEnv?: () => NodeJS.ProcessEnv
  now?: () => number
  generateToken?: () => string
  existsSync?: typeof existsSync
  mkdirSync?: typeof mkdirSync
  readFileSync?: typeof readFileSync
  writeFileSync?: typeof writeFileSync
  chmodSync?: typeof chmodSync
}

const runtimeConfig: ExportMcpTokenRuntimeConfig = {}
let cachedStoredToken = ''

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const getEnv = () => runtimeConfig.getEnv?.() || process.env
const getExistsSync = () => runtimeConfig.existsSync || existsSync
const getMkdirSync = () => runtimeConfig.mkdirSync || mkdirSync
const getReadFileSync = () => runtimeConfig.readFileSync || readFileSync
const getWriteFileSync = () => runtimeConfig.writeFileSync || writeFileSync
const getChmodSync = () => runtimeConfig.chmodSync || chmodSync
const getNow = () => runtimeConfig.now?.() || Date.now()
const generateToken = () => cleanText(runtimeConfig.generateToken?.()) || randomBytes(32).toString('hex')

const chmodBestEffort = (path: string, mode: number) => {
  try {
    getChmodSync()(path, mode)
  } catch {
    // Windows and some packaged filesystems do not support POSIX modes.
  }
}

export const configureExportMcpTokenRuntime = (config: ExportMcpTokenRuntimeConfig = {}) => {
  runtimeConfig.userDataPath = config.userDataPath
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.now = config.now
  runtimeConfig.generateToken = config.generateToken
  runtimeConfig.existsSync = config.existsSync
  runtimeConfig.mkdirSync = config.mkdirSync
  runtimeConfig.readFileSync = config.readFileSync
  runtimeConfig.writeFileSync = config.writeFileSync
  runtimeConfig.chmodSync = config.chmodSync
  cachedStoredToken = ''
}

export const getExportMcpTokenFilePath = () => join(cleanText(runtimeConfig.userDataPath) || process.cwd(), 'external-codex-mcp', 'token.json')

export const getExportMcpEnvironmentToken = () => cleanText(getEnv().AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN)

const readStoredToken = () => {
  if (cachedStoredToken) return cachedStoredToken
  const tokenPath = getExportMcpTokenFilePath()
  if (!getExistsSync()(tokenPath)) return ''
  const raw = String(getReadFileSync()(tokenPath, 'utf-8'))
  try {
    const parsed = JSON.parse(raw) as { token?: unknown }
    cachedStoredToken = cleanText(parsed.token)
  } catch {
    cachedStoredToken = cleanText(raw)
  }
  return cachedStoredToken
}

const writeStoredToken = (token: string) => {
  const cleanToken = cleanText(token)
  if (!cleanToken) throw new Error('Export MCP token cannot be empty.')
  const tokenPath = getExportMcpTokenFilePath()
  const tokenDir = dirname(tokenPath)
  getMkdirSync()(tokenDir, { recursive: true, mode: 0o700 })
  chmodBestEffort(tokenDir, 0o700)
  getWriteFileSync()(
    tokenPath,
    `${JSON.stringify(
      {
        token: cleanToken,
        createdAt: getNow()
      },
      null,
      2
    )}\n`,
    { encoding: 'utf-8', mode: 0o600 }
  )
  chmodBestEffort(tokenPath, 0o600)
  cachedStoredToken = cleanToken
  return cleanToken
}

export const ensureStoredExportMcpToken = () => readStoredToken() || writeStoredToken(generateToken())

export const getEffectiveExportMcpToken = () => getExportMcpEnvironmentToken() || ensureStoredExportMcpToken()

export const rotateStoredExportMcpToken = () => {
  if (getExportMcpEnvironmentToken()) {
    throw new Error('AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN is set. Remove the environment override and restart aiopsterm before rotating the app-managed Export MCP token.')
  }
  return writeStoredToken(generateToken())
}

export const getExportMcpTokenRuntimeStatus = () => {
  const environmentToken = getExportMcpEnvironmentToken()
  if (environmentToken) return { configured: true, source: 'environment' as const, tokenFilePath: getExportMcpTokenFilePath() }
  const storedToken = ensureStoredExportMcpToken()
  return { configured: Boolean(storedToken), source: storedToken ? ('stored' as const) : ('missing' as const), tokenFilePath: getExportMcpTokenFilePath() }
}
