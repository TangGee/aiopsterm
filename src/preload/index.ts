import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiopsPreloadApi,
  FileListEntry,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  UserConfig,
  SkillUserConfig
} from '@shared/preload'

const api: AiopsPreloadApi = {
  platform: () => ipcRenderer.invoke('app:platform'),
  shell: () => ipcRenderer.invoke('app:shell'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  downloadAppUpdate: (version: string) => ipcRenderer.invoke('app:download-update', version),
  installAppUpdate: (version?: string) => ipcRenderer.invoke('app:install-update', version),
  onAppUpdateProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('app:update-progress', wrapped)
    return () => ipcRenderer.off('app:update-progress', wrapped)
  },
  listChatConversations: () => ipcRenderer.invoke('chat-history:list'),
  createChatConversation: () => ipcRenderer.invoke('chat-history:create'),
  updateChatConversation: (input) => ipcRenderer.invoke('chat-history:update', input),
  deleteChatConversation: (id: string) => ipcRenderer.invoke('chat-history:delete', id),
  restoreChatConversation: (id: string) => ipcRenderer.invoke('chat-history:restore', id),
  saveChatMessageMetadata: (input) => ipcRenderer.invoke('chat-history:message-metadata', input),
  listAiTodoSnapshot: () => ipcRenderer.invoke('ai:todo-snapshot'),
  listAiContextCatalog: () => ipcRenderer.invoke('ai:context-catalog'),
  getUserAccount: () => ipcRenderer.invoke('user:get-account'),
  openUserLogin: () => ipcRenderer.invoke('user:open-login'),
  loginUserAccount: (input) => ipcRenderer.invoke('user:login', input),
  logoutUserAccount: () => ipcRenderer.invoke('user:logout'),
  skipUserLogin: () => ipcRenderer.invoke('user:skip-login'),
  sendUserLoginCode: (input) => ipcRenderer.invoke('user:send-login-code', input),
  prepareUserAvatarImage: (input) => ipcRenderer.invoke('user:avatar:prepare', input),
  updateUserProfile: (input) => ipcRenderer.invoke('user:update-profile', input),
  resetUserPassword: (input) => ipcRenderer.invoke('user:reset-password', input),
  sendUserContactCode: (input) => ipcRenderer.invoke('user:send-contact-code', input),
  bindUserContact: (input) => ipcRenderer.invoke('user:bind-contact', input),
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
  openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
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
  getSettingsPreferences: (seed) => ipcRenderer.invoke('settings-preferences:get', seed),
  saveSettingsRule: (input) => ipcRenderer.invoke('settings-preferences:save-rule', input),
  deleteSettingsRule: (id: string) => ipcRenderer.invoke('settings-preferences:delete-rule', id),
  saveSettingsShortcut: (input) => ipcRenderer.invoke('settings-preferences:save-shortcut', input),
  resetSettingsShortcuts: () => ipcRenderer.invoke('settings-preferences:reset-shortcuts'),
  getSecurityConfigPath: () => ipcRenderer.invoke('security-config:path') as Promise<string>,
  readSecurityConfig: () => ipcRenderer.invoke('security-config:read') as Promise<string>,
  writeSecurityConfig: (content: string) => ipcRenderer.invoke('security-config:write', content) as Promise<void>,
  onSecurityConfigFileChanged: (listener: (content: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, content: string) => listener(content)
    ipcRenderer.on('security-config:changed', wrapped)
    return () => ipcRenderer.off('security-config:changed', wrapped)
  },
  getKeywordHighlightConfigPath: () => ipcRenderer.invoke('keyword-highlight-config:path') as Promise<string>,
  readKeywordHighlightConfig: () => ipcRenderer.invoke('keyword-highlight-config:read') as Promise<string>,
  writeKeywordHighlightConfig: (content: string) => ipcRenderer.invoke('keyword-highlight-config:write', content) as Promise<void>,
  onKeywordHighlightConfigFileChanged: (listener: (content: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, content: string) => listener(content)
    ipcRenderer.on('keyword-highlight-config:changed', wrapped)
    return () => ipcRenderer.off('keyword-highlight-config:changed', wrapped)
  },
  getMcpConfigPath: () => ipcRenderer.invoke('mcp-config:path') as Promise<string>,
  getMcpServers: () => ipcRenderer.invoke('mcp:get-servers'),
  readMcpConfig: () => ipcRenderer.invoke('mcp-config:read') as Promise<string>,
  writeMcpConfig: (content: string) => ipcRenderer.invoke('mcp-config:write', content) as Promise<void>,
  toggleMcpServer: (serverName: string, disabled: boolean) => ipcRenderer.invoke('mcp-config:toggle-server', serverName, disabled),
  deleteMcpServer: (serverName: string) => ipcRenderer.invoke('mcp-config:delete-server', serverName),
  setMcpToolState: (serverName: string, toolName: string, enabled: boolean) => ipcRenderer.invoke('mcp:set-tool-state', serverName, toolName, enabled),
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
  readLocalFile: (filePath: string) => ipcRenderer.invoke('files:read-local', filePath),
  writeLocalFile: (filePath: string, content: string) => ipcRenderer.invoke('files:write-local', filePath, content),
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
  deleteAsset: (id: string) => ipcRenderer.invoke('assets:delete', id),
  refreshOrganizationAssets: (input) => ipcRenderer.invoke('assets:organization:refresh', input),
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
  saveQuickCommands: (config) => ipcRenderer.invoke('quick-commands:save', config),
  saveQuickCommandGroup: (input) => ipcRenderer.invoke('quick-commands:group:save', input),
  deleteQuickCommandGroup: (uuid: string) => ipcRenderer.invoke('quick-commands:group:delete', uuid),
  saveQuickCommandSnippet: (input) => ipcRenderer.invoke('quick-commands:snippet:save', input),
  deleteQuickCommandSnippet: (id: number) => ipcRenderer.invoke('quick-commands:snippet:delete', id),
  reorderQuickCommands: (input) => ipcRenderer.invoke('quick-commands:reorder', input),
  listAliasCommands: (query?: string) => ipcRenderer.invoke('aliases:list', query),
  saveAliasCommand: (input) => ipcRenderer.invoke('aliases:save', input),
  deleteAliasCommand: (input) => ipcRenderer.invoke('aliases:delete', input),
  createTerminal: (options?: TerminalCreateOptions) => ipcRenderer.invoke('terminal:create', options) as Promise<TerminalSessionInfo>,
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  killTerminal: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  getTerminalCommandSuggestions: (query: string, context) => ipcRenderer.invoke('terminal:suggestions', query, context),
  generateTerminalCommand: (input) => ipcRenderer.invoke('terminal:command:generate', input),
  listAiModels: () => ipcRenderer.invoke('models:list'),
  checkModelProvider: (input) => ipcRenderer.invoke('models:check-provider', input),
  listExtensionPlugins: () => ipcRenderer.invoke('extensions:list'),
  installExtensionPlugin: (input) => ipcRenderer.invoke('extensions:install-plugin', input),
  updateExtensionPlugin: (input) => ipcRenderer.invoke('extensions:update-plugin', input),
  installExtensionPackage: (input) => ipcRenderer.invoke('extensions:install-package', input),
  uninstallExtensionPlugin: (input) => ipcRenderer.invoke('extensions:uninstall-plugin', input),
  openExtensionSubscription: (input) => ipcRenderer.invoke('extensions:open-subscription', input),
  cancelExtensionInstall: (pluginId: string) => ipcRenderer.invoke('extensions:cancel-install', pluginId),
  onExtensionInstallProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('extensions:install-progress', wrapped)
    return () => ipcRenderer.off('extensions:install-progress', wrapped)
  },
  createAiChatExchangeRequest: (input) => ipcRenderer.invoke('ai:chat-exchange-request', input),
  generateAiChatResponse: (input) => ipcRenderer.invoke('ai:chat-response', input),
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
  mutateDatabaseTable: (input) => ipcRenderer.invoke('database:mutate-table', input),
  createDatabaseAiPaneRequest: (input) => ipcRenderer.invoke('database:ai-pane-request', input),
  startDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-start', input),
  cancelDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-cancel', input),
  generateDatabaseAiPaneResponse: (input) => ipcRenderer.invoke('database:ai-pane-response', input),
  createDatabaseAiDrawerRequest: (input) => ipcRenderer.invoke('database:ai-drawer-request', input),
  startDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-start', input),
  cancelDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-cancel', input),
  generateDatabaseAiDrawerResponse: (input) => ipcRenderer.invoke('database:ai-drawer-response', input),
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
  resizeKubernetesTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('kubernetes:terminal:resize', id, cols, rows),
  closeKubernetesTerminal: (id: string, exitCode?: number) => ipcRenderer.invoke('kubernetes:terminal:close', id, exitCode),
  executeKubernetesCommand: (input) => ipcRenderer.invoke('kubernetes:execute-command', input),
  refreshKubernetesResources: (input) => ipcRenderer.invoke('kubernetes:resources:refresh', input),
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
  recordFileTransferTask: (input) => ipcRenderer.invoke('files:transfer-task:record', input),
  cancelFileTransferTask: (input) => ipcRenderer.invoke('files:transfer-task:cancel', input),
  listFileTransferTasks: () => ipcRenderer.invoke('files:list-transfer-tasks'),
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => listener(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.off('terminal:data', wrapped)
  },
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => listener(payload)
    ipcRenderer.on('terminal:exit', wrapped)
    return () => ipcRenderer.off('terminal:exit', wrapped)
  }
}

contextBridge.exposeInMainWorld('aiops', api)
