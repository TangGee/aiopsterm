import type { ShortcutUserConfig } from './contracts/settingsPreferences'

export const SETTINGS_SHORTCUT_DEFAULTS_VERSION = 2

export const defaultSettingsShortcuts = (platform: string): ShortcutUserConfig[] => {
  const isMac = platform === 'darwin'
  return [
    { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
    { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
    { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
    { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' },
    { id: 'closeCurrentPanel', action: '关闭当前面板', shortcut: 'Ctrl+Shift+W' },
    { id: 'recentPanels', action: '打开最近面板', shortcut: 'Ctrl+Tab' },
    { id: 'navigatePanelBack', action: '导航到上一个面板', shortcut: isMac ? 'Cmd+[' : 'Ctrl+Left' },
    { id: 'navigatePanelForward', action: '导航到下一个面板', shortcut: isMac ? 'Cmd+]' : 'Ctrl+Right' },
    { id: 'navigatePanelByOrderBack', action: '按标签栏顺序切换到左侧面板', shortcut: 'Ctrl+Shift+Left' },
    { id: 'navigatePanelByOrderForward', action: '按标签栏顺序切换到右侧面板', shortcut: 'Ctrl+Shift+Right' }
  ]
}
