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
  | 'common.add'
  | 'common.all'
  | 'common.cancel'
  | 'common.close'
  | 'common.configure'
  | 'common.copy'
  | 'common.delete'
  | 'common.export'
  | 'common.install'
  | 'common.login'
  | 'common.new'
  | 'common.open'
  | 'common.processing'
  | 'common.refresh'
  | 'common.refreshing'
  | 'common.reinstall'
  | 'common.uninstall'
  | 'common.save'
  | 'common.search'
  | 'common.settings'
  | 'common.submit'
  | 'common.system'
  | 'common.unknown'
  | 'module.workspace'
  | 'module.aiSessions'
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
  | 'settings.help.open'
  | 'settings.help.back'
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
  | 'settings.general.editorScope'
  | 'settings.general.fontSize'
  | 'settings.general.lineHeight'
  | 'settings.general.font'
  | 'settings.terminal.title'
  | 'settings.terminal.description'
  | 'settings.terminal.terminalType'
  | 'settings.terminal.font'
  | 'settings.terminal.fontSize'
  | 'settings.terminal.scrollBack'
  | 'settings.terminal.cursorStyle'
  | 'settings.terminal.cursorBlock'
  | 'settings.terminal.cursorBar'
  | 'settings.terminal.cursorUnderline'
  | 'settings.terminal.cursorBlink'
  | 'settings.terminal.lineHeight'
  | 'settings.terminal.pinchZoom'
  | 'settings.terminal.showCloseButton'
  | 'settings.terminal.sshAgents'
  | 'settings.terminal.sshAgentSettings'
  | 'settings.terminal.mouseEvents'
  | 'settings.terminal.middleMouse'
  | 'settings.terminal.rightMouse'
  | 'settings.terminal.mouseNone'
  | 'settings.terminal.mousePaste'
  | 'settings.terminal.mouseContextMenu'
  | 'settings.terminal.mouseCloseTab'
  | 'settings.terminal.sshAgentTitle'
  | 'settings.terminal.sshAgentFingerprint'
  | 'settings.terminal.sshAgentComment'
  | 'settings.terminal.sshAgentType'
  | 'settings.terminal.sshAgentAction'
  | 'settings.terminal.sshAgentEmpty'
  | 'settings.terminal.sshAgentKey'
  | 'settings.terminal.sshAgentSelectKey'
  | 'settings.terminal.saveUnavailable'
  | 'settings.terminal.saveFailed'
  | 'settings.terminal.saved'
  | 'settings.ai.title'
  | 'settings.ai.agentHookInstaller'
  | 'settings.ai.hibernation'
  | 'settings.ai.notifications'
  | 'settings.ai.automationDeveloper'
  | 'settings.ai.general'
  | 'settings.ai.features'
  | 'settings.ai.modelProxy'
  | 'settings.ai.terminal'
  | 'settings.ai.extendedThinking'
  | 'settings.ai.thinkingBudgetDescription'
  | 'settings.ai.autoExecuteReadOnly'
  | 'settings.ai.autoExecuteReadOnlyDescription'
  | 'settings.ai.commandOutputFiltering'
  | 'settings.ai.commandOutputFilteringDescription'
  | 'settings.ai.kbSearch'
  | 'settings.ai.kbSearchDescription'
  | 'settings.ai.experienceExtraction'
  | 'settings.ai.experienceExtractionDescription'
  | 'settings.ai.managedAiAutoNaming'
  | 'settings.ai.managedAiAutoNamingDescription'
  | 'settings.ai.autoApproval'
  | 'settings.ai.autoApprovalDescription'
  | 'settings.ai.securityConfig'
  | 'settings.ai.openSecurityConfig'
  | 'settings.ai.reasoningLow'
  | 'settings.ai.reasoningMedium'
  | 'settings.ai.reasoningHigh'
  | 'settings.ai.enableProxy'
  | 'settings.ai.proxyType'
  | 'settings.ai.enableProxyIdentity'
  | 'settings.ai.shellIntegrationTimeout'
  | 'settings.ai.shellIntegrationTimeoutDescription'
  | 'settings.ai.agentHook.statusNotLoaded'
  | 'settings.ai.agentHook.installed'
  | 'settings.ai.agentHook.configError'
  | 'settings.ai.agentHook.ready'
  | 'settings.ai.agentHook.cliMissing'
  | 'settings.ai.agentHook.detectedMissing'
  | 'settings.ai.agentHook.launchCommand'
  | 'settings.ai.agentHook.description'
  | 'settings.ai.agentHook.config'
  | 'settings.ai.agentHook.extraConfig'
  | 'settings.ai.agentHook.helper'
  | 'settings.ai.agentHook.title'
  | 'settings.ai.agentHook.subtitle'
  | 'settings.ai.agentHook.serviceUnavailable'
  | 'settings.ai.agentHook.statusLoadFailed'
  | 'settings.ai.agentHook.statusRefreshed'
  | 'settings.ai.agentHook.installFailed'
  | 'settings.ai.agentHook.uninstallFailed'
  | 'settings.ai.agentHook.installMalformed'
  | 'settings.ai.agentHook.uninstallMalformed'
  | 'settings.ai.agentHook.installedNotice'
  | 'settings.ai.agentHook.uninstalledNotice'
  | 'settings.ai.hibernation.enable'
  | 'settings.ai.hibernation.description'
  | 'settings.ai.hibernation.idleSeconds'
  | 'settings.ai.hibernation.idleDescription'
  | 'settings.ai.hibernation.maxLiveTerminals'
  | 'settings.ai.hibernation.maxLiveDescription'
  | 'settings.ai.hibernation.confirmationSeconds'
  | 'settings.ai.hibernation.confirmationDescription'
  | 'settings.ai.hibernation.loadFailed'
  | 'settings.ai.hibernation.serviceUnavailable'
  | 'settings.ai.hibernation.saveFailed'
  | 'settings.ai.hibernation.saved'
  | 'settings.ai.hibernation.enabledNotice'
  | 'settings.ai.hibernation.disabledNotice'
  | 'settings.ai.notification.desktop'
  | 'settings.ai.notification.desktopDescription'
  | 'settings.ai.notification.controlBell'
  | 'settings.ai.notification.controlBellDescription'
  | 'settings.ai.automation.description'
  | 'settings.ai.automation.controlSocketDescription'
  | 'settings.ai.automation.cliHelperDescription'
  | 'settings.ai.automation.externalCodexMcpDescription'
  | 'settings.ai.automation.externalCodexMcpTokenDescription'
  | 'settings.ai.automation.externalCodexMcpSocketDescription'
  | 'settings.ai.automation.copySnippet'
  | 'settings.ai.automation.controlProtocolDocs'
  | 'settings.ai.automation.externalCodexMcpDocs'
  | 'agents.searchConversations'
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
  | 'top.aiAttentionOpen'
  | 'top.aiAttentionPending'
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
  | 'ai.codexTargetUnbound'
  | 'ai.codexTargetDropHint'
  | 'ai.codexTargetBind'
  | 'ai.codexTargetLocate'
  | 'ai.codexTargetChange'
  | 'ai.codexTargetUnbind'
  | 'ai.codexTargetSearch'
  | 'ai.codexTargetUseCurrent'
  | 'ai.codexTargetMissing'
  | 'ai.codexTargetClosed'
  | 'ai.codexTargetOpenFailed'
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
  | 'aiSessions.eyebrow'
  | 'aiSessions.openSettings'
  | 'aiSessions.refresh'
  | 'aiSessions.searchPlaceholder'
  | 'aiSessions.agent'
  | 'aiSessions.project'
  | 'aiSessions.pendingCount'
  | 'aiSessions.currentCount'
  | 'aiSessions.pendingScopedCount'
  | 'aiSessions.nextPending'
  | 'aiSessions.copyQueueSummary'
  | 'aiSessions.handleFilteredPending'
  | 'aiSessions.markAllHandled'
  | 'aiSessions.clearEnded'
  | 'aiSessions.markHandled'
  | 'aiSessions.emptyTitle'
  | 'aiSessions.emptyDescription'
  | 'aiSessions.restorable'
  | 'aiSessions.hibernated'
  | 'aiSessions.resume'
  | 'aiSessions.locateTerminal'
  | 'aiSessions.meta.path'
  | 'aiSessions.meta.session'
  | 'aiSessions.meta.agentLifecycle'
  | 'aiSessions.meta.requestKind'
  | 'aiSessions.meta.decisionMode'
  | 'aiSessions.meta.waitTimeout'
  | 'aiSessions.meta.tool'
  | 'aiSessions.meta.agentPid'
  | 'aiSessions.meta.parentProcess'
  | 'aiSessions.meta.processGroup'
  | 'aiSessions.meta.terminalPid'
  | 'aiSessions.meta.terminalActivity'
  | 'aiSessions.meta.transcript'
  | 'aiSessions.meta.launchCommand'
  | 'aiSessions.meta.resumeCommand'
  | 'aiSessions.action.submitReply'
  | 'aiSessions.action.allow'
  | 'aiSessions.action.alwaysAllow'
  | 'aiSessions.action.bypassSession'
  | 'aiSessions.action.deny'
  | 'aiSessions.action.handled'
  | 'aiSessions.replyQuestionPlaceholder'
  | 'aiSessions.replyOptionalPlaceholder'
  | 'aiSessions.timeline'
  | 'aiSessions.copyEvent'
  | 'aiSessions.decisions'
  | 'aiSessions.clearSession'
  | 'aiSessions.filter.all'
  | 'aiSessions.filter.needsInput'
  | 'aiSessions.filter.working'
  | 'aiSessions.filter.idle'
  | 'aiSessions.filter.ended'
  | 'aiSessions.filter.hibernated'
  | 'aiSessions.cockpit.total'
  | 'aiSessions.state.unknown'
  | 'aiSessions.eventFilter.permission'
  | 'aiSessions.eventFilter.question'
  | 'aiSessions.eventFilter.plan'
  | 'aiSessions.eventFilter.notification'
  | 'aiSessions.eventFilter.telemetry'
  | 'aiSessions.request.permission'
  | 'aiSessions.request.question'
  | 'aiSessions.request.plan'
  | 'aiSessions.request.notification'
  | 'aiSessions.request.telemetry'
  | 'aiSessions.decision.blocking'
  | 'aiSessions.decision.local'
  | 'aiSessions.decision.telemetry'
  | 'aiSessions.event.sessionStart'
  | 'aiSessions.event.promptSubmit'
  | 'aiSessions.event.toolUse'
  | 'aiSessions.event.permissionRequest'
  | 'aiSessions.event.question'
  | 'aiSessions.event.notification'
  | 'aiSessions.event.lifecycle'
  | 'aiSessions.event.stop'
  | 'aiSessions.event.sessionEnd'
  | 'aiSessions.decision.allow'
  | 'aiSessions.decision.always'
  | 'aiSessions.decision.bypass'
  | 'aiSessions.decision.deny'
  | 'aiSessions.decision.reply'
  | 'aiSessions.decision.handled'
  | 'aiSessions.unknownPath'
  | 'aiSessions.scopeAll'
  | 'aiSessions.scopeSearch'
  | 'aiSessions.eventCopied'
  | 'aiSessions.eventCopyFailed'
  | 'aiSessions.queueHeader'
  | 'aiSessions.queueCounts'
  | 'aiSessions.queueCopied'
  | 'aiSessions.queueCopyFailed'
  | 'aiSessions.visibleHandled'
  | 'aiSessions.copy.agent'
  | 'aiSessions.copy.status'
  | 'aiSessions.copy.session'
  | 'aiSessions.copy.path'
  | 'aiSessions.copy.summary'
  | 'aiSessions.copy.resume'
  | 'aiSessions.relative.secondsAgo'
  | 'aiSessions.relative.minutesAgo'
  | 'aiSessions.relative.hoursAgo'
  | 'aiSessions.relative.daysAgo'
  | 'aiSessions.notice.serviceUnavailable'
  | 'aiSessions.notice.listFailed'
  | 'aiSessions.notice.refreshed'
  | 'aiSessions.notice.processFailed'
  | 'aiSessions.notice.allowed'
  | 'aiSessions.notice.alwaysAllowed'
  | 'aiSessions.notice.bypassAllowed'
  | 'aiSessions.notice.denied'
  | 'aiSessions.notice.replied'
  | 'aiSessions.notice.handled'
  | 'aiSessions.notice.renameFailed'
  | 'aiSessions.notice.renamed'
  | 'aiSessions.notice.clearFailed'
  | 'aiSessions.notice.cleared'
  | 'aiSessions.notice.bulkFailed'
  | 'aiSessions.notice.missing'
  | 'aiSessions.notice.hibernationDisabled'
  | 'aiSessions.notice.cannotHibernateNeedsInput'
  | 'aiSessions.notice.noResumeCommand'
  | 'aiSessions.notice.hibernateFailed'
  | 'aiSessions.notice.hibernated'
  | 'aiSessions.notice.resumeNeedsTerminal'
  | 'aiSessions.notice.resumeCommandWritten'
  | 'aiSessions.notice.resumeCommandNeedsApproval'
  | 'aiSessions.notice.noPendingMessages'
  | 'aiSessions.notice.openedSettings'
  | 'terminal.status.editor'
  | 'terminal.status.connecting'
  | 'terminal.status.error'
  | 'terminal.status.closed'
  | 'terminal.status.connected'
  | 'terminal.kind.editor'
  | 'terminal.kind.local'
  | 'terminal.kind.localTerminal'
  | 'terminal.tab.type'
  | 'terminal.tab.status'
  | 'terminal.tab.host'
  | 'terminal.tab.path'
  | 'terminal.tab.file'
  | 'terminal.tab.session'
  | 'terminal.tab.localTarget'
  | 'terminal.context.locatePendingAi'
  | 'terminal.context.openAiSessions'
  | 'terminal.context.refreshAiSessions'
  | 'terminal.context.focusTerminal'
  | 'terminal.context.copyContext'
  | 'terminal.context.copyContextButton'
  | 'terminal.context.aiSessions'
  | 'terminal.context.refresh'
  | 'terminal.context.focus'
  | 'terminal.context.refreshFailed'
  | 'terminal.context.copied'
  | 'terminal.context.copyFailed'
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
  'common.add': '添加',
  'common.all': '全部',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.configure': '配置',
  'common.copy': '复制',
  'common.delete': '删除',
  'common.export': '导出',
  'common.install': '安装',
  'common.login': '登录',
  'common.new': '新建',
  'common.open': '打开',
  'common.processing': '处理中',
  'common.refresh': '刷新',
  'common.refreshing': '刷新中',
  'common.reinstall': '重新安装',
  'common.uninstall': '卸载',
  'common.save': '保存',
  'common.search': '搜索',
  'common.settings': '设置',
  'common.submit': '提交',
  'common.system': '系统',
  'common.unknown': '未知',
  'module.workspace': '工作区',
  'module.aiSessions': 'AI 会话',
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
  'settings.help.open': '打开本页帮助文档',
  'settings.help.back': '返回设置',
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
  'settings.general.editorScope': '这些设置会应用到文件、知识库、SQL 和设置 JSON 等代码编辑器；终端字体请在“终端设置”中调整，AI 输入框不受影响。',
  'settings.general.fontSize': '字体大小',
  'settings.general.lineHeight': '行高',
  'settings.general.font': '字体',
  'settings.terminal.title': '终端设置',
  'settings.terminal.description': '终端类型主要影响 TERM 和程序能力探测，通常不会直接改变外观。字体只有系统已安装或能匹配到对应字体时才会明显变化。',
  'settings.terminal.terminalType': '终端类型',
  'settings.terminal.font': '字体',
  'settings.terminal.fontSize': '字体大小',
  'settings.terminal.scrollBack': 'ScrollBack',
  'settings.terminal.cursorStyle': '光标样式',
  'settings.terminal.cursorBlock': '块状光标',
  'settings.terminal.cursorBar': '竖线光标',
  'settings.terminal.cursorUnderline': '下划线光标',
  'settings.terminal.cursorBlink': '光标闪烁',
  'settings.terminal.lineHeight': '行高',
  'settings.terminal.pinchZoom': 'Pinch Zoom',
  'settings.terminal.showCloseButton': '显示关闭按钮',
  'settings.terminal.sshAgents': 'SSH Agents',
  'settings.terminal.sshAgentSettings': 'SSH Agent 设置',
  'settings.terminal.mouseEvents': '鼠标事件',
  'settings.terminal.middleMouse': '中键:',
  'settings.terminal.rightMouse': '右键:',
  'settings.terminal.mouseNone': '无',
  'settings.terminal.mousePaste': '粘贴剪贴板',
  'settings.terminal.mouseContextMenu': '显示右键菜单',
  'settings.terminal.mouseCloseTab': '关闭当前标签',
  'settings.terminal.sshAgentTitle': 'SSH Agent 设置',
  'settings.terminal.sshAgentFingerprint': '指纹',
  'settings.terminal.sshAgentComment': '备注',
  'settings.terminal.sshAgentType': '类型',
  'settings.terminal.sshAgentAction': '操作',
  'settings.terminal.sshAgentEmpty': '暂无密钥添加',
  'settings.terminal.sshAgentKey': '密钥',
  'settings.terminal.sshAgentSelectKey': '请选择密钥',
  'settings.terminal.saveUnavailable': '终端设置保存服务不可用',
  'settings.terminal.saveFailed': '终端设置保存失败',
  'settings.terminal.saved': '终端设置已保存',
  'settings.ai.title': 'AI 偏好设置',
  'settings.ai.agentHookInstaller': 'Agent Hook 安装器',
  'settings.ai.hibernation': 'AI 会话休眠',
  'settings.ai.notifications': '通知',
  'settings.ai.automationDeveloper': '自动化与开发者',
  'settings.ai.general': '通用',
  'settings.ai.features': '功能',
  'settings.ai.modelProxy': 'AI 模型代理',
  'settings.ai.terminal': '终端',
  'settings.ai.extendedThinking': '启用 Extended Thinking',
  'settings.ai.thinkingBudgetDescription': '影响 AI 对话请求的输出 token 预算，并写入对话系统约束。',
  'settings.ai.autoExecuteReadOnly': '自动执行只读命令',
  'settings.ai.autoExecuteReadOnlyDescription': '只读命令可在确认范围内自动执行。',
  'settings.ai.commandOutputFiltering': '命令输出过滤',
  'settings.ai.commandOutputFilteringDescription': 'Agent 回传长命令输出时压缩中间部分，界面仍保留完整输出。',
  'settings.ai.kbSearch': '知识库搜索',
  'settings.ai.kbSearchDescription': '发送普通 AI 对话时自动检索并附加相关知识库文档。',
  'settings.ai.experienceExtraction': '经验抽取',
  'settings.ai.experienceExtractionDescription': '影响 AI 回答中是否提炼可复用运维经验。',
  'settings.ai.managedAiAutoNaming': 'AI 会话自动命名',
  'settings.ai.managedAiAutoNamingDescription': 'Agent 回合结束后用当前模型总结 2-5 个词的会话标题；手动标题不会被覆盖。',
  'settings.ai.autoApproval': '自动批准',
  'settings.ai.autoApprovalDescription': '只允许低风险只读动作自动通过，不绕过高风险命令审批。',
  'settings.ai.securityConfig': '安全配置',
  'settings.ai.openSecurityConfig': '打开安全配置',
  'settings.ai.reasoningLow': '低',
  'settings.ai.reasoningMedium': '中',
  'settings.ai.reasoningHigh': '高',
  'settings.ai.enableProxy': '启用代理',
  'settings.ai.proxyType': '代理类型',
  'settings.ai.enableProxyIdentity': '启用代理身份',
  'settings.ai.shellIntegrationTimeout': 'Shell Integration Timeout',
  'settings.ai.shellIntegrationTimeoutDescription': 'Agent 等待终端命令输出的默认超时时间，单位为秒。',
  'settings.ai.agentHook.statusNotLoaded': '状态未加载',
  'settings.ai.agentHook.installed': '已安装',
  'settings.ai.agentHook.configError': '配置异常',
  'settings.ai.agentHook.ready': '可安装',
  'settings.ai.agentHook.cliMissing': '未检测到 CLI',
  'settings.ai.agentHook.detectedMissing': '未检测到',
  'settings.ai.agentHook.launchCommand': '启动命令',
  'settings.ai.agentHook.description': '安装后，只会捕获通过 aiopsterm 本地连接终端启动的会话；外部系统终端会自动空返回，不接管审批。',
  'settings.ai.agentHook.config': 'Hook 配置',
  'settings.ai.agentHook.extraConfig': '附加配置',
  'settings.ai.agentHook.helper': 'Hook Helper',
  'settings.ai.agentHook.title': 'Codex / Claude Code 会话管理 Hook',
  'settings.ai.agentHook.subtitle': '显式写入用户级 Hook 配置，用于让 AI 会话面板发现并定位需要处理的本地连接会话。',
  'settings.ai.agentHook.serviceUnavailable': 'Agent Hook 安装器服务不可用',
  'settings.ai.agentHook.statusLoadFailed': 'Agent Hook 安装器状态加载失败',
  'settings.ai.agentHook.statusRefreshed': 'Agent Hook 状态已刷新',
  'settings.ai.agentHook.installFailed': 'Agent Hook 安装失败',
  'settings.ai.agentHook.uninstallFailed': 'Agent Hook 卸载失败',
  'settings.ai.agentHook.installMalformed': 'Agent Hook 安装结果异常',
  'settings.ai.agentHook.uninstallMalformed': 'Agent Hook 卸载结果异常',
  'settings.ai.agentHook.installedNotice': '{label} Agent Hook 已安装',
  'settings.ai.agentHook.uninstalledNotice': '{label} Agent Hook 已卸载',
  'settings.ai.hibernation.enable': '启用 Agent Hibernation',
  'settings.ai.hibernation.description': '后台 AI 会话超过空闲阈值且超过最大活跃终端数时，允许先提示再休眠对应终端，保留可恢复会话记录。',
  'settings.ai.hibernation.idleSeconds': '空闲时间（秒）',
  'settings.ai.hibernation.idleDescription': '只有超过该时间没有终端活动的可恢复 AI 会话才会成为休眠候选。',
  'settings.ai.hibernation.maxLiveTerminals': '最大活跃终端数',
  'settings.ai.hibernation.maxLiveDescription': '活跃可恢复 AI 终端数量超过该值后，才会从后台最旧的候选开始休眠。',
  'settings.ai.hibernation.confirmationSeconds': '确认倒计时（秒）',
  'settings.ai.hibernation.confirmationDescription': '设置为 0 时不显示倒计时确认，符合条件后直接休眠后台候选。',
  'settings.ai.hibernation.loadFailed': 'Agent Hibernation 配置加载失败',
  'settings.ai.hibernation.serviceUnavailable': 'Agent Hibernation 服务不可用',
  'settings.ai.hibernation.saveFailed': 'Agent Hibernation 配置保存失败',
  'settings.ai.hibernation.saved': 'Agent Hibernation 配置已保存',
  'settings.ai.hibernation.enabledNotice': 'Agent Hibernation 已开启',
  'settings.ai.hibernation.disabledNotice': 'Agent Hibernation 已关闭',
  'settings.ai.notification.desktop': '桌面通知',
  'settings.ai.notification.desktopDescription': '控制外部通知协议和 AI 会话事件触发的系统桌面通知。关闭后应用内通知列表仍会保留。',
  'settings.ai.notification.controlBell': '顶部铃铛提醒控制通知',
  'settings.ai.notification.controlBellDescription': '控制外部通知协议产生的未读通知是否进入顶部铃铛队列；AI 会话审批、问题和待处理提醒始终保留。',
  'settings.ai.automation.description': '这些入口用于脚本、CLI、外部 Codex MCP 和本地连接终端自动化；能否生效取决于运行时环境变量和是否从 aiopsterm 本地连接终端启动。',
  'settings.ai.automation.controlSocketDescription': 'aiopsterm 本地连接终端会注入该变量，外部脚本通过它调用控制协议。',
  'settings.ai.automation.cliHelperDescription': '在带 Control Socket 环境的终端中使用，用于通知、会话和自动化控制。',
  'settings.ai.automation.externalCodexMcpDescription': '给外部 Codex 使用的 MCP 桥接服务，当前通过环境变量启用，修改后需要重启 aiopsterm。',
  'settings.ai.automation.externalCodexMcpTokenDescription': '可选访问令牌；设置后外部 Codex MCP 客户端需要携带同一个 token。',
  'settings.ai.automation.externalCodexMcpSocketDescription': '可选 socket 路径；未设置时使用应用数据目录下的默认路径。',
  'settings.ai.automation.copySnippet': '复制 {label}',
  'settings.ai.automation.controlProtocolDocs': '控制协议文档',
  'settings.ai.automation.externalCodexMcpDocs': '外部 Codex MCP 文档',
  'agents.searchConversations': '搜索会话',
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
  'top.aiAttentionOpen': 'AI 会话管理',
  'top.aiAttentionPending': 'AI 有 {count} 条未处理消息：{title}',
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
  'ai.codexTargetUnbound': '未绑定终端',
  'ai.codexTargetDropHint': '拖拽主机或终端标签到这里，或搜索主机绑定',
  'ai.codexTargetBind': '绑定主机/终端',
  'ai.codexTargetLocate': '定位绑定终端',
  'ai.codexTargetChange': '更换绑定目标',
  'ai.codexTargetUnbind': '解除绑定',
  'ai.codexTargetSearch': '搜索主机',
  'ai.codexTargetUseCurrent': '绑定当前终端',
  'ai.codexTargetMissing': '请先绑定一个已连接的终端。',
  'ai.codexTargetClosed': '绑定终端已关闭，请重新绑定或重新连接。',
  'ai.codexTargetOpenFailed': '主机终端打开失败，未完成绑定。',
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
  'aiSessions.eyebrow': 'AI Sessions',
  'aiSessions.openSettings': '打开 AI 设置',
  'aiSessions.refresh': '刷新 AI 会话',
  'aiSessions.searchPlaceholder': '搜索会话',
  'aiSessions.agent': 'Agent',
  'aiSessions.project': '项目',
  'aiSessions.pendingCount': '{count} 个待处理',
  'aiSessions.currentCount': '{count} 个当前会话',
  'aiSessions.pendingScopedCount': '{count} 个待处理 · {scope}',
  'aiSessions.nextPending': '定位下一条待处理',
  'aiSessions.copyQueueSummary': '复制当前队列摘要',
  'aiSessions.handleFilteredPending': '处理当前筛选的待处理项',
  'aiSessions.markAllHandled': '全部已处理',
  'aiSessions.clearEnded': '清理已结束',
  'aiSessions.markHandled': '标记已处理',
  'aiSessions.emptyTitle': '暂无 AI 会话',
  'aiSessions.emptyDescription': '安装并启用 Agent Hook 后，通过 aiopsterm 本地连接启动的 Codex / Claude Code / Cursor / Gemini 等会显示在这里。',
  'aiSessions.restorable': '可恢复',
  'aiSessions.hibernated': '已休眠',
  'aiSessions.resume': '恢复会话',
  'aiSessions.locateTerminal': '定位终端',
  'aiSessions.meta.path': '路径',
  'aiSessions.meta.session': '会话',
  'aiSessions.meta.agentLifecycle': 'Agent 状态',
  'aiSessions.meta.requestKind': '请求类型',
  'aiSessions.meta.decisionMode': '处理模式',
  'aiSessions.meta.waitTimeout': '等待超时',
  'aiSessions.meta.tool': '工具',
  'aiSessions.meta.agentPid': 'Agent PID',
  'aiSessions.meta.parentProcess': '父进程',
  'aiSessions.meta.processGroup': '进程组',
  'aiSessions.meta.terminalPid': '终端 PID',
  'aiSessions.meta.terminalActivity': '终端活动',
  'aiSessions.meta.transcript': '记录',
  'aiSessions.meta.launchCommand': '启动命令',
  'aiSessions.meta.resumeCommand': '恢复命令',
  'aiSessions.action.submitReply': '提交回答',
  'aiSessions.action.allow': '允许',
  'aiSessions.action.alwaysAllow': '持续允许',
  'aiSessions.action.bypassSession': '本会话绕过',
  'aiSessions.action.deny': '拒绝',
  'aiSessions.action.handled': '已处理',
  'aiSessions.replyQuestionPlaceholder': '输入要回复给 AI 的答案',
  'aiSessions.replyOptionalPlaceholder': '可选：拒绝原因或处理说明',
  'aiSessions.timeline': '事件流',
  'aiSessions.copyEvent': '复制事件',
  'aiSessions.decisions': '处理记录',
  'aiSessions.clearSession': '清理此会话',
  'aiSessions.filter.all': '全部',
  'aiSessions.filter.needsInput': '待处理',
  'aiSessions.filter.working': '运行中',
  'aiSessions.filter.idle': '空闲',
  'aiSessions.filter.ended': '已结束',
  'aiSessions.filter.hibernated': '已休眠',
  'aiSessions.cockpit.total': '总会话',
  'aiSessions.state.unknown': '未知',
  'aiSessions.eventFilter.permission': '权限',
  'aiSessions.eventFilter.question': '提问',
  'aiSessions.eventFilter.plan': '计划',
  'aiSessions.eventFilter.notification': '通知',
  'aiSessions.eventFilter.telemetry': '遥测',
  'aiSessions.request.permission': '权限审批',
  'aiSessions.request.question': '用户提问',
  'aiSessions.request.plan': '计划确认',
  'aiSessions.request.notification': '通知',
  'aiSessions.request.telemetry': '遥测',
  'aiSessions.decision.blocking': '等待响应',
  'aiSessions.decision.local': '本地处理',
  'aiSessions.decision.telemetry': '仅记录',
  'aiSessions.event.sessionStart': '会话开始',
  'aiSessions.event.promptSubmit': '提交提示',
  'aiSessions.event.toolUse': '工具调用',
  'aiSessions.event.permissionRequest': '权限请求',
  'aiSessions.event.question': '提问',
  'aiSessions.event.notification': '通知',
  'aiSessions.event.lifecycle': '生命周期',
  'aiSessions.event.stop': '轮次结束',
  'aiSessions.event.sessionEnd': '会话结束',
  'aiSessions.decision.allow': '允许',
  'aiSessions.decision.always': '持续允许',
  'aiSessions.decision.bypass': '本会话绕过',
  'aiSessions.decision.deny': '拒绝',
  'aiSessions.decision.reply': '回复',
  'aiSessions.decision.handled': '已处理',
  'aiSessions.unknownPath': '未知路径',
  'aiSessions.scopeAll': '全部范围',
  'aiSessions.scopeSearch': '搜索：{query}',
  'aiSessions.eventCopied': 'AI 会话事件已复制',
  'aiSessions.eventCopyFailed': 'AI 会话事件复制失败',
  'aiSessions.queueHeader': 'AI 会话队列：{scope}',
  'aiSessions.queueCounts': '当前会话：{current}，待处理：{pending}',
  'aiSessions.queueCopied': 'AI 会话队列摘要已复制',
  'aiSessions.queueCopyFailed': 'AI 会话队列摘要复制失败',
  'aiSessions.visibleHandled': '已处理 {count} 个 AI 会话',
  'aiSessions.copy.agent': 'Agent',
  'aiSessions.copy.status': '状态',
  'aiSessions.copy.session': '会话',
  'aiSessions.copy.path': '路径',
  'aiSessions.copy.summary': '摘要',
  'aiSessions.copy.resume': '恢复',
  'aiSessions.relative.secondsAgo': '{count}s 前',
  'aiSessions.relative.minutesAgo': '{count}m 前',
  'aiSessions.relative.hoursAgo': '{count}h 前',
  'aiSessions.relative.daysAgo': '{count}d 前',
  'aiSessions.notice.serviceUnavailable': 'AI 会话管理服务不可用',
  'aiSessions.notice.listFailed': 'AI 会话列表加载失败',
  'aiSessions.notice.refreshed': 'AI 会话已刷新',
  'aiSessions.notice.processFailed': 'AI 会话处理失败',
  'aiSessions.notice.allowed': '已允许 AI 请求',
  'aiSessions.notice.alwaysAllowed': '已持续允许 AI 请求',
  'aiSessions.notice.bypassAllowed': '已允许本会话绕过审批',
  'aiSessions.notice.denied': '已拒绝 AI 请求',
  'aiSessions.notice.replied': '已回复 AI 问题',
  'aiSessions.notice.handled': '已标记处理',
  'aiSessions.notice.renameFailed': 'AI 会话重命名失败',
  'aiSessions.notice.renamed': 'AI 会话已重命名',
  'aiSessions.notice.clearFailed': 'AI 会话清理失败',
  'aiSessions.notice.cleared': 'AI 会话已清理',
  'aiSessions.notice.bulkFailed': 'AI 会话批量操作失败',
  'aiSessions.notice.missing': 'AI 会话不存在',
  'aiSessions.notice.hibernationDisabled': 'Agent Hibernation 未开启',
  'aiSessions.notice.cannotHibernateNeedsInput': '等待输入的 AI 会话不能休眠',
  'aiSessions.notice.noResumeCommand': '此 AI 会话没有可用的恢复命令',
  'aiSessions.notice.hibernateFailed': 'AI 会话休眠失败',
  'aiSessions.notice.hibernated': 'AI 会话已休眠',
  'aiSessions.notice.resumeNeedsTerminal': '恢复 AI 会话需要先打开它所属的本地连接终端',
  'aiSessions.notice.resumeCommandWritten': '已向所属终端写入 AI 会话恢复命令',
  'aiSessions.notice.resumeCommandNeedsApproval': 'AI 会话恢复命令等待安全审批',
  'aiSessions.notice.noPendingMessages': '没有待处理的 AI 消息',
  'aiSessions.notice.openedSettings': '已打开 AI 设置',
  'terminal.status.editor': '编辑器',
  'terminal.status.connecting': '连接中',
  'terminal.status.error': '异常',
  'terminal.status.closed': '已断开',
  'terminal.status.connected': '已连接',
  'terminal.kind.editor': 'Editor',
  'terminal.kind.local': 'Local',
  'terminal.kind.localTerminal': '本地终端',
  'terminal.tab.type': '类型',
  'terminal.tab.status': '状态',
  'terminal.tab.host': '主机',
  'terminal.tab.path': '路径',
  'terminal.tab.file': '文件',
  'terminal.tab.session': '会话',
  'terminal.tab.localTarget': 'local',
  'terminal.context.locatePendingAi': '定位待处理 AI 会话',
  'terminal.context.openAiSessions': '打开 AI 会话管理',
  'terminal.context.refreshAiSessions': '刷新 AI 会话状态',
  'terminal.context.focusTerminal': '聚焦当前终端',
  'terminal.context.copyContext': '复制当前终端上下文',
  'terminal.context.copyContextButton': '复制上下文',
  'terminal.context.aiSessions': 'AI 会话',
  'terminal.context.refresh': '刷新',
  'terminal.context.focus': '聚焦',
  'terminal.context.refreshFailed': 'AI 会话刷新失败',
  'terminal.context.copied': '终端上下文已复制',
  'terminal.context.copyFailed': '终端上下文复制失败',
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
  'common.add': 'Add',
  'common.all': 'All',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.configure': 'Configure',
  'common.copy': 'Copy',
  'common.delete': 'Delete',
  'common.export': 'Export',
  'common.install': 'Install',
  'common.login': 'Log in',
  'common.new': 'New',
  'common.open': 'Open',
  'common.processing': 'Processing',
  'common.refresh': 'Refresh',
  'common.refreshing': 'Refreshing',
  'common.reinstall': 'Reinstall',
  'common.uninstall': 'Uninstall',
  'common.save': 'Save',
  'common.search': 'Search',
  'common.settings': 'Settings',
  'common.submit': 'Submit',
  'common.system': 'System',
  'common.unknown': 'Unknown',
  'module.workspace': 'Workspace',
  'module.aiSessions': 'AI Sessions',
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
  'settings.help.open': 'Open this settings page help document',
  'settings.help.back': 'Back to settings',
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
  'settings.general.editorScope': 'Applies to file, knowledge, SQL, and settings JSON code editors. Terminal fonts are controlled by Terminal Settings; the AI input is not affected.',
  'settings.general.fontSize': 'Font Size',
  'settings.general.lineHeight': 'Line Height',
  'settings.general.font': 'Font',
  'settings.terminal.title': 'Terminal Settings',
  'settings.terminal.description': 'Terminal type mainly affects TERM and capability detection. It usually does not change appearance directly. Font changes are visible only when the font is installed or matched by the system.',
  'settings.terminal.terminalType': 'Terminal Type',
  'settings.terminal.font': 'Font',
  'settings.terminal.fontSize': 'Font Size',
  'settings.terminal.scrollBack': 'ScrollBack',
  'settings.terminal.cursorStyle': 'Cursor Style',
  'settings.terminal.cursorBlock': 'Block cursor',
  'settings.terminal.cursorBar': 'Bar cursor',
  'settings.terminal.cursorUnderline': 'Underline cursor',
  'settings.terminal.cursorBlink': 'Cursor Blink',
  'settings.terminal.lineHeight': 'Line Height',
  'settings.terminal.pinchZoom': 'Pinch Zoom',
  'settings.terminal.showCloseButton': 'Show close button',
  'settings.terminal.sshAgents': 'SSH Agents',
  'settings.terminal.sshAgentSettings': 'SSH Agent Settings',
  'settings.terminal.mouseEvents': 'Mouse Events',
  'settings.terminal.middleMouse': 'Middle:',
  'settings.terminal.rightMouse': 'Right:',
  'settings.terminal.mouseNone': 'None',
  'settings.terminal.mousePaste': 'Paste clipboard',
  'settings.terminal.mouseContextMenu': 'Show context menu',
  'settings.terminal.mouseCloseTab': 'Close current tab',
  'settings.terminal.sshAgentTitle': 'SSH Agent Settings',
  'settings.terminal.sshAgentFingerprint': 'Fingerprint',
  'settings.terminal.sshAgentComment': 'Comment',
  'settings.terminal.sshAgentType': 'Type',
  'settings.terminal.sshAgentAction': 'Action',
  'settings.terminal.sshAgentEmpty': 'No keys added',
  'settings.terminal.sshAgentKey': 'Key',
  'settings.terminal.sshAgentSelectKey': 'Select a key',
  'settings.terminal.saveUnavailable': 'Terminal settings save service is unavailable',
  'settings.terminal.saveFailed': 'Failed to save terminal settings',
  'settings.terminal.saved': 'Terminal settings saved',
  'settings.ai.title': 'AI Preferences',
  'settings.ai.agentHookInstaller': 'Agent Hook Installer',
  'settings.ai.hibernation': 'AI Session Hibernation',
  'settings.ai.notifications': 'Notifications',
  'settings.ai.automationDeveloper': 'Automation and Developer',
  'settings.ai.general': 'General',
  'settings.ai.features': 'Features',
  'settings.ai.modelProxy': 'AI Model Proxy',
  'settings.ai.terminal': 'Terminal',
  'settings.ai.extendedThinking': 'Enable Extended Thinking',
  'settings.ai.thinkingBudgetDescription': 'Affects the output token budget for AI conversation requests and is written into conversation system constraints.',
  'settings.ai.autoExecuteReadOnly': 'Auto-run read-only commands',
  'settings.ai.autoExecuteReadOnlyDescription': 'Read-only commands can run automatically within the confirmed scope.',
  'settings.ai.commandOutputFiltering': 'Command output filtering',
  'settings.ai.commandOutputFilteringDescription': 'Compresses the middle of long command output returned by Agents while keeping the full output in the UI.',
  'settings.ai.kbSearch': 'Knowledge search',
  'settings.ai.kbSearchDescription': 'Automatically retrieves and attaches relevant knowledge documents for normal AI conversations.',
  'settings.ai.experienceExtraction': 'Experience extraction',
  'settings.ai.experienceExtractionDescription': 'Controls whether AI answers extract reusable operations experience.',
  'settings.ai.managedAiAutoNaming': 'AI session auto-naming',
  'settings.ai.managedAiAutoNamingDescription': 'After an Agent turn ends, summarize the current session title into 2-5 words with the current model. Manual titles are not overwritten.',
  'settings.ai.autoApproval': 'Auto approval',
  'settings.ai.autoApprovalDescription': 'Only low-risk read-only actions can pass automatically. High-risk command approval is never bypassed.',
  'settings.ai.securityConfig': 'Security Config',
  'settings.ai.openSecurityConfig': 'Open Security Config',
  'settings.ai.reasoningLow': 'Low',
  'settings.ai.reasoningMedium': 'Medium',
  'settings.ai.reasoningHigh': 'High',
  'settings.ai.enableProxy': 'Enable proxy',
  'settings.ai.proxyType': 'Proxy Type',
  'settings.ai.enableProxyIdentity': 'Enable proxy identity',
  'settings.ai.shellIntegrationTimeout': 'Shell Integration Timeout',
  'settings.ai.shellIntegrationTimeoutDescription': 'Default timeout, in seconds, for Agents waiting on terminal command output.',
  'settings.ai.agentHook.statusNotLoaded': 'Status not loaded',
  'settings.ai.agentHook.installed': 'Installed',
  'settings.ai.agentHook.configError': 'Config error',
  'settings.ai.agentHook.ready': 'Ready to install',
  'settings.ai.agentHook.cliMissing': 'CLI not detected',
  'settings.ai.agentHook.detectedMissing': 'Not detected',
  'settings.ai.agentHook.launchCommand': 'Launch command',
  'settings.ai.agentHook.description': 'After installation, only sessions launched from aiopsterm local connection terminals are captured. External system terminals return empty automatically and approvals are not taken over.',
  'settings.ai.agentHook.config': 'Hook Config',
  'settings.ai.agentHook.extraConfig': 'Extra Config',
  'settings.ai.agentHook.helper': 'Hook Helper',
  'settings.ai.agentHook.title': 'Codex / Claude Code Session Management Hook',
  'settings.ai.agentHook.subtitle': 'Writes user-level Hook configuration so the AI session panel can discover and locate local-connection sessions that need attention.',
  'settings.ai.agentHook.serviceUnavailable': 'Agent Hook installer service is unavailable',
  'settings.ai.agentHook.statusLoadFailed': 'Failed to load Agent Hook installer status',
  'settings.ai.agentHook.statusRefreshed': 'Agent Hook status refreshed',
  'settings.ai.agentHook.installFailed': 'Agent Hook install failed',
  'settings.ai.agentHook.uninstallFailed': 'Agent Hook uninstall failed',
  'settings.ai.agentHook.installMalformed': 'Unexpected Agent Hook install result',
  'settings.ai.agentHook.uninstallMalformed': 'Unexpected Agent Hook uninstall result',
  'settings.ai.agentHook.installedNotice': '{label} Agent Hook installed',
  'settings.ai.agentHook.uninstalledNotice': '{label} Agent Hook uninstalled',
  'settings.ai.hibernation.enable': 'Enable Agent Hibernation',
  'settings.ai.hibernation.description': 'When background AI sessions exceed the idle threshold and the live-terminal limit, aiopsterm can warn first, hibernate the owning terminal, and keep a restorable session record.',
  'settings.ai.hibernation.idleSeconds': 'Idle time (seconds)',
  'settings.ai.hibernation.idleDescription': 'Only restorable AI sessions with no terminal activity beyond this time become hibernation candidates.',
  'settings.ai.hibernation.maxLiveTerminals': 'Max live terminals',
  'settings.ai.hibernation.maxLiveDescription': 'Hibernation starts from the oldest background candidates only after the number of live restorable AI terminals exceeds this value.',
  'settings.ai.hibernation.confirmationSeconds': 'Confirmation countdown (seconds)',
  'settings.ai.hibernation.confirmationDescription': 'Set to 0 to skip the countdown confirmation and hibernate eligible background candidates directly.',
  'settings.ai.hibernation.loadFailed': 'Failed to load Agent Hibernation config',
  'settings.ai.hibernation.serviceUnavailable': 'Agent Hibernation service is unavailable',
  'settings.ai.hibernation.saveFailed': 'Failed to save Agent Hibernation config',
  'settings.ai.hibernation.saved': 'Agent Hibernation config saved',
  'settings.ai.hibernation.enabledNotice': 'Agent Hibernation enabled',
  'settings.ai.hibernation.disabledNotice': 'Agent Hibernation disabled',
  'settings.ai.notification.desktop': 'Desktop notifications',
  'settings.ai.notification.desktopDescription': 'Controls system desktop notifications triggered by the external notification protocol and AI session events. In-app notification history is still retained when disabled.',
  'settings.ai.notification.controlBell': 'Top bell for control notifications',
  'settings.ai.notification.controlBellDescription': 'Controls whether unread notifications from the external notification protocol enter the top bell queue. AI approvals, questions, and pending reminders are always retained.',
  'settings.ai.automation.description': 'These entries are for scripts, CLI, external Codex MCP, and local connection terminal automation. Whether they work depends on runtime environment variables and whether the process was launched from an aiopsterm local connection terminal.',
  'settings.ai.automation.controlSocketDescription': 'aiopsterm injects this variable into local connection terminals so external scripts can call the control protocol.',
  'settings.ai.automation.cliHelperDescription': 'Use this in a terminal with Control Socket environment for notifications, sessions, and automation control.',
  'settings.ai.automation.externalCodexMcpDescription': 'MCP bridge for external Codex. It is currently enabled through environment variables and requires restarting aiopsterm after changes.',
  'settings.ai.automation.externalCodexMcpTokenDescription': 'Optional access token. When set, external Codex MCP clients must carry the same token.',
  'settings.ai.automation.externalCodexMcpSocketDescription': 'Optional socket path. When unset, the default path under the app data directory is used.',
  'settings.ai.automation.copySnippet': 'Copy {label}',
  'settings.ai.automation.controlProtocolDocs': 'Control protocol docs',
  'settings.ai.automation.externalCodexMcpDocs': 'External Codex MCP docs',
  'agents.searchConversations': 'Search conversations',
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
  'top.aiAttentionOpen': 'AI session manager',
  'top.aiAttentionPending': 'AI has {count} pending messages: {title}',
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
  'ai.codexTargetUnbound': 'No terminal bound',
  'ai.codexTargetDropHint': 'Drop a host or terminal tab here, or search for a host to bind',
  'ai.codexTargetBind': 'Bind host/terminal',
  'ai.codexTargetLocate': 'Locate bound terminal',
  'ai.codexTargetChange': 'Change bound target',
  'ai.codexTargetUnbind': 'Unbind target',
  'ai.codexTargetSearch': 'Search hosts',
  'ai.codexTargetUseCurrent': 'Bind current terminal',
  'ai.codexTargetMissing': 'Bind a connected terminal first.',
  'ai.codexTargetClosed': 'The bound terminal is closed. Rebind or reconnect it.',
  'ai.codexTargetOpenFailed': 'Failed to open the host terminal, so it was not bound.',
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
  'aiSessions.eyebrow': 'AI Sessions',
  'aiSessions.openSettings': 'Open AI settings',
  'aiSessions.refresh': 'Refresh AI sessions',
  'aiSessions.searchPlaceholder': 'Search sessions',
  'aiSessions.agent': 'Agent',
  'aiSessions.project': 'Project',
  'aiSessions.pendingCount': '{count} pending',
  'aiSessions.currentCount': '{count} current sessions',
  'aiSessions.pendingScopedCount': '{count} pending · {scope}',
  'aiSessions.nextPending': 'Locate next pending item',
  'aiSessions.copyQueueSummary': 'Copy current queue summary',
  'aiSessions.handleFilteredPending': 'Handle pending items in the current filter',
  'aiSessions.markAllHandled': 'Mark all handled',
  'aiSessions.clearEnded': 'Clear ended',
  'aiSessions.markHandled': 'Mark handled',
  'aiSessions.emptyTitle': 'No AI sessions',
  'aiSessions.emptyDescription': 'After Agent Hooks are installed and enabled, Codex / Claude Code / Cursor / Gemini sessions launched from aiopsterm local connection terminals appear here.',
  'aiSessions.restorable': 'Restorable',
  'aiSessions.hibernated': 'Hibernated',
  'aiSessions.resume': 'Resume session',
  'aiSessions.locateTerminal': 'Locate terminal',
  'aiSessions.meta.path': 'Path',
  'aiSessions.meta.session': 'Session',
  'aiSessions.meta.agentLifecycle': 'Agent State',
  'aiSessions.meta.requestKind': 'Request Type',
  'aiSessions.meta.decisionMode': 'Decision Mode',
  'aiSessions.meta.waitTimeout': 'Wait Timeout',
  'aiSessions.meta.tool': 'Tool',
  'aiSessions.meta.agentPid': 'Agent PID',
  'aiSessions.meta.parentProcess': 'Parent Process',
  'aiSessions.meta.processGroup': 'Process Group',
  'aiSessions.meta.terminalPid': 'Terminal PID',
  'aiSessions.meta.terminalActivity': 'Terminal Activity',
  'aiSessions.meta.transcript': 'Transcript',
  'aiSessions.meta.launchCommand': 'Launch Command',
  'aiSessions.meta.resumeCommand': 'Resume Command',
  'aiSessions.action.submitReply': 'Submit reply',
  'aiSessions.action.allow': 'Allow',
  'aiSessions.action.alwaysAllow': 'Always allow',
  'aiSessions.action.bypassSession': 'Bypass this session',
  'aiSessions.action.deny': 'Deny',
  'aiSessions.action.handled': 'Handled',
  'aiSessions.replyQuestionPlaceholder': 'Enter the answer to send to AI',
  'aiSessions.replyOptionalPlaceholder': 'Optional: denial reason or handling note',
  'aiSessions.timeline': 'Event Stream',
  'aiSessions.copyEvent': 'Copy event',
  'aiSessions.decisions': 'Decision Records',
  'aiSessions.clearSession': 'Clear this session',
  'aiSessions.filter.all': 'All',
  'aiSessions.filter.needsInput': 'Pending',
  'aiSessions.filter.working': 'Working',
  'aiSessions.filter.idle': 'Idle',
  'aiSessions.filter.ended': 'Ended',
  'aiSessions.filter.hibernated': 'Hibernated',
  'aiSessions.cockpit.total': 'Total',
  'aiSessions.state.unknown': 'Unknown',
  'aiSessions.eventFilter.permission': 'Permission',
  'aiSessions.eventFilter.question': 'Question',
  'aiSessions.eventFilter.plan': 'Plan',
  'aiSessions.eventFilter.notification': 'Notification',
  'aiSessions.eventFilter.telemetry': 'Telemetry',
  'aiSessions.request.permission': 'Permission approval',
  'aiSessions.request.question': 'User question',
  'aiSessions.request.plan': 'Plan confirmation',
  'aiSessions.request.notification': 'Notification',
  'aiSessions.request.telemetry': 'Telemetry',
  'aiSessions.decision.blocking': 'Waiting for response',
  'aiSessions.decision.local': 'Local handling',
  'aiSessions.decision.telemetry': 'Record only',
  'aiSessions.event.sessionStart': 'Session started',
  'aiSessions.event.promptSubmit': 'Prompt submitted',
  'aiSessions.event.toolUse': 'Tool call',
  'aiSessions.event.permissionRequest': 'Permission request',
  'aiSessions.event.question': 'Question',
  'aiSessions.event.notification': 'Notification',
  'aiSessions.event.lifecycle': 'Lifecycle',
  'aiSessions.event.stop': 'Turn ended',
  'aiSessions.event.sessionEnd': 'Session ended',
  'aiSessions.decision.allow': 'Allow',
  'aiSessions.decision.always': 'Always allow',
  'aiSessions.decision.bypass': 'Bypass this session',
  'aiSessions.decision.deny': 'Deny',
  'aiSessions.decision.reply': 'Reply',
  'aiSessions.decision.handled': 'Handled',
  'aiSessions.unknownPath': 'Unknown path',
  'aiSessions.scopeAll': 'All scopes',
  'aiSessions.scopeSearch': 'Search: {query}',
  'aiSessions.eventCopied': 'AI session event copied',
  'aiSessions.eventCopyFailed': 'Failed to copy AI session event',
  'aiSessions.queueHeader': 'AI session queue: {scope}',
  'aiSessions.queueCounts': 'Current sessions: {current}, pending: {pending}',
  'aiSessions.queueCopied': 'AI session queue summary copied',
  'aiSessions.queueCopyFailed': 'Failed to copy AI session queue summary',
  'aiSessions.visibleHandled': 'Handled {count} AI sessions',
  'aiSessions.copy.agent': 'Agent',
  'aiSessions.copy.status': 'Status',
  'aiSessions.copy.session': 'Session',
  'aiSessions.copy.path': 'Path',
  'aiSessions.copy.summary': 'Summary',
  'aiSessions.copy.resume': 'Resume',
  'aiSessions.relative.secondsAgo': '{count}s ago',
  'aiSessions.relative.minutesAgo': '{count}m ago',
  'aiSessions.relative.hoursAgo': '{count}h ago',
  'aiSessions.relative.daysAgo': '{count}d ago',
  'aiSessions.notice.serviceUnavailable': 'AI session manager service is unavailable',
  'aiSessions.notice.listFailed': 'Failed to load AI session list',
  'aiSessions.notice.refreshed': 'AI sessions refreshed',
  'aiSessions.notice.processFailed': 'Failed to process AI session',
  'aiSessions.notice.allowed': 'AI request allowed',
  'aiSessions.notice.alwaysAllowed': 'AI request always allowed',
  'aiSessions.notice.bypassAllowed': 'This session can bypass approval',
  'aiSessions.notice.denied': 'AI request denied',
  'aiSessions.notice.replied': 'AI question replied',
  'aiSessions.notice.handled': 'Marked handled',
  'aiSessions.notice.renameFailed': 'Failed to rename AI session',
  'aiSessions.notice.renamed': 'AI session renamed',
  'aiSessions.notice.clearFailed': 'Failed to clear AI session',
  'aiSessions.notice.cleared': 'AI session cleared',
  'aiSessions.notice.bulkFailed': 'AI session bulk operation failed',
  'aiSessions.notice.missing': 'AI session not found',
  'aiSessions.notice.hibernationDisabled': 'Agent Hibernation is disabled',
  'aiSessions.notice.cannotHibernateNeedsInput': 'AI sessions waiting for input cannot hibernate',
  'aiSessions.notice.noResumeCommand': 'This AI session has no available resume command',
  'aiSessions.notice.hibernateFailed': 'Failed to hibernate AI session',
  'aiSessions.notice.hibernated': 'AI session hibernated',
  'aiSessions.notice.resumeNeedsTerminal': 'Open the owning local connection terminal before resuming this AI session',
  'aiSessions.notice.resumeCommandWritten': 'AI session resume command written to the owning terminal',
  'aiSessions.notice.resumeCommandNeedsApproval': 'AI session resume command is waiting for security approval',
  'aiSessions.notice.noPendingMessages': 'No pending AI messages',
  'aiSessions.notice.openedSettings': 'AI settings opened',
  'terminal.status.editor': 'Editor',
  'terminal.status.connecting': 'Connecting',
  'terminal.status.error': 'Error',
  'terminal.status.closed': 'Disconnected',
  'terminal.status.connected': 'Connected',
  'terminal.kind.editor': 'Editor',
  'terminal.kind.local': 'Local',
  'terminal.kind.localTerminal': 'Local terminal',
  'terminal.tab.type': 'Type',
  'terminal.tab.status': 'Status',
  'terminal.tab.host': 'Host',
  'terminal.tab.path': 'Path',
  'terminal.tab.file': 'File',
  'terminal.tab.session': 'Session',
  'terminal.tab.localTarget': 'local',
  'terminal.context.locatePendingAi': 'Locate pending AI session',
  'terminal.context.openAiSessions': 'Open AI session manager',
  'terminal.context.refreshAiSessions': 'Refresh AI session status',
  'terminal.context.focusTerminal': 'Focus current terminal',
  'terminal.context.copyContext': 'Copy current terminal context',
  'terminal.context.copyContextButton': 'Copy context',
  'terminal.context.aiSessions': 'AI Sessions',
  'terminal.context.refresh': 'Refresh',
  'terminal.context.focus': 'Focus',
  'terminal.context.refreshFailed': 'Failed to refresh AI sessions',
  'terminal.context.copied': 'Terminal context copied',
  'terminal.context.copyFailed': 'Failed to copy terminal context',
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
  'module.aiSessions': 'AI 會話',
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
  'settings.help.open': '開啟本頁說明文件',
  'settings.help.back': '返回設定',
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
  'settings.general.editorScope': '這些設定會套用到檔案、知識庫、SQL 和設定 JSON 等程式碼編輯器；終端字型請在「終端設定」中調整，AI 輸入框不受影響。',
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
  'settings.general.editorScope': 'ファイル、ナレッジ、SQL、設定 JSON などのコードエディターに適用されます。ターミナルのフォントは「ターミナル設定」で調整します。AI 入力欄には影響しません。',
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
  'settings.general.editorScope': '파일, 지식 베이스, SQL, 설정 JSON 등의 코드 편집기에 적용됩니다. 터미널 글꼴은 터미널 설정에서 조정하며 AI 입력창에는 영향을 주지 않습니다.',
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
  'settings.general.editorScope': 'Gilt für Datei-, Wissens-, SQL- und Einstellungen-JSON-Code-Editoren. Terminal-Schriften werden in den Terminal-Einstellungen gesteuert; die AI-Eingabe ist nicht betroffen.',
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
  'settings.general.editorScope': 'S’applique aux éditeurs de code pour les fichiers, la base de connaissances, SQL et le JSON des paramètres. Les polices du terminal se règlent dans Paramètres du terminal ; la saisie IA n’est pas affectée.',
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
  'settings.general.editorScope': 'Si applica agli editor di codice per file, conoscenza, SQL e JSON delle impostazioni. I caratteri del terminale si regolano nelle impostazioni terminale; l’input AI non è interessato.',
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
  'settings.general.editorScope': 'Aplica-se aos editores de código de ficheiros, conhecimento, SQL e JSON das definições. As fontes do terminal são controladas nas Definições do terminal; a entrada de IA não é afetada.',
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
  'settings.general.editorScope': 'Применяется к редакторам кода для файлов, базы знаний, SQL и JSON настроек. Шрифты терминала настраиваются в настройках терминала; поле ввода AI не затрагивается.',
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
  'settings.general.editorScope': 'ينطبق على محررات كود الملفات والمعرفة وSQL وJSON الإعدادات. تضبط خطوط الطرفية من إعدادات الطرفية؛ ولا يتأثر إدخال AI.',
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
