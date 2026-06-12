import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { watch } from 'fs'
import type { FSWatcher } from 'fs'
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import Store from 'electron-store'
import AdmZip from 'adm-zip'
import {
  configureAssetBackendRuntime,
  configureAssetConnectionRuntime,
  confirmAssetImport,
  deleteAsset,
  deleteAssetGroup,
  deleteAssetFolder,
  deleteKeychain,
  exportAssets,
  getAsset,
  getAssetSecret,
  getKeychain,
  getKeychainSecret,
  listAssets,
  listAssetGroups,
  listKeychains,
  listSshAgentKeychainOptions,
  previewAssetImport,
  refreshOrganizationAssets,
  renameAssetGroup,
  saveAsset,
  saveAssetFolder,
  saveKeychain,
  testAssetConnection
} from './backend/assets'
import { cancelAiChatResponse, configureAiChatRuntime, createAiChatExchangeRequest, formatMcpResourceReadContent, generateAiChatResponse } from './backend/aiChat'
import { configureAiCommandBackendRuntime, listAiCommandCatalog } from './backend/aiCommands'
import { configureAiContextBackendRuntime, listAiContextCatalog } from './backend/aiContext'
import { configureAiTodoBackendRuntime, listAiTodoSnapshot } from './backend/aiTodos'
import { exportChat } from './backend/chatExport'
import { stageChatAttachment } from './backend/chatAttachments'
import { configureAliasBackendRuntime, deleteAliasCommand, listAliasCommands, saveAliasCommand } from './backend/aliases'
import { checkAppUpdate, downloadAppUpdate, installAppUpdate } from './backend/appUpdate'
import {
  configureChatHistoryBackendRuntime,
  createChatConversation,
  deleteChatConversation,
  getChatConversationMessages,
  listChatConversations,
  replaceChatConversationMessages,
  restoreChatConversation,
  saveChatMessageMetadata,
  updateChatConversation
} from './backend/chatHistory'
import {
  prepareChatImageAttachment,
  prepareChatImageAttachmentFromClipboard,
  prepareChatImageAttachmentFromFile,
  validateChatImageAttachment
} from './backend/chatImageAttachment'
import { applyKnowledgeSearchRuntimeSetting } from './backend/knowledgeSearchRuntime'
import { writeKnowledgePastedImageFromClipboard } from './backend/knowledgeBaseImage'
import { defaultMcpServers, defaultMcpToolStates } from '@shared/mcpSeed'
import { shouldRunMcpDiscovery, shouldUseE2eDialogFixtures } from '@shared/runtimeSwitches'
import {
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
  configureDatabaseBackendRuntime,
  connectDatabaseConnection,
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
  saveDatabaseAiPaneState,
  saveDatabaseConnection,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse,
  testDatabaseConnection
} from './backend/database'
import { exportDatabaseRows } from './backend/databaseExport'
import {
  cancelExtensionInstall,
  configureExtensionBackendRuntime,
  downloadExtensionPackage,
  installExtensionPackage,
  installExtensionPluginFromUrl,
  installExtensionPlugin,
  listExtensionPlugins,
  openExtensionSubscription,
  uninstallExtensionPlugin,
  updateExtensionPlugin
} from './backend/extensions'
import {
  cancelFileTransferTask,
  deleteFileSession,
  deleteFileSessionFolder,
  listFileSessionCatalog,
  listFileTransferTasks,
  listFiles as listBackendFiles,
  mutateFileEntry,
  readFileContent,
  saveFileSession,
  saveFileSessionFolder,
  saveFileSessionFromSftpPayload,
  saveFileSessionFromTerminalContext,
  transferFileEntry,
  updateFileSession,
  configureFilesBackendRuntime,
  writeFileContent
} from './backend/files'
import { callMcpTool, clearMcpRuntimeClientCache, discoverMcpServerSnapshot, readMcpResource } from './backend/mcpRuntime'
import {
  addKubernetesCluster,
  cleanupKubernetesAgent,
  configureKubernetesBackendRuntime,
  connectKubernetesCluster,
  closeKubernetesTerminal,
  createKubernetesTerminal,
  deleteKubernetesCluster,
  disconnectKubernetesCluster,
  executeKubernetesCommand,
  executeKubernetesResourceAction,
  getKubernetesAgentProxyConfig,
  importKubernetesKubeconfig,
  listKubernetesCatalog,
  planKubernetesResourceAction,
  refreshKubernetesResources,
  resizeKubernetesTerminal,
  saveKubernetesAgentProxyConfig,
  setKubernetesTerminalEventSink,
  switchKubernetesContext,
  syncKubernetesBastion,
  testKubernetesClusterConnection,
  updateKubernetesCluster,
  writeKubernetesTerminal
} from './backend/kubernetes'
import { checkModelProvider, listAiModels } from './backend/modelProviders'
import {
  configureQuickCommandBackendRuntime,
  deleteQuickCommandGroup,
  deleteQuickCommandSnippet,
  getQuickCommands,
  planQuickCommandScript,
  reorderQuickCommands,
  saveQuickCommandGroup,
  saveQuickCommandMacro,
  saveQuickCommandSnippet,
  saveQuickCommands
} from './backend/quickCommands'
import {
  configureSettingsPreferencesBackendRuntime,
  deleteSettingsRule,
  getSettingsPreferences,
  resetSettingsShortcuts,
  saveSettingsRule,
  saveSettingsShortcut
} from './backend/settingsPreferences'
import { applyPrivacyRuntimeSettings, configurePrivacyRuntime } from './backend/privacyRuntime'
import { createSshProxySocket } from './backend/sshProxy'
import { configureSshTunnelBackendRuntime, startSshTunnel, stopSshTunnel } from './backend/sshTunnels'
import { configureSshTerminalBackendRuntime, createSshTerminalSession, type SshTerminalSession } from './backend/sshTerminal'
import {
  configureTerminalSuggestionsRuntime,
  generateTerminalCommand,
  getTerminalCommandSuggestions,
  recordTerminalCommandHistory
} from './backend/terminalSuggestions'
import {
  createSshTerminalConnectionInfo,
  createTerminalBinaryWriteResult,
  createTerminalDataEvent,
  createTerminalErrorLifecycleEvent,
  createTerminalKillResult,
  createTerminalLifecycleEvent,
  createTerminalWriteResult
} from './backend/terminal'
import {
  bindUserContact,
  configureUserAccountBackendRuntime,
  deactivateUserAccount,
  getUserAccount,
  loginUserAccount,
  logoutUserAccount,
  openUserLogin,
  prepareUserAvatarImage,
  resolveUserAvatarAssetPath,
  resetUserPassword,
  revokeTrustedDevice,
  sendUserContactCode,
  sendUserLoginCode,
  skipUserLogin,
  updateUserProfile
} from './backend/userAccount'
import { configureVoiceBackendRuntime, transcribeVoiceInput } from './backend/voice'
import {
  closeZmodemStream,
  openZmodemStream,
  pickZmodemSavePath,
  pickZmodemUploadFiles,
  writeZmodemChunk
} from './backend/zmodem'
import {
  aiopstermProtocolPrefix,
  aiopstermProtocolScheme,
  parseAiopstermDeepLink,
  type AiopstermDeepLinkPayload
} from '@shared/deepLink'
import {
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH,
  defaultKnowledgeBaseConfig,
  defaultKnowledgeSeedTree,
  getDefaultKnowledgeSeedFile,
  shouldUseKnowledgeSeedData
} from '@shared/knowledgeBaseSeed'
import { defaultModelSettingsConfig } from '@shared/modelSettingsSeed'
import { defaultSettingsRulesConfig } from '@shared/settingsPreferencesSeed'
import { defaultSkillSeedData, defaultSkillsConfig, shouldUseSkillSeedData } from '@shared/skillsSeed'
import { defaultWorkspacePreferencesConfig } from '@shared/workspacePreferencesSeed'
import type {
  AliasCommandConfig,
  AliasCommandDeleteInput,
  AliasCommandSaveInput,
  AiChatCancelInput,
  AiChatExchangeRequestInput,
  AiChatExportInput,
  AiChatHistoryMessage,
  AiChatMessageMetadataInput,
  AiMcpResourceAccessActionInput,
  AiMcpResourceAccessActionResult,
  AiMcpToolCallActionInput,
  AiMcpToolCallActionResult,
  AiChatResponseInput,
  AiModelCatalogInput,
  AppUpdateProgressEvent,
  AiChatConversationUpdateInput,
  AiopsAssetInput,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsOrganizationAssetRefreshInput,
  AiopsUserAvatarPrepareInput,
  AiopsUserCodeInput,
  AiopsUserContactBindInput,
  AiopsUserDeactivateInput,
  AiopsUserLoginInput,
  AiopsUserPasswordInput,
  AiopsUserProfileUpdateInput,
  PrivacyRuntimeApplyInput,
  EditorUserConfig,
  DatabaseConnectionSaveInput,
  DatabaseConnectionTestInput,
  DatabaseCreateDatabaseInput,
  DatabaseConnectionMoveInput,
  DatabaseGroupCreateInput,
  DatabaseGroupUpdateInput,
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneStateSnapshot,
  DatabaseExportInput,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlExecuteInput,
  DatabaseTableDdlInput,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableQueryInput,
  ExtensionInstallProgress,
  ExtensionPackageDownloadInput,
  ExtensionPackageInstallInput,
  ExtensionPluginOperationInput,
  ExtensionPluginUrlInstallInput,
  ExtensionSubscriptionInput,
  FileContentOptions,
  FileEntryMutation,
  FileListOptions,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionPatch,
  FileSessionTerminalContext,
  FileTransferTaskCancelInput,
  FileTransferOperation,
  KeywordHighlightUserConfig,
  KnowledgeBaseNodeConfig,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KubernetesAgentProxyConfigInput,
  KubernetesClusterInput,
  KubernetesKubeconfigImportInput,
  KubernetesClusterTestInput,
  KubernetesClusterUpdateInput,
  KubernetesCommandInput,
  KubernetesResourceActionInput,
  KubernetesResourceRefreshInput,
  KubernetesTerminalCreateInput,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KnowledgeBaseUserConfig,
  KnowledgeSearchRuntimeApplyInput,
  McpConfigFile,
  McpResourceReadInput,
  McpServerUserConfig,
  McpToolCallInput,
  McpToolCallResult,
  McpToolStatesUserConfig,
  ModelProviderCheckInput,
  ModelSettingsUserConfig,
  QuickCommandGroupSaveInput,
  QuickCommandMacroSaveInput,
  QuickCommandReorderInput,
  QuickCommandScriptPlanInput,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig,
  SecurityUserConfig,
  SettingsRuleSaveInput,
  SettingsShortcutSaveInput,
  ShortcutUserConfig,
  SkillMetadataConfig,
  SkillUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  TerminalCommandGenerationInput,
  TerminalCommandSuggestionContext,
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalLifecycleEvent,
  ChatImageAttachmentPrepareInput,
  ChatImageAttachmentClipboardInput,
  ChatImageAttachmentFileInput,
  ChatImageAttachmentValidateInput,
  KnowledgeBasePastedImageInput,
  UserConfig,
  VoiceTranscriptionInput,
  WorkspaceUserConfig,
  UserRuleConfig,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRenameInput,
  AiopsAssetExportInput,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelStopInput
} from '@shared/preload'

type PtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

type PtyModule = {
  spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): PtyProcess
}

type TerminalSession = {
  id: string
  process: ChildProcessWithoutNullStreams | PtyProcess | SshTerminalSession
  shell: string
  cwd: string
  window: BrowserWindow
  kind: 'pty' | 'process' | 'ssh'
  host?: string
  manualCloseRequested?: boolean
}

type SkillImportResult = {
  success: boolean
  skillName?: string
  error?: string
  errorCode?: 'INVALID_ZIP' | 'NO_SKILL_MD' | 'INVALID_METADATA' | 'DIR_EXISTS' | 'EXTRACT_FAILED' | 'UNKNOWN'
}

type KnowledgeBaseEntry = {
  name: string
  relPath: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

type KnowledgeBaseTransferProgress = {
  jobId: string
  transferred: number
  total: number
  destRelPath: string
}

const defaultKeywordHighlightConfig: KeywordHighlightUserConfig = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const defaultSecurityConfig: SecurityUserConfig = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: [],
    whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
    dangerousCommands: ['rm', 'format', 'shutdown'],
    maxCommandLength: 10000,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: false
    }
  }
}

const defaultKnowledgeBaseUserConfig: KnowledgeBaseUserConfig = defaultKnowledgeBaseConfig()
const defaultSettingsRulesUserConfig: UserRuleConfig[] = defaultSettingsRulesConfig()
const defaultSkillsUserConfig: SkillUserConfig[] = defaultSkillsConfig()
const defaultWorkspacePreferencesUserConfig: WorkspaceUserConfig = defaultWorkspacePreferencesConfig()
const defaultModelSettingsUserConfig: ModelSettingsUserConfig = defaultModelSettingsConfig()

const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  leftPanelWidth: 286,
  rightPanelWidth: 360,
  agentsLeftWidth: 286,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.15,
    brightness: 0.45,
    lastCustomImage: ''
  },
  terminal: {
    terminalType: 'xterm-256color',
    fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
    fontSize: 12,
    scrollBack: 1000,
    cursorStyle: 'block',
    cursorBlink: true,
    lineHeight: 1,
    pinchZoomStatus: true,
    showCloseButton: true,
    sshAgentsStatus: false,
    middleMouseEvent: 'paste',
    rightMouseEvent: 'contextMenu'
  },
  workspacePreferences: defaultWorkspacePreferencesUserConfig,
  editorSettings: {
    fontSize: 14,
    lineHeight: 0,
    fontFamily: 'cascadia-mono',
    tabSize: 4,
    wordWrap: 'off',
    minimap: true,
    mouseWheelZoom: true
  },
  sshProxyConfigs: [],
  sshAgentKeys: [],
  extensionSettings: {
    autoCompleteStatus: true,
    quickVimStatus: true,
    aliasStatus: true,
    highlightStatus: true
  },
  keywordHighlight: defaultKeywordHighlightConfig,
  securityConfig: defaultSecurityConfig,
  privacy: {
    telemetry: 'enabled',
    secretRedaction: 'disabled',
    dataSync: 'disabled'
  },
  aiPreferences: {
    enableExtendedThinking: true,
    thinkingBudgetTokens: 4096,
    autoExecuteReadOnlyCommands: false,
    commandOutputFilteringEnabled: true,
    kbSearchEnabled: true,
    experienceExtractionEnabled: true,
    autoApproval: false,
    reasoningEffort: 'medium',
    needProxy: false,
    proxy: {
      type: 'HTTP',
      host: '127.0.0.1',
      port: 7890,
      enableProxyIdentity: false,
      username: '',
      password: ''
    },
    shellIntegrationTimeout: 4
  },
  modelSettings: defaultModelSettingsUserConfig,
  shortcuts: [
    { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
    { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
    { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
    { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
  ],
  rules: defaultSettingsRulesUserConfig,
  skills: defaultSkillsUserConfig,
  mcpServers: defaultMcpServers(),
  mcpToolStates: defaultMcpToolStates(),
  knowledgeBase: defaultKnowledgeBaseUserConfig,
  onboarding: {
    version: 2,
    guideTabAutoOpened: false,
    completedModules: {
      interfaceGuide: false,
      systemSettings: false,
      addAndConnectHost: false,
      aiChat: false
    }
  }
}

if (process.env.AIOPSTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AIOPSTERM_USER_DATA_DIR)
}

const store = new Store<{ config: UserConfig }>({
  name: 'aiopsterm-config',
  defaults: {
    config: defaultConfig
  }
})

const sessions = new Map<string, TerminalSession>()
let mainWindow: BrowserWindow | null = null
const pendingDeepLinks: AiopstermDeepLinkPayload[] = []
let securityConfigWatcher: FSWatcher | null = null
let keywordHighlightConfigWatcher: FSWatcher | null = null
let mcpConfigWatcher: FSWatcher | null = null
let skillsWatchers: FSWatcher[] = []
let skillsWatcherDebounce: NodeJS.Timeout | null = null

const sendTerminalLifecycle = (
  owner: BrowserWindow,
  id: string,
  event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }
): TerminalLifecycleEvent => {
  const payload = createTerminalLifecycleEvent(id, event)
  owner.webContents.send('terminal:lifecycle', payload)
  return payload
}

const sendTerminalErrorLifecycle = (
  owner: BrowserWindow,
  id: string,
  kind: TerminalLifecycleEvent['kind'],
  error: unknown,
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at' | 'reason' | 'isNetworkDisconnect' | 'errorCode' | 'errorMessage'>> = {}
): TerminalLifecycleEvent => {
  const payload = createTerminalErrorLifecycleEvent(id, kind, error, event)
  owner.webContents.send('terminal:lifecycle', payload)
  return payload
}

const sendTerminalExit = (owner: BrowserWindow, lifecycle: TerminalLifecycleEvent, code = lifecycle.code ?? null) => {
  owner.webContents.send('terminal:exit', {
    id: lifecycle.id,
    code,
    kind: lifecycle.kind,
    reason: lifecycle.reason,
    isNetworkDisconnect: lifecycle.isNetworkDisconnect,
    errorCode: lifecycle.errorCode,
    errorMessage: lifecycle.errorMessage
  })
}

const terminalDataPayload = (id: string, chunk: string | Buffer) => {
  return createTerminalDataEvent(id, chunk)
}

const sendTerminalData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
  owner.webContents.send('terminal:data', terminalDataPayload(id, chunk))
}

const terminalBinaryPayload = (payload: unknown): Buffer => {
  if (payload instanceof ArrayBuffer) return Buffer.from(payload)
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  if (Array.isArray(payload)) return Buffer.from(payload)
  return Buffer.alloc(0)
}

const writeTerminalBuffer = (session: TerminalSession, buffer: Buffer) => {
  if (session.kind === 'ssh') {
    ;(session.process as SshTerminalSession).write(buffer)
  } else {
    ;(session.process as ChildProcessWithoutNullStreams).stdin.write(buffer)
  }
}

const cloneKnowledgeBaseNodes = (nodes: KnowledgeBaseNodeConfig[] = []): KnowledgeBaseNodeConfig[] =>
  nodes.map((node) => ({
    ...node,
    children: node.children ? cloneKnowledgeBaseNodes(node.children) : undefined
  }))

const cloneKnowledgeBase = (source?: KnowledgeBaseUserConfig): KnowledgeBaseUserConfig | undefined =>
  source
    ? {
        tree: cloneKnowledgeBaseNodes(source.tree),
        usedBytes: source.usedBytes,
        totalBytes: source.totalBytes
      }
    : undefined

const cloneAliasCommands = (commands?: AliasCommandConfig[]): AliasCommandConfig[] | undefined =>
  commands?.map((command) => ({ ...command }))

const cloneShortcuts = (shortcuts?: ShortcutUserConfig[]): ShortcutUserConfig[] | undefined =>
  shortcuts?.map((shortcut) => ({ ...shortcut }))

const cloneRules = (rules?: UserRuleConfig[]): UserRuleConfig[] | undefined =>
  rules?.map((rule) => ({ ...rule }))

const cloneSkills = (skills?: SkillUserConfig[]): SkillUserConfig[] | undefined =>
  skills?.map((skill) => ({ ...skill }))

const isEditableSkill = (skill: SkillUserConfig) => {
  if (!skill.path) return skill.editable
  const userRoot = resolve(getSkillsUserPath())
  const skillPath = resolve(skill.path)
  return skillPath === userRoot || skillPath.startsWith(`${userRoot}${sep}`)
}

const normalizeSkillNameForDirectory = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'skill'

const parseSkillYamlValue = (value: string): string => {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseSkillFrontmatter = (content: string): { metadata: Partial<SkillMetadataConfig>; body: string } => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/)
  if (!match) {
    const heading = normalized.match(/^#\s+(.+)$/m)
    const paragraph = normalized.match(/^#.+\n+([^#\n][^\n]+)/m)
    return {
      metadata: {
        ...(heading ? { name: heading[1].trim() } : {}),
        ...(paragraph ? { description: paragraph[1].trim() } : {})
      },
      body: normalized.trim()
    }
  }
  const metadata: Partial<SkillMetadataConfig> = {}
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return
    const key = line.slice(0, colonIndex).trim()
    const value = parseSkillYamlValue(line.slice(colonIndex + 1))
    if (key === 'name' || key === 'description') {
      metadata[key] = value
    }
  })
  return {
    metadata,
    body: match[2].trim()
  }
}

const validateSkillMetadata = (metadata: Partial<SkillMetadataConfig>) => {
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  if (!name || !description) {
    throw new Error('Skill metadata requires name and description')
  }
  return { name, description }
}

const buildSkillFile = (metadata: SkillMetadataConfig, content: string) => {
  const safeDescription = metadata.description.replace(/\r?\n/g, ' ')
  return `---\nname: ${metadata.name}\ndescription: ${safeDescription}\n---\n\n${content.trim()}\n`
}

const cloneMcpServers = (servers?: McpServerUserConfig[]): McpServerUserConfig[] | undefined =>
  servers?.map((server) => ({
    ...server,
    tools: server.tools.map((tool) => ({
      ...tool,
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

const cloneMcpToolStates = (states?: McpToolStatesUserConfig): McpToolStatesUserConfig | undefined =>
  states ? { ...states } : undefined

const cloneEditorSettings = (settings?: EditorUserConfig): EditorUserConfig | undefined =>
  settings ? { ...settings } : undefined

const cloneSshProxyConfigs = (configs?: SshProxyConfig[]): SshProxyConfig[] | undefined => configs?.map((config) => ({ ...config }))

const cloneSshAgentKeys = (keys?: SshAgentKeyConfig[]): SshAgentKeyConfig[] | undefined => keys?.map((key) => ({ ...key }))

const cloneKeywordHighlight = (config?: KeywordHighlightUserConfig): KeywordHighlightUserConfig | undefined =>
  config
    ? {
        'keyword-highlight': {
          enabled: config['keyword-highlight']?.enabled ?? defaultKeywordHighlightConfig['keyword-highlight'].enabled,
          applyTo: {
            ...defaultKeywordHighlightConfig['keyword-highlight'].applyTo,
            ...(config['keyword-highlight']?.applyTo || {})
          },
          rules: (config['keyword-highlight']?.rules || defaultKeywordHighlightConfig['keyword-highlight'].rules).map((rule) => ({
            ...rule,
            pattern: Array.isArray(rule.pattern) ? [...rule.pattern] : rule.pattern,
            style: { ...rule.style }
          }))
        }
      }
    : undefined

const cloneSecurityConfig = (config?: SecurityUserConfig): SecurityUserConfig | undefined =>
  config
    ? {
        security: {
          enableCommandSecurity: config.security?.enableCommandSecurity ?? defaultSecurityConfig.security.enableCommandSecurity,
          enableStrictMode: config.security?.enableStrictMode ?? defaultSecurityConfig.security.enableStrictMode,
          blacklistPatterns: [...(config.security?.blacklistPatterns || defaultSecurityConfig.security.blacklistPatterns)],
          whitelistPatterns: [...(config.security?.whitelistPatterns || defaultSecurityConfig.security.whitelistPatterns)],
          dangerousCommands: [...(config.security?.dangerousCommands || defaultSecurityConfig.security.dangerousCommands)],
          maxCommandLength: config.security?.maxCommandLength ?? defaultSecurityConfig.security.maxCommandLength,
          securityPolicy: {
            ...defaultSecurityConfig.security.securityPolicy,
            ...(config.security?.securityPolicy || {})
          }
        }
      }
    : undefined

const normalizeStringArray = (source: unknown, fallback: string[]) =>
  Array.isArray(source) ? source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [...fallback]

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toStringArray = (source: unknown) =>
  Array.isArray(source) ? source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : undefined

const toStringRecord = (source: unknown) => {
  if (!isRecord(source)) return undefined
  const entries = Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length ? Object.fromEntries(entries) : undefined
}

const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = value.type === 'sse' || value.type === 'streamableHttp' ? value.type : 'stdio'
    const server: McpConfigFile['mcpServers'][string] = {
      type,
      ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      ...(toStringArray(value.autoApprove) ? { autoApprove: toStringArray(value.autoApprove) } : {}),
      ...(typeof value.timeout === 'number' && value.timeout > 0 ? { timeout: value.timeout } : {})
    }
    if (type === 'stdio') {
      if (typeof value.command === 'string' && value.command.trim()) server.command = value.command.trim()
      const args = toStringArray(value.args)
      if (args) server.args = args
      if (typeof value.cwd === 'string' && value.cwd.trim()) server.cwd = value.cwd.trim()
      const env = toStringRecord(value.env)
      if (env) server.env = env
    } else {
      if (typeof value.url === 'string' && value.url.trim()) server.url = value.url.trim()
      const headers = toStringRecord(value.headers)
      if (headers) server.headers = headers
    }
    mcpServers[name.trim()] = server
  })
  return { mcpServers }
}

const mcpConfigFromUserConfig = (config: UserConfig): McpConfigFile => {
  const servers = config.mcpServers || []
  return {
    mcpServers: Object.fromEntries(
      servers.map((server) => {
        const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
        return [
          server.name,
          {
            type: 'stdio' as const,
            disabled: server.disabled,
            ...(autoApprove.length ? { autoApprove } : {}),
            command: server.name === 'filesystem' ? 'npx' : server.name,
            args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', app.getPath('home')] : [],
            timeout: 60
          }
        ]
      })
    )
  }
}

const normalizeKeywordHighlightConfig = (source?: unknown): KeywordHighlightUserConfig => {
  const root = isRecord(source) ? source : {}
  const incoming = isRecord(root['keyword-highlight']) ? root['keyword-highlight'] : {}
  const applyTo = isRecord(incoming.applyTo) ? incoming.applyTo : {}
  const rulesSource = Array.isArray(incoming.rules) ? incoming.rules : []
  const rules: KeywordHighlightUserConfig['keyword-highlight']['rules'] = []
  const seen = new Set<string>()
  rulesSource.forEach((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim() || seen.has(item.name.trim())) return
    const style = isRecord(item.style) ? item.style : {}
    const foreground = typeof style.foreground === 'string' && /^#(?:[0-9a-fA-F]{6})$/.test(style.foreground) ? style.foreground : '#F87171'
    const pattern =
      Array.isArray(item.pattern) && item.pattern.some((value) => typeof value === 'string' && value.trim())
        ? item.pattern.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
        : typeof item.pattern === 'string' && item.pattern.trim()
          ? item.pattern.trim()
          : item.name.trim()
    const name = item.name.trim()
    seen.add(name)
    rules.push({
      name,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      scope: item.scope === 'input' || item.scope === 'both' ? item.scope : 'output',
      matchType: item.matchType === 'wildcard' ? 'wildcard' : 'regex',
      pattern,
      style: {
        foreground,
        fontStyle: style.fontStyle === 'normal' ? 'normal' : 'bold'
      }
    })
  })
  return {
    'keyword-highlight': {
      enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : defaultKeywordHighlightConfig['keyword-highlight'].enabled,
      applyTo: {
        output: applyTo.output !== undefined ? Boolean(applyTo.output) : defaultKeywordHighlightConfig['keyword-highlight'].applyTo.output,
        input: applyTo.input !== undefined ? Boolean(applyTo.input) : defaultKeywordHighlightConfig['keyword-highlight'].applyTo.input
      },
      rules
    }
  }
}

const normalizeSecurityConfig = (source?: unknown): SecurityUserConfig => {
  const root = isRecord(source) ? source : {}
  const securitySource = isRecord(root.security) ? root.security : {}
  const policySource = isRecord(securitySource.securityPolicy) ? securitySource.securityPolicy : {}
  const defaults = defaultSecurityConfig.security
  return {
    security: {
      enableCommandSecurity:
        typeof securitySource.enableCommandSecurity === 'boolean' ? securitySource.enableCommandSecurity : defaults.enableCommandSecurity,
      enableStrictMode: typeof securitySource.enableStrictMode === 'boolean' ? securitySource.enableStrictMode : defaults.enableStrictMode,
      blacklistPatterns: normalizeStringArray(securitySource.blacklistPatterns, defaults.blacklistPatterns),
      whitelistPatterns: normalizeStringArray(securitySource.whitelistPatterns, defaults.whitelistPatterns),
      dangerousCommands: normalizeStringArray(securitySource.dangerousCommands, defaults.dangerousCommands),
      maxCommandLength:
        typeof securitySource.maxCommandLength === 'number' && securitySource.maxCommandLength > 0
          ? securitySource.maxCommandLength
          : defaults.maxCommandLength,
      securityPolicy: {
        blockCritical: typeof policySource.blockCritical === 'boolean' ? policySource.blockCritical : defaults.securityPolicy.blockCritical,
        askForMedium: typeof policySource.askForMedium === 'boolean' ? policySource.askForMedium : defaults.securityPolicy.askForMedium,
        askForHigh: typeof policySource.askForHigh === 'boolean' ? policySource.askForHigh : defaults.securityPolicy.askForHigh,
        askForBlacklist: typeof policySource.askForBlacklist === 'boolean' ? policySource.askForBlacklist : defaults.securityPolicy.askForBlacklist
      }
    }
  }
}

const mergeModelProvider = (
  provider: ModelSettingsUserConfig['providers'][keyof ModelSettingsUserConfig['providers']] | undefined,
  fallback: ModelSettingsUserConfig['providers'][keyof ModelSettingsUserConfig['providers']]
) => ({
  ...fallback,
  ...(provider || {})
})

const cloneModelSettings = (settings?: ModelSettingsUserConfig): ModelSettingsUserConfig | undefined =>
  settings
    ? {
        addModelSwitch: settings.addModelSwitch,
        providers: {
          litellm: mergeModelProvider(settings.providers?.litellm, defaultConfig.modelSettings!.providers.litellm),
          openai: mergeModelProvider(settings.providers?.openai, defaultConfig.modelSettings!.providers.openai),
          bedrock: mergeModelProvider(settings.providers?.bedrock, defaultConfig.modelSettings!.providers.bedrock),
          deepseek: mergeModelProvider(settings.providers?.deepseek, defaultConfig.modelSettings!.providers.deepseek),
          anthropic: mergeModelProvider(settings.providers?.anthropic, defaultConfig.modelSettings!.providers.anthropic),
          ollama: mergeModelProvider(settings.providers?.ollama, defaultConfig.modelSettings!.providers.ollama)
        },
        options: (settings.options || defaultConfig.modelSettings!.options).map((option) => ({ ...option }))
      }
    : undefined

const isDev = !app.isPackaged
const rendererUrl = process.env.ELECTRON_RENDERER_URL

app.setName('aiopsterm')
app.setAppUserModelId('app.aiopsterm.desktop')

const focusWindow = (targetWindow = mainWindow || BrowserWindow.getAllWindows()[0]) => {
  if (!targetWindow || targetWindow.isDestroyed()) return null
  if (targetWindow.isMinimized()) targetWindow.restore()
  targetWindow.focus()
  return targetWindow
}

const dispatchDeepLinkToRenderer = (payload: AiopstermDeepLinkPayload) => {
  const targetWindow = focusWindow()
  if (!targetWindow) return false
  targetWindow.webContents.send('app:deep-link', payload)
  return true
}

const handleDeepLinkUrl = (rawUrl: string) => {
  const parsed = parseAiopstermDeepLink(rawUrl)
  if (!parsed.valid) {
    return { success: false, reason: parsed.reason }
  }

  const payload = {
    ...parsed.payload,
    acceptedAt: Date.now()
  }
  pendingDeepLinks.push(payload)
  dispatchDeepLinkToRenderer(payload)
  return { success: true, payload }
}

const findDeepLinkArg = (argv: string[]) => argv.find((arg) => typeof arg === 'string' && arg.startsWith(aiopstermProtocolPrefix))

const userAvatarProtocolScheme = 'aiopsterm-user-avatar'

protocol.registerSchemesAsPrivileged([
  {
    scheme: userAvatarProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

const registerDeepLinkProtocol = () => {
  if (!app.isDefaultProtocolClient(aiopstermProtocolScheme)) {
    app.setAsDefaultProtocolClient(aiopstermProtocolScheme)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
registerDeepLinkProtocol()

const registerUserAvatarProtocol = () => {
  protocol.handle(userAvatarProtocolScheme, async (request) => {
    const assetPath = resolveUserAvatarAssetPath(request.url)
    if (!assetPath) return new Response('Avatar not found', { status: 404 })
    try {
      const metadata = await stat(assetPath)
      if (!metadata.isFile()) return new Response('Avatar not found', { status: 404 })
      return net.fetch(pathToFileURL(assetPath).href)
    } catch {
      return new Response('Avatar not found', { status: 404 })
    }
  })
}
if (!gotSingleInstanceLock) {
  const deepLinkArg = findDeepLinkArg(process.argv)
  if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    focusWindow()
    const deepLinkArg = findDeepLinkArg(commandLine)
    if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
  })
}

app.on('open-url', (event, url) => {
  if (!url.startsWith(aiopstermProtocolPrefix)) return
  event.preventDefault()
  handleDeepLinkUrl(url)
})

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1344,
    height: 756,
    minWidth: 1024,
    minHeight: 680,
    title: 'aiopsterm',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized')
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:unmaximized')
  })
}

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const terminalHistoryLinesFromWrite = (data: string) => {
  const text = String(data || '')
  if (!/[\r\n]/.test(text)) return []
  const lines = text.split(/[\r\n]+/)
  if (!/[\r\n]$/.test(text)) lines.pop()
  return lines.map((line) => line.trim()).filter(Boolean)
}

const normalizeModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'mock' || provider === 'local') return 'local'
  if (provider === 'litellm' || provider === 'openai-compatible' || provider === 'ollama' || provider === 'bedrock' || provider === 'deepseek' || provider === 'anthropic') return provider
  return defaultConfig.modelProvider
}

const normalizeModelName = (value: unknown) => {
  const modelName = String(value || '').trim()
  if (!modelName || modelName === 'mock-ops-agent' || modelName === 'ops-local-agent' || modelName === 'aiopsterm-local-agent') return defaultConfig.modelName
  return modelName
}

const normalizeLayoutWidth = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 220 && value <= 640 ? Math.round(value) : fallback

const mergeConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
  leftPanelWidth: normalizeLayoutWidth(patch.leftPanelWidth, normalizeLayoutWidth(base.leftPanelWidth, defaultConfig.leftPanelWidth!)),
  rightPanelWidth: normalizeLayoutWidth(patch.rightPanelWidth, normalizeLayoutWidth(base.rightPanelWidth, defaultConfig.rightPanelWidth!)),
  agentsLeftWidth: normalizeLayoutWidth(patch.agentsLeftWidth, normalizeLayoutWidth(base.agentsLeftWidth, defaultConfig.agentsLeftWidth!)),
  modelProvider: normalizeModelProvider(patch.modelProvider || base.modelProvider),
  modelName: normalizeModelName(patch.modelName || base.modelName),
  background: {
    ...base.background,
    ...(patch.background || {})
  },
  terminal: {
    ...base.terminal!,
    ...(patch.terminal || {})
  },
  workspacePreferences: {
    ...base.workspacePreferences!,
    ...(patch.workspacePreferences || {}),
    expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || []
  },
  editorSettings: cloneEditorSettings(patch.editorSettings || base.editorSettings),
  sshProxyConfigs: cloneSshProxyConfigs(patch.sshProxyConfigs || base.sshProxyConfigs),
  sshAgentKeys: cloneSshAgentKeys(patch.sshAgentKeys || base.sshAgentKeys),
  extensionSettings: {
    ...base.extensionSettings!,
    ...(patch.extensionSettings || {})
  },
  keywordHighlight: cloneKeywordHighlight(patch.keywordHighlight || base.keywordHighlight),
  securityConfig: cloneSecurityConfig(patch.securityConfig || base.securityConfig),
  privacy: {
    ...base.privacy!,
    ...(patch.privacy || {})
  },
  modelSettings: cloneModelSettings(patch.modelSettings || base.modelSettings),
  aiPreferences: {
    ...base.aiPreferences!,
    ...(patch.aiPreferences || {}),
    proxy: {
      ...base.aiPreferences!.proxy,
      ...(patch.aiPreferences?.proxy || {})
    }
  },
  quickCommands:
    base.quickCommands || patch.quickCommands
      ? {
          groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || [])],
          snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || [])]
        }
      : undefined,
  knowledgeBase: cloneKnowledgeBase(patch.knowledgeBase || base.knowledgeBase),
  aliasCommands: cloneAliasCommands(patch.aliasCommands || base.aliasCommands),
  shortcuts: cloneShortcuts(patch.shortcuts || base.shortcuts),
  rules: cloneRules(patch.rules || base.rules),
  skills: cloneSkills(patch.skills || base.skills),
  customInstructions: typeof patch.customInstructions === 'string' ? patch.customInstructions : base.customInstructions,
  mcpServers: cloneMcpServers(patch.mcpServers || base.mcpServers),
  mcpToolStates: cloneMcpToolStates(patch.mcpToolStates || base.mcpToolStates),
  onboarding: {
    ...base.onboarding!,
    ...(patch.onboarding || {}),
    completedModules: {
      ...(base.onboarding?.completedModules || {}),
      ...(patch.onboarding?.completedModules || {})
    }
  }
})

const getConfig = (): UserConfig => mergeConfig(defaultConfig, store.get('config'))
configureTerminalSuggestionsRuntime({ getConfig })
configureAssetConnectionRuntime({ getConfig })
configureDatabaseBackendRuntime({
  getConfig,
  fetch,
  createSshProxySocket,
  localBackendDouble: process.env.AIOPSTERM_DB_AI_BACKEND_DOUBLE === '1',
  stateFilePath: join(app.getPath('userData'), 'database-workspace.json'),
  useSeedData: process.env.AIOPSTERM_DATABASE_ENABLE_SEED === '1'
})
configureVoiceBackendRuntime({ getConfig })
configureAssetBackendRuntime({
  useSeedData: process.env.AIOPSTERM_ASSETS_ENABLE_SEED === '1'
})
configureFilesBackendRuntime({
  getConfig,
  useSeedData: process.env.AIOPSTERM_FILES_ENABLE_SEED === '1'
})
configurePrivacyRuntime({
  dataSyncStateFilePath: join(app.getPath('userData'), 'data-sync-runtime.json'),
  useDataSyncBackendDouble: process.env.AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE === '1'
})
configureSshTunnelBackendRuntime({ getConfig })
configureSshTerminalBackendRuntime({
  getConfig,
  getAsset,
  getAssetSecret,
  getKeychainSecret,
  useBackendDouble: process.env.AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE === '1'
})
configureExtensionBackendRuntime({
  extensionRootDir: join(app.getPath('userData'), 'extensions'),
  fetch: (url, init) => net.fetch(url, init)
})
configureKubernetesBackendRuntime({
  stateDir: join(app.getPath('userData'), 'kubernetes'),
  useSeedData: process.env.AIOPSTERM_KUBERNETES_ENABLE_SEED === '1'
})
setKubernetesTerminalEventSink((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => {
  const channel = 'data' in event ? 'kubernetes:terminal:data' : 'kubernetes:terminal:exit'
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(channel, event)
  })
})
configureUserAccountBackendRuntime({
  stateFilePath: join(app.getPath('userData'), 'user-account.json'),
  useSeedData: process.env.AIOPSTERM_USER_ACCOUNT_ENABLE_SEED === '1'
})
configureSettingsPreferencesBackendRuntime({
  useSeedData: process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED === '1'
})
configureAiTodoBackendRuntime({
  stateFilePath: join(app.getPath('userData'), 'ai-todos.json'),
  useSeedData: process.env.AIOPSTERM_AI_TODO_ENABLE_SEED === '1'
})
configureChatHistoryBackendRuntime({
  stateFilePath: join(app.getPath('userData'), 'chat-history.json'),
  useSeedData: process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED === '1'
})
configureQuickCommandBackendRuntime({
  databasePath: join(app.getPath('userData'), 'aiopsterm-state.db'),
  useSeedData: process.env.AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED === '1'
})
configureAliasBackendRuntime({
  databasePath: join(app.getPath('userData'), 'aiopsterm-state.db'),
  useSeedData: process.env.AIOPSTERM_ALIASES_ENABLE_SEED === '1'
})

const getSecurityConfigPath = () => join(app.getPath('userData'), 'security-config.json')
const getKeywordHighlightConfigPath = () => join(app.getPath('userData'), 'keyword-highlight.json')
const getMcpConfigPath = () => join(app.getPath('userData'), 'setting', 'mcp_settings.json')
const getSkillsUserPath = () => join(app.getPath('userData'), 'skills')
const getSkillsInitMarkerPath = () => join(getSkillsUserPath(), '.aiopsterm-skills-initialized')
const getSkillFilePath = (skillDirName: string) => join(getSkillsUserPath(), skillDirName, 'SKILL.md')
const getKnowledgeBasePath = () => join(app.getPath('userData'), 'knowledgebase')
const getKnowledgeBaseInitMarkerPath = () => join(getKnowledgeBasePath(), '.aiopsterm-knowledge-initialized')
const getChatAttachmentsPath = () => join(app.getPath('userData'), 'chat-attachments')
const getCustomBackgroundsPath = () => join(app.getPath('userData'), 'backgrounds')
const getLogDirPath = () => join(app.getPath('userData'), 'logs')

const blockedKnowledgeImportExtensions = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.app',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.iso',
  '.bin',
  '.dll',
  '.so',
  '.dylib',
  '.jar',
  '.class',
  '.pyc',
  '.o',
  '.a',
  '.lib',
  '.db',
  '.sqlite',
  '.sqlite3'
])

const knowledgeImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const knowledgeSearchExtensions = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.csv',
  '.tsv',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.js',
  '.ts',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.html',
  '.css',
  '.xml'
])
const maxKnowledgeImportBytes = 10 * 1024 * 1024
const maxKnowledgeSearchFileBytes = 2 * 1024 * 1024
const maxKnowledgeSearchQueryLength = 512
const maxCustomBackgroundBytes = 20 * 1024 * 1024
const maxLocalTextReadBytes = 2 * 1024 * 1024
const allowedCustomBackgroundExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

const normalizeKnowledgeRelPath = (relPath: string) => relPath.replace(/\\/g, '/').replace(/^\/+/, '')

type KnowledgeSearchChunk = {
  id: string
  path: string
  startLine: number
  endLine: number
  text: string
  normalizedText: string
  tokens: string[]
}

type KnowledgeSearchIndex = {
  chunks: KnowledgeSearchChunk[]
  status: KnowledgeBaseSearchStatus
}

let knowledgeSearchIndex: KnowledgeSearchIndex | null = null

const invalidateKnowledgeSearchIndex = () => {
  knowledgeSearchIndex = null
}

const sanitizeCustomBackgroundName = (name: string) => {
  const ext = extname(name).toLowerCase()
  const base = basename(name, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || `background-${Date.now()}`}${ext}`
}

const isSafeKnowledgeBasename = (name: string) => {
  if (!name || name === '.' || name === '..') return false
  return !name.includes('/') && !name.includes('\\')
}

const resolveKnowledgePath = (relPath: string) => {
  const normalized = normalizeKnowledgeRelPath(relPath || '')
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error('Absolute path not allowed')
  }
  const rootAbs = resolve(getKnowledgeBasePath())
  const absPath = resolve(rootAbs, normalized)
  if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
    throw new Error('Path escapes knowledgebase root')
  }
  return { rootAbs, absPath, relPath: normalized }
}

const pathExists = async (absPath: string) => {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

const splitNameExt = (fileName: string) => {
  const ext = extname(fileName)
  return { base: ext ? fileName.slice(0, -ext.length) : fileName, ext }
}

const ensureUniqueKnowledgeName = async (dirAbs: string, desiredName: string) => {
  const { base, ext } = splitNameExt(desiredName)
  let candidate = desiredName
  let index = 1
  while (await pathExists(join(dirAbs, candidate))) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }
  return candidate
}

const getKnowledgeMimeType = (relPath: string) => {
  const ext = extname(relPath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

const isKnowledgeSearchableFile = (relPath: string, size: number) => {
  const ext = extname(relPath).toLowerCase()
  return size <= maxKnowledgeSearchFileBytes && knowledgeSearchExtensions.has(ext)
}

const normalizeKnowledgeSearchText = (value: string) => value.toLowerCase().normalize('NFKC')

const tokenizeKnowledgeSearch = (value: string) =>
  Array.from(new Set(normalizeKnowledgeSearchText(value).match(/[\p{L}\p{N}_-]+/gu) || [])).filter((token) => token.length > 1)

const createKnowledgeSearchSnippet = (text: string, queryTokens: string[]) => {
  const compact = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (!compact) return ''
  const normalized = normalizeKnowledgeSearchText(compact)
  const firstMatch = queryTokens.reduce((best, token) => {
    const index = normalized.indexOf(token)
    return index === -1 ? best : Math.min(best, index)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(firstMatch)) return compact.slice(0, 260)
  const start = Math.max(0, firstMatch - 80)
  const end = Math.min(compact.length, firstMatch + 180)
  return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`
}

const chunkKnowledgeSearchText = (relPath: string, content: string): KnowledgeSearchChunk[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const chunks: KnowledgeSearchChunk[] = []
  const maxLines = 36
  const overlapLines = 6
  for (let start = 0; start < lines.length; start += maxLines - overlapLines) {
    const slice = lines.slice(start, start + maxLines)
    const text = slice.join('\n').trim()
    if (!text) continue
    chunks.push({
      id: `${relPath}:${start + 1}`,
      path: relPath,
      startLine: start + 1,
      endLine: Math.min(lines.length, start + slice.length),
      text,
      normalizedText: normalizeKnowledgeSearchText(text),
      tokens: tokenizeKnowledgeSearch(text)
    })
    if (start + maxLines >= lines.length) break
  }
  return chunks
}

const walkKnowledgeSearchFiles = async (relDir = ''): Promise<Array<{ relPath: string; size: number }>> => {
  const files: Array<{ relPath: string; size: number }> = []
  const entries = await listKnowledgeDir(relDir)
  for (const entry of entries) {
    if (entry.type === 'dir') {
      files.push(...(await walkKnowledgeSearchFiles(entry.relPath)))
    } else if (isKnowledgeSearchableFile(entry.relPath, entry.size || 0)) {
      files.push({ relPath: entry.relPath, size: entry.size || 0 })
    }
  }
  return files
}

const buildKnowledgeSearchIndex = async (): Promise<KnowledgeSearchIndex> => {
  await ensureKnowledgeBaseDirectory()
  const files = await walkKnowledgeSearchFiles('')
  const chunks: KnowledgeSearchChunk[] = []
  for (const file of files) {
    const { absPath } = resolveKnowledgePath(file.relPath)
    try {
      const content = await readFile(absPath, 'utf-8')
      chunks.push(...chunkKnowledgeSearchText(file.relPath, content))
    } catch {
      // Ignore unreadable/binary-like text files; the tree and editor read paths still surface file errors.
    }
  }
  return {
    chunks,
    status: {
      totalFiles: files.length,
      totalChunks: chunks.length,
      provider: 'aiopsterm-local',
      model: 'lexical',
      updatedAt: Date.now()
    }
  }
}

const getKnowledgeSearchIndex = async () => {
  if (!knowledgeSearchIndex) {
    knowledgeSearchIndex = await buildKnowledgeSearchIndex()
  }
  return knowledgeSearchIndex
}

const scoreKnowledgeChunk = (chunk: KnowledgeSearchChunk, query: string, queryTokens: string[]) => {
  const normalizedQuery = normalizeKnowledgeSearchText(query)
  let matchCount = 0
  let score = 0
  if (chunk.normalizedText.includes(normalizedQuery)) {
    matchCount += 1
    score += 1.5
  }
  for (const token of queryTokens) {
    const occurrences = chunk.normalizedText.split(token).length - 1
    if (occurrences <= 0) continue
    matchCount += occurrences
    score += Math.min(occurrences, 4) * (chunk.tokens.includes(token) ? 0.55 : 0.3)
  }
  const fileName = normalizeKnowledgeSearchText(basename(chunk.path))
  if (queryTokens.some((token) => fileName.includes(token))) {
    score += 0.35
  }
  return { score, matchCount }
}

const searchKnowledgeIndex = async (query: string, options?: { maxResults?: number; minScore?: number }): Promise<KnowledgeBaseSearchResult[]> => {
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedQuery || normalizedQuery.length > maxKnowledgeSearchQueryLength) return []
  const queryTokens = tokenizeKnowledgeSearch(normalizedQuery)
  if (!queryTokens.length) return []
  const maxResults = Math.min(Math.max(Math.floor(options?.maxResults || 20), 1), 50)
  const minScore = Math.max(options?.minScore ?? 0.15, 0)
  const index = await getKnowledgeSearchIndex()
  return index.chunks
    .map((chunk) => {
      const scored = scoreKnowledgeChunk(chunk, normalizedQuery, queryTokens)
      return {
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: Number(scored.score.toFixed(4)),
        snippet: createKnowledgeSearchSnippet(chunk.text, queryTokens),
        matchCount: scored.matchCount
      }
    })
    .filter((result) => result.score >= minScore && result.matchCount > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, maxResults)
}

const ensureKnowledgeSeedNode = async (node: KnowledgeBaseNodeConfig, parentRelDir = '') => {
  const relPath = node.relPath || posix.join(parentRelDir, node.title)
  const { absPath } = resolveKnowledgePath(relPath)
  if (node.type === 'dir') {
    await mkdir(absPath, { recursive: true })
    for (const child of node.children || []) {
      await ensureKnowledgeSeedNode(child, relPath)
    }
    return
  }
  if (!(await pathExists(absPath))) {
    await mkdir(dirname(absPath), { recursive: true })
    const seedFile = getDefaultKnowledgeSeedFile(relPath)
    if (seedFile?.kind === 'base64') {
      await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
    } else {
      await writeFile(absPath, seedFile?.content || '', 'utf-8')
    }
  }
}

const migrateKnowledgeSeedPlaceholders = async () => {
  const seedFile = getDefaultKnowledgeSeedFile(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
  if (seedFile?.kind !== 'base64') return
  try {
    const { absPath } = resolveKnowledgePath(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
    const current = await readFile(absPath)
    if (current.toString('utf-8') === 'aiopsterm knowledge image placeholder\n') {
      await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
    }
  } catch {
    // Missing user-edited default images are left untouched after initial seeding.
  }
}

const ensureKnowledgeBaseDirectory = async () => {
  const knowledgePath = getKnowledgeBasePath()
  await mkdir(knowledgePath, { recursive: true })
  try {
    await access(getKnowledgeBaseInitMarkerPath())
  } catch {
    if (shouldUseKnowledgeSeedData()) {
      for (const node of defaultKnowledgeSeedTree()) {
        await ensureKnowledgeSeedNode(node)
      }
    }
    await writeFile(getKnowledgeBaseInitMarkerPath(), 'initialized\n', 'utf-8')
  }
  await migrateKnowledgeSeedPlaceholders()
  return knowledgePath
}

const listKnowledgeDir = async (relDir: string): Promise<KnowledgeBaseEntry[]> => {
  await ensureKnowledgeBaseDirectory()
  const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
  if (!(await pathExists(dirAbs))) return []
  const entries = await readdir(dirAbs, { withFileTypes: true })
  const result: KnowledgeBaseEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const childAbs = join(dirAbs, entry.name)
    const metadata = await stat(childAbs)
    const childRel = posix.join(normalizedRelDir, entry.name)
    result.push({
      name: entry.name,
      relPath: childRel,
      type: entry.isDirectory() ? 'dir' : 'file',
      ...(entry.isDirectory() ? {} : { size: metadata.size }),
      mtimeMs: metadata.mtimeMs
    })
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

const getKnowledgeNodeId = (relPath: string) => `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`

const buildKnowledgeTreeFromDisk = async (relDir = ''): Promise<KnowledgeBaseNodeConfig[]> => {
  const entries = await listKnowledgeDir(relDir)
  const nodes: KnowledgeBaseNodeConfig[] = []
  for (const entry of entries) {
    const node: KnowledgeBaseNodeConfig = {
      id: getKnowledgeNodeId(entry.relPath),
      key: entry.relPath,
      title: entry.name,
      type: entry.type,
      relPath: entry.relPath,
      ...(entry.type === 'file' ? { size: entry.size || 0 } : {})
    }
    if (entry.type === 'dir') {
      node.children = await buildKnowledgeTreeFromDisk(entry.relPath)
    }
    nodes.push(node)
  }
  return nodes
}

const sumKnowledgeTreeSize = (nodes: KnowledgeBaseNodeConfig[]): number =>
  nodes.reduce((total, node) => total + (node.size || 0) + (node.children ? sumKnowledgeTreeSize(node.children) : 0), 0)

const syncKnowledgeBaseConfigFromDisk = async () => {
  const tree = await buildKnowledgeTreeFromDisk()
  const config = getConfig()
  const nextKnowledgeBase: KnowledgeBaseUserConfig = {
    tree,
    usedBytes: sumKnowledgeTreeSize(tree),
    totalBytes: config.knowledgeBase?.totalBytes || defaultKnowledgeBaseUserConfig.totalBytes
  }
  store.set('config', mergeConfig(config, { knowledgeBase: nextKnowledgeBase }))
  invalidateKnowledgeSearchIndex()
  return nextKnowledgeBase
}

const isKnowledgeFileAllowedForImport = (fileName: string, fileSize: number) => {
  const ext = extname(fileName).toLowerCase()
  if (ext && blockedKnowledgeImportExtensions.has(ext)) return false
  return fileSize <= maxKnowledgeImportBytes
}

const collectKnowledgeImportTasks = async (srcDir: string, destDir: string): Promise<Array<{ srcPath: string; destPath: string }>> => {
  const tasks: Array<{ srcPath: string; destPath: string }> = []
  const entries = await readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      tasks.push(...(await collectKnowledgeImportTasks(srcPath, destPath)))
      continue
    }
    if (!entry.isFile()) continue
    const metadata = await stat(srcPath)
    if (isKnowledgeFileAllowedForImport(entry.name, metadata.size)) {
      tasks.push({ srcPath, destPath })
    }
  }
  return tasks
}

const sendKnowledgeProgress = (window: BrowserWindow | null, payload: KnowledgeBaseTransferProgress) => {
  if (window && !window.isDestroyed()) {
    window.webContents.send('kb:transfer-progress', payload)
  }
}

const parseSkillFile = async (filePath: string): Promise<SkillUserConfig | null> => {
  const content = await readFile(filePath, 'utf-8')
  const parsed = parseSkillFrontmatter(content)
  try {
    const metadata = validateSkillMetadata(parsed.metadata)
    return {
      name: metadata.name,
      description: metadata.description,
      enabled: true,
      editable: isEditableSkill({ name: metadata.name, description: metadata.description, enabled: true, editable: true, content: parsed.body, path: filePath }),
      content: parsed.body,
      path: filePath
    }
  } catch {
    return null
  }
}

const hasAnySkillFile = async (dirPath: string) => {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'SKILL.md') return true
      if (entry.isDirectory()) {
        try {
          await access(join(dirPath, entry.name, 'SKILL.md'))
          return true
        } catch {
          // Ignore directories that are not skill folders.
        }
      }
    }
  } catch {
    return false
  }
  return false
}

const seedSkillsFromConfig = async (skills: SkillUserConfig[]) => {
  for (const skill of skills) {
    const name = skill.name?.trim()
    const description = skill.description?.trim()
    const content = skill.content?.trim()
    if (!name || !description || !content) continue
    const skillFilePath = getSkillFilePath(normalizeSkillNameForDirectory(name))
    try {
      await access(skillFilePath)
      continue
    } catch {
      await mkdir(dirname(skillFilePath), { recursive: true })
      await writeFile(skillFilePath, buildSkillFile({ name, description }, content), 'utf-8')
    }
  }
}

const ensureSkillsDirectory = async () => {
  const skillsPath = getSkillsUserPath()
  await mkdir(skillsPath, { recursive: true })
  try {
    await access(getSkillsInitMarkerPath())
  } catch {
    if (shouldUseSkillSeedData() && !(await hasAnySkillFile(skillsPath))) {
      await seedSkillsFromConfig(defaultSkillSeedData())
    }
    await writeFile(getSkillsInitMarkerPath(), 'initialized\n', 'utf-8')
  }
  return skillsPath
}

const loadSkillsFromDisk = async (): Promise<SkillUserConfig[]> => {
  const skillsPath = await ensureSkillsDirectory()
  const savedStates = new Map((getConfig().skills || []).map((skill) => [skill.name, skill.enabled]))
  const entries = await readdir(skillsPath, { withFileTypes: true })
  const skillsByName = new Map<string, SkillUserConfig>()

  for (const entry of entries) {
    const filePath = entry.isDirectory() ? join(skillsPath, entry.name, 'SKILL.md') : entry.isFile() && entry.name === 'SKILL.md' ? join(skillsPath, entry.name) : ''
    if (!filePath) continue
    try {
      const skill = await parseSkillFile(filePath)
      if (!skill || skillsByName.has(skill.name)) continue
      skill.enabled = savedStates.has(skill.name) ? Boolean(savedStates.get(skill.name)) : true
      skillsByName.set(skill.name, skill)
    } catch {
      // Invalid or temporarily unavailable SKILL.md files are skipped until the next reload.
    }
  }

  return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

const broadcastSkillsUpdate = (skills: SkillUserConfig[]) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('skills:update', skills)
    }
  })
}

const syncSkillsConfigFromDisk = async () => {
  const skills = await loadSkillsFromDisk()
  store.set('config', mergeConfig(getConfig(), { skills }))
  broadcastSkillsUpdate(skills)
  return skills
}

const closeSkillsWatchers = () => {
  skillsWatchers.forEach((watcher) => watcher.close())
  skillsWatchers = []
}

const scheduleSkillsReload = () => {
  if (skillsWatcherDebounce) {
    clearTimeout(skillsWatcherDebounce)
  }
  skillsWatcherDebounce = setTimeout(() => {
    skillsWatcherDebounce = null
    syncSkillsConfigFromDisk()
      .then(() => startSkillsWatcher())
      .catch(() => {
        // External edits can briefly remove files or folders; the next event or manual reload will recover.
      })
  }, 100)
}

const startSkillsWatcher = async () => {
  const skillsPath = await ensureSkillsDirectory()
  closeSkillsWatchers()
  skillsWatchers.push(watch(skillsPath, scheduleSkillsReload))
  const entries = await readdir(skillsPath, { withFileTypes: true })
  entries
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => {
      try {
        skillsWatchers.push(
          watch(join(skillsPath, entry.name), (_eventType, filename) => {
            if (!filename || filename.toString() === 'SKILL.md') {
              scheduleSkillsReload()
            }
          })
        )
      } catch {
        // A skill directory can be removed between readdir and watch.
      }
    })
  await syncSkillsConfigFromDisk()
}

configureAiContextBackendRuntime({
  listKnowledgeTree: () => buildKnowledgeTreeFromDisk(),
  listSkills: () => loadSkillsFromDisk()
})
configureAiCommandBackendRuntime({
  listKnowledgeDir: (relDir) => listKnowledgeDir(relDir)
})
configureAiChatRuntime({
  getConfig,
  listSkills: () => loadSkillsFromDisk(),
  localBackendDouble: process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE === '1',
  callMcpTool: async (input) => {
    const current = getConfig()
    return callMcpTool(await loadCurrentMcpConfigFile(), input, {
      servers: current.mcpServers || [],
      toolStates: current.mcpToolStates || {},
      clientName: 'aiopsterm',
      clientVersion: app.getVersion()
    })
  }
})

const findSkillByName = async (skillName: string) => {
  const skills = await loadSkillsFromDisk()
  return skills.find((skill) => skill.name === skillName) || null
}

const ignoredSkillExportEntries = new Set(['.DS_Store', 'Thumbs.db', '.git', '.gitignore', 'node_modules', '__pycache__', '.vscode', '.idea'])

const normalizeZipEntryName = (entryName: string) => entryName.replace(/\\/g, '/')

const isUnsafeZipEntryName = (entryName: string) => {
  const normalized = normalizeZipEntryName(entryName)
  return normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')
}

const importSkillZip = async (zipPath: string, overwrite = false): Promise<SkillImportResult> => {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    return { success: false, error: 'Invalid or corrupted ZIP file', errorCode: 'INVALID_ZIP' }
  }

  const entries = zip.getEntries()
  if (!entries.length) {
    return { success: false, error: 'ZIP file is empty', errorCode: 'INVALID_ZIP' }
  }

  let skillMdEntry: AdmZip.IZipEntry | null = null
  let skillMdBasePath = ''

  for (const entry of entries) {
    const entryName = normalizeZipEntryName(entry.entryName)
    if (isUnsafeZipEntryName(entryName)) {
      return { success: false, error: 'ZIP file contains invalid paths', errorCode: 'INVALID_ZIP' }
    }
    if (entryName === 'SKILL.md') {
      skillMdEntry = entry
      skillMdBasePath = ''
      break
    }
    if (entryName.endsWith('/SKILL.md')) {
      const parts = entryName.split('/')
      if (parts.length === 2) {
        skillMdEntry = entry
        skillMdBasePath = `${parts[0]}/`
        break
      }
    }
  }

  if (!skillMdEntry) {
    return { success: false, error: 'No SKILL.md file found in ZIP', errorCode: 'NO_SKILL_MD' }
  }

  let metadata: SkillMetadataConfig
  try {
    metadata = validateSkillMetadata(parseSkillFrontmatter(skillMdEntry.getData().toString('utf-8')).metadata)
  } catch {
    return { success: false, error: 'Invalid SKILL.md metadata', errorCode: 'INVALID_METADATA' }
  }

  const userSkillsPath = await ensureSkillsDirectory()
  const skillDirName = normalizeSkillNameForDirectory(metadata.name)
  const targetDir = join(userSkillsPath, skillDirName)
  try {
    await access(targetDir)
    if (!overwrite) {
      return {
        success: false,
        skillName: metadata.name,
        error: `Skill "${metadata.name}" already exists`,
        errorCode: 'DIR_EXISTS'
      }
    }
    await rm(targetDir, { recursive: true, force: true })
  } catch {
    // Directory does not exist.
  }

  try {
    await mkdir(targetDir, { recursive: true })
    for (const entry of entries) {
      const entryName = normalizeZipEntryName(entry.entryName)
      if (isUnsafeZipEntryName(entryName)) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`)
      }
      if (skillMdBasePath && !entryName.startsWith(skillMdBasePath)) {
        continue
      }
      if (entry.isDirectory) {
        continue
      }
      const relativePath = skillMdBasePath ? entryName.slice(skillMdBasePath.length) : entryName
      if (!relativePath) {
        continue
      }
      const targetPath = resolve(targetDir, relativePath)
      const targetRoot = `${resolve(targetDir)}${sep}`
      if (!targetPath.startsWith(targetRoot)) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`)
      }
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, entry.getData())
    }
    await startSkillsWatcher()
    return { success: true, skillName: metadata.name }
  } catch {
    await rm(targetDir, { recursive: true, force: true })
    return { success: false, skillName: metadata.name, error: 'Failed to extract skill files', errorCode: 'EXTRACT_FAILED' }
  }
}

const addSkillDirectoryToZip = async (zip: AdmZip, rootDir: string, currentDir: string) => {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredSkillExportEntries.has(entry.name)) {
      continue
    }
    const fullPath = join(currentDir, entry.name)
    const relativePath = relative(rootDir, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      await addSkillDirectoryToZip(zip, rootDir, fullPath)
      continue
    }
    zip.addFile(relativePath, await readFile(fullPath))
  }
}

const exportSkillZipBuffer = async (skillName: string) => {
  const skill = await findSkillByName(skillName)
  if (!skill?.path) {
    throw new Error(`Skill not found: ${skillName}`)
  }
  const skillDir = dirname(skill.path)
  const metadata = await stat(skillDir)
  if (!metadata.isDirectory()) {
    throw new Error(`Skill directory not found: ${skillDir}`)
  }
  const zip = new AdmZip()
  await addSkillDirectoryToZip(zip, skillDir, skillDir)
  return zip.toBuffer()
}

const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

const defaultSecurityConfigContent = () => `// aiopsterm AI security configuration
// Edit this file to control command approval, block lists, allow lists, and command length limits.

${JSON.stringify(defaultSecurityConfig, null, 2)}
`

const ensureSecurityConfigFile = async () => {
  const configPath = getSecurityConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, defaultSecurityConfigContent(), 'utf-8')
  }
  return configPath
}

const defaultKeywordHighlightConfigContent = () => JSON.stringify(defaultKeywordHighlightConfig, null, 2)

const ensureKeywordHighlightConfigFile = async () => {
  const configPath = getKeywordHighlightConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, defaultKeywordHighlightConfigContent(), 'utf-8')
  }
  return configPath
}

const ensureMcpConfigFile = async () => {
  const configPath = getMcpConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, JSON.stringify(mcpConfigFromUserConfig(getConfig()), null, 2), 'utf-8')
  }
  return configPath
}

const applyMcpConfigFileSnapshot = async (parsed: McpConfigFile) => {
  await clearMcpRuntimeClientCache()
  const current = getConfig()
  const snapshot = await discoverMcpServerSnapshot(parsed, {
    existingServers: current.mcpServers || [],
    toolStates: current.mcpToolStates || {},
    clientName: 'aiopsterm',
    clientVersion: app.getVersion(),
    runDiscovery: shouldRunMcpDiscovery()
  })
  const next = mergeConfig(current, { mcpServers: snapshot.mcpServers, mcpToolStates: snapshot.mcpToolStates })
  store.set('config', next)
  return {
    mcpConfig: parsed,
    mcpServers: cloneMcpServers(next.mcpServers) || [],
    mcpToolStates: cloneMcpToolStates(next.mcpToolStates) || {}
  }
}

const syncMcpConfigFromContent = async (content: string) => {
  if (!content.trim()) return
  return applyMcpConfigFileSnapshot(normalizeMcpConfigFile(JSON.parse(content)))
}

const loadCurrentMcpConfigFile = async () => {
  const configPath = await ensureMcpConfigFile()
  return normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
}

const setMcpToolState = (serverName: string, toolName: string, enabled: boolean) => {
  const normalizedServerName = serverName.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerName || !normalizedToolName) {
    throw new Error('MCP server and tool names are required')
  }
  const current = getConfig()
  const servers = cloneMcpServers(current.mcpServers) || []
  const server = servers.find((item) => item.name === normalizedServerName)
  if (!server) {
    throw new Error(`MCP server not found: ${normalizedServerName}`)
  }
  const tool = server.tools.find((item) => item.name === normalizedToolName)
  if (!tool) {
    throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
  }
  tool.enabled = enabled
  store.set(
    'config',
    mergeConfig(current, {
      mcpServers: servers,
      mcpToolStates: {
        ...(current.mcpToolStates || {}),
        [`${normalizedServerName}:${normalizedToolName}`]: enabled
      }
    })
  )
}

const setMcpToolAutoApprove = async (serverName: string, toolName: string, autoApprove: boolean) => {
  const normalizedServerName = serverName.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerName || !normalizedToolName) {
    throw new Error('MCP server and tool names are required')
  }
  const current = getConfig()
  const existingServer = current.mcpServers?.find((server) => server.name === normalizedServerName)
  if (!existingServer) {
    throw new Error(`MCP server not found: ${normalizedServerName}`)
  }
  if (!existingServer.tools.some((tool) => tool.name === normalizedToolName)) {
    throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
  }

  const configPath = await ensureMcpConfigFile()
  const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
  const server = parsed.mcpServers[normalizedServerName]
  if (!server) {
    throw new Error(`MCP server config not found: ${normalizedServerName}`)
  }

  const approved = new Set((server.autoApprove || []).filter(Boolean))
  if (autoApprove) {
    approved.add(normalizedToolName)
  } else {
    approved.delete(normalizedToolName)
  }
  const nextAutoApprove = [...approved]
  if (nextAutoApprove.length) {
    server.autoApprove = nextAutoApprove
  } else {
    delete server.autoApprove
  }

  const nextContent = JSON.stringify(parsed, null, 2)
  await writeFile(configPath, nextContent, 'utf-8')
  const snapshot = await applyMcpConfigFileSnapshot(parsed)
  broadcastMcpConfigChanged(nextContent)
  return { ok: true, data: snapshot }
}

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

const cloneChatHistoryMessages = (messages: AiChatHistoryMessage[]) => JSON.parse(JSON.stringify(messages)) as AiChatHistoryMessage[]

const formatMcpToolCallContent = (content: NonNullable<McpToolCallResult['data']>['content']) => {
  if (!content.length) return '[]'
  return content
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.data === 'string') return item.data
      return JSON.stringify(item, null, 2)
    })
    .join('\n\n')
}

const callCurrentMcpTool = async (input: McpToolCallInput) => {
  const current = getConfig()
  return callMcpTool(await loadCurrentMcpConfigFile(), input, {
    servers: current.mcpServers || [],
    toolStates: current.mcpToolStates || {},
    clientName: 'aiopsterm',
    clientVersion: app.getVersion()
  })
}

const readCurrentMcpResource = async (input: McpResourceReadInput) => {
  const current = getConfig()
  return readMcpResource(await loadCurrentMcpConfigFile(), input, {
    servers: current.mcpServers || [],
    clientName: 'aiopsterm',
    clientVersion: app.getVersion()
  })
}

const handleAiMcpToolCallAction = async (input: AiMcpToolCallActionInput, approve: boolean): Promise<AiMcpToolCallActionResult> => {
  const conversationId = String(input?.conversationId || '').trim()
  const messageId = String(input?.messageId || '').trim()
  if (!conversationId || !messageId) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_TARGET_REQUIRED',
      errorMessage: 'AI MCP tool call approval requires a conversation and message id.'
    }
  }
  const snapshot = getChatConversationMessages(conversationId)
  if (!snapshot.ok || !snapshot.data) {
    return {
      ok: false,
      errorCode: snapshot.errorCode || 'AI_MCP_TOOL_CALL_HISTORY_UNAVAILABLE',
      errorMessage: snapshot.errorMessage || 'AI chat history is unavailable.'
    }
  }
  const messageIndex = snapshot.data.messages.findIndex((message) => message.id === messageId)
  const message = messageIndex >= 0 ? snapshot.data.messages[messageIndex] : undefined
  if (!message || message.ask !== 'mcp_tool_call' || !message.mcpToolCall) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_NOT_FOUND',
      errorMessage: 'AI MCP tool call message was not found.'
    }
  }
  const nextMessages = cloneChatHistoryMessages(snapshot.data.messages)
  const nextMessage = nextMessages[messageIndex]
  if (!approve) {
    nextMessage.action = 'rejected'
    nextMessage.state = 'done'
    const saved = replaceChatConversationMessages(conversationId, nextMessages)
    if (!saved.ok || !saved.data) {
      return {
        ok: false,
        errorCode: saved.errorCode || 'AI_MCP_TOOL_CALL_REJECT_SAVE_FAILED',
        errorMessage: saved.errorMessage || 'AI MCP tool rejection could not be saved.'
      }
    }
    return {
      ok: true,
      data: {
        status: 'rejected',
        conversation: saved.data.conversation,
        messages: saved.data.messages
      }
    }
  }

  let mcpConfig: NonNullable<AiMcpToolCallActionResult['data']>['mcpConfig']
  if (input.autoApprove) {
    try {
      const autoApproveResult = await setMcpToolAutoApprove(message.mcpToolCall.serverName, message.mcpToolCall.toolName, true)
      mcpConfig = autoApproveResult.data
    } catch (error) {
      return {
        ok: false,
        errorCode: 'AI_MCP_TOOL_AUTO_APPROVE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'AI MCP tool auto approve could not be saved.'
      }
    }
  }

  const toolInput: McpToolCallInput = {
    serverName: message.mcpToolCall.serverName,
    toolName: message.mcpToolCall.toolName,
    arguments: cloneJsonRecord(message.mcpToolCall.arguments) || {}
  }
  const toolResult = await callCurrentMcpTool(toolInput)
  nextMessage.action = 'approved'
  nextMessage.state = toolResult.ok && toolResult.data && !toolResult.data.isError ? 'done' : 'error'
  nextMessage.say = 'command_output'
  nextMessage.text = toolResult.ok && toolResult.data ? formatMcpToolCallContent(toolResult.data.content) : toolResult.errorMessage || 'MCP tool call failed.'
  const saved = replaceChatConversationMessages(conversationId, nextMessages)
  if (!saved.ok || !saved.data) {
    return {
      ok: false,
      errorCode: saved.errorCode || 'AI_MCP_TOOL_CALL_SAVE_FAILED',
      errorMessage: saved.errorMessage || 'AI MCP tool call result could not be saved.'
    }
  }
  return {
    ok: true,
    data: {
      status: 'approved',
      conversation: saved.data.conversation,
      messages: saved.data.messages,
      ...(toolResult.ok && toolResult.data
        ? { toolCall: toolResult.data }
        : { toolCallError: { errorCode: toolResult.errorCode, errorMessage: toolResult.errorMessage || 'MCP tool call failed.' } }),
      ...(mcpConfig ? { mcpConfig } : {})
    }
  }
}

const handleAiMcpResourceAccessAction = async (
  input: AiMcpResourceAccessActionInput,
  approve: boolean
): Promise<AiMcpResourceAccessActionResult> => {
  const conversationId = String(input?.conversationId || '').trim()
  const messageId = String(input?.messageId || '').trim()
  if (!conversationId || !messageId) {
    return {
      ok: false,
      errorCode: 'AI_MCP_RESOURCE_ACCESS_TARGET_REQUIRED',
      errorMessage: 'AI MCP resource access approval requires a conversation and message id.'
    }
  }
  const snapshot = getChatConversationMessages(conversationId)
  if (!snapshot.ok || !snapshot.data) {
    return {
      ok: false,
      errorCode: snapshot.errorCode || 'AI_MCP_RESOURCE_ACCESS_HISTORY_UNAVAILABLE',
      errorMessage: snapshot.errorMessage || 'AI chat history is unavailable.'
    }
  }
  const messageIndex = snapshot.data.messages.findIndex((message) => message.id === messageId)
  const message = messageIndex >= 0 ? snapshot.data.messages[messageIndex] : undefined
  if (!message || message.ask !== 'mcp_resource_access' || !message.mcpResourceAccess) {
    return {
      ok: false,
      errorCode: 'AI_MCP_RESOURCE_ACCESS_NOT_FOUND',
      errorMessage: 'AI MCP resource access message was not found.'
    }
  }
  const nextMessages = cloneChatHistoryMessages(snapshot.data.messages)
  const nextMessage = nextMessages[messageIndex]
  if (!approve) {
    nextMessage.action = 'rejected'
    nextMessage.state = 'done'
    const saved = replaceChatConversationMessages(conversationId, nextMessages)
    if (!saved.ok || !saved.data) {
      return {
        ok: false,
        errorCode: saved.errorCode || 'AI_MCP_RESOURCE_ACCESS_REJECT_SAVE_FAILED',
        errorMessage: saved.errorMessage || 'AI MCP resource access rejection could not be saved.'
      }
    }
    return {
      ok: true,
      data: {
        status: 'rejected',
        conversation: saved.data.conversation,
        messages: saved.data.messages
      }
    }
  }

  const resourceInput: McpResourceReadInput = {
    serverName: message.mcpResourceAccess.serverName,
    uri: message.mcpResourceAccess.uri
  }
  const resourceResult = await readCurrentMcpResource(resourceInput)
  nextMessage.action = 'approved'
  nextMessage.say = 'command_output'
  nextMessage.state = resourceResult.ok && resourceResult.data ? 'done' : 'error'
  nextMessage.text =
    resourceResult.ok && resourceResult.data ? formatMcpResourceReadContent(resourceResult.data.contents) : resourceResult.errorMessage || 'MCP resource access failed.'
  const saved = replaceChatConversationMessages(conversationId, nextMessages)
  if (!saved.ok || !saved.data) {
    return {
      ok: false,
      errorCode: saved.errorCode || 'AI_MCP_RESOURCE_ACCESS_SAVE_FAILED',
      errorMessage: saved.errorMessage || 'AI MCP resource access result could not be saved.'
    }
  }
  return {
    ok: true,
    data: {
      status: 'approved',
      conversation: saved.data.conversation,
      messages: saved.data.messages,
      ...(resourceResult.ok && resourceResult.data
        ? { resourceAccess: resourceResult.data }
        : { resourceAccessError: { errorCode: resourceResult.errorCode, errorMessage: resourceResult.errorMessage || 'MCP resource access failed.' } })
    }
  }
}

const broadcastMcpConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('mcp-config:changed', content)
    }
  })
}

const syncKeywordHighlightConfigFromContent = (content: string) => {
  if (!content.trim()) return
  const parsed = JSON.parse(content) as Partial<UserConfig>
  if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) return
  const nextKeywordHighlight = normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed)
  const next = mergeConfig(getConfig(), { keywordHighlight: nextKeywordHighlight })
  store.set('config', next)
  return next.keywordHighlight
}

const broadcastKeywordHighlightConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('keyword-highlight-config:changed', content)
    }
  })
}

const syncSecurityConfigFromContent = (content: string) => {
  const cleaned = removeJsonComments(content)
  if (!cleaned) return
  const parsed = JSON.parse(cleaned) as Partial<UserConfig>
  if (!parsed.securityConfig && !('security' in parsed)) return
  const nextSecurityConfig = normalizeSecurityConfig(parsed.securityConfig || parsed)
  const next = mergeConfig(getConfig(), { securityConfig: nextSecurityConfig })
  store.set('config', next)
  return next.securityConfig
}

const broadcastSecurityConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('security-config:changed', content)
    }
  })
}

const startSecurityConfigWatcher = async () => {
  const configPath = await ensureSecurityConfigFile()
  securityConfigWatcher?.close()
  securityConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      syncSecurityConfigFromContent(content)
      broadcastSecurityConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const startKeywordHighlightConfigWatcher = async () => {
  const configPath = await ensureKeywordHighlightConfigFile()
  keywordHighlightConfigWatcher?.close()
  keywordHighlightConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      syncKeywordHighlightConfigFromContent(content)
      broadcastKeywordHighlightConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const startMcpConfigWatcher = async () => {
  const configPath = await ensureMcpConfigFile()
  mcpConfigWatcher?.close()
  mcpConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      await syncMcpConfigFromContent(content)
      broadcastMcpConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const loadPty = (): PtyModule | null => {
  try {
    return require('node-pty') as PtyModule
  } catch {
    return null
  }
}

const createSshTerminal = (owner: BrowserWindow, id: string, options: TerminalCreateOptions) => {
  return createSshTerminalSession(id, options, {
    lifecycle: (event) => owner.webContents.send('terminal:lifecycle', event),
    exit: (event, code) => sendTerminalExit(owner, event, code ?? event.code ?? null),
    data: (chunk) => sendTerminalData(owner, id, chunk),
    closed: () => sessions.delete(id)
  })
}

const registerIpc = () => {
  ipcMain.handle('app:platform', () => process.platform)
  ipcMain.handle('app:shell', () => getDefaultShell())
  ipcMain.handle('app:check-update', () => checkAppUpdate(app.getVersion()))
  ipcMain.handle('app:download-update', (event, version: string) => {
    const emit = (progress: AppUpdateProgressEvent) => event.sender.send('app:update-progress', progress)
    return downloadAppUpdate({ version }, emit, { cacheDir: join(app.getPath('userData'), 'updates') })
  })
  ipcMain.handle('app:install-update', (_event, version?: string) =>
    installAppUpdate(
      { version },
      {
        installer: async (update) => {
          const errorMessage = await shell.openPath(update.filePath)
          if (errorMessage) throw new Error(errorMessage)
          return {
            handoff: {
              kind: 'os-open',
              accepted: true
            },
            message: `Update ${update.version} handed off to the operating system installer.`
          }
        }
      }
    )
  )
  ipcMain.handle('chat-history:list', () => listChatConversations())
  ipcMain.handle('chat-history:create', () => createChatConversation())
  ipcMain.handle('chat-history:update', (_event, input: AiChatConversationUpdateInput) => updateChatConversation(input))
  ipcMain.handle('chat-history:delete', (_event, id: string) => deleteChatConversation(id))
  ipcMain.handle('chat-history:restore', (_event, id: string) => restoreChatConversation(id))
  ipcMain.handle('chat-history:message-metadata', (_event, input: AiChatMessageMetadataInput) => saveChatMessageMetadata(input))
  ipcMain.handle('ai:mcp-tool-call:approve', (_event, input: AiMcpToolCallActionInput) => handleAiMcpToolCallAction(input, true))
  ipcMain.handle('ai:mcp-tool-call:reject', (_event, input: AiMcpToolCallActionInput) => handleAiMcpToolCallAction(input, false))
  ipcMain.handle('ai:mcp-resource-access:approve', (_event, input: AiMcpResourceAccessActionInput) => handleAiMcpResourceAccessAction(input, true))
  ipcMain.handle('ai:mcp-resource-access:reject', (_event, input: AiMcpResourceAccessActionInput) => handleAiMcpResourceAccessAction(input, false))
  ipcMain.handle('chat:export', async (event, input: AiChatExportInput) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    return exportChat(input, {
      showSaveDialog: (options) => {
        if (shouldUseE2eDialogFixtures()) {
          return Promise.resolve({
            canceled: false,
            filePath: join(app.getPath('downloads'), basename(options.defaultPath))
          })
        }
        return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
      }
    })
  })
  ipcMain.handle('ai:todo-snapshot', () => listAiTodoSnapshot())
  ipcMain.handle('ai:context-catalog', () => listAiContextCatalog())
  ipcMain.handle('ai:command-catalog', () => listAiCommandCatalog())
  ipcMain.handle('user:get-account', () => getUserAccount())
  ipcMain.handle('user:open-login', () => openUserLogin())
  ipcMain.handle('user:login', (_event, input: AiopsUserLoginInput) => loginUserAccount(input))
  ipcMain.handle('user:logout', () => logoutUserAccount())
  ipcMain.handle('user:skip-login', () => skipUserLogin())
  ipcMain.handle('user:send-login-code', (_event, input: AiopsUserCodeInput) => sendUserLoginCode(input))
  ipcMain.handle('user:avatar:prepare', (_event, input: AiopsUserAvatarPrepareInput) => prepareUserAvatarImage(input))
  ipcMain.handle('user:update-profile', (_event, input: AiopsUserProfileUpdateInput) => updateUserProfile(input))
  ipcMain.handle('user:reset-password', (_event, input: AiopsUserPasswordInput) => resetUserPassword(input))
  ipcMain.handle('user:send-contact-code', (_event, input: AiopsUserCodeInput) => sendUserContactCode(input))
  ipcMain.handle('user:bind-contact', (_event, input: AiopsUserContactBindInput) => bindUserContact(input))
  ipcMain.handle('user:deactivate-account', (_event, input: AiopsUserDeactivateInput) => deactivateUserAccount(input))
  ipcMain.handle('user:revoke-trusted-device', (_event, id: number) => revokeTrustedDevice(id))
  ipcMain.handle('app:get-protocol-prefix', () => aiopstermProtocolPrefix)
  ipcMain.handle('app:handle-protocol-url', async (_event, rawUrl: string) => handleDeepLinkUrl(rawUrl))
  ipcMain.handle('app:consume-deep-links', async () => {
    const queue = [...pendingDeepLinks]
    pendingDeepLinks.length = 0
    return queue
  })
  ipcMain.handle('app:open-external-url', async (_event, rawUrl: string) => {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs can be opened')
    }
    await shell.openExternal(parsed.toString())
  })
  ipcMain.handle('app:open-log-dir', async () => {
    const logDir = getLogDirPath()
    await mkdir(logDir, { recursive: true })
    if (shouldUseE2eDialogFixtures()) {
      return { path: logDir }
    }
    const result = await shell.openPath(logDir)
    if (result) throw new Error(result)
    return { path: logDir }
  })
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.maximize()
  })
  ipcMain.handle('window:unmaximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.unmaximize()
  })
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false)
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:save', (_event, patch: Partial<UserConfig>) => {
    const next = mergeConfig(getConfig(), patch)
    store.set('config', next)
    return next
  })
  ipcMain.handle('privacy:runtime:apply', (_event, input: PrivacyRuntimeApplyInput) => applyPrivacyRuntimeSettings(input))
  ipcMain.handle('knowledge-search:runtime:apply', (_event, input: KnowledgeSearchRuntimeApplyInput) => applyKnowledgeSearchRuntimeSetting(input))
  ipcMain.handle('settings-preferences:get', () => {
    const result = getSettingsPreferences(getConfig())
    if (result.ok && result.data) {
      store.set('config', mergeConfig(getConfig(), { shortcuts: result.data.shortcuts, rules: result.data.rules, customInstructions: '' }))
    }
    return result
  })
  ipcMain.handle('settings-preferences:save-rule', (_event, input: SettingsRuleSaveInput) => {
    const result = saveSettingsRule(input)
    if (result.ok && result.data) {
      store.set('config', mergeConfig(getConfig(), { rules: result.data.rules, customInstructions: '' }))
    }
    return result
  })
  ipcMain.handle('settings-preferences:delete-rule', (_event, id: string) => {
    const result = deleteSettingsRule(id)
    if (result.ok && result.data) {
      store.set('config', mergeConfig(getConfig(), { rules: result.data.rules, customInstructions: '' }))
    }
    return result
  })
  ipcMain.handle('settings-preferences:save-shortcut', (_event, input: SettingsShortcutSaveInput) => {
    const result = saveSettingsShortcut(input)
    if (result.ok && result.data) {
      store.set('config', mergeConfig(getConfig(), { shortcuts: result.data.shortcuts }))
    }
    return result
  })
  ipcMain.handle('settings-preferences:reset-shortcuts', () => {
    const result = resetSettingsShortcuts()
    if (result.ok && result.data) {
      store.set('config', mergeConfig(getConfig(), { shortcuts: result.data.shortcuts }))
    }
    return result
  })
  ipcMain.handle('security-config:path', async () => ensureSecurityConfigFile())
  ipcMain.handle('security-config:read', async () => {
    const configPath = await ensureSecurityConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('security-config:write', async (_event, content: string) => {
    const configPath = await ensureSecurityConfigFile()
    const parsed = JSON.parse(removeJsonComments(content)) as Partial<UserConfig>
    if (!parsed.securityConfig && !('security' in parsed)) {
      return { ok: false, errorCode: 'SECURITY_CONFIG_INVALID', errorMessage: 'Security config content is missing the security root.' }
    }
    const securityConfig = normalizeSecurityConfig(parsed.securityConfig || parsed)
    await writeFile(configPath, content, 'utf-8')
    store.set('config', mergeConfig(getConfig(), { securityConfig }))
    broadcastSecurityConfigChanged(content)
    return { ok: true, data: { securityConfig } }
  })
  ipcMain.handle('keyword-highlight-config:path', async () => ensureKeywordHighlightConfigFile())
  ipcMain.handle('keyword-highlight-config:read', async () => {
    const configPath = await ensureKeywordHighlightConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('keyword-highlight-config:write', async (_event, content: string) => {
    const configPath = await ensureKeywordHighlightConfigFile()
    const parsed = JSON.parse(content) as Partial<UserConfig>
    if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) {
      return { ok: false, errorCode: 'KEYWORD_HIGHLIGHT_CONFIG_INVALID', errorMessage: 'Keyword highlight config content is missing the keyword-highlight root.' }
    }
    const keywordHighlight = normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed)
    await writeFile(configPath, content, 'utf-8')
    store.set('config', mergeConfig(getConfig(), { keywordHighlight }))
    broadcastKeywordHighlightConfigChanged(content)
    return { ok: true, data: { keywordHighlight } }
  })
  ipcMain.handle('mcp-config:path', async () => ensureMcpConfigFile())
  ipcMain.handle('mcp:get-servers', async () => {
    const configPath = await ensureMcpConfigFile()
    await syncMcpConfigFromContent(await readFile(configPath, 'utf-8'))
    return cloneMcpServers(getConfig().mcpServers) || []
  })
  ipcMain.handle('mcp-config:read', async () => {
    const configPath = await ensureMcpConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('mcp-config:write', async (_event, content: string) => {
    const configPath = await ensureMcpConfigFile()
    const normalized = normalizeMcpConfigFile(JSON.parse(content))
    const nextContent = JSON.stringify(normalized, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    const snapshot = await applyMcpConfigFileSnapshot(normalized)
    broadcastMcpConfigChanged(nextContent)
    return { ok: true, data: snapshot }
  })
  ipcMain.handle('mcp-config:toggle-server', async (_event, serverName: string, disabled: boolean) => {
    const configPath = await ensureMcpConfigFile()
    const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
    if (!parsed.mcpServers[serverName]) {
      parsed.mcpServers[serverName] = { type: 'stdio' }
    }
    parsed.mcpServers[serverName].disabled = disabled
    const nextContent = JSON.stringify(parsed, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    await syncMcpConfigFromContent(nextContent)
    broadcastMcpConfigChanged(nextContent)
  })
  ipcMain.handle('mcp-config:delete-server', async (_event, serverName: string) => {
    const configPath = await ensureMcpConfigFile()
    const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
    delete parsed.mcpServers[serverName]
    const nextContent = JSON.stringify(parsed, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    await syncMcpConfigFromContent(nextContent)
    broadcastMcpConfigChanged(nextContent)
  })
  ipcMain.handle('mcp:set-tool-state', async (_event, serverName: string, toolName: string, enabled: boolean) => {
    setMcpToolState(serverName, toolName, Boolean(enabled))
  })
  ipcMain.handle('mcp:set-tool-auto-approve', async (_event, serverName: string, toolName: string, autoApprove: boolean) => {
    try {
      return await setMcpToolAutoApprove(serverName, toolName, Boolean(autoApprove))
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_TOOL_AUTO_APPROVE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'MCP tool auto approve update failed.'
      }
    }
  })
  ipcMain.handle('mcp:tool-call', async (_event, input: McpToolCallInput) => {
    try {
      const current = getConfig()
      return callMcpTool(await loadCurrentMcpConfigFile(), input, {
        servers: current.mcpServers || [],
        toolStates: current.mcpToolStates || {},
        clientName: 'aiopsterm',
        clientVersion: app.getVersion()
      })
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_CONFIG_INVALID',
        errorMessage: error instanceof Error ? error.message : 'MCP config could not be read.'
      }
    }
  })
  ipcMain.handle('mcp:resource-read', async (_event, input: McpResourceReadInput) => {
    try {
      return readMcpResource(await loadCurrentMcpConfigFile(), input, {
        servers: getConfig().mcpServers || [],
        clientName: 'aiopsterm',
        clientVersion: app.getVersion()
      })
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_CONFIG_INVALID',
        errorMessage: error instanceof Error ? error.message : 'MCP config could not be read.'
      }
    }
  })
  ipcMain.handle('skills:get-all', async () => syncSkillsConfigFromDisk())
  ipcMain.handle('skills:get-enabled', async () => {
    const skills = await loadSkillsFromDisk()
    return skills.filter((skill) => skill.enabled)
  })
  ipcMain.handle('skills:set-enabled', async (_event, skillName: string, enabled: boolean) => {
    const skills = await loadSkillsFromDisk()
    const target = skills.find((skill) => skill.name === skillName)
    if (!target) throw new Error(`Skill not found: ${skillName}`)
    const nextSkills = skills.map((skill) => (skill.name === skillName ? { ...skill, enabled: Boolean(enabled) } : skill))
    store.set('config', mergeConfig(getConfig(), { skills: nextSkills }))
    broadcastSkillsUpdate(nextSkills)
  })
  ipcMain.handle('skills:get-user-path', async () => ensureSkillsDirectory())
  ipcMain.handle('skills:reload', async () => syncSkillsConfigFromDisk())
  ipcMain.handle('skills:create', async (_event, metadata: SkillMetadataConfig, content: string) => {
    const normalized = validateSkillMetadata(metadata)
    if (!/^[a-z-]+$/.test(normalized.name)) {
      throw new Error('Skill name can only contain lowercase letters and hyphens')
    }
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) {
      throw new Error('Skill content is required')
    }
    const skillsPath = await ensureSkillsDirectory()
    const existing = await loadSkillsFromDisk()
    if (existing.some((skill) => skill.name === normalized.name)) {
      throw new Error(`Skill already exists: ${normalized.name}`)
    }
    const skillDir = join(skillsPath, normalizeSkillNameForDirectory(normalized.name))
    try {
      await access(skillDir)
      throw new Error(`Skill directory already exists: ${skillDir}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Skill directory already exists')) throw error
    }
    await mkdir(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    await writeFile(skillPath, buildSkillFile(normalized, skillContent), 'utf-8')
    await startSkillsWatcher()
    const created = await findSkillByName(normalized.name)
    if (!created) throw new Error(`Failed to create skill: ${normalized.name}`)
    return created
  })
  ipcMain.handle('skills:delete', async (_event, skillName: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!isEditableSkill(skill)) throw new Error('Can only delete user-created skills')
    await rm(dirname(skill.path), { recursive: true, force: true })
    await startSkillsWatcher()
  })
  ipcMain.handle('skills:open-folder', async () => {
    const skillsPath = await ensureSkillsDirectory()
    const result = await shell.openPath(skillsPath)
    if (result) throw new Error(result)
    return { path: skillsPath }
  })
  ipcMain.handle('skills:import-zip', async (_event, zipPath: string, overwrite?: boolean) => importSkillZip(zipPath, Boolean(overwrite)))
  ipcMain.handle('skills:read-content', async (_event, skillName: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    return {
      metadata: {
        name: skill.name,
        description: skill.description
      },
      content: skill.content
    }
  })
  ipcMain.handle('skills:update', async (_event, skillName: string, metadata: SkillMetadataConfig, content: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!isEditableSkill(skill)) throw new Error('Can only update user-created skills')
    const normalized = validateSkillMetadata({ ...metadata, name: skillName })
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) throw new Error('Skill content is required')
    await writeFile(skill.path, buildSkillFile(normalized, skillContent), 'utf-8')
    await startSkillsWatcher()
  })
  ipcMain.handle('skills:export-zip', async (event, skillName: string) => {
    const zipBuffer = await exportSkillZipBuffer(skillName)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const saveOptions = {
      defaultPath: `${skillName}.zip`,
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' }
    }
    await writeFile(result.filePath, zipBuffer)
    return { success: true, filePath: result.filePath }
  })
  ipcMain.handle('assets:list', () => listAssets())
  ipcMain.handle('assets:groups:list', (_event, input?: AiopsAssetGroupListInput) => listAssetGroups(input))
  ipcMain.handle('assets:groups:rename', (_event, input: AiopsAssetGroupRenameInput) => renameAssetGroup(input))
  ipcMain.handle('assets:groups:delete', (_event, input: AiopsAssetGroupDeleteInput) => deleteAssetGroup(input))
  ipcMain.handle('assets:save', (_event, asset: AiopsAssetInput) => saveAsset(asset))
  ipcMain.handle('assets:test-connection', (_event, input) => testAssetConnection(input))
  ipcMain.handle('assets:delete', (_event, id: string) => deleteAsset(id))
  ipcMain.handle('assets:organization:refresh', (_event, input?: AiopsOrganizationAssetRefreshInput) => refreshOrganizationAssets(input))
  ipcMain.handle('assets:import:preview', (_event, input) => previewAssetImport(input))
  ipcMain.handle('assets:import:confirm', (_event, input) => confirmAssetImport(input))
  ipcMain.handle('assets:export', async (event, input: AiopsAssetExportInput) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    return exportAssets(input, {
      showSaveDialog: (options) => {
        if (shouldUseE2eDialogFixtures()) {
          return Promise.resolve({
            canceled: false,
            filePath: join(app.getPath('downloads'), basename(options.defaultPath))
          })
        }
        return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
      }
    })
  })
  ipcMain.handle('ssh:tunnel:start', (_event, input: AiopsSshTunnelStartInput) => startSshTunnel(input))
  ipcMain.handle('ssh:tunnel:stop', (_event, input: AiopsSshTunnelStopInput) => stopSshTunnel(input))
  ipcMain.handle('assets:folder:save', (_event, folder: AiopsCustomFolderSaveInput) => saveAssetFolder(folder))
  ipcMain.handle('assets:folder:delete', (_event, uuid: string) => deleteAssetFolder(uuid))
  ipcMain.handle('assets:keychains:list', () => listKeychains())
  ipcMain.handle('assets:keychains:ssh-agent-options', () => listSshAgentKeychainOptions())
  ipcMain.handle('assets:keychains:get', (_event, id: string) => getKeychain(id))
  ipcMain.handle('assets:keychains:save', (_event, keychain: AiopsKeychainInput) => saveKeychain(keychain))
  ipcMain.handle('assets:keychains:delete', (_event, id: string) => deleteKeychain(id))
  ipcMain.handle('quick-commands:get', () => getQuickCommands())
  ipcMain.handle('quick-commands:save', (_event, config: QuickCommandsUserConfig) => saveQuickCommands(config))
  ipcMain.handle('quick-commands:group:save', (_event, input: QuickCommandGroupSaveInput) => saveQuickCommandGroup(input))
  ipcMain.handle('quick-commands:group:delete', (_event, uuid: string) => deleteQuickCommandGroup(uuid))
  ipcMain.handle('quick-commands:snippet:save', (_event, input: QuickCommandSnippetSaveInput) => saveQuickCommandSnippet(input))
  ipcMain.handle('quick-commands:macro:save', (_event, input: QuickCommandMacroSaveInput) => saveQuickCommandMacro(input))
  ipcMain.handle('quick-commands:snippet:delete', (_event, id: number) => deleteQuickCommandSnippet(id))
  ipcMain.handle('quick-commands:reorder', (_event, input: QuickCommandReorderInput) => reorderQuickCommands(input))
  ipcMain.handle('quick-commands:script:plan', (_event, input: QuickCommandScriptPlanInput) => planQuickCommandScript(input))
  ipcMain.handle('aliases:list', (_event, query?: string) => listAliasCommands(query || ''))
  ipcMain.handle('aliases:save', (_event, input: AliasCommandSaveInput) => saveAliasCommand(input))
  ipcMain.handle('aliases:delete', (_event, input: AliasCommandDeleteInput) => deleteAliasCommand(input))
  ipcMain.handle('dialog:open-file', async (event, options) => {
    const useE2eDialogFixtures = shouldUseE2eDialogFixtures()
    if (
      useE2eDialogFixtures &&
      Array.isArray(options?.properties) &&
      options.properties.includes('openFile') &&
      Array.isArray(options?.filters) &&
      options.filters.some((filter: { name?: string }) => filter?.name === 'Asset Import Files')
    ) {
      const assetImportPath = join(app.getPath('userData'), 'e2e-external-reference-assets.json')
      await writeFile(
        assetImportPath,
        JSON.stringify([{ username: 'ops', ip: '10.73.0.9', label: 'e2e-imported-json', group_name: 'E2E', port: 2299 }]),
        'utf-8'
      )
      return { canceled: false, filePaths: [assetImportPath] }
    }
    if (
      useE2eDialogFixtures &&
      Array.isArray(options?.properties) &&
      options.properties.includes('openFile') &&
      Array.isArray(options?.filters) &&
      options.filters.some((filter: { name?: string }) => filter?.name === 'Key Files')
    ) {
      const keyImportPath = join(app.getPath('userData'), 'e2e-import-rsa.pem')
      await writeFile(keyImportPath, '-----BEGIN RSA PRIVATE KEY-----\ne2e import\n-----END RSA PRIVATE KEY-----', 'utf-8')
      return { canceled: false, filePaths: [keyImportPath] }
    }
    if (
      useE2eDialogFixtures &&
      Array.isArray(options?.properties) &&
      options.properties.includes('openFile') &&
      Array.isArray(options?.filters) &&
      options.filters.some((filter: { name?: string }) => filter?.name === 'Images')
    ) {
      const backgroundPath = join(app.getPath('userData'), 'e2e-background.png')
      const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
      await writeFile(backgroundPath, png1x1)
      return { canceled: false, filePaths: [backgroundPath] }
    }
    if (
      useE2eDialogFixtures &&
      Array.isArray(options?.properties) &&
      options.properties.includes('openFile') &&
      Array.isArray(options?.filters) &&
      options.filters.some((filter: { name?: string }) => filter?.name === 'Text')
    ) {
      const attachmentPath = join(app.getPath('userData'), 'e2e-chat-attachment.md')
      await writeFile(attachmentPath, '# E2E chat attachment\n\nGenerated by the aiopsterm test harness.\n', 'utf-8')
      return { canceled: false, filePaths: [attachmentPath] }
    }
    if (
      useE2eDialogFixtures &&
      Array.isArray(options?.properties) &&
      options.properties.includes('openFile') &&
      Array.isArray(options?.filters) &&
      options.filters.some((filter: { name?: string }) => filter?.name === 'YAML Files')
    ) {
      const kubeconfigPath = join(app.getPath('userData'), 'e2e-kubeconfig.yaml')
      await writeFile(
        kubeconfigPath,
        [
          'apiVersion: v1',
          'kind: Config',
          'current-context: e2e/admin',
          'clusters:',
          '- name: e2e-cluster',
          '  cluster:',
          '    server: https://e2e.k8s.local:6443',
          'contexts:',
          '- name: e2e/admin',
          '  context:',
          '    cluster: e2e-cluster',
          '    namespace: e2e'
        ].join('\n'),
        'utf-8'
      )
      return { canceled: false, filePaths: [kubeconfigPath] }
    }
    if (useE2eDialogFixtures && Array.isArray(options?.properties) && options.properties.includes('openDirectory')) {
      const importPath = join(app.getPath('userData'), 'e2e-imported-note.md')
      await writeFile(importPath, '# E2E imported note\n\nGenerated by the aiopsterm test harness.\n', 'utf-8')
      return { canceled: false, filePaths: [importPath] }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
  })
  ipcMain.handle('dialog:save-file', async (event, options) => {
    if (shouldUseE2eDialogFixtures()) {
      return { canceled: false, filePath: join(app.getPath('downloads'), options?.defaultPath ? basename(String(options.defaultPath)) : 'downloaded-file') }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
  })
  ipcMain.handle('settings:save-custom-background', async (_event, srcAbsPath: string) => {
    if (!srcAbsPath || typeof srcAbsPath !== 'string') throw new Error('srcAbsPath is required')
    if (!isAbsolute(srcAbsPath)) throw new Error('srcAbsPath must be absolute')
    const metadata = await stat(srcAbsPath)
    if (!metadata.isFile()) throw new Error('Background source must be a file')
    if (metadata.size > maxCustomBackgroundBytes) throw new Error('Background file too large')
    const ext = extname(srcAbsPath).toLowerCase()
    if (!allowedCustomBackgroundExtensions.has(ext)) throw new Error('Background file type not allowed')

    const backgroundDir = getCustomBackgroundsPath()
    await mkdir(backgroundDir, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(backgroundDir, sanitizeCustomBackgroundName(basename(srcAbsPath)))
    const finalPath = join(backgroundDir, finalName)
    await cp(srcAbsPath, finalPath)
    return {
      filePath: finalPath,
      url: pathToFileURL(finalPath).href,
      name: finalName,
      size: metadata.size
    }
  })
  ipcMain.handle('files:read-local', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
    if (!isAbsolute(filePath)) throw new Error('filePath must be absolute')
    const metadata = await stat(filePath)
    if (!metadata.isFile()) throw new Error('Source must be a file')
    if (metadata.size > maxLocalTextReadBytes) throw new Error('File too large')
    return {
      content: await readFile(filePath, 'utf-8'),
      mtimeMs: metadata.mtimeMs,
      size: metadata.size
    }
  })
  ipcMain.handle('files:write-local', async (_event, filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, typeof content === 'string' ? content : String(content), 'utf-8')
  })
  ipcMain.handle('chat:stage-attachment', async (_event, payload: { taskId: string; srcAbsPath: string }) => {
    return stageChatAttachment(payload, getChatAttachmentsPath())
  })
  ipcMain.handle('chat:validate-image-attachment', (_event, input?: ChatImageAttachmentValidateInput) => validateChatImageAttachment(input || {}))
  ipcMain.handle('chat:prepare-image-attachment', (_event, input?: ChatImageAttachmentPrepareInput) => prepareChatImageAttachment(input || {}))
  ipcMain.handle('chat:prepare-image-attachment-from-file', (_event, input?: ChatImageAttachmentFileInput) => prepareChatImageAttachmentFromFile(input || {}))
  ipcMain.handle('chat:prepare-image-attachment-from-clipboard', (_event, input?: ChatImageAttachmentClipboardInput) =>
    prepareChatImageAttachmentFromClipboard(input || {})
  )
  ipcMain.handle('kb:check-path', async (_event, payload: { absPath: string }) => {
    const absPath = typeof payload?.absPath === 'string' ? payload.absPath : ''
    try {
      const metadata = await stat(absPath)
      return {
        exists: true,
        isDirectory: metadata.isDirectory(),
        isFile: metadata.isFile()
      }
    } catch {
      return { exists: false, isDirectory: false, isFile: false }
    }
  })
  ipcMain.handle('kb:ensure-root', async () => {
    await ensureKnowledgeBaseDirectory()
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true }
  })
  ipcMain.handle('kb:get-root', async () => {
    const root = await ensureKnowledgeBaseDirectory()
    await syncKnowledgeBaseConfigFromDisk()
    return { root }
  })
  ipcMain.handle('kb:list-dir', async (_event, payload: { relDir: string }) => listKnowledgeDir(payload?.relDir || ''))
  ipcMain.handle('kb:read-file', async (_event, payload: { relPath: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    if (!metadata.isFile()) throw new Error('Not a file')
    if (encoding === 'base64') {
      const content = (await readFile(absPath)).toString('base64')
      return {
        content,
        mtimeMs: metadata.mtimeMs,
        mimeType: getKnowledgeMimeType(relPath),
        isImage: knowledgeImageExtensions.has(extname(relPath).toLowerCase())
      }
    }
    return {
      content: await readFile(absPath, 'utf-8'),
      mtimeMs: metadata.mtimeMs
    }
  })
  ipcMain.handle('kb:write-file', async (_event, payload: { relPath: string; content: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = resolveKnowledgePath(relPath)
    await mkdir(dirname(absPath), { recursive: true })
    if (encoding === 'base64') {
      await writeFile(absPath, Buffer.from(content, 'base64'))
    } else {
      await writeFile(absPath, content, 'utf-8')
    }
    const metadata = await stat(absPath)
    await syncKnowledgeBaseConfigFromDisk()
    return { mtimeMs: metadata.mtimeMs }
  })
  ipcMain.handle('kb:paste-image-from-clipboard', async (_event, payload?: KnowledgeBasePastedImageInput) =>
    writeKnowledgePastedImageFromClipboard(payload || {}, {
      resolveKnowledgePath,
      ensureUniqueKnowledgeName,
      syncKnowledgeBaseConfigFromDisk
    })
  )
  ipcMain.handle('kb:mkdir', async (_event, payload: { relDir: string; name: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!isSafeKnowledgeBasename(name)) throw new Error('Invalid folder name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const targetAbs = join(dirAbs, name)
    await mkdir(targetAbs, { recursive: false })
    const relPath = posix.join(normalizedRelDir, name)
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true, relPath }
  })
  ipcMain.handle('kb:create-file', async (_event, payload: { relDir: string; name: string; content?: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!isSafeKnowledgeBasename(name)) throw new Error('Invalid file name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dirAbs, name)
    await writeFile(join(dirAbs, finalName), typeof payload?.content === 'string' ? payload.content : '', 'utf-8')
    const relPath = posix.join(normalizedRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:rename', async (_event, payload: { relPath: string; newName: string }) => {
    const relPath = payload?.relPath || ''
    const newName = typeof payload?.newName === 'string' ? payload.newName.trim() : ''
    if (!isSafeKnowledgeBasename(newName)) throw new Error('Invalid name')
    const { absPath: srcAbs, relPath: normalizedRelPath } = resolveKnowledgePath(relPath)
    const parentAbs = dirname(srcAbs)
    const destAbs = join(parentAbs, newName)
    const parentRel = posix.dirname(normalizedRelPath)
    const nextRelPath = parentRel === '.' ? newName : posix.join(parentRel, newName)
    if (srcAbs === destAbs) return { relPath: nextRelPath }
    if (await pathExists(destAbs)) throw new Error('Target already exists')
    await rename(srcAbs, destAbs)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath: nextRelPath }
  })
  ipcMain.handle('kb:delete', async (_event, payload: { relPath: string; recursive?: boolean }) => {
    const relPath = payload?.relPath || ''
    const { absPath } = resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    if (metadata.isDirectory()) {
      await rm(absPath, { recursive: Boolean(payload?.recursive), force: true })
    } else {
      await unlink(absPath)
    }
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true }
  })
  ipcMain.handle('kb:move', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot move a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    const destAbs = join(dstDirAbs, finalName)
    try {
      await rename(srcAbs, destAbs)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EXDEV') {
        await cp(srcAbs, destAbs, { recursive: true })
        await rm(srcAbs, { recursive: true, force: true })
      } else {
        throw error
      }
    }
    const relPath = posix.join(normalizedDstRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:copy', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot copy a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    await cp(srcAbs, join(dstDirAbs, finalName), { recursive: true })
    const relPath = posix.join(normalizedDstRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:import-file', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isFile()) throw new Error('Source is not a file')
    if (!isKnowledgeFileAllowedForImport(srcAbsPath, sourceMetadata.size)) {
      if (sourceMetadata.size > maxKnowledgeImportBytes) throw new Error('File too large')
      throw new Error('File type not allowed')
    }
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destAbs = join(dstDirAbs, finalName)
    const jobId = randomUUID()
    const destRelPath = posix.join(normalizedDstRelDir, finalName)
    const owner = BrowserWindow.fromWebContents(event.sender)
    sendKnowledgeProgress(owner, { jobId, transferred: 0, total: sourceMetadata.size || 1, destRelPath })
    await cp(srcAbsPath, destAbs)
    sendKnowledgeProgress(owner, { jobId, transferred: sourceMetadata.size || 1, total: sourceMetadata.size || 1, destRelPath })
    await syncKnowledgeBaseConfigFromDisk()
    return { jobId, relPath: destRelPath }
  })
  ipcMain.handle('kb:import-folder', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isDirectory()) throw new Error('Source is not a folder')
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalFolderName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destFolderAbs = join(dstDirAbs, finalFolderName)
    const destFolderRel = posix.join(normalizedDstRelDir, finalFolderName)
    await mkdir(destFolderAbs, { recursive: true })
    const tasks = await collectKnowledgeImportTasks(srcAbsPath, destFolderAbs)
    const jobId = randomUUID()
    const owner = BrowserWindow.fromWebContents(event.sender)
    sendKnowledgeProgress(owner, { jobId, transferred: 0, total: tasks.length, destRelPath: destFolderRel })
    for (let index = 0; index < tasks.length; index += 1) {
      await mkdir(dirname(tasks[index].destPath), { recursive: true })
      await cp(tasks[index].srcPath, tasks[index].destPath)
      sendKnowledgeProgress(owner, { jobId, transferred: index + 1, total: tasks.length, destRelPath: destFolderRel })
    }
    await syncKnowledgeBaseConfigFromDisk()
    return { jobId, relPath: destFolderRel }
  })
  ipcMain.handle('kb:search', async (_event, query: string, options?: { maxResults?: number; minScore?: number }) => searchKnowledgeIndex(query, options))
  ipcMain.handle('kb:search-status', async () => {
    const index = await getKnowledgeSearchIndex()
    return index.status
  })
  ipcMain.handle('kb:reindex', async () => {
    knowledgeSearchIndex = await buildKnowledgeSearchIndex()
    return {
      files: knowledgeSearchIndex.status.totalFiles,
      chunks: knowledgeSearchIndex.status.totalChunks
    }
  })

  ipcMain.handle('terminal:create', (event, options: TerminalCreateOptions = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) {
      throw new Error('No owner window for terminal session')
    }

    const id = randomUUID()
    if (options.kind === 'ssh' || options.ssh || options.assetId) {
      const result = createSshTerminal(owner, id, options)
      if (result.session) {
        sessions.set(id, {
          id,
          process: result.session,
          shell: result.shell,
          cwd: result.cwd,
          window: owner,
          kind: 'ssh',
          host: result.connection.host
        })
      }
      return {
        id,
        shell: result.shell,
        cwd: result.cwd,
        kind: 'ssh' as const,
        connection: createSshTerminalConnectionInfo(id, result.connection, options),
        lifecycle: result.lifecycle
      }
    }

    const terminalShell = options.shell || getDefaultShell()
    const cwd = options.cwd || app.getPath('home')
    const localLifecycleBase = {
      kind: 'local' as const,
      shell: terminalShell,
      cwd
    }
    let lifecycle = sendTerminalLifecycle(owner, id, {
      ...localLifecycleBase,
      stage: 'starting',
      message: `Starting local shell ${terminalShell}`
    })
    let localClosed = false
    const finishLocal = (code: number | null, reason: TerminalDisconnectReason, message: string) => {
      if (localClosed) return
      localClosed = true
      const terminalSession = sessions.get(id)
      sessions.delete(id)
      lifecycle = sendTerminalLifecycle(owner, id, {
        ...localLifecycleBase,
        stage: 'closed',
        code,
        reason: terminalSession?.manualCloseRequested ? 'manual' : reason,
        isNetworkDisconnect: false,
        message: terminalSession?.manualCloseRequested ? 'Terminal closed by user.' : message
      })
      sendTerminalExit(owner, lifecycle, code)
    }
    const failLocal = (error: unknown, message: string, code = 1) => {
      if (localClosed) return
      localClosed = true
      sessions.delete(id)
      lifecycle = sendTerminalErrorLifecycle(owner, id, 'local', error, {
        ...localLifecycleBase,
        code,
        message
      })
      sendTerminalExit(owner, lifecycle, code)
    }
    const ptyModule = loadPty()
    if (ptyModule) {
      const ptyProcess = ptyModule.spawn(terminalShell, [], {
        name: 'xterm-256color',
        cols: options.cols || 100,
        rows: options.rows || 30,
        cwd,
        env: process.env
      })
      sessions.set(id, {
        id,
        process: ptyProcess,
        shell: terminalShell,
        cwd,
        window: owner,
        kind: 'pty',
        host: 'local'
      })
      lifecycle = sendTerminalLifecycle(owner, id, {
        ...localLifecycleBase,
        stage: 'shell-ready',
        message: `Local shell ready ${terminalShell}`
      })
      ptyProcess.onData((data) => sendTerminalData(owner, id, data))
      ptyProcess.onExit((event) => {
        finishLocal(event.exitCode, 'process', 'Local shell exited.')
      })
    } else {
      const child = spawn(terminalShell, [], {
        cwd,
        env: process.env,
        shell: false
      })

      sessions.set(id, {
        id,
        process: child,
        shell: terminalShell,
        cwd,
        window: owner,
        kind: 'process',
        host: 'local'
      })
      lifecycle = sendTerminalLifecycle(owner, id, {
        ...localLifecycleBase,
        stage: 'shell-ready',
        message: `Local shell ready ${terminalShell}`
      })

      child.stdout.on('data', (chunk: Buffer) => {
        sendTerminalData(owner, id, chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        sendTerminalData(owner, id, chunk)
      })
      child.on('exit', (code) => {
        finishLocal(code, 'process', 'Local shell exited.')
      })
      child.on('error', (childError) => {
        sendTerminalData(owner, id, `\n[aiopsterm] failed to start shell: ${childError.message}\n`)
        failLocal(childError, 'Local shell failed to start.')
      })
      sendTerminalData(owner, id, '\n[aiopsterm] pty unavailable, using subprocess fallback.\n')
    }

    return { id, shell: terminalShell, cwd, kind: 'local' as const, lifecycle }
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session) return createTerminalWriteResult(id, data, false)
    if (session.kind === 'pty') {
      ;(session.process as PtyProcess).write(data)
    } else if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).write(data)
    } else {
      ;(session.process as ChildProcessWithoutNullStreams).stdin.write(data)
    }
    terminalHistoryLinesFromWrite(data).forEach((command) => recordTerminalCommandHistory(command, { host: session.host }))
    return createTerminalWriteResult(id, data, true)
  })

  ipcMain.handle('terminal:write-binary', (_event, id: string, payload: unknown) => {
    const session = sessions.get(id)
    const buffer = terminalBinaryPayload(payload)
    if (!session) return createTerminalBinaryWriteResult(id, buffer.byteLength, false)
    if (session.kind === 'pty') {
      return {
        ok: false,
        errorCode: 'TERMINAL_BINARY_UNSUPPORTED',
        errorMessage: 'This terminal runtime does not support binary writes.'
      }
    }
    if (!buffer.byteLength) {
      return {
        ok: false,
        errorCode: 'TERMINAL_BINARY_EMPTY',
        errorMessage: 'Terminal binary payload is empty.'
      }
    }
    writeTerminalBuffer(session, buffer)
    return createTerminalBinaryWriteResult(id, buffer.byteLength, true)
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session) return
    if (session.kind === 'pty') {
      ;(session.process as PtyProcess).resize(cols, rows)
    } else if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).resize(cols, rows)
    }
  })

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return createTerminalKillResult(id, false)
    session.manualCloseRequested = true
    if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).kill('manual')
    } else {
      session.process.kill()
    }
    return createTerminalKillResult(id, true)
  })

  ipcMain.handle('zmodem:pick-upload-files', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    return pickZmodemUploadFiles({
      showOpenDialog: () => {
        const options = { properties: ['openFile', 'multiSelections'] as Electron.OpenDialogOptions['properties'] }
        return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
      }
    })
  })
  ipcMain.handle('zmodem:pick-save-path', async (event, name: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    return pickZmodemSavePath(name, {
      showSaveDialog: (defaultName) => {
        const options = { defaultPath: defaultName }
        return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
      }
    })
  })
  ipcMain.handle('zmodem:open-stream', (_event, savePath: string) => openZmodemStream(savePath))
  ipcMain.handle('zmodem:write-chunk', (_event, streamId: string, chunk: unknown) => writeZmodemChunk(streamId, chunk))
  ipcMain.handle('zmodem:close-stream', (_event, streamId: string) => closeZmodemStream(streamId))

  ipcMain.handle('terminal:suggestions', (_event, query: string, context?: TerminalCommandSuggestionContext) =>
    getTerminalCommandSuggestions(query, context)
  )
  ipcMain.handle('terminal:command:generate', (_event, input: TerminalCommandGenerationInput) => generateTerminalCommand(input))
  ipcMain.handle('models:list', (_event, input?: AiModelCatalogInput) =>
    listAiModels({
      modelSettings: input?.modelSettings || getConfig().modelSettings
    })
  )
  ipcMain.handle('models:check-provider', (_event, input: ModelProviderCheckInput) => checkModelProvider(input))
  ipcMain.handle('extensions:list', () => listExtensionPlugins())
  ipcMain.handle('extensions:install-plugin', (event, input: ExtensionPluginOperationInput) => {
    const emit = (progress: ExtensionInstallProgress) => event.sender.send('extensions:install-progress', progress)
    return installExtensionPlugin(input, emit)
  })
  ipcMain.handle('extensions:update-plugin', (event, input: ExtensionPluginOperationInput) => {
    const emit = (progress: ExtensionInstallProgress) => event.sender.send('extensions:install-progress', progress)
    return updateExtensionPlugin(input, emit)
  })
  ipcMain.handle('extensions:install-package', (event, input: ExtensionPackageInstallInput) => {
    const emit = (progress: ExtensionInstallProgress) => event.sender.send('extensions:install-progress', progress)
    return installExtensionPackage(input, emit)
  })
  ipcMain.handle('extensions:download-package', (_event, input: ExtensionPackageDownloadInput) => downloadExtensionPackage(input))
  ipcMain.handle('extensions:install-plugin-from-url', (event, input: ExtensionPluginUrlInstallInput) => {
    const emit = (progress: ExtensionInstallProgress) => event.sender.send('extensions:install-progress', progress)
    return installExtensionPluginFromUrl(input, emit)
  })
  ipcMain.handle('extensions:uninstall-plugin', (_event, input: ExtensionPluginOperationInput) => uninstallExtensionPlugin(input))
  ipcMain.handle('extensions:open-subscription', (_event, input: ExtensionSubscriptionInput) =>
    openExtensionSubscription(input, (url) => shell.openExternal(url))
  )
  ipcMain.handle('extensions:cancel-install', (_event, pluginId: string) => cancelExtensionInstall(pluginId))
  ipcMain.handle('ai:chat-exchange-request', (_event, input: AiChatExchangeRequestInput) => createAiChatExchangeRequest(input))
  ipcMain.handle('ai:chat-response', (_event, input: AiChatResponseInput) => generateAiChatResponse(input))
  ipcMain.handle('ai:chat-response:cancel', (_event, input: AiChatCancelInput) => cancelAiChatResponse(input))
  ipcMain.handle('voice:transcribe', (_event, input?: VoiceTranscriptionInput) => transcribeVoiceInput(input))
  ipcMain.handle('database:catalog', () => listDatabaseCatalog())
  ipcMain.handle('database:test-connection', (_event, input: DatabaseConnectionTestInput) => testDatabaseConnection(input))
  ipcMain.handle('database:save-connection', (_event, input: DatabaseConnectionSaveInput) => saveDatabaseConnection(input))
  ipcMain.handle('database:group:create', (_event, input: DatabaseGroupCreateInput) => createDatabaseGroup(input))
  ipcMain.handle('database:group:rename', (_event, input: DatabaseGroupUpdateInput) => renameDatabaseGroup(input))
  ipcMain.handle('database:group:move', (_event, input: DatabaseGroupUpdateInput) => moveDatabaseGroup(input))
  ipcMain.handle('database:group:delete', (_event, id: string) => deleteDatabaseGroup(id))
  ipcMain.handle('database:connection:move', (_event, input: DatabaseConnectionMoveInput) => moveDatabaseConnection(input))
  ipcMain.handle('database:connection:remove', (_event, connectionId: string) => removeDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:connect', (_event, connectionId: string) => connectDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:disconnect', (_event, connectionId: string) => disconnectDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:refresh', (_event, connectionId: string) => refreshDatabaseConnection(connectionId))
  ipcMain.handle('database:create-database', (_event, input: DatabaseCreateDatabaseInput) => createDatabaseCatalog(input))
  ipcMain.handle('database:execute-sql', (_event, input: DatabaseSqlExecuteInput) => executeDatabaseSql(input))
  ipcMain.handle('database:table-ddl', (_event, input: DatabaseTableDdlInput) => getDatabaseTableDdl(input))
  ipcMain.handle('database:query-table', (_event, input: DatabaseTableQueryInput) => queryDatabaseTable(input))
  ipcMain.handle('database:mutation-plan', (_event, input: DatabaseTableMutationPlanInput) => planDatabaseTableMutation(input))
  ipcMain.handle('database:mutate-table', (_event, input: DatabaseTableMutationInput) => mutateDatabaseTable(input))
  ipcMain.handle('database:export-rows', (_event, input: DatabaseExportInput) =>
    exportDatabaseRows(input, {
      showSaveDialog: (options) => {
        const owner = BrowserWindow.getFocusedWindow()
        return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
      }
    })
  )
  ipcMain.handle('database:ai-pane-state:get', () => getDatabaseAiPaneState())
  ipcMain.handle('database:ai-pane-state:save', (_event, input: DatabaseAiPaneStateSnapshot) => saveDatabaseAiPaneState(input))
  ipcMain.handle('database:ai-pane-request', (_event, input: DatabaseAiPaneRequestInput) => createDatabaseAiPaneRequest(input))
  ipcMain.handle('database:ai-pane-start', (_event, input: DatabaseAiPaneLifecycleInput) => startDatabaseAiPaneResponse(input))
  ipcMain.handle('database:ai-pane-cancel', (_event, input: DatabaseAiPaneLifecycleInput) => cancelDatabaseAiPaneResponse(input))
  ipcMain.handle('database:ai-pane-response', (_event, input: DatabaseAiPaneResponseInput) => generateDatabaseAiPaneResponse(input))
  ipcMain.handle('database:ai-drawer-request', (_event, input: DatabaseAiDrawerRequestInput) => createDatabaseAiDrawerRequest(input))
  ipcMain.handle('database:ai-drawer-start', (_event, input: DatabaseAiDrawerLifecycleInput) => startDatabaseAiDrawerResponse(input))
  ipcMain.handle('database:ai-drawer-cancel', (_event, input: DatabaseAiDrawerLifecycleInput) => cancelDatabaseAiDrawerResponse(input))
  ipcMain.handle('database:ai-drawer-response', (_event, input: DatabaseAiDrawerResponseInput) => generateDatabaseAiDrawerResponse(input))
  ipcMain.handle('database:ai-diagnose-sql-error', (_event, input: DatabaseSqlErrorDiagnosisInput) => diagnoseDatabaseSqlError(input))
  ipcMain.handle('kubernetes:catalog', () => listKubernetesCatalog())
  ipcMain.handle('kubernetes:context:switch', (_event, contextName: string) => switchKubernetesContext(contextName))
  ipcMain.handle('kubernetes:cluster:add', (_event, input: KubernetesClusterInput) => addKubernetesCluster(input))
  ipcMain.handle('kubernetes:cluster:update', (_event, id: string, input: KubernetesClusterUpdateInput) => updateKubernetesCluster(id, input))
  ipcMain.handle('kubernetes:cluster:test', (_event, input: KubernetesClusterTestInput) => testKubernetesClusterConnection(input))
  ipcMain.handle('kubernetes:kubeconfig:import', (_event, input: KubernetesKubeconfigImportInput) => importKubernetesKubeconfig(input))
  ipcMain.handle('kubernetes:cluster:delete', (_event, id: string) => deleteKubernetesCluster(id))
  ipcMain.handle('kubernetes:cluster:connect', (_event, id: string) => connectKubernetesCluster(id))
  ipcMain.handle('kubernetes:cluster:disconnect', (_event, id: string) => disconnectKubernetesCluster(id))
  ipcMain.handle('kubernetes:bastion:sync', (_event, bastionUuid: string) => syncKubernetesBastion(bastionUuid))
  ipcMain.handle('kubernetes:terminal:create', (_event, input: KubernetesTerminalCreateInput) => createKubernetesTerminal(input))
  ipcMain.handle('kubernetes:terminal:write', (_event, id: string, data: string) => writeKubernetesTerminal(id, data))
  ipcMain.handle('kubernetes:terminal:resize', (_event, id: string, cols: number, rows: number) => resizeKubernetesTerminal(id, cols, rows))
  ipcMain.handle('kubernetes:terminal:close', (_event, id: string, exitCode?: number) => closeKubernetesTerminal(id, exitCode))
  ipcMain.handle('kubernetes:execute-command', (_event, input: KubernetesCommandInput) => executeKubernetesCommand(input))
  ipcMain.handle('kubernetes:resource-action:plan', (_event, input: KubernetesResourceActionInput) => planKubernetesResourceAction(input))
  ipcMain.handle('kubernetes:resource-action:execute', (_event, input: KubernetesResourceActionInput) => executeKubernetesResourceAction(input))
  ipcMain.handle('kubernetes:resources:refresh', (_event, input: KubernetesResourceRefreshInput) => refreshKubernetesResources(input))
  ipcMain.handle('kubernetes:agent:proxy:get', () => getKubernetesAgentProxyConfig())
  ipcMain.handle('kubernetes:agent:proxy:save', (_event, input: KubernetesAgentProxyConfigInput) => saveKubernetesAgentProxyConfig(input))
  ipcMain.handle('kubernetes:agent:cleanup', () => cleanupKubernetesAgent())
  ipcMain.handle('files:sessions:catalog', () => listFileSessionCatalog())
  ipcMain.handle('files:sessions:save', (_event, session: FileSessionInfo) => saveFileSession(session))
  ipcMain.handle('files:sessions:save-from-sftp-payload', (_event, payload: Record<string, unknown>) => saveFileSessionFromSftpPayload(payload))
  ipcMain.handle('files:sessions:save-from-terminal-context', (_event, context: FileSessionTerminalContext) =>
    saveFileSessionFromTerminalContext(context)
  )
  ipcMain.handle('files:sessions:update', (_event, id: string, patch: FileSessionPatch) => updateFileSession(id, patch))
  ipcMain.handle('files:sessions:delete', (_event, id: string) => deleteFileSession(id))
  ipcMain.handle('files:sessions:folder:save', (_event, folder: FileSessionFolderSaveInput) => saveFileSessionFolder(folder))
  ipcMain.handle('files:sessions:folder:delete', (_event, uuid: string) => deleteFileSessionFolder(uuid))
  ipcMain.handle('files:list', async (_event, directory: string, options?: FileListOptions) => listBackendFiles(directory, options))
  ipcMain.handle('files:read-content', async (_event, filePath: string, options?: FileContentOptions) => readFileContent(filePath, options))
  ipcMain.handle('files:write-content', async (_event, filePath: string, content: string, options?: FileContentOptions) =>
    writeFileContent(filePath, content, options)
  )
  ipcMain.handle('files:mutate-entry', async (_event, mutation: FileEntryMutation, options?: FileListOptions) =>
    mutateFileEntry(mutation, options)
  )
  ipcMain.handle('files:transfer-entry', async (_event, operation: FileTransferOperation, options?: FileListOptions) =>
    transferFileEntry(operation, options)
  )
  ipcMain.handle('files:transfer-task:cancel', async (_event, input: FileTransferTaskCancelInput) => cancelFileTransferTask(input))
  ipcMain.handle('files:list-transfer-tasks', async () => listFileTransferTasks())
}

app.whenReady().then(async () => {
  registerUserAvatarProtocol()
  registerIpc()
  await Promise.all([startSecurityConfigWatcher(), startKeywordHighlightConfigWatcher(), startMcpConfigWatcher(), startSkillsWatcher()])
  createWindow()
  const deepLinkArg = findDeepLinkArg(process.argv)
  if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  sessions.forEach((session) => {
    if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).kill()
    } else {
      session.process.kill()
    }
  })
  sessions.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  securityConfigWatcher?.close()
  securityConfigWatcher = null
  keywordHighlightConfigWatcher?.close()
  keywordHighlightConfigWatcher = null
  mcpConfigWatcher?.close()
  mcpConfigWatcher = null
  void clearMcpRuntimeClientCache()
  closeSkillsWatchers()
  if (skillsWatcherDebounce) {
    clearTimeout(skillsWatcherDebounce)
    skillsWatcherDebounce = null
  }
})
