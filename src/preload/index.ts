import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiopsPreloadApi,
  FileListEntry,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
  KnowledgeBaseTransferProgress,
  UserConfig,
  SkillUserConfig
} from '@shared/preload'

const api: AiopsPreloadApi = {
  platform: () => ipcRenderer.invoke('app:platform'),
  shell: () => ipcRenderer.invoke('app:shell'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
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
  readMcpConfig: () => ipcRenderer.invoke('mcp-config:read') as Promise<string>,
  writeMcpConfig: (content: string) => ipcRenderer.invoke('mcp-config:write', content) as Promise<void>,
  toggleMcpServer: (serverName: string, disabled: boolean) => ipcRenderer.invoke('mcp-config:toggle-server', serverName, disabled),
  deleteMcpServer: (serverName: string) => ipcRenderer.invoke('mcp-config:delete-server', serverName),
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
  writeLocalFile: (filePath: string, content: string) => ipcRenderer.invoke('files:write-local', filePath, content),
  kbCheckPath: (absPath: string) => ipcRenderer.invoke('kb:check-path', { absPath }),
  kbEnsureRoot: () => ipcRenderer.invoke('kb:ensure-root'),
  kbGetRoot: () => ipcRenderer.invoke('kb:get-root'),
  kbListDir: (relDir: string) => ipcRenderer.invoke('kb:list-dir', { relDir }),
  kbReadFile: (relPath: string, encoding?: 'utf-8' | 'base64') => ipcRenderer.invoke('kb:read-file', { relPath, encoding }),
  kbWriteFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64') => ipcRenderer.invoke('kb:write-file', { relPath, content, encoding }),
  kbMkdir: (relDir: string, name: string) => ipcRenderer.invoke('kb:mkdir', { relDir, name }),
  kbCreateFile: (relDir: string, name: string, content?: string) => ipcRenderer.invoke('kb:create-file', { relDir, name, content }),
  kbRename: (relPath: string, newName: string) => ipcRenderer.invoke('kb:rename', { relPath, newName }),
  kbDelete: (relPath: string, recursive?: boolean) => ipcRenderer.invoke('kb:delete', { relPath, recursive }),
  kbMove: (srcRelPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:move', { srcRelPath, dstRelDir }),
  kbCopy: (srcRelPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:copy', { srcRelPath, dstRelDir }),
  kbImportFile: (srcAbsPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:import-file', { srcAbsPath, dstRelDir }),
  kbImportFolder: (srcAbsPath: string, dstRelDir: string) => ipcRenderer.invoke('kb:import-folder', { srcAbsPath, dstRelDir }),
  onKbTransferProgress: (listener: (event: KnowledgeBaseTransferProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: KnowledgeBaseTransferProgress) => listener(payload)
    ipcRenderer.on('kb:transfer-progress', wrapped)
    return () => ipcRenderer.off('kb:transfer-progress', wrapped)
  },
  createTerminal: (options?: TerminalCreateOptions) => ipcRenderer.invoke('terminal:create', options) as Promise<TerminalSessionInfo>,
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  killTerminal: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  listFiles: (directory: string) => ipcRenderer.invoke('files:list', directory) as Promise<FileListEntry[]>,
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
