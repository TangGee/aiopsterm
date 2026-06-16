export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'pt-PT', 'ru-RU', 'ar-AR'] as const

export type SupportedLocale = (typeof supportedLocales)[number]
export type LocaleSetting = SupportedLocale | 'system'

export const localeDisplayNames: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'pt-PT': 'Português',
  'ru-RU': 'Русский',
  'ar-AR': 'العربية'
}

export type I18nKey =
  | 'common.ai'
  | 'common.agents'
  | 'common.cancel'
  | 'common.close'
  | 'common.configure'
  | 'common.copy'
  | 'common.export'
  | 'common.login'
  | 'common.new'
  | 'common.open'
  | 'common.save'
  | 'common.search'
  | 'common.settings'
  | 'common.submit'
  | 'common.system'
  | 'module.workspace'
  | 'module.assets'
  | 'module.files'
  | 'module.snippets'
  | 'module.knowledge'
  | 'module.extensions'
  | 'module.kubernetes'
  | 'module.database'
  | 'module.settings'
  | 'module.user'
  | 'settings.nav.general'
  | 'settings.nav.terminal'
  | 'settings.nav.extensions'
  | 'settings.nav.models'
  | 'settings.nav.billing'
  | 'settings.nav.ai'
  | 'settings.nav.mcp'
  | 'settings.nav.skills'
  | 'settings.nav.rules'
  | 'settings.nav.shortcuts'
  | 'settings.nav.trustedDevices'
  | 'settings.nav.privacy'
  | 'settings.nav.about'
  | 'settings.nav.docs'
  | 'settings.general.base'
  | 'settings.general.theme'
  | 'settings.general.themeSystem'
  | 'settings.general.themeDefault'
  | 'settings.general.themeOfficial'
  | 'settings.general.background'
  | 'settings.general.defaultBackground'
  | 'settings.general.customUpload'
  | 'settings.general.customBackground'
  | 'settings.general.deleteCustomBackground'
  | 'settings.general.upload'
  | 'settings.general.opacity'
  | 'settings.general.brightness'
  | 'settings.general.defaultLayout'
  | 'settings.general.language'
  | 'settings.general.followSystem'
  | 'settings.general.watermark'
  | 'settings.general.enabled'
  | 'settings.general.disabled'
  | 'settings.general.onboarding'
  | 'settings.general.openOnboarding'
  | 'settings.general.editor'
  | 'settings.general.fontSize'
  | 'settings.general.lineHeight'
  | 'settings.general.font'
  | 'top.modeToAgents'
  | 'top.modeToTerminal'
  | 'top.expandSessions'
  | 'top.collapseSessions'
  | 'top.expandLeft'
  | 'top.collapseLeft'
  | 'top.aiUnavailable'
  | 'top.expandAi'
  | 'top.collapseAi'
  | 'top.updateChecking'
  | 'top.updateAvailable'
  | 'top.updateInstallRequested'
  | 'top.updateLocal'
  | 'top.windowMinimize'
  | 'top.windowRestore'
  | 'top.windowMaximize'
  | 'top.windowClose'
  | 'ai.newChat'
  | 'ai.panelMode'
  | 'ai.codexCliMode'
  | 'ai.classicChatMode'
  | 'ai.codexRestart'
  | 'ai.codexIdle'
  | 'ai.codexStarting'
  | 'ai.codexReady'
  | 'ai.codexError'
  | 'ai.codexClosed'
  | 'ai.codexBridgeMissing'
  | 'ai.codexStartFailed'
  | 'ai.moreActions'
  | 'ai.history'
  | 'ai.conversationTabs'
  | 'ai.closeTab'
  | 'ai.untitledChat'
  | 'ai.chatCreated'
  | 'ai.chatCreateFailed'
  | 'ai.chatRestored'
  | 'ai.chatRestoreFailed'
  | 'ai.chatDeleted'
  | 'ai.chatDeleteFailed'
  | 'ai.tabClosed'
  | 'ai.keepOneTab'
  | 'ai.historyFavoriteGroup'
  | 'ai.historyToday'
  | 'ai.historyYesterday'
  | 'ai.historyDaysAgo'
  | 'ai.historyTitleUpdated'
  | 'ai.historyTitleUpdateFailed'
  | 'ai.historyFavorited'
  | 'ai.historyUnfavorited'
  | 'ai.historyFavoriteUpdateFailed'
  | 'ai.historyRestoreTruncated'
  | 'ai.searchChat'
  | 'ai.exportChat'
  | 'ai.searchHistory'
  | 'ai.clearSearch'
  | 'ai.favoritesOnly'
  | 'ai.cancelEdit'
  | 'ai.favorite'
  | 'ai.editTitle'
  | 'ai.deleteHistory'
  | 'ai.loadingMore'
  | 'ai.loadMore'
  | 'ai.noData'
  | 'ai.noMatches'
  | 'ai.clear'
  | 'ai.previous'
  | 'ai.next'
  | 'ai.back'
  | 'ai.editMessagePlaceholder'
  | 'ai.noMatchingContext'
  | 'ai.noMatchingCommands'
  | 'ai.selectAll'
  | 'ai.deselectAll'
  | 'ai.clearSelection'
  | 'ai.emptyNoModelTitle'
  | 'ai.emptyNoModelLogin'
  | 'ai.emptyNoModelConfigure'
  | 'ai.configureModel'
  | 'ai.addContext'
  | 'ai.removeContext'
  | 'ai.inputPlaceholder'
  | 'ai.processing'
  | 'ai.searchContext'
  | 'ai.searchItems'
  | 'ai.searchCommand'
  | 'ai.searchModel'
  | 'ai.noMatchingModels'
  | 'ai.output'
  | 'ai.commandReview'
  | 'ai.commandReviewTitle'
  | 'ai.commandReviewDescription'
  | 'ai.commandReviewOpen'
  | 'ai.commandReviewCopy'
  | 'ai.commandReviewSave'
  | 'ai.commandReviewRun'
  | 'ai.commandReject'
  | 'ai.commandAutoRun'
  | 'ai.commandRun'
  | 'ai.commandRunning'
  | 'terminal.mfaTitle'
  | 'terminal.mfaDescription'
  | 'terminal.mfaPromptFallback'
  | 'terminal.mfaRequired'
  | 'terminal.passwordTitle'
  | 'terminal.passwordDescription'
  | 'terminal.passwordRejectedDescription'
  | 'terminal.passwordPromptFallback'
  | 'terminal.passwordRequired'
  | 'terminal.passwordRemember'
  | 'terminal.mfaSubmit'
  | 'terminal.mfaSubmitting'
  | 'terminal.mfaEmpty'
  | 'terminal.mfaFailed'
  | 'terminal.mfaCanceled'
  | 'terminal.mfaTimeout'
  | 'terminal.mfaSuccess'

export type LocaleMessages = Record<I18nKey, string>

const zhCN: LocaleMessages = {
  'common.ai': 'AI',
  'common.agents': 'Agents',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.configure': '配置',
  'common.copy': '复制',
  'common.export': '导出',
  'common.login': '登录',
  'common.new': '新建',
  'common.open': '打开',
  'common.save': '保存',
  'common.search': '搜索',
  'common.settings': '设置',
  'common.submit': '提交',
  'common.system': '系统',
  'module.workspace': '工作区',
  'module.assets': '资产',
  'module.files': '文件',
  'module.snippets': '快捷命令',
  'module.knowledge': '知识库',
  'module.extensions': '扩展',
  'module.kubernetes': 'Kubernetes',
  'module.database': '数据库',
  'module.settings': '设置',
  'module.user': '用户',
  'settings.nav.general': '通用',
  'settings.nav.terminal': '终端',
  'settings.nav.extensions': '扩展',
  'settings.nav.models': '模型',
  'settings.nav.billing': '计费概览',
  'settings.nav.ai': 'AI 偏好设置',
  'settings.nav.mcp': 'MCP',
  'settings.nav.skills': 'Skills',
  'settings.nav.rules': '规则',
  'settings.nav.shortcuts': '快捷键',
  'settings.nav.trustedDevices': '可信设备',
  'settings.nav.privacy': '隐私',
  'settings.nav.about': '关于',
  'settings.nav.docs': '文档',
  'settings.general.base': '基础设置',
  'settings.general.theme': '主题',
  'settings.general.themeSystem': '系统',
  'settings.general.themeDefault': '默认',
  'settings.general.themeOfficial': '官方主题',
  'settings.general.background': '背景',
  'settings.general.defaultBackground': '默认背景',
  'settings.general.customUpload': '自定义上传（支持JPG、PNG、WebP、GIF）',
  'settings.general.customBackground': '自定义背景',
  'settings.general.deleteCustomBackground': '删除自定义背景',
  'settings.general.upload': '上传',
  'settings.general.opacity': '透明度',
  'settings.general.brightness': '亮度',
  'settings.general.defaultLayout': '默认布局',
  'settings.general.language': '语言',
  'settings.general.followSystem': '跟随系统',
  'settings.general.watermark': '水印',
  'settings.general.enabled': '开启',
  'settings.general.disabled': '关闭',
  'settings.general.onboarding': '入门引导',
  'settings.general.openOnboarding': '打开入门引导',
  'settings.general.editor': '编辑器设置',
  'settings.general.fontSize': '字体大小',
  'settings.general.lineHeight': '行高',
  'settings.general.font': '字体',
  'top.modeToAgents': '切换到 Agents 模式',
  'top.modeToTerminal': '切换到终端模式',
  'top.expandSessions': '展开会话侧栏',
  'top.collapseSessions': '收起会话侧栏',
  'top.expandLeft': '展开左侧面板',
  'top.collapseLeft': '收起左侧面板',
  'top.aiUnavailable': '当前模块不显示 AI 面板',
  'top.expandAi': '展开 AI 面板',
  'top.collapseAi': '收起 AI 面板',
  'top.updateChecking': 'Checking',
  'top.updateAvailable': '点击更新',
  'top.updateInstallRequested': '待安装',
  'top.updateLocal': '本地版本',
  'top.windowMinimize': '最小化窗口',
  'top.windowRestore': '还原窗口',
  'top.windowMaximize': '最大化窗口',
  'top.windowClose': '退出应用',
  'ai.newChat': '新建会话',
  'ai.panelMode': 'AI 面板模式',
  'ai.codexCliMode': 'Codex CLI',
  'ai.classicChatMode': 'Classic Chat',
  'ai.codexRestart': '重启 Codex CLI',
  'ai.codexIdle': 'Codex CLI 未启动',
  'ai.codexStarting': '正在启动 Codex CLI',
  'ai.codexReady': 'Codex CLI 已连接',
  'ai.codexError': 'Codex CLI 异常',
  'ai.codexClosed': 'Codex CLI 已退出',
  'ai.codexBridgeMissing': 'Codex CLI 桥接服务不可用',
  'ai.codexStartFailed': 'Codex CLI 启动失败',
  'ai.moreActions': '更多',
  'ai.history': '会话历史',
  'ai.conversationTabs': 'AI 会话标签',
  'ai.closeTab': '关闭标签',
  'ai.untitledChat': '未命名会话',
  'ai.chatCreated': '已新建会话。',
  'ai.chatCreateFailed': '新建会话失败。',
  'ai.chatRestored': '已恢复历史会话。',
  'ai.chatRestoreFailed': '历史会话恢复失败。',
  'ai.chatDeleted': '历史会话已删除。',
  'ai.chatDeleteFailed': '历史会话删除失败。',
  'ai.tabClosed': '标签已关闭。',
  'ai.keepOneTab': '至少保留一个会话标签。',
  'ai.historyFavoriteGroup': '收藏',
  'ai.historyToday': '今天',
  'ai.historyYesterday': '昨天',
  'ai.historyDaysAgo': '{count}天前',
  'ai.historyTitleUpdated': '历史标题已更新。',
  'ai.historyTitleUpdateFailed': '历史标题未更新。',
  'ai.historyFavorited': '历史会话已收藏。',
  'ai.historyUnfavorited': '已取消历史收藏。',
  'ai.historyFavoriteUpdateFailed': '历史收藏更新失败。',
  'ai.historyRestoreTruncated': '已加载最近 {count} 条历史消息，完整历史仍保存在本地。',
  'ai.searchChat': '搜索聊天',
  'ai.exportChat': '导出聊天',
  'ai.searchHistory': '搜索历史',
  'ai.clearSearch': '清空搜索',
  'ai.favoritesOnly': '只看收藏',
  'ai.cancelEdit': '取消编辑',
  'ai.favorite': '收藏',
  'ai.editTitle': '编辑标题',
  'ai.deleteHistory': '删除历史',
  'ai.loadingMore': '加载中...',
  'ai.loadMore': '加载更多',
  'ai.noData': '暂无数据',
  'ai.noMatches': '无匹配',
  'ai.clear': '清空',
  'ai.previous': '上一个',
  'ai.next': '下一个',
  'ai.back': '返回',
  'ai.editMessagePlaceholder': '编辑消息',
  'ai.noMatchingContext': '没有匹配的上下文',
  'ai.noMatchingCommands': '没有匹配的命令',
  'ai.selectAll': '全选',
  'ai.deselectAll': '取消全选',
  'ai.clearSelection': '清空选择',
  'ai.emptyNoModelTitle': '没有可用的模型',
  'ai.emptyNoModelLogin': '请登录使用提供的内置模型或配置可用模型',
  'ai.emptyNoModelConfigure': '请配置可用模型',
  'ai.configureModel': '配置模型',
  'ai.addContext': '@ 添加上下文',
  'ai.removeContext': '移除上下文',
  'ai.inputPlaceholder': '描述你的运维目标',
  'ai.processing': '处理中',
  'ai.searchContext': '搜索上下文',
  'ai.searchItems': '搜索条目',
  'ai.searchCommand': '搜索命令',
  'ai.searchModel': '搜索模型',
  'ai.noMatchingModels': '没有匹配的模型',
  'ai.output': 'OUTPUT',
  'ai.commandReview': '命令审计',
  'ai.commandReviewTitle': '审计并编辑命令',
  'ai.commandReviewDescription': '执行前检查 AI 生成的命令。保存后会更新当前命令卡，执行会写入当前活动终端。',
  'ai.commandReviewOpen': '审计编辑',
  'ai.commandReviewCopy': '复制命令',
  'ai.commandReviewSave': '保存修改',
  'ai.commandReviewRun': '保存并执行',
  'ai.commandReject': '拒绝',
  'ai.commandAutoRun': '查询类自动执行',
  'ai.commandRun': '执行',
  'ai.commandRunning': '执行中',
  'terminal.mfaTitle': 'SSH 二次认证',
  'terminal.mfaDescription': '远程主机 {target} 需要动态密码或验证码。输入后将继续当前 SSH 登录。',
  'terminal.mfaPromptFallback': '验证码或动态密码',
  'terminal.mfaRequired': '需要二次认证',
  'terminal.passwordTitle': 'SSH 密码认证',
  'terminal.passwordDescription': '远程主机 {target} 需要输入 SSH 密码。默认仅用于本次登录；勾选后会在连接成功时更新该主机密码。',
  'terminal.passwordRejectedDescription': '远程主机 {target} 拒绝了已保存的密码。请输入新密码重试；勾选后会在连接成功时更新该主机密码。',
  'terminal.passwordPromptFallback': 'SSH 密码',
  'terminal.passwordRequired': '需要 SSH 密码',
  'terminal.passwordRemember': '记住密码并更新该主机',
  'terminal.mfaSubmit': '提交认证',
  'terminal.mfaSubmitting': '提交中',
  'terminal.mfaEmpty': '请输入认证信息。',
  'terminal.mfaFailed': '认证失败，请重新输入。',
  'terminal.mfaCanceled': '已取消二次认证。',
  'terminal.mfaTimeout': '二次认证超时，请重新连接。',
  'terminal.mfaSuccess': '二次认证通过。'
}

const enUS: LocaleMessages = {
  'common.ai': 'AI',
  'common.agents': 'Agents',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.configure': 'Configure',
  'common.copy': 'Copy',
  'common.export': 'Export',
  'common.login': 'Log in',
  'common.new': 'New',
  'common.open': 'Open',
  'common.save': 'Save',
  'common.search': 'Search',
  'common.settings': 'Settings',
  'common.submit': 'Submit',
  'common.system': 'System',
  'module.workspace': 'Workspace',
  'module.assets': 'Assets',
  'module.files': 'Files',
  'module.snippets': 'Quick Commands',
  'module.knowledge': 'Knowledge',
  'module.extensions': 'Extensions',
  'module.kubernetes': 'Kubernetes',
  'module.database': 'Database',
  'module.settings': 'Settings',
  'module.user': 'User',
  'settings.nav.general': 'General',
  'settings.nav.terminal': 'Terminal',
  'settings.nav.extensions': 'Extensions',
  'settings.nav.models': 'Models',
  'settings.nav.billing': 'Billing',
  'settings.nav.ai': 'AI Preferences',
  'settings.nav.mcp': 'MCP',
  'settings.nav.skills': 'Skills',
  'settings.nav.rules': 'Rules',
  'settings.nav.shortcuts': 'Shortcuts',
  'settings.nav.trustedDevices': 'Trusted Devices',
  'settings.nav.privacy': 'Privacy',
  'settings.nav.about': 'About',
  'settings.nav.docs': 'Docs',
  'settings.general.base': 'Basic Settings',
  'settings.general.theme': 'Theme',
  'settings.general.themeSystem': 'System',
  'settings.general.themeDefault': 'Default',
  'settings.general.themeOfficial': 'Official Themes',
  'settings.general.background': 'Background',
  'settings.general.defaultBackground': 'Default background',
  'settings.general.customUpload': 'Custom upload (JPG, PNG, WebP, GIF)',
  'settings.general.customBackground': 'Custom background',
  'settings.general.deleteCustomBackground': 'Delete custom background',
  'settings.general.upload': 'Upload',
  'settings.general.opacity': 'Opacity',
  'settings.general.brightness': 'Brightness',
  'settings.general.defaultLayout': 'Default Layout',
  'settings.general.language': 'Language',
  'settings.general.followSystem': 'Follow system',
  'settings.general.watermark': 'Watermark',
  'settings.general.enabled': 'On',
  'settings.general.disabled': 'Off',
  'settings.general.onboarding': 'Onboarding',
  'settings.general.openOnboarding': 'Open onboarding',
  'settings.general.editor': 'Editor Settings',
  'settings.general.fontSize': 'Font Size',
  'settings.general.lineHeight': 'Line Height',
  'settings.general.font': 'Font',
  'top.modeToAgents': 'Switch to Agents mode',
  'top.modeToTerminal': 'Switch to Terminal mode',
  'top.expandSessions': 'Expand sessions sidebar',
  'top.collapseSessions': 'Collapse sessions sidebar',
  'top.expandLeft': 'Expand left panel',
  'top.collapseLeft': 'Collapse left panel',
  'top.aiUnavailable': 'AI panel is hidden for the current module',
  'top.expandAi': 'Expand AI panel',
  'top.collapseAi': 'Collapse AI panel',
  'top.updateChecking': 'Checking',
  'top.updateAvailable': 'Update',
  'top.updateInstallRequested': 'Install pending',
  'top.updateLocal': 'Local version',
  'top.windowMinimize': 'Minimize window',
  'top.windowRestore': 'Restore window',
  'top.windowMaximize': 'Maximize window',
  'top.windowClose': 'Quit app',
  'ai.newChat': 'New chat',
  'ai.panelMode': 'AI panel mode',
  'ai.codexCliMode': 'Codex CLI',
  'ai.classicChatMode': 'Classic Chat',
  'ai.codexRestart': 'Restart Codex CLI',
  'ai.codexIdle': 'Codex CLI is not running',
  'ai.codexStarting': 'Starting Codex CLI',
  'ai.codexReady': 'Codex CLI connected',
  'ai.codexError': 'Codex CLI error',
  'ai.codexClosed': 'Codex CLI exited',
  'ai.codexBridgeMissing': 'Codex CLI bridge is unavailable',
  'ai.codexStartFailed': 'Failed to start Codex CLI',
  'ai.moreActions': 'More',
  'ai.history': 'Chat history',
  'ai.conversationTabs': 'AI conversation tabs',
  'ai.closeTab': 'Close tab',
  'ai.untitledChat': 'Untitled chat',
  'ai.chatCreated': 'New chat created.',
  'ai.chatCreateFailed': 'Failed to create chat.',
  'ai.chatRestored': 'Chat restored.',
  'ai.chatRestoreFailed': 'Failed to restore chat.',
  'ai.chatDeleted': 'Chat deleted.',
  'ai.chatDeleteFailed': 'Failed to delete chat.',
  'ai.tabClosed': 'Tab closed.',
  'ai.keepOneTab': 'Keep at least one chat tab open.',
  'ai.historyFavoriteGroup': 'Favorites',
  'ai.historyToday': 'Today',
  'ai.historyYesterday': 'Yesterday',
  'ai.historyDaysAgo': '{count} days ago',
  'ai.historyTitleUpdated': 'History title updated.',
  'ai.historyTitleUpdateFailed': 'History title was not updated.',
  'ai.historyFavorited': 'Chat added to favorites.',
  'ai.historyUnfavorited': 'Chat removed from favorites.',
  'ai.historyFavoriteUpdateFailed': 'Failed to update favorite.',
  'ai.historyRestoreTruncated': 'Loaded the latest {count} history messages. The full history is still stored locally.',
  'ai.searchChat': 'Search chat',
  'ai.exportChat': 'Export chat',
  'ai.searchHistory': 'Search history',
  'ai.clearSearch': 'Clear search',
  'ai.favoritesOnly': 'Favorites only',
  'ai.cancelEdit': 'Cancel edit',
  'ai.favorite': 'Favorite',
  'ai.editTitle': 'Edit title',
  'ai.deleteHistory': 'Delete history',
  'ai.loadingMore': 'Loading...',
  'ai.loadMore': 'Load more',
  'ai.noData': 'No data',
  'ai.noMatches': 'No matches',
  'ai.clear': 'Clear',
  'ai.previous': 'Previous',
  'ai.next': 'Next',
  'ai.back': 'Back',
  'ai.editMessagePlaceholder': 'Edit message',
  'ai.noMatchingContext': 'No matching context',
  'ai.noMatchingCommands': 'No matching commands',
  'ai.selectAll': 'Select all',
  'ai.deselectAll': 'Deselect all',
  'ai.clearSelection': 'Clear selection',
  'ai.emptyNoModelTitle': 'No available model',
  'ai.emptyNoModelLogin': 'Log in to use built-in models or configure an available model',
  'ai.emptyNoModelConfigure': 'Configure an available model',
  'ai.configureModel': 'Configure model',
  'ai.addContext': '@ Add context',
  'ai.removeContext': 'Remove context',
  'ai.inputPlaceholder': 'Describe your operations goal',
  'ai.processing': 'Processing',
  'ai.searchContext': 'Search context',
  'ai.searchItems': 'Search items',
  'ai.searchCommand': 'Search commands',
  'ai.searchModel': 'Search models',
  'ai.noMatchingModels': 'No matching models',
  'ai.output': 'OUTPUT',
  'ai.commandReview': 'Command review',
  'ai.commandReviewTitle': 'Review and edit command',
  'ai.commandReviewDescription': 'Review the AI-generated command before execution. Saving updates the current command card; running writes it to the active terminal.',
  'ai.commandReviewOpen': 'Review edit',
  'ai.commandReviewCopy': 'Copy command',
  'ai.commandReviewSave': 'Save changes',
  'ai.commandReviewRun': 'Save and run',
  'ai.commandReject': 'Reject',
  'ai.commandAutoRun': 'Auto-run read-only query',
  'ai.commandRun': 'Run',
  'ai.commandRunning': 'Running',
  'terminal.mfaTitle': 'SSH two-factor authentication',
  'terminal.mfaDescription': 'Remote host {target} requires a dynamic password or verification code. Submit it to continue the SSH login.',
  'terminal.mfaPromptFallback': 'Verification code or dynamic password',
  'terminal.mfaRequired': 'Two-factor authentication required',
  'terminal.passwordTitle': 'SSH password authentication',
  'terminal.passwordDescription': 'Remote host {target} requires an SSH password. It is used only for this login by default; remember it to update this host after a successful connection.',
  'terminal.passwordRejectedDescription': 'Remote host {target} rejected the saved password. Enter a new password to retry; remember it to update this host after a successful connection.',
  'terminal.passwordPromptFallback': 'SSH password',
  'terminal.passwordRequired': 'SSH password required',
  'terminal.passwordRemember': 'Remember password for this host',
  'terminal.mfaSubmit': 'Submit verification',
  'terminal.mfaSubmitting': 'Submitting',
  'terminal.mfaEmpty': 'Enter the verification response.',
  'terminal.mfaFailed': 'Verification failed. Please try again.',
  'terminal.mfaCanceled': 'Two-factor authentication canceled.',
  'terminal.mfaTimeout': 'Two-factor authentication timed out. Reconnect and try again.',
  'terminal.mfaSuccess': 'Two-factor authentication passed.'
}

const zhTW: LocaleMessages = {
  ...zhCN,
  'module.workspace': '工作區',
  'module.assets': '資產',
  'module.files': '檔案',
  'module.snippets': '快捷命令',
  'module.knowledge': '知識庫',
  'module.extensions': '擴充',
  'module.database': '資料庫',
  'module.settings': '設定',
  'module.user': '使用者',
  'common.settings': '設定',
  'settings.nav.general': '一般',
  'settings.nav.terminal': '終端',
  'settings.nav.extensions': '擴充',
  'settings.nav.models': '模型',
  'settings.nav.billing': '計費概覽',
  'settings.nav.ai': 'AI 偏好設定',
  'settings.nav.rules': '規則',
  'settings.nav.shortcuts': '快捷鍵',
  'settings.nav.trustedDevices': '信任裝置',
  'settings.nav.privacy': '隱私',
  'settings.nav.about': '關於',
  'settings.nav.docs': '文件',
  'settings.general.base': '基礎設定',
  'settings.general.theme': '主題',
  'settings.general.themeSystem': '系統',
  'settings.general.themeDefault': '預設',
  'settings.general.themeOfficial': '官方主題',
  'settings.general.background': '背景',
  'settings.general.defaultBackground': '預設背景',
  'settings.general.customUpload': '自訂上傳（支援JPG、PNG、WebP、GIF）',
  'settings.general.customBackground': '自訂背景',
  'settings.general.deleteCustomBackground': '刪除自訂背景',
  'settings.general.defaultLayout': '預設版面',
  'settings.general.language': '語言',
  'settings.general.followSystem': '跟隨系統',
  'settings.general.watermark': '浮水印',
  'settings.general.enabled': '開啟',
  'settings.general.disabled': '關閉',
  'settings.general.onboarding': '入門導覽',
  'settings.general.openOnboarding': '開啟入門導覽',
  'settings.general.editor': '編輯器設定',
  'ai.newChat': '新建對話',
  'ai.moreActions': '更多',
  'ai.history': '對話歷史',
  'ai.conversationTabs': 'AI 對話標籤',
  'ai.closeTab': '關閉標籤',
  'ai.untitledChat': '未命名對話',
  'ai.chatCreated': '已新建對話。',
  'ai.chatCreateFailed': '新建對話失敗。',
  'ai.chatRestored': '已還原歷史對話。',
  'ai.chatRestoreFailed': '歷史對話還原失敗。',
  'ai.chatDeleted': '歷史對話已刪除。',
  'ai.chatDeleteFailed': '歷史對話刪除失敗。',
  'ai.tabClosed': '標籤已關閉。',
  'ai.keepOneTab': '至少保留一個對話標籤。',
  'ai.historyFavoriteGroup': '收藏',
  'ai.historyToday': '今天',
  'ai.historyYesterday': '昨天',
  'ai.historyDaysAgo': '{count}天前',
  'ai.historyTitleUpdated': '歷史標題已更新。',
  'ai.historyTitleUpdateFailed': '歷史標題未更新。',
  'ai.historyFavorited': '歷史對話已收藏。',
  'ai.historyUnfavorited': '已取消歷史收藏。',
  'ai.historyFavoriteUpdateFailed': '歷史收藏更新失敗。',
  'ai.searchChat': '搜尋對話',
  'ai.exportChat': '匯出對話',
  'ai.searchHistory': '搜尋歷史',
  'ai.clearSearch': '清除搜尋',
  'ai.emptyNoModelTitle': '沒有可用的模型',
  'ai.emptyNoModelLogin': '請登入使用內建模型或設定可用模型',
  'ai.emptyNoModelConfigure': '請設定可用模型',
  'ai.configureModel': '設定模型',
  'ai.addContext': '@ 加入上下文',
  'ai.inputPlaceholder': '描述你的運維目標',
  'ai.processing': '處理中'
}

const jaJP: LocaleMessages = {
  ...enUS,
  'module.workspace': 'ワークスペース',
  'module.assets': 'アセット',
  'module.files': 'ファイル',
  'module.snippets': 'クイックコマンド',
  'module.knowledge': 'ナレッジ',
  'module.extensions': '拡張機能',
  'module.database': 'データベース',
  'module.settings': '設定',
  'module.user': 'ユーザー',
  'common.settings': '設定',
  'settings.nav.general': '一般',
  'settings.nav.terminal': 'ターミナル',
  'settings.nav.extensions': '拡張機能',
  'settings.nav.models': 'モデル',
  'settings.nav.billing': '請求',
  'settings.nav.ai': 'AI 設定',
  'settings.nav.rules': 'ルール',
  'settings.nav.shortcuts': 'ショートカット',
  'settings.nav.trustedDevices': '信頼済みデバイス',
  'settings.nav.privacy': 'プライバシー',
  'settings.nav.about': '情報',
  'settings.nav.docs': 'ドキュメント',
  'settings.general.base': '基本設定',
  'settings.general.theme': 'テーマ',
  'settings.general.background': '背景',
  'settings.general.defaultLayout': '既定レイアウト',
  'settings.general.language': '言語',
  'settings.general.openOnboarding': 'オンボーディングを開く',
  'settings.general.editor': 'エディター設定',
  'ai.newChat': '新しいチャット',
  'ai.moreActions': 'その他',
  'ai.history': 'チャット履歴',
  'ai.conversationTabs': 'AI チャットタブ',
  'ai.closeTab': 'タブを閉じる',
  'ai.untitledChat': '無題のチャット',
  'ai.chatCreated': '新しいチャットを作成しました。',
  'ai.chatCreateFailed': 'チャットの作成に失敗しました。',
  'ai.chatRestored': 'チャットを復元しました。',
  'ai.chatRestoreFailed': 'チャットの復元に失敗しました。',
  'ai.chatDeleted': 'チャット履歴を削除しました。',
  'ai.chatDeleteFailed': 'チャット履歴の削除に失敗しました。',
  'ai.tabClosed': 'タブを閉じました。',
  'ai.keepOneTab': '少なくとも 1 つのチャットタブを残してください。',
  'ai.historyFavoriteGroup': 'お気に入り',
  'ai.historyToday': '今日',
  'ai.historyYesterday': '昨日',
  'ai.historyDaysAgo': '{count} 日前',
  'ai.historyTitleUpdated': '履歴タイトルを更新しました。',
  'ai.historyTitleUpdateFailed': '履歴タイトルを更新できませんでした。',
  'ai.historyFavorited': 'チャットをお気に入りに追加しました。',
  'ai.historyUnfavorited': 'チャットをお気に入りから外しました。',
  'ai.historyFavoriteUpdateFailed': 'お気に入りの更新に失敗しました。',
  'ai.searchChat': 'チャットを検索',
  'ai.exportChat': 'チャットをエクスポート',
  'ai.emptyNoModelTitle': '利用可能なモデルがありません',
  'ai.configureModel': 'モデルを設定',
  'ai.addContext': '@ コンテキストを追加',
  'ai.inputPlaceholder': '運用目標を入力してください'
}

const koKR: LocaleMessages = {
  ...enUS,
  'module.workspace': '작업 영역',
  'module.assets': '자산',
  'module.files': '파일',
  'module.snippets': '빠른 명령',
  'module.knowledge': '지식 베이스',
  'module.extensions': '확장',
  'module.database': '데이터베이스',
  'module.settings': '설정',
  'module.user': '사용자',
  'common.settings': '설정',
  'settings.nav.general': '일반',
  'settings.nav.terminal': '터미널',
  'settings.nav.extensions': '확장',
  'settings.nav.models': '모델',
  'settings.nav.billing': '결제',
  'settings.nav.ai': 'AI 환경설정',
  'settings.nav.rules': '규칙',
  'settings.nav.shortcuts': '단축키',
  'settings.nav.trustedDevices': '신뢰 기기',
  'settings.nav.privacy': '개인정보',
  'settings.nav.about': '정보',
  'settings.nav.docs': '문서',
  'settings.general.base': '기본 설정',
  'settings.general.theme': '테마',
  'settings.general.background': '배경',
  'settings.general.defaultLayout': '기본 레이아웃',
  'settings.general.language': '언어',
  'settings.general.openOnboarding': '온보딩 열기',
  'settings.general.editor': '편집기 설정',
  'ai.newChat': '새 채팅',
  'ai.moreActions': '더보기',
  'ai.history': '채팅 기록',
  'ai.conversationTabs': 'AI 채팅 탭',
  'ai.closeTab': '탭 닫기',
  'ai.untitledChat': '제목 없는 채팅',
  'ai.chatCreated': '새 채팅을 만들었습니다.',
  'ai.chatCreateFailed': '채팅을 만들지 못했습니다.',
  'ai.chatRestored': '채팅을 복원했습니다.',
  'ai.chatRestoreFailed': '채팅을 복원하지 못했습니다.',
  'ai.chatDeleted': '채팅 기록을 삭제했습니다.',
  'ai.chatDeleteFailed': '채팅 기록을 삭제하지 못했습니다.',
  'ai.tabClosed': '탭을 닫았습니다.',
  'ai.keepOneTab': '채팅 탭을 하나 이상 유지하세요.',
  'ai.historyFavoriteGroup': '즐겨찾기',
  'ai.historyToday': '오늘',
  'ai.historyYesterday': '어제',
  'ai.historyDaysAgo': '{count}일 전',
  'ai.historyTitleUpdated': '기록 제목을 업데이트했습니다.',
  'ai.historyTitleUpdateFailed': '기록 제목을 업데이트하지 못했습니다.',
  'ai.historyFavorited': '채팅을 즐겨찾기에 추가했습니다.',
  'ai.historyUnfavorited': '채팅을 즐겨찾기에서 제거했습니다.',
  'ai.historyFavoriteUpdateFailed': '즐겨찾기를 업데이트하지 못했습니다.',
  'ai.searchChat': '채팅 검색',
  'ai.exportChat': '채팅 내보내기',
  'ai.emptyNoModelTitle': '사용 가능한 모델 없음',
  'ai.configureModel': '모델 설정',
  'ai.addContext': '@ 컨텍스트 추가',
  'ai.inputPlaceholder': '운영 목표를 설명하세요'
}

const deDE: LocaleMessages = {
  ...enUS,
  'module.workspace': 'Arbeitsbereich',
  'module.assets': 'Assets',
  'module.files': 'Dateien',
  'module.snippets': 'Schnellbefehle',
  'module.knowledge': 'Wissen',
  'module.extensions': 'Erweiterungen',
  'module.database': 'Datenbank',
  'module.settings': 'Einstellungen',
  'module.user': 'Benutzer',
  'common.settings': 'Einstellungen',
  'settings.nav.general': 'Allgemein',
  'settings.nav.terminal': 'Terminal',
  'settings.nav.extensions': 'Erweiterungen',
  'settings.nav.models': 'Modelle',
  'settings.nav.billing': 'Abrechnung',
  'settings.nav.ai': 'AI-Einstellungen',
  'settings.nav.rules': 'Regeln',
  'settings.nav.shortcuts': 'Tastenkürzel',
  'settings.nav.trustedDevices': 'Vertrauensgeräte',
  'settings.nav.privacy': 'Datenschutz',
  'settings.nav.about': 'Über',
  'settings.nav.docs': 'Dokumentation',
  'settings.general.base': 'Grundeinstellungen',
  'settings.general.theme': 'Theme',
  'settings.general.background': 'Hintergrund',
  'settings.general.defaultLayout': 'Standardlayout',
  'settings.general.language': 'Sprache',
  'settings.general.openOnboarding': 'Onboarding öffnen',
  'settings.general.editor': 'Editor-Einstellungen',
  'ai.newChat': 'Neuer Chat',
  'ai.moreActions': 'Mehr',
  'ai.history': 'Chatverlauf',
  'ai.conversationTabs': 'AI-Chat-Tabs',
  'ai.closeTab': 'Tab schließen',
  'ai.untitledChat': 'Unbenannter Chat',
  'ai.chatCreated': 'Neuer Chat erstellt.',
  'ai.chatCreateFailed': 'Chat konnte nicht erstellt werden.',
  'ai.chatRestored': 'Chat wiederhergestellt.',
  'ai.chatRestoreFailed': 'Chat konnte nicht wiederhergestellt werden.',
  'ai.chatDeleted': 'Chatverlauf gelöscht.',
  'ai.chatDeleteFailed': 'Chatverlauf konnte nicht gelöscht werden.',
  'ai.tabClosed': 'Tab geschlossen.',
  'ai.keepOneTab': 'Mindestens ein Chat-Tab muss geöffnet bleiben.',
  'ai.historyFavoriteGroup': 'Favoriten',
  'ai.historyToday': 'Heute',
  'ai.historyYesterday': 'Gestern',
  'ai.historyDaysAgo': 'vor {count} Tagen',
  'ai.historyTitleUpdated': 'Verlaufstitel aktualisiert.',
  'ai.historyTitleUpdateFailed': 'Verlaufstitel wurde nicht aktualisiert.',
  'ai.historyFavorited': 'Chat zu Favoriten hinzugefügt.',
  'ai.historyUnfavorited': 'Chat aus Favoriten entfernt.',
  'ai.historyFavoriteUpdateFailed': 'Favorit konnte nicht aktualisiert werden.',
  'ai.searchChat': 'Chat suchen',
  'ai.exportChat': 'Chat exportieren',
  'ai.emptyNoModelTitle': 'Kein Modell verfügbar',
  'ai.configureModel': 'Modell konfigurieren',
  'ai.addContext': '@ Kontext hinzufügen',
  'ai.inputPlaceholder': 'Beschreiben Sie Ihr Betriebsziel'
}

const frFR: LocaleMessages = {
  ...enUS,
  'module.workspace': 'Espace de travail',
  'module.assets': 'Ressources',
  'module.files': 'Fichiers',
  'module.snippets': 'Commandes rapides',
  'module.knowledge': 'Base de connaissances',
  'module.extensions': 'Extensions',
  'module.database': 'Base de données',
  'module.settings': 'Paramètres',
  'module.user': 'Utilisateur',
  'common.settings': 'Paramètres',
  'settings.nav.general': 'Général',
  'settings.nav.terminal': 'Terminal',
  'settings.nav.extensions': 'Extensions',
  'settings.nav.models': 'Modèles',
  'settings.nav.billing': 'Facturation',
  'settings.nav.ai': 'Préférences IA',
  'settings.nav.rules': 'Règles',
  'settings.nav.shortcuts': 'Raccourcis',
  'settings.nav.trustedDevices': 'Appareils de confiance',
  'settings.nav.privacy': 'Confidentialité',
  'settings.nav.about': 'À propos',
  'settings.nav.docs': 'Documentation',
  'settings.general.base': 'Paramètres de base',
  'settings.general.theme': 'Thème',
  'settings.general.background': 'Arrière-plan',
  'settings.general.defaultLayout': 'Disposition par défaut',
  'settings.general.language': 'Langue',
  'settings.general.openOnboarding': 'Ouvrir l’accueil',
  'settings.general.editor': 'Paramètres de l’éditeur',
  'ai.newChat': 'Nouveau chat',
  'ai.moreActions': 'Plus',
  'ai.history': 'Historique',
  'ai.conversationTabs': 'Onglets de chat IA',
  'ai.closeTab': 'Fermer l’onglet',
  'ai.untitledChat': 'Chat sans titre',
  'ai.chatCreated': 'Nouveau chat créé.',
  'ai.chatCreateFailed': 'Échec de la création du chat.',
  'ai.chatRestored': 'Chat restauré.',
  'ai.chatRestoreFailed': 'Échec de la restauration du chat.',
  'ai.chatDeleted': 'Historique du chat supprimé.',
  'ai.chatDeleteFailed': 'Échec de la suppression du chat.',
  'ai.tabClosed': 'Onglet fermé.',
  'ai.keepOneTab': 'Gardez au moins un onglet de chat ouvert.',
  'ai.historyFavoriteGroup': 'Favoris',
  'ai.historyToday': 'Aujourd’hui',
  'ai.historyYesterday': 'Hier',
  'ai.historyDaysAgo': 'il y a {count} jours',
  'ai.historyTitleUpdated': 'Titre de l’historique mis à jour.',
  'ai.historyTitleUpdateFailed': 'Le titre de l’historique n’a pas été mis à jour.',
  'ai.historyFavorited': 'Chat ajouté aux favoris.',
  'ai.historyUnfavorited': 'Chat retiré des favoris.',
  'ai.historyFavoriteUpdateFailed': 'Échec de la mise à jour du favori.',
  'ai.searchChat': 'Rechercher dans le chat',
  'ai.exportChat': 'Exporter le chat',
  'ai.emptyNoModelTitle': 'Aucun modèle disponible',
  'ai.configureModel': 'Configurer le modèle',
  'ai.addContext': '@ Ajouter un contexte',
  'ai.inputPlaceholder': 'Décrivez votre objectif opérationnel'
}

const itIT: LocaleMessages = {
  ...enUS,
  'module.workspace': 'Area di lavoro',
  'module.assets': 'Risorse',
  'module.files': 'File',
  'module.snippets': 'Comandi rapidi',
  'module.knowledge': 'Conoscenza',
  'module.extensions': 'Estensioni',
  'module.database': 'Database',
  'module.settings': 'Impostazioni',
  'module.user': 'Utente',
  'common.settings': 'Impostazioni',
  'settings.nav.general': 'Generale',
  'settings.nav.terminal': 'Terminale',
  'settings.nav.extensions': 'Estensioni',
  'settings.nav.models': 'Modelli',
  'settings.nav.billing': 'Fatturazione',
  'settings.nav.ai': 'Preferenze AI',
  'settings.nav.rules': 'Regole',
  'settings.nav.shortcuts': 'Scorciatoie',
  'settings.nav.trustedDevices': 'Dispositivi attendibili',
  'settings.nav.privacy': 'Privacy',
  'settings.nav.about': 'Informazioni',
  'settings.nav.docs': 'Documenti',
  'settings.general.base': 'Impostazioni di base',
  'settings.general.theme': 'Tema',
  'settings.general.background': 'Sfondo',
  'settings.general.defaultLayout': 'Layout predefinito',
  'settings.general.language': 'Lingua',
  'settings.general.openOnboarding': 'Apri onboarding',
  'settings.general.editor': 'Impostazioni editor',
  'ai.newChat': 'Nuova chat',
  'ai.moreActions': 'Altro',
  'ai.history': 'Cronologia chat',
  'ai.conversationTabs': 'Schede chat AI',
  'ai.closeTab': 'Chiudi scheda',
  'ai.untitledChat': 'Chat senza titolo',
  'ai.chatCreated': 'Nuova chat creata.',
  'ai.chatCreateFailed': 'Creazione della chat non riuscita.',
  'ai.chatRestored': 'Chat ripristinata.',
  'ai.chatRestoreFailed': 'Ripristino della chat non riuscito.',
  'ai.chatDeleted': 'Cronologia chat eliminata.',
  'ai.chatDeleteFailed': 'Eliminazione della cronologia chat non riuscita.',
  'ai.tabClosed': 'Scheda chiusa.',
  'ai.keepOneTab': 'Mantieni aperta almeno una scheda chat.',
  'ai.historyFavoriteGroup': 'Preferiti',
  'ai.historyToday': 'Oggi',
  'ai.historyYesterday': 'Ieri',
  'ai.historyDaysAgo': '{count} giorni fa',
  'ai.historyTitleUpdated': 'Titolo della cronologia aggiornato.',
  'ai.historyTitleUpdateFailed': 'Titolo della cronologia non aggiornato.',
  'ai.historyFavorited': 'Chat aggiunta ai preferiti.',
  'ai.historyUnfavorited': 'Chat rimossa dai preferiti.',
  'ai.historyFavoriteUpdateFailed': 'Aggiornamento preferito non riuscito.',
  'ai.searchChat': 'Cerca nella chat',
  'ai.exportChat': 'Esporta chat',
  'ai.emptyNoModelTitle': 'Nessun modello disponibile',
  'ai.configureModel': 'Configura modello',
  'ai.addContext': '@ Aggiungi contesto',
  'ai.inputPlaceholder': 'Descrivi il tuo obiettivo operativo'
}

const ptPT: LocaleMessages = {
  ...enUS,
  'module.workspace': 'Área de trabalho',
  'module.assets': 'Ativos',
  'module.files': 'Ficheiros',
  'module.snippets': 'Comandos rápidos',
  'module.knowledge': 'Conhecimento',
  'module.extensions': 'Extensões',
  'module.database': 'Base de dados',
  'module.settings': 'Definições',
  'module.user': 'Utilizador',
  'common.settings': 'Definições',
  'settings.nav.general': 'Geral',
  'settings.nav.terminal': 'Terminal',
  'settings.nav.extensions': 'Extensões',
  'settings.nav.models': 'Modelos',
  'settings.nav.billing': 'Faturação',
  'settings.nav.ai': 'Preferências de IA',
  'settings.nav.rules': 'Regras',
  'settings.nav.shortcuts': 'Atalhos',
  'settings.nav.trustedDevices': 'Dispositivos fiáveis',
  'settings.nav.privacy': 'Privacidade',
  'settings.nav.about': 'Sobre',
  'settings.nav.docs': 'Documentação',
  'settings.general.base': 'Definições básicas',
  'settings.general.theme': 'Tema',
  'settings.general.background': 'Fundo',
  'settings.general.defaultLayout': 'Layout predefinido',
  'settings.general.language': 'Idioma',
  'settings.general.openOnboarding': 'Abrir integração',
  'settings.general.editor': 'Definições do editor',
  'ai.newChat': 'Nova conversa',
  'ai.moreActions': 'Mais',
  'ai.history': 'Histórico de conversas',
  'ai.conversationTabs': 'Separadores de conversa AI',
  'ai.closeTab': 'Fechar separador',
  'ai.untitledChat': 'Conversa sem título',
  'ai.chatCreated': 'Nova conversa criada.',
  'ai.chatCreateFailed': 'Falha ao criar conversa.',
  'ai.chatRestored': 'Conversa restaurada.',
  'ai.chatRestoreFailed': 'Falha ao restaurar conversa.',
  'ai.chatDeleted': 'Histórico de conversa eliminado.',
  'ai.chatDeleteFailed': 'Falha ao eliminar histórico de conversa.',
  'ai.tabClosed': 'Separador fechado.',
  'ai.keepOneTab': 'Mantenha pelo menos um separador de conversa aberto.',
  'ai.historyFavoriteGroup': 'Favoritos',
  'ai.historyToday': 'Hoje',
  'ai.historyYesterday': 'Ontem',
  'ai.historyDaysAgo': 'há {count} dias',
  'ai.historyTitleUpdated': 'Título do histórico atualizado.',
  'ai.historyTitleUpdateFailed': 'O título do histórico não foi atualizado.',
  'ai.historyFavorited': 'Conversa adicionada aos favoritos.',
  'ai.historyUnfavorited': 'Conversa removida dos favoritos.',
  'ai.historyFavoriteUpdateFailed': 'Falha ao atualizar favorito.',
  'ai.searchChat': 'Pesquisar conversa',
  'ai.exportChat': 'Exportar conversa',
  'ai.emptyNoModelTitle': 'Nenhum modelo disponível',
  'ai.configureModel': 'Configurar modelo',
  'ai.addContext': '@ Adicionar contexto',
  'ai.inputPlaceholder': 'Descreva o seu objetivo operacional'
}

const ruRU: LocaleMessages = {
  ...enUS,
  'module.workspace': 'Рабочая область',
  'module.assets': 'Ресурсы',
  'module.files': 'Файлы',
  'module.snippets': 'Быстрые команды',
  'module.knowledge': 'База знаний',
  'module.extensions': 'Расширения',
  'module.database': 'База данных',
  'module.settings': 'Настройки',
  'module.user': 'Пользователь',
  'common.settings': 'Настройки',
  'settings.nav.general': 'Общие',
  'settings.nav.terminal': 'Терминал',
  'settings.nav.extensions': 'Расширения',
  'settings.nav.models': 'Модели',
  'settings.nav.billing': 'Биллинг',
  'settings.nav.ai': 'Настройки AI',
  'settings.nav.rules': 'Правила',
  'settings.nav.shortcuts': 'Горячие клавиши',
  'settings.nav.trustedDevices': 'Доверенные устройства',
  'settings.nav.privacy': 'Конфиденциальность',
  'settings.nav.about': 'О программе',
  'settings.nav.docs': 'Документация',
  'settings.general.base': 'Основные настройки',
  'settings.general.theme': 'Тема',
  'settings.general.background': 'Фон',
  'settings.general.defaultLayout': 'Макет по умолчанию',
  'settings.general.language': 'Язык',
  'settings.general.openOnboarding': 'Открыть обучение',
  'settings.general.editor': 'Настройки редактора',
  'ai.newChat': 'Новый чат',
  'ai.moreActions': 'Еще',
  'ai.history': 'История чата',
  'ai.conversationTabs': 'Вкладки чата AI',
  'ai.closeTab': 'Закрыть вкладку',
  'ai.untitledChat': 'Чат без названия',
  'ai.chatCreated': 'Новый чат создан.',
  'ai.chatCreateFailed': 'Не удалось создать чат.',
  'ai.chatRestored': 'Чат восстановлен.',
  'ai.chatRestoreFailed': 'Не удалось восстановить чат.',
  'ai.chatDeleted': 'История чата удалена.',
  'ai.chatDeleteFailed': 'Не удалось удалить историю чата.',
  'ai.tabClosed': 'Вкладка закрыта.',
  'ai.keepOneTab': 'Оставьте открытой хотя бы одну вкладку чата.',
  'ai.historyFavoriteGroup': 'Избранное',
  'ai.historyToday': 'Сегодня',
  'ai.historyYesterday': 'Вчера',
  'ai.historyDaysAgo': '{count} дн. назад',
  'ai.historyTitleUpdated': 'Название истории обновлено.',
  'ai.historyTitleUpdateFailed': 'Название истории не обновлено.',
  'ai.historyFavorited': 'Чат добавлен в избранное.',
  'ai.historyUnfavorited': 'Чат удалён из избранного.',
  'ai.historyFavoriteUpdateFailed': 'Не удалось обновить избранное.',
  'ai.searchChat': 'Поиск в чате',
  'ai.exportChat': 'Экспорт чата',
  'ai.emptyNoModelTitle': 'Нет доступной модели',
  'ai.configureModel': 'Настроить модель',
  'ai.addContext': '@ Добавить контекст',
  'ai.inputPlaceholder': 'Опишите вашу операционную цель'
}

const arAR: LocaleMessages = {
  ...enUS,
  'common.settings': 'الإعدادات',
  'common.search': 'بحث',
  'common.save': 'حفظ',
  'common.close': 'إغلاق',
  'common.login': 'تسجيل الدخول',
  'module.workspace': 'مساحة العمل',
  'module.assets': 'الأصول',
  'module.files': 'الملفات',
  'module.snippets': 'الأوامر السريعة',
  'module.knowledge': 'المعرفة',
  'module.extensions': 'الإضافات',
  'module.database': 'قاعدة البيانات',
  'module.settings': 'الإعدادات',
  'module.user': 'المستخدم',
  'settings.nav.general': 'عام',
  'settings.nav.terminal': 'الطرفية',
  'settings.nav.extensions': 'الإضافات',
  'settings.nav.models': 'النماذج',
  'settings.nav.billing': 'الفوترة',
  'settings.nav.ai': 'تفضيلات AI',
  'settings.nav.rules': 'القواعد',
  'settings.nav.shortcuts': 'الاختصارات',
  'settings.nav.trustedDevices': 'الأجهزة الموثوقة',
  'settings.nav.privacy': 'الخصوصية',
  'settings.nav.about': 'حول',
  'settings.nav.docs': 'الوثائق',
  'settings.general.base': 'الإعدادات الأساسية',
  'settings.general.theme': 'السمة',
  'settings.general.background': 'الخلفية',
  'settings.general.defaultLayout': 'التخطيط الافتراضي',
  'settings.general.language': 'اللغة',
  'settings.general.openOnboarding': 'فتح الإرشاد',
  'settings.general.editor': 'إعدادات المحرر',
  'ai.newChat': 'محادثة جديدة',
  'ai.moreActions': 'المزيد',
  'ai.history': 'سجل المحادثات',
  'ai.conversationTabs': 'تبويبات محادثة AI',
  'ai.closeTab': 'إغلاق التبويب',
  'ai.untitledChat': 'محادثة بلا عنوان',
  'ai.chatCreated': 'تم إنشاء محادثة جديدة.',
  'ai.chatCreateFailed': 'تعذر إنشاء المحادثة.',
  'ai.chatRestored': 'تمت استعادة المحادثة.',
  'ai.chatRestoreFailed': 'تعذرت استعادة المحادثة.',
  'ai.chatDeleted': 'تم حذف سجل المحادثة.',
  'ai.chatDeleteFailed': 'تعذر حذف سجل المحادثة.',
  'ai.tabClosed': 'تم إغلاق التبويب.',
  'ai.keepOneTab': 'احتفظ بتبويب محادثة واحد على الأقل مفتوحا.',
  'ai.historyFavoriteGroup': 'المفضلة',
  'ai.historyToday': 'اليوم',
  'ai.historyYesterday': 'أمس',
  'ai.historyDaysAgo': 'منذ {count} أيام',
  'ai.historyTitleUpdated': 'تم تحديث عنوان السجل.',
  'ai.historyTitleUpdateFailed': 'لم يتم تحديث عنوان السجل.',
  'ai.historyFavorited': 'تمت إضافة المحادثة إلى المفضلة.',
  'ai.historyUnfavorited': 'تمت إزالة المحادثة من المفضلة.',
  'ai.historyFavoriteUpdateFailed': 'تعذر تحديث المفضلة.',
  'ai.searchChat': 'بحث في المحادثة',
  'ai.exportChat': 'تصدير المحادثة',
  'ai.emptyNoModelTitle': 'لا يوجد نموذج متاح',
  'ai.configureModel': 'إعداد النموذج',
  'ai.addContext': '@ إضافة سياق',
  'ai.inputPlaceholder': 'صف هدف التشغيل لديك'
}

export const localeMessages: Record<SupportedLocale, LocaleMessages> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'de-DE': deDE,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-PT': ptPT,
  'ru-RU': ruRU,
  'ar-AR': arAR
}
