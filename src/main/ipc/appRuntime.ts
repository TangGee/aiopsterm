import type { IpcMain } from 'electron'
import { mkdir } from 'fs/promises'
import { aiopstermProtocolPrefix, type AiopstermDeepLinkPayload } from '@shared/deepLink'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'
import { applyKnowledgeSearchRuntimeSetting } from '../backend/knowledgeSearchRuntime'
import { applyPrivacyRuntimeSettings } from '../backend/privacyRuntime'
import { writeRuntimeLog } from '../backend/runtimeLog'
import { openSettingsDocumentation, submitSettingsFeedbackReport } from '../backend/settingsExternalActions'
import type {
  KnowledgeSearchRuntimeApplyInput,
  OpenSettingsDocumentationInput,
  PrivacyRuntimeApplyInput,
  SettingsDocumentationPage,
  UserConfig
} from '@shared/preload'

type SettingsExternalActionRuntime = Parameters<typeof openSettingsDocumentation>[0]

type RegisterAppRuntimeIpcInput = {
  getPlatform: () => string
  getDefaultShell: () => string
  handleProtocolUrl: (rawUrl: string) => unknown
  consumeDeepLinks: () => AiopstermDeepLinkPayload[]
  openExternal: (url: string) => Promise<void> | void
  openPath: (path: string) => Promise<string | void>
  getLogDirPath: () => string
  createSettingsExternalActionRuntime: () => SettingsExternalActionRuntime
  getConfig: () => UserConfig
  saveConfigPatch: (patch: Partial<UserConfig>) => UserConfig
  shouldSkipOpenPath?: () => boolean
  mkdir?: typeof mkdir
}

const settingsDocumentationPages = new Set<SettingsDocumentationPage>([
  'general',
  'terminal',
  'extensions',
  'models',
  'billing',
  'ai',
  'mcp',
  'skills',
  'rules',
  'shortcuts',
  'trustedDevices',
  'privacy',
  'about'
])

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeSettingsDocumentationInput = (source: unknown): OpenSettingsDocumentationInput => {
  if (!isRecord(source)) return {}
  const page = typeof source.page === 'string' && settingsDocumentationPages.has(source.page as SettingsDocumentationPage) ? (source.page as SettingsDocumentationPage) : undefined
  const locale = typeof source.locale === 'string' ? source.locale : undefined
  const documentPath = typeof source.documentPath === 'string' ? source.documentPath : undefined
  const basePath = typeof source.basePath === 'string' ? source.basePath : undefined
  return { ...(page ? { page } : {}), ...(locale ? { locale } : {}), ...(documentPath ? { documentPath } : {}), ...(basePath ? { basePath } : {}) }
}

export const registerAppRuntimeIpc = (ipcMain: IpcMain, input: RegisterAppRuntimeIpcInput) => {
  ipcMain.handle('app:platform', () => input.getPlatform())
  ipcMain.handle('app:shell', () => input.getDefaultShell())
  ipcMain.handle('app:get-protocol-prefix', () => aiopstermProtocolPrefix)
  ipcMain.handle('app:handle-protocol-url', async (_event, rawUrl: string) => input.handleProtocolUrl(rawUrl))
  ipcMain.handle('app:consume-deep-links', async () => input.consumeDeepLinks())
  ipcMain.handle('app:open-external-url', async (_event, rawUrl: string) => {
    const normalized = normalizeExternalHttpUrl(rawUrl)
    if (!normalized.valid) {
      throw new Error('Only http and https URLs can be opened')
    }
    await input.openExternal(normalized.url)
  })
  ipcMain.handle('settings:open-documentation', async (_event, documentationInput: unknown) =>
    openSettingsDocumentation(input.createSettingsExternalActionRuntime(), normalizeSettingsDocumentationInput(documentationInput))
  )
  ipcMain.handle('settings:submit-feedback-report', async () => submitSettingsFeedbackReport(input.createSettingsExternalActionRuntime()))
  ipcMain.handle('app:open-log-dir', async () => {
    const logDir = input.getLogDirPath()
    await (input.mkdir || mkdir)(logDir, { recursive: true })
    if (input.shouldSkipOpenPath?.()) {
      return { path: logDir }
    }
    const result = await input.openPath(logDir)
    if (result) throw new Error(String(result))
    return { path: logDir }
  })
  ipcMain.handle('app:runtime-log', async (_event, level: unknown, eventName: unknown, fields: unknown) => {
    const cleanLevel = level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? level : 'info'
    const cleanEvent = typeof eventName === 'string' && eventName.trim() ? eventName.trim().slice(0, 120) : 'renderer.event'
    const cleanFields = fields && typeof fields === 'object' && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {}
    await writeRuntimeLog(cleanLevel, cleanEvent, cleanFields)
    return { ok: true, data: { event: cleanEvent } }
  })
  ipcMain.handle('config:get', () => input.getConfig())
  ipcMain.handle('config:save', (_event, patch: Partial<UserConfig>) => input.saveConfigPatch(patch))
  ipcMain.handle('privacy:runtime:apply', (_event, runtimeInput: PrivacyRuntimeApplyInput) => applyPrivacyRuntimeSettings(runtimeInput))
  ipcMain.handle('knowledge-search:runtime:apply', (_event, runtimeInput: KnowledgeSearchRuntimeApplyInput) => applyKnowledgeSearchRuntimeSetting(runtimeInput))
}
