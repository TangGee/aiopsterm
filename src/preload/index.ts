import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { KeywordHighlightConfigWriteResult, SecurityConfigWriteResult } from '@shared/contracts/appRuntime'
import type { McpConfigWriteResult } from '@shared/contracts/mcp'
import type { FileListEntry } from '@shared/contracts/files'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { KnowledgeBaseSearchResult, KnowledgeBaseSearchStatus, KnowledgeBaseTransferProgress } from '@shared/contracts/knowledgeBase'
import type {
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent,
  TerminalSessionInfo
} from '@shared/contracts/terminalSessions'

const rendererRuntimeEnvNames = [
  'AIOPSTERM_TERMINAL_STRESS',
  'AIOPSTERM_TERMINAL_DEBUG_LOGS',
  'AIOPSTERM_TERMINAL_RENDER_BACKEND'
]

const rendererRuntimeEnv = () =>
  rendererRuntimeEnvNames.reduce<Record<string, string | undefined>>((env, name) => {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
    return env
  }, {})

const api: AiopsPreloadApi = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  runtimeEnv: rendererRuntimeEnv,
  platform: () => ipcRenderer.invoke('app:platform'),
  shell: () => ipcRenderer.invoke('app:shell'),
  getGpuFeatureStatus: () => ipcRenderer.invoke('app:gpu-feature-status'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadAppUpdate: (version: string) => ipcRenderer.invoke('app:download-update', version),
  installAppUpdate: (version?: string) => ipcRenderer.invoke('app:install-update', version),
  onAppUpdateProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('app:update-progress', wrapped)
    return () => ipcRenderer.off('app:update-progress', wrapped)
  },
  listChatConversations: () => ipcRenderer.invoke('chat-history:list'),
  deselectChatConversation: (expectedConversationId: string) => ipcRenderer.invoke('chat-history:deselect', expectedConversationId),
  createChatConversation: () => ipcRenderer.invoke('chat-history:create'),
  updateChatConversation: (input) => ipcRenderer.invoke('chat-history:update', input),
  deleteChatConversation: (id: string) => ipcRenderer.invoke('chat-history:delete', id),
  restoreChatConversation: (id: string) => ipcRenderer.invoke('chat-history:restore', id),
  saveChatMessageMetadata: (input) => ipcRenderer.invoke('chat-history:message-metadata', input),
  approveAiMcpToolCall: (input) => ipcRenderer.invoke('ai:mcp-tool-call:approve', input),
  rejectAiMcpToolCall: (input) => ipcRenderer.invoke('ai:mcp-tool-call:reject', input),
  approveAiMcpResourceAccess: (input) => ipcRenderer.invoke('ai:mcp-resource-access:approve', input),
  rejectAiMcpResourceAccess: (input) => ipcRenderer.invoke('ai:mcp-resource-access:reject', input),
  exportChat: (input) => ipcRenderer.invoke('chat:export', input),
  listAiTodoSnapshot: () => ipcRenderer.invoke('ai:todo-snapshot'),
  listAiContextCatalog: () => ipcRenderer.invoke('ai:context-catalog'),
  listAiCommandCatalog: () => ipcRenderer.invoke('ai:command-catalog'),
  getUserAccount: () => ipcRenderer.invoke('user:get-account'),
  openUserLogin: () => ipcRenderer.invoke('user:open-login'),
  openUserAccountCenter: () => ipcRenderer.invoke('user:open-account-center'),
  loginUserAccount: (input) => ipcRenderer.invoke('user:login', input),
  logoutUserAccount: () => ipcRenderer.invoke('user:logout'),
  skipUserLogin: () => ipcRenderer.invoke('user:skip-login'),
  sendUserLoginCode: (input) => ipcRenderer.invoke('user:send-login-code', input),
  prepareUserAvatarImage: (input) => ipcRenderer.invoke('user:avatar:prepare', input),
  updateUserProfile: (input) => ipcRenderer.invoke('user:update-profile', input),
  resetUserPassword: (input) => ipcRenderer.invoke('user:reset-password', input),
  sendUserContactCode: (input) => ipcRenderer.invoke('user:send-contact-code', input),
  bindUserContact: (input) => ipcRenderer.invoke('user:bind-contact', input),
  deactivateUserAccount: (input) => ipcRenderer.invoke('user:deactivate-account', input),
  revokeTrustedDevice: (id: number) => ipcRenderer.invoke('user:revoke-trusted-device', id),
  getProtocolPrefix: () => ipcRenderer.invoke('app:get-protocol-prefix') as Promise<string>,
  handleProtocolUrl: (url: string) => ipcRenderer.invoke('app:handle-protocol-url', url),
  consumeDeepLinks: () => ipcRenderer.invoke('app:consume-deep-links'),
  onDeepLink: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('app:deep-link', wrapped)
    return () => ipcRenderer.off('app:deep-link', wrapped)
  },
  openExternalUrl: (url: string) => ipcRenderer.invoke('app:open-external-url', url),
  openOfficialExternalLink: (link) => ipcRenderer.invoke('app:open-official-link', link),
  onProductTelemetryConsent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, telemetry: 'enabled' | 'disabled') => listener(telemetry)
    ipcRenderer.on('product-telemetry:consent-changed', wrapped)
    return () => ipcRenderer.off('product-telemetry:consent-changed', wrapped)
  },
  openSettingsDocumentation: (input) => ipcRenderer.invoke('settings:open-documentation', input),
  submitSettingsFeedbackReport: () => ipcRenderer.invoke('settings:submit-feedback-report'),
  openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),
  writeRuntimeLog: (level, event, fields) => ipcRenderer.invoke('app:runtime-log', level, event, fields),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  newWindow: () => ipcRenderer.invoke('window:new'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  setBadgeCount: (count: number) => ipcRenderer.invoke('window:set-badge-count', count) as Promise<boolean>,
  setBadgeState: (input) => ipcRenderer.invoke('window:set-badge-state', input) as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximized: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on('window:maximized', wrapped)
    return () => ipcRenderer.off('window:maximized', wrapped)
  },
  onUnmaximized: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on('window:unmaximized', wrapped)
    return () => ipcRenderer.off('window:unmaximized', wrapped)
  },
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<UserConfig>,
  saveConfig: (patch: Partial<UserConfig>) => ipcRenderer.invoke('config:save', patch) as Promise<UserConfig>,
  applyPrivacyRuntimeSettings: (input) => ipcRenderer.invoke('privacy:runtime:apply', input),
  applyKnowledgeSearchRuntimeSetting: (input) => ipcRenderer.invoke('knowledge-search:runtime:apply', input),
  getSettingsPreferences: () => ipcRenderer.invoke('settings-preferences:get'),
  saveSettingsRule: (input) => ipcRenderer.invoke('settings-preferences:save-rule', input),
  deleteSettingsRule: (id: string) => ipcRenderer.invoke('settings-preferences:delete-rule', id),
  saveSettingsShortcut: (input) => ipcRenderer.invoke('settings-preferences:save-shortcut', input),
  resetSettingsShortcuts: () => ipcRenderer.invoke('settings-preferences:reset-shortcuts'),
  getSecurityConfigPath: () => ipcRenderer.invoke('security-config:path') as Promise<string>,
  readSecurityConfig: () => ipcRenderer.invoke('security-config:read') as Promise<string>,
  writeSecurityConfig: (content: string) => ipcRenderer.invoke('security-config:write', content) as Promise<SecurityConfigWriteResult>,
  onSecurityConfigFileChanged: (listener: (content: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, content: string) => listener(content)
    ipcRenderer.on('security-config:changed', wrapped)
    return () => ipcRenderer.off('security-config:changed', wrapped)
  },
  getKeywordHighlightConfigPath: () => ipcRenderer.invoke('keyword-highlight-config:path') as Promise<string>,
  readKeywordHighlightConfig: () => ipcRenderer.invoke('keyword-highlight-config:read') as Promise<string>,
  writeKeywordHighlightConfig: (content: string) => ipcRenderer.invoke('keyword-highlight-config:write', content) as Promise<KeywordHighlightConfigWriteResult>,
  onKeywordHighlightConfigFileChanged: (listener: (content: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, content: string) => listener(content)
    ipcRenderer.on('keyword-highlight-config:changed', wrapped)
    return () => ipcRenderer.off('keyword-highlight-config:changed', wrapped)
  },
  getMcpConfigPath: () => ipcRenderer.invoke('mcp-config:path') as Promise<string>,
  getMcpServers: () => ipcRenderer.invoke('mcp:get-servers'),
  readMcpConfig: () => ipcRenderer.invoke('mcp-config:read') as Promise<string>,
  writeMcpConfig: (content: string) => ipcRenderer.invoke('mcp-config:write', content) as Promise<McpConfigWriteResult>,
  toggleMcpServer: (serverName: string, disabled: boolean) =>
    ipcRenderer.invoke('mcp-config:toggle-server', serverName, disabled) as Promise<McpConfigWriteResult>,
  deleteMcpServer: (serverName: string) => ipcRenderer.invoke('mcp-config:delete-server', serverName) as Promise<McpConfigWriteResult>,
  setMcpToolState: (serverName: string, toolName: string, enabled: boolean) =>
    ipcRenderer.invoke('mcp:set-tool-state', serverName, toolName, enabled) as Promise<McpConfigWriteResult>,
  setMcpToolAutoApprove: (serverName: string, toolName: string, autoApprove: boolean) =>
    ipcRenderer.invoke('mcp:set-tool-auto-approve', serverName, toolName, autoApprove) as Promise<McpConfigWriteResult>,
  callMcpTool: (serverName: string, toolName: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:tool-call', { serverName, toolName, arguments: args }),
  readMcpResource: (serverName: string, uri: string) => ipcRenderer.invoke('mcp:resource-read', { serverName, uri }),
  onMcpConfigFileChanged: (listener: (content: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, content: string) => listener(content)
    ipcRenderer.on('mcp-config:changed', wrapped)
    return () => ipcRenderer.off('mcp-config:changed', wrapped)
  },
  getSkills: () => ipcRenderer.invoke('skills:get-all'),
  getEnabledSkills: () => ipcRenderer.invoke('skills:get-enabled'),
  setSkillEnabled: (skillName: string, enabled: boolean) => ipcRenderer.invoke('skills:set-enabled', skillName, enabled),
  getSkillsUserPath: () => ipcRenderer.invoke('skills:get-user-path'),
  reloadSkills: () => ipcRenderer.invoke('skills:reload'),
  createSkill: (metadata, content) => ipcRenderer.invoke('skills:create', metadata, content),
  deleteSkill: (skillName: string) => ipcRenderer.invoke('skills:delete', skillName),
  openSkillsFolder: () => ipcRenderer.invoke('skills:open-folder'),
  importSkillZip: (zipPath: string, overwrite?: boolean) => ipcRenderer.invoke('skills:import-zip', zipPath, overwrite),
  readSkillContent: (skillName: string) => ipcRenderer.invoke('skills:read-content', skillName),
  updateSkill: (skillName: string, metadata, content: string) => ipcRenderer.invoke('skills:update', skillName, metadata, content),
  exportSkillZip: (skillName: string) => ipcRenderer.invoke('skills:export-zip', skillName),
  onSkillsUpdate: (listener: (skills: SkillUserConfig[]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, skills: SkillUserConfig[]) => listener(skills)
    ipcRenderer.on('skills:update', wrapped)
    return () => ipcRenderer.off('skills:update', wrapped)
  },
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:open-file', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save-file', options),
  saveCustomBackground: (srcAbsPath: string) => ipcRenderer.invoke('settings:save-custom-background', srcAbsPath),
  saveCustomNotificationSound: (srcAbsPath: string) => ipcRenderer.invoke('settings:save-custom-notification-sound', srcAbsPath),
  readLocalFile: (filePath: string) => ipcRenderer.invoke('files:read-local', filePath),
  writeLocalFile: (filePath: string, content: string) => ipcRenderer.invoke('files:write-local', filePath, content),
  ensureLocalDirectory: (input) => ipcRenderer.invoke('files:ensure-directory', input),
  readLocalEditorFile: (filePath: string) => ipcRenderer.invoke('local-editor-files:read', filePath),
  writeLocalEditorFile: (input) => ipcRenderer.invoke('local-editor-files:write', input),
  startLocalEditorFileWatch: (input) => ipcRenderer.invoke('local-editor-files:watch:start', input),
  stopLocalEditorFileWatch: (watchId: string) => ipcRenderer.invoke('local-editor-files:watch:stop', watchId),
  onLocalEditorFileWatchEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('local-editor-files:watch-event', wrapped)
    return () => ipcRenderer.off('local-editor-files:watch-event', wrapped)
  },
  stageChatAttachment: (payload) => ipcRenderer.invoke('chat:stage-attachment', payload),
  validateChatImageAttachment: (input) => ipcRenderer.invoke('chat:validate-image-attachment', input),
  prepareChatImageAttachment: (input) => ipcRenderer.invoke('chat:prepare-image-attachment', input),
  prepareChatImageAttachmentFromFile: (input) => ipcRenderer.invoke('chat:prepare-image-attachment-from-file', input),
  prepareChatImageAttachmentFromClipboard: (input) => ipcRenderer.invoke('chat:prepare-image-attachment-from-clipboard', input),
  kbCheckPath: (absPath: string) => ipcRenderer.invoke('kb:check-path', { absPath }),
  kbEnsureRoot: () => ipcRenderer.invoke('kb:ensure-root'),
  kbGetRoot: () => ipcRenderer.invoke('kb:get-root'),
  kbListDir: (relDir: string) => ipcRenderer.invoke('kb:list-dir', { relDir }),
  kbReadFile: (relPath: string, encoding?: 'utf-8' | 'base64') => ipcRenderer.invoke('kb:read-file', { relPath, encoding }),
  kbWriteFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64') => ipcRenderer.invoke('kb:write-file', { relPath, content, encoding }),
  kbPasteImageFromClipboard: (relDir?: string, name?: string) => ipcRenderer.invoke('kb:paste-image-from-clipboard', { relDir, name }),
  kbMkdir: (relDir: string, name: string) => ipcRenderer.invoke('kb:mkdir', { relDir, name }),
  kbCreateFile: (relDir: string, name: string, content?: string) => ipcRenderer.invoke('kb:create-file', { relDir, name, content }),
  kbRename: (relPath: string, newName: string) => ipcRenderer.invoke('kb:rename', { relPath, newName }),
  kbDelete: (relPath: string, recursive?: boolean) => ipcRenderer.invoke('kb:delete', { relPath, recursive }),
  kbMove: (srcRelPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:move', { srcRelPath, dstRelDir }),
  kbCopy: (srcRelPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:copy', { srcRelPath, dstRelDir }),
  kbImportFile: (srcAbsPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:import-file', { srcAbsPath, dstRelDir }),
  kbImportFolder: (srcAbsPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:import-folder', { srcAbsPath, dstRelDir }),
  kbSearch: (query: string, options?: { maxResults?: number; minScore?: number }) =>
    ipcRenderer.invoke('kb:search', query, options) as Promise<KnowledgeBaseSearchResult[]>,
  kbSearchStatus: () => ipcRenderer.invoke('kb:search-status') as Promise<KnowledgeBaseSearchStatus>,
  kbReindex: () => ipcRenderer.invoke('kb:reindex') as Promise<{ files: number; chunks: number }>,
  onKbTransferProgress: (listener: (event: KnowledgeBaseTransferProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: KnowledgeBaseTransferProgress) => listener(payload)
    ipcRenderer.on('kb:transfer-progress', wrapped)
    return () => ipcRenderer.off('kb:transfer-progress', wrapped)
  },
  listAssets: () => ipcRenderer.invoke('assets:list'),
  listAssetGroups: (input) => ipcRenderer.invoke('assets:groups:list', input),
  renameAssetGroup: (input) => ipcRenderer.invoke('assets:groups:rename', input),
  deleteAssetGroup: (input) => ipcRenderer.invoke('assets:groups:delete', input),
  saveAsset: (asset) => ipcRenderer.invoke('assets:save', asset),
  getAssetEditableSecret: (id: string) => ipcRenderer.invoke('assets:editable-secret:get', id),
  testAssetConnection: (input) => ipcRenderer.invoke('assets:test-connection', input),
  deleteAsset: (id: string) => ipcRenderer.invoke('assets:delete', id),
  refreshOrganizationAssets: (input) => ipcRenderer.invoke('assets:organization:refresh', input),
  previewAssetImport: (input) => ipcRenderer.invoke('assets:import:preview', input),
  confirmAssetImport: (input) => ipcRenderer.invoke('assets:import:confirm', input),
  exportAssets: (input) => ipcRenderer.invoke('assets:export', input),
  startSshTunnel: (input) => ipcRenderer.invoke('ssh:tunnel:start', input),
  stopSshTunnel: (input) => ipcRenderer.invoke('ssh:tunnel:stop', input),
  saveAssetFolder: (folder) => ipcRenderer.invoke('assets:folder:save', folder),
  deleteAssetFolder: (uuid: string) => ipcRenderer.invoke('assets:folder:delete', uuid),
  listKeychains: () => ipcRenderer.invoke('assets:keychains:list'),
  listSshAgentKeychainOptions: () => ipcRenderer.invoke('assets:keychains:ssh-agent-options'),
  getKeychain: (id: string) => ipcRenderer.invoke('assets:keychains:get', id),
  saveKeychain: (keychain) => ipcRenderer.invoke('assets:keychains:save', keychain),
  deleteKeychain: (id: string) => ipcRenderer.invoke('assets:keychains:delete', id),
  getQuickCommands: () => ipcRenderer.invoke('quick-commands:get'),
  saveQuickCommandGroup: (input) => ipcRenderer.invoke('quick-commands:group:save', input),
  deleteQuickCommandGroup: (uuid: string) => ipcRenderer.invoke('quick-commands:group:delete', uuid),
  saveQuickCommandSnippet: (input) => ipcRenderer.invoke('quick-commands:snippet:save', input),
  saveQuickCommandMacro: (input) => ipcRenderer.invoke('quick-commands:macro:save', input),
  deleteQuickCommandSnippet: (id: number) => ipcRenderer.invoke('quick-commands:snippet:delete', id),
  reorderQuickCommands: (input) => ipcRenderer.invoke('quick-commands:reorder', input),
  planQuickCommandScript: (input) => ipcRenderer.invoke('quick-commands:script:plan', input),
  createTerminal: (options?: TerminalCreateOptions) => ipcRenderer.invoke('terminal:create', options) as Promise<TerminalSessionInfo>,
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  ackTerminalData: (id: string, bytes: number) => {
    ipcRenderer.send('terminal:ack-data', id, bytes)
  },
  writeTerminalBinary: (id: string, data) => ipcRenderer.invoke('terminal:write-binary', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  killTerminal: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  createCodexSession: (options) => ipcRenderer.invoke('codex:create', options),
  setCodexSessionTarget: (id: string, target) => ipcRenderer.invoke('codex:set-target', id, target),
  setCodexSessionPendingContext: (id: string, text?: string) => ipcRenderer.invoke('codex:set-pending-context', id, text),
  writeCodexSession: (id: string, data: string) => ipcRenderer.invoke('codex:write', id, data),
  resizeCodexSession: (id: string, cols: number, rows: number) => ipcRenderer.invoke('codex:resize', id, cols, rows),
  killCodexSession: (id: string) => ipcRenderer.invoke('codex:kill', id),
  listProductSessions: (input) => ipcRenderer.invoke('product-session:list', input),
  getProductSession: (id: string) => ipcRenderer.invoke('product-session:get', id),
  createProductSession: (input) => ipcRenderer.invoke('product-session:create', input),
  updateProductSession: (input) => ipcRenderer.invoke('product-session:update', input),
  deleteProductSession: (id: string) => ipcRenderer.invoke('product-session:delete', id),
  closeProductSession: (id: string) => ipcRenderer.invoke('product-session:close', id),
  listProductSessionProjectionMessages: (id, input) => ipcRenderer.invoke('product-session:projection:list', id, input),
  replaceProductSessionProjectionMessages: (id, messages) => ipcRenderer.invoke('product-session:projection:replace', id, messages),
  upsertProductSessionProjectionMessages: (id, messages) => ipcRenderer.invoke('product-session:projection:upsert', id, messages),
  reviseProductSessionProjectionMessages: (id, input) => ipcRenderer.invoke('product-session:projection:revise', id, input),
  onProductSessionChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, changed: Parameters<typeof listener>[0]) => listener(changed)
    ipcRenderer.on('product-session:changed', wrapped)
    return () => ipcRenderer.off('product-session:changed', wrapped)
  },
  listAgentHookInstallers: () => ipcRenderer.invoke('agent-hooks:list'),
  installAgentHook: (input) => ipcRenderer.invoke('agent-hooks:install', input),
  uninstallAgentHook: (input) => ipcRenderer.invoke('agent-hooks:uninstall', input),
  listAgentSessionParsers: () => ipcRenderer.invoke('ai-agent:session-parsers:list'),
  importAgentSessionParser: (input) => ipcRenderer.invoke('ai-agent:session-parsers:import', input),
  removeAgentSessionParser: (input) => ipcRenderer.invoke('ai-agent:session-parsers:remove', input),
  listExportMcpInstallers: () => ipcRenderer.invoke('export-mcp:list'),
  installExportMcp: (input) => ipcRenderer.invoke('export-mcp:install', input),
  uninstallExportMcp: (input) => ipcRenderer.invoke('export-mcp:uninstall', input),
  copyExportMcpConfig: (input) => ipcRenderer.invoke('export-mcp:copy-config', input),
  resetExportMcpToken: () => ipcRenderer.invoke('export-mcp:reset-token'),
  listManagedAiSessions: () => ipcRenderer.invoke('ai-agent:sessions:list'),
  getAgentHibernationConfig: () => ipcRenderer.invoke('ai-agent:hibernation:config:get'),
  setAgentHibernationConfig: (input) => ipcRenderer.invoke('ai-agent:hibernation:config:set', input),
  hibernateManagedAiSession: (input) => ipcRenderer.invoke('ai-agent:sessions:hibernate', input),
  wakeManagedAiSession: (input) => ipcRenderer.invoke('ai-agent:sessions:wake', input),
  bindManagedAiSessionTerminal: (input) => ipcRenderer.invoke('ai-agent:sessions:bind-terminal', input),
  replyManagedAiSession: (input) => ipcRenderer.invoke('ai-agent:sessions:reply', input),
  renameManagedAiSession: (input) => ipcRenderer.invoke('ai-agent:sessions:rename', input),
  clearManagedAiSession: (input) => ipcRenderer.invoke('ai-agent:sessions:clear', input),
  bulkManagedAiSessions: (input) => ipcRenderer.invoke('ai-agent:sessions:bulk', input),
  listManagedAiSessionContent: (input) => ipcRenderer.invoke('ai-agent:sessions:content:list', input),
  getManagedAiSessionContentRecord: (input) => ipcRenderer.invoke('ai-agent:sessions:content:get-record', input),
  updateManagedAiSessionContentRecord: (input) => ipcRenderer.invoke('ai-agent:sessions:content:update-record', input),
  deleteManagedAiSessionContentRecord: (input) => ipcRenderer.invoke('ai-agent:sessions:content:delete-record', input),
  listManagedAiNotifications: (input) => ipcRenderer.invoke('ai-agent:notifications:list', input),
  markManagedAiNotificationRead: (input) => ipcRenderer.invoke('ai-agent:notifications:mark-read', input),
  dismissManagedAiNotification: (input) => ipcRenderer.invoke('ai-agent:notifications:dismiss', input),
  clearManagedAiNotifications: () => ipcRenderer.invoke('ai-agent:notifications:clear'),
  openManagedAiNotification: (input) => ipcRenderer.invoke('ai-agent:notifications:open', input),
  jumpToUnreadManagedAiNotification: () => ipcRenderer.invoke('ai-agent:notifications:jump-unread'),
  invokeControlRequest: (method, params) => ipcRenderer.invoke('control:invoke', method, params),
  respondControlRequest: (id, response) => ipcRenderer.invoke('control:response', id, response),
  onControlRequest: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      void Promise.resolve(listener(payload))
        .then((response) => ipcRenderer.invoke('control:response', payload.id, response))
        .catch((error) =>
          ipcRenderer.invoke('control:response', payload.id, {
            ok: false,
            errorCode: 'CONTROL_RENDERER_HANDLER_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error)
          })
        )
    }
    ipcRenderer.on('control:request', wrapped)
    return () => ipcRenderer.off('control:request', wrapped)
  },
  respondTerminalKeyboardInteractive: (id: string, response) => ipcRenderer.send(`terminal:keyboard-interactive:response:${id}`, response),
  cancelTerminalKeyboardInteractive: (id: string) => ipcRenderer.send(`terminal:keyboard-interactive:cancel:${id}`),
  pickZmodemUploadFiles: () => ipcRenderer.invoke('zmodem:pick-upload-files'),
  pickZmodemSavePath: (name: string) => ipcRenderer.invoke('zmodem:pick-save-path', name),
  openZmodemStream: (savePath: string) => ipcRenderer.invoke('zmodem:open-stream', savePath),
  writeZmodemChunk: (streamId: string, chunk) => ipcRenderer.invoke('zmodem:write-chunk', streamId, chunk),
  closeZmodemStream: (streamId: string) => ipcRenderer.invoke('zmodem:close-stream', streamId),
  getTerminalCommandSuggestions: (query: string, context) => ipcRenderer.invoke('terminal:suggestions', query, context),
  generateTerminalCommand: (input) => ipcRenderer.invoke('terminal:command:generate', input),
  listAiModels: (input) => ipcRenderer.invoke('models:list', input),
  checkModelProvider: (input) => ipcRenderer.invoke('models:check-provider', input),
  listExtensionPlugins: () => ipcRenderer.invoke('extensions:list'),
  syncExtensionAssetProvider: (input) => ipcRenderer.invoke('extensions:provider:sync-assets', input),
  cancelExtensionAssetProvider: (input) => ipcRenderer.invoke('extensions:provider:cancel', input),
  installExtensionPlugin: (input) => ipcRenderer.invoke('extensions:install-plugin', input),
  updateExtensionPlugin: (input) => ipcRenderer.invoke('extensions:update-plugin', input),
  installExtensionPackage: (input) => ipcRenderer.invoke('extensions:install-package', input),
  downloadExtensionPackage: (input) => ipcRenderer.invoke('extensions:download-package', input),
  installExtensionPluginFromUrl: (input) => ipcRenderer.invoke('extensions:install-plugin-from-url', input),
  uninstallExtensionPlugin: (input) => ipcRenderer.invoke('extensions:uninstall-plugin', input),
  openExtensionSubscription: (input) => ipcRenderer.invoke('extensions:open-subscription', input),
  cancelExtensionInstall: (pluginId: string) => ipcRenderer.invoke('extensions:cancel-install', pluginId),
  runExtensionRuntimeAction: (input) => ipcRenderer.invoke('extensions:runtime-action', input),
  executeExtensionCommand: (input) => ipcRenderer.invoke('extensions:execute-command', input),
  listExtensionTreeChildren: (input) => ipcRenderer.invoke('extensions:tree-children', input),
  listExtensionContexts: () => ipcRenderer.invoke('extensions:contexts'),
  getExtensionConfiguration: (pluginId: string) => ipcRenderer.invoke('extensions:configuration:get', pluginId),
  saveExtensionConfiguration: (input) => ipcRenderer.invoke('extensions:configuration:save', input),
  listExtensionVersions: () => ipcRenderer.invoke('extensions:versions'),
  listExtensionBastions: () => ipcRenderer.invoke('extensions:bastions'),
  invokeExtensionBastion: (type: string, method: string, input) => ipcRenderer.invoke('extensions:bastion:invoke', type, method, input),
  onExtensionRuntimeEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('extensions:runtime-event', wrapped)
    return () => ipcRenderer.off('extensions:runtime-event', wrapped)
  },
  onExtensionInstallProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('extensions:install-progress', wrapped)
    return () => ipcRenderer.off('extensions:install-progress', wrapped)
  },
  createAiChatExchangeRequest: (input) => ipcRenderer.invoke('ai:chat-exchange-request', input),
  generateAiChatResponse: (input) => ipcRenderer.invoke('ai:chat-response', input),
  cancelAiChatResponse: (input) => ipcRenderer.invoke('ai:chat-response:cancel', input),
  respondClineAgentApproval: (input) => ipcRenderer.invoke('cline-agent:approval:respond', input),
  abortClineAgentTask: (input) => ipcRenderer.invoke('cline-agent:task:abort', input),
  onClineAgentTaskEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('cline-agent:task-event', wrapped)
    return () => ipcRenderer.off('cline-agent:task-event', wrapped)
  },
  transcribeVoiceInput: (input) => ipcRenderer.invoke('voice:transcribe', input),
  listDatabaseCatalog: () => ipcRenderer.invoke('database:catalog'),
  testDatabaseConnection: (input) => ipcRenderer.invoke('database:test-connection', input),
  saveDatabaseConnection: (input) => ipcRenderer.invoke('database:save-connection', input),
  createDatabaseGroup: (input) => ipcRenderer.invoke('database:group:create', input),
  renameDatabaseGroup: (input) => ipcRenderer.invoke('database:group:rename', input),
  moveDatabaseGroup: (input) => ipcRenderer.invoke('database:group:move', input),
  deleteDatabaseGroup: (id: string) => ipcRenderer.invoke('database:group:delete', id),
  moveDatabaseConnection: (input) => ipcRenderer.invoke('database:connection:move', input),
  removeDatabaseConnection: (connectionId: string) => ipcRenderer.invoke('database:connection:remove', connectionId),
  connectDatabaseConnection: (connectionId: string) => ipcRenderer.invoke('database:connection:connect', connectionId),
  disconnectDatabaseConnection: (connectionId: string) => ipcRenderer.invoke('database:connection:disconnect', connectionId),
  refreshDatabaseConnection: (connectionId: string) => ipcRenderer.invoke('database:connection:refresh', connectionId),
  createDatabaseCatalog: (input) => ipcRenderer.invoke('database:create-database', input),
  executeDatabaseSql: (input) => ipcRenderer.invoke('database:execute-sql', input),
  getDatabaseTableDdl: (input) => ipcRenderer.invoke('database:table-ddl', input),
  queryDatabaseTable: (input) => ipcRenderer.invoke('database:query-table', input),
  planDatabaseTableMutation: (input) => ipcRenderer.invoke('database:mutation-plan', input),
  mutateDatabaseTable: (input) => ipcRenderer.invoke('database:mutate-table', input),
  exportDatabaseRows: (input) => ipcRenderer.invoke('database:export-rows', input),
  getDatabasePageComment: (input) => ipcRenderer.invoke('database:comment:get', input),
  saveDatabasePageComment: (input) => ipcRenderer.invoke('database:comment:save', input),
  getDatabaseAiPaneState: () => ipcRenderer.invoke('database:ai-pane-state:get'),
  saveDatabaseAiPaneState: (input) => ipcRenderer.invoke('database:ai-pane-state:save', input),
  createDatabaseAiPaneRequest: (input) => ipcRenderer.invoke('database:ai-pane-request', input),
  startDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-start', input),
  cancelDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-cancel', input),
  generateDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-response', input),
  createDatabaseAiDrawerRequest: (input) => ipcRenderer.invoke('database:ai-drawer-request', input),
  startDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-start', input),
  cancelDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-cancel', input),
  generateDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-response', input),
  diagnoseDatabaseSqlError: (input) => ipcRenderer.invoke('database:ai-diagnose-sql-error', input),
  listKubernetesCatalog: () => ipcRenderer.invoke('kubernetes:catalog'),
  switchKubernetesContext: (contextName: string) => ipcRenderer.invoke('kubernetes:context:switch', contextName),
  addKubernetesCluster: (input) => ipcRenderer.invoke('kubernetes:cluster:add', input),
  updateKubernetesCluster: (id: string, input) => ipcRenderer.invoke('kubernetes:cluster:update', id, input),
  testKubernetesClusterConnection: (input) => ipcRenderer.invoke('kubernetes:cluster:test', input),
  importKubernetesKubeconfig: (input) => ipcRenderer.invoke('kubernetes:kubeconfig:import', input),
  deleteKubernetesCluster: (id: string) => ipcRenderer.invoke('kubernetes:cluster:delete', id),
  connectKubernetesCluster: (id: string) => ipcRenderer.invoke('kubernetes:cluster:connect', id),
  disconnectKubernetesCluster: (id: string) => ipcRenderer.invoke('kubernetes:cluster:disconnect', id),
  syncKubernetesBastion: (bastionUuid: string) => ipcRenderer.invoke('kubernetes:bastion:sync', bastionUuid),
  createKubernetesTerminal: (input) => ipcRenderer.invoke('kubernetes:terminal:create', input),
  writeKubernetesTerminal: (id: string, data: string) => ipcRenderer.invoke('kubernetes:terminal:write', id, data),
  resizeKubernetesTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('kubernetes:terminal:resize', id, cols, rows),
  closeKubernetesTerminal: (id: string, exitCode?: number) => ipcRenderer.invoke('kubernetes:terminal:close', id, exitCode),
  executeKubernetesCommand: (input) => ipcRenderer.invoke('kubernetes:execute-command', input),
  planKubernetesResourceAction: (input) => ipcRenderer.invoke('kubernetes:resource-action:plan', input),
  executeKubernetesResourceAction: (input) => ipcRenderer.invoke('kubernetes:resource-action:execute', input),
  refreshKubernetesResources: (input) => ipcRenderer.invoke('kubernetes:resources:refresh', input),
  getKubernetesAgentProxyConfig: () => ipcRenderer.invoke('kubernetes:agent:proxy:get'),
  saveKubernetesAgentProxyConfig: (input) => ipcRenderer.invoke('kubernetes:agent:proxy:save', input),
  cleanupKubernetesAgent: () => ipcRenderer.invoke('kubernetes:agent:cleanup'),
  listFileSessionCatalog: () => ipcRenderer.invoke('files:sessions:catalog'),
  saveFileSession: (session) => ipcRenderer.invoke('files:sessions:save', session),
  saveFileSessionFromSftpPayload: (payload) => ipcRenderer.invoke('files:sessions:save-from-sftp-payload', payload),
  saveFileSessionFromTerminalContext: (context) => ipcRenderer.invoke('files:sessions:save-from-terminal-context', context),
  updateFileSession: (id: string, patch) => ipcRenderer.invoke('files:sessions:update', id, patch),
  deleteFileSession: (id: string) => ipcRenderer.invoke('files:sessions:delete', id),
  saveFileSessionFolder: (folder) => ipcRenderer.invoke('files:sessions:folder:save', folder),
  deleteFileSessionFolder: (uuid: string) => ipcRenderer.invoke('files:sessions:folder:delete', uuid),
  listFiles: (directory: string, options) => ipcRenderer.invoke('files:list', directory, options) as Promise<FileListEntry[]>,
  readFileContent: (filePath: string, options) => ipcRenderer.invoke('files:read-content', filePath, options),
  writeFileContent: (filePath: string, content: string, options) => ipcRenderer.invoke('files:write-content', filePath, content, options),
  mutateFileEntry: (mutation, options) => ipcRenderer.invoke('files:mutate-entry', mutation, options),
  transferFileEntry: (operation, options) => ipcRenderer.invoke('files:transfer-entry', operation, options),
  cancelFileTransferTask: (input) => ipcRenderer.invoke('files:transfer-task:cancel', input),
  listFileTransferTasks: () => ipcRenderer.invoke('files:list-transfer-tasks'),
  onFileTransferTaskEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('files:transfer-task-event', wrapped)
    return () => ipcRenderer.off('files:transfer-task-event', wrapped)
  },
  getProjectFileContext: (input) => ipcRenderer.invoke('project-files:context', input),
  listProjectDirectory: (input) => ipcRenderer.invoke('project-files:list', input),
  mutateProjectEntry: (input) => ipcRenderer.invoke('project-files:mutate', input),
  readProjectFile: (input) => ipcRenderer.invoke('project-files:read', input),
  writeProjectFile: (input) => ipcRenderer.invoke('project-files:write', input),
  startProjectFileWatch: (input) => ipcRenderer.invoke('project-files:watch:start', input),
  stopProjectFileWatch: (watchId: string) => ipcRenderer.invoke('project-files:watch:stop', watchId),
  onProjectFileWatchEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('project-files:watch-event', wrapped)
    return () => ipcRenderer.off('project-files:watch-event', wrapped)
  },
  onProjectFilesChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('project-files:changed', wrapped)
    return () => ipcRenderer.off('project-files:changed', wrapped)
  },
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => listener(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.off('terminal:data', wrapped)
  },
  onTerminalLifecycle: (listener: (event: TerminalLifecycleEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalLifecycleEvent) => listener(payload)
    ipcRenderer.on('terminal:lifecycle', wrapped)
    return () => ipcRenderer.off('terminal:lifecycle', wrapped)
  },
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => listener(payload)
    ipcRenderer.on('terminal:exit', wrapped)
    return () => ipcRenderer.off('terminal:exit', wrapped)
  },
  publishAiAgentSessionEvent: (input) => ipcRenderer.invoke('ai-agent:session-event', input),
  onAiAgentSessionEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('ai-agent:session-event', wrapped)
    return () => ipcRenderer.off('ai-agent:session-event', wrapped)
  },
  onManagedAiSessionEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('ai-agent:managed-session-event', wrapped)
    return () => ipcRenderer.off('ai-agent:managed-session-event', wrapped)
  },
  onManagedAiSessionFocusRequest: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('ai-agent:session-focus', wrapped)
    return () => ipcRenderer.off('ai-agent:session-focus', wrapped)
  },
  onCodexSessionData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('codex:data', wrapped)
    return () => ipcRenderer.off('codex:data', wrapped)
  },
  onCodexSessionLifecycle: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('codex:lifecycle', wrapped)
    return () => ipcRenderer.off('codex:lifecycle', wrapped)
  },
  onCodexSessionExit: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('codex:exit', wrapped)
    return () => ipcRenderer.off('codex:exit', wrapped)
  },
  onCodexSessionThread: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('codex:thread', wrapped)
    return () => ipcRenderer.off('codex:thread', wrapped)
  },
  onTerminalKeyboardInteractiveRequest: (listener: (event: TerminalKeyboardInteractiveRequest) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalKeyboardInteractiveRequest) => listener(payload)
    ipcRenderer.on('terminal:keyboard-interactive:request', wrapped)
    return () => ipcRenderer.off('terminal:keyboard-interactive:request', wrapped)
  },
  onTerminalKeyboardInteractiveResult: (listener: (event: TerminalKeyboardInteractiveResult) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalKeyboardInteractiveResult) => listener(payload)
    ipcRenderer.on('terminal:keyboard-interactive:result', wrapped)
    return () => ipcRenderer.off('terminal:keyboard-interactive:result', wrapped)
  },
  onKubernetesTerminalData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('kubernetes:terminal:data', wrapped)
    return () => ipcRenderer.off('kubernetes:terminal:data', wrapped)
  },
  onKubernetesTerminalExit: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('kubernetes:terminal:exit', wrapped)
    return () => ipcRenderer.off('kubernetes:terminal:exit', wrapped)
  }
}

contextBridge.exposeInMainWorld('aiops', api)
