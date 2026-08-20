// Capture documentation screenshots from the built app with seeded demo data.
//
// Usage:
//   npm run build
//   node scripts/docs-screenshots/capture.js --locale zh-CN
//   node scripts/docs-screenshots/capture.js --locale en-US
//
// Raw PNGs + element bounding-box manifests go to test-results/docs-screenshots/raw/<locale>.
// Then run: python3 scripts/docs-screenshots/annotate.py
const path = require('path')
const fs = require('fs')
const os = require('os')

const REPO = path.resolve(__dirname, '..', '..')
const localeArgIndex = process.argv.findIndex((arg) => arg === '--locale' || arg.startsWith('--locale='))
const localeArg = localeArgIndex < 0
  ? 'zh-CN'
  : process.argv[localeArgIndex].includes('=')
    ? process.argv[localeArgIndex].split('=', 2)[1]
    : process.argv[localeArgIndex + 1]
if (!['zh-CN', 'en-US'].includes(localeArg)) throw new Error('Usage: capture.js --locale <zh-CN|en-US>')
const LOCALE = localeArg
const OUT = path.join(REPO, 'test-results', 'docs-screenshots', 'raw', LOCALE)
const { _electron } = require(path.join(REPO, 'node_modules', 'playwright-core'))

const log = (m) => console.log(`[capture:${LOCALE}] ${m}`)
const localized = (zhCN, enUS) => LOCALE === 'en-US' ? enUS : zhCN
const failures = []

const seedEnv = (userDataDir, codexHome) => ({
  ...process.env,
  SHELL: process.env.SHELL || '/bin/bash',
  NODE_ENV: 'test',
  AIOPSTERM_USER_DATA_DIR: userDataDir,
  CODEX_HOME: codexHome,
  AIOPSTERM_CHAT_HISTORY_ENABLE_SEED: '1',
  AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED: '1',
  AIOPSTERM_ASSETS_ENABLE_SEED: '1',
  AIOPSTERM_DATABASE_ENABLE_SEED: '1',
  AIOPSTERM_FILES_ENABLE_SEED: '1',
  AIOPSTERM_KNOWLEDGE_ENABLE_SEED: '1',
  AIOPSTERM_KUBERNETES_ENABLE_SEED: '1',
  AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED: '1',
  AIOPSTERM_SKILLS_ENABLE_SEED: '1',
  AIOPSTERM_USER_ACCOUNT_ENABLE_SEED: '1',
  AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED: '1',
  AIOPSTERM_MCP_ENABLE_SEED: '1',
  AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED: '1',
  AIOPSTERM_E2E_DIALOG_FIXTURES: '1',
  AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
  AIOPSTERM_AI_CHAT_BACKEND_DOUBLE: '1',
  AIOPSTERM_DB_AI_BACKEND_DOUBLE: '1',
  AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE: '1',
  AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE: '1',
  AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE: '1',
  AIOPSTERM_USER_LOGIN_URL: 'https://accounts.aiopsterm.local/e2e-login',
  AIOPSTERM_USER_ACCOUNT_CENTER_URL: 'https://accounts.aiopsterm.local/e2e-account-center',
  LANG: LOCALE === 'en-US' ? 'en_US.UTF-8' : 'zh_CN.UTF-8',
  LC_ALL: LOCALE === 'en-US' ? 'en_US.UTF-8' : 'zh_CN.UTF-8',
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
})

async function boxOf(page, selector, filterText) {
  try {
    let loc = page.locator(selector)
    if (filterText) loc = loc.filter({ hasText: filterText })
    loc = loc.first()
    if ((await loc.count()) === 0) return null
    const b = await loc.boundingBox({ timeout: 1500 })
    return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null
  } catch {
    return null
  }
}

async function snap(page, name, boxSpecs) {
  await page.waitForTimeout(700)
  const manifest = {}
  for (const [key, sel, filterText] of boxSpecs || []) {
    manifest[key] = await boxOf(page, sel, filterText)
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(manifest, null, 2))
  log(`snap ${name}: ` + Object.entries(manifest).map(([k, v]) => `${k}=${v ? 'ok' : 'MISS'}`).join(' '))
  const missing = Object.entries(manifest).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) throw new Error(`${name} is missing annotation anchors: ${missing.join(', ')}`)
}

async function scene(name, fn) {
  try {
    await fn()
    log(`scene ok: ${name}`)
  } catch (err) {
    const message = `${name}: ${String(err).split('\n')[0]}`
    failures.push(message)
    log(`scene FAIL: ${message}`)
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiopsterm-docs-shots-'))
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiopsterm-docs-project-'))
  const codexHome = path.join(userDataDir, 'codex')
  const codexSessionDir = path.join(codexHome, 'sessions', '2026', '08', '09')
  const codexTranscriptPath = path.join(codexSessionDir, 'docs-project-session.jsonl')
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
  fs.mkdirSync(codexSessionDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Service API\n\nDocumentation screenshot project.\n')
  fs.writeFileSync(path.join(projectRoot, 'src', 'server.ts'), 'export const status = "ready"\n')
  fs.writeFileSync(codexTranscriptPath, [
    JSON.stringify({ type: 'session_meta', payload: { id: 'docs-project-session', cwd: projectRoot, model: 'gpt-5.6-codex' } }),
    JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: localized('检查 API 服务状态并说明准备修改哪些文件。', 'Check the API service status and explain which files should change.') }] } }),
    JSON.stringify({ type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: localized('我会先查看 README.md 和 src/server.ts，再更新服务状态并运行验证。', 'I will inspect README.md and src/server.ts, update the service status, and run verification.') }] } }),
    JSON.stringify({ type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: localized('修改已完成：服务状态保持 ready，项目文件可以在右侧直接查看。', 'The update is complete: the service remains ready and project files are available in the right panel.') }] } })
  ].join('\n') + '\n')
  log('launching built app...')
  const app = await _electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: REPO,
    env: seedEnv(userDataDir, codexHome),
    timeout: 90000
  })
  const page = await app.firstWindow({ timeout: 90000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(8000)
  await page.locator('[data-testid="top-language-button"]').click()
  await page.locator('[data-testid="top-language-menu"] button')
    .filter({ hasText: LOCALE === 'en-US' ? 'English' : '简体中文' })
    .click()
  await page.waitForFunction((locale) => document.documentElement.lang === locale, LOCALE)
  await page.waitForTimeout(1200)
  if (LOCALE === 'en-US') {
    await page.evaluate(async () => {
      const snapshot = await window.aiops.listAssets()
      const folderNames = {
        'direct-folder-prod': ['Production', 'Production hosts'],
        'direct-folder-staging': ['Staging', 'Staging hosts'],
        'direct-folder-db': ['Database', 'Database hosts'],
        'direct-folder-maintenance': ['Maintenance', 'Maintenance hosts'],
        'custom-folder-a': ['Core services', 'Frequently used bastion assets'],
        'custom-folder-b': ['Troubleshooting', 'Temporary troubleshooting assets']
      }
      for (const folder of snapshot.folders) {
        const localizedFolder = folderNames[folder.uuid]
        if (!localizedFolder) continue
        const result = await window.aiops.saveAssetFolder({
          ...folder,
          name: localizedFolder[0],
          description: localizedFolder[1]
        })
        if (!result?.ok) throw new Error(result?.errorMessage || `Could not localize asset folder ${folder.uuid}.`)
      }
      const groupNames = {
        '本地连接': 'Local connections',
        '生产': 'Production',
        '预发': 'Staging',
        '数据库': 'Database',
        '维护': 'Maintenance',
        '企业': 'Enterprise'
      }
      const comments = {
        '生产入口': 'Production entry',
        '预发 API': 'Staging API',
        '主库': 'Primary database',
        '待迁移': 'Pending migration',
        '同步资产': 'Synchronized assets'
      }
      for (const asset of snapshot.assets.filter((candidate) => !candidate.isLocalShell)) {
        const result = await window.aiops.saveAsset({
          ...asset,
          group: groupNames[asset.group] || asset.group,
          group_name: groupNames[asset.group_name] || asset.group_name,
          comment: comments[asset.comment] || asset.comment
        })
        if (!result?.ok) throw new Error(result?.errorMessage || `Could not localize asset ${asset.id}.`)
      }
      const preferences = await window.aiops.getSettingsPreferences()
      if (!preferences?.ok) throw new Error(preferences?.errorMessage || 'Could not load documentation settings.')
      const englishRules = [
        'Before production changes, provide read-only checks and a rollback point.',
        'Do not automatically delete, restart, scale, write files, or modify configuration.'
      ]
      for (const [index, rule] of preferences.data.rules.entries()) {
        const result = await window.aiops.saveSettingsRule({
          id: rule.id,
          content: englishRules[index] || englishRules[englishRules.length - 1],
          enabled: rule.enabled
        })
        if (!result?.ok) throw new Error(result?.errorMessage || `Could not localize settings rule ${rule.id}.`)
      }
      const quickCommands = await window.aiops.getQuickCommands()
      for (const group of quickCommands.groups) {
        const result = await window.aiops.saveQuickCommandGroup({ uuid: group.uuid, group_name: 'Inspection commands' })
        if (!result?.ok) throw new Error(result?.errorMessage || `Could not localize quick-command group ${group.uuid}.`)
      }
      for (const [index, snippet] of quickCommands.snippets.entries()) {
        const result = await window.aiops.saveQuickCommandSnippet({
          ...snippet,
          snippet_name: index === 0 ? 'Disk inspection' : snippet.snippet_name
        })
        if (!result?.ok) throw new Error(result?.errorMessage || `Could not localize quick command ${snippet.uuid}.`)
      }
      await window.aiops.kbRename('使用指南', 'User Guide')
      await window.aiops.kbRename('Markdown语法指南.md', 'Markdown Guide.md')
    })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.lang === 'en-US')
    await page.waitForTimeout(5000)
  }
  const rail = (key) => page.locator(`.side-rail .rail-button[data-module-key="${key}"]`)

  await scene('01-main-window', async () => {
    await snap(page, '01-main-window', [
      ['sideRail', '.side-rail'],
      ['modulePanel', '.module-panel'],
      ['dashboard', '.terminal-dashboard'],
      ['aiPanel', '.ai-panel'],
      ['topBar', '.top-bar'],
      ['agentsEntry', '[data-testid="agents-mode-entry"]'],
      ['railWorkspace', '.side-rail .rail-button[data-module-key="workspace"]'],
      ['railSettings', '.side-rail .rail-button[data-module-key="settings"]'],
      ['searchInput', '.workspace-search input'],
      ['directTab', '.workspace-tabs button', localized('直接连接', 'Direct connections')],
      ['bastionTab', '.workspace-tabs button', localized('堡垒机资源', 'Bastion resources')],
      ['hostLocal', '.workspace-host-row', '127.0.0.1'],
      ['hostProd', '.workspace-host-row', 'prod-bastion']
    ])
  })

  await scene('03-terminal-session', async () => {
    await page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first().dblclick()
    await page.locator('.terminal-pane .xterm-host').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.waitForTimeout(3000)
    await page.keyboard.type('echo "welcome to aiopsterm" && uname -sr', { delay: 15 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)
    await page.keyboard.type('df -h / && uptime', { delay: 15 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    await snap(page, '03-terminal-session', [
      ['tabBar', '.terminal-tabs'],
      ['tab', '.terminal-tab', '127.0.0.1'],
      ['pane', '.terminal-pane'],
      ['aiPanel', '.ai-panel']
    ])
  })

  await scene('04-terminal-context-menu', async () => {
    await page.locator('.terminal-pane').first().click({ button: 'right' })
    await page.locator('.terminal-context-menu').waitFor({ state: 'visible', timeout: 5000 })
    await snap(page, '04-terminal-context-menu', [
      ['menu', '.terminal-context-menu'],
      ['splitRight', '.terminal-context-menu button, .terminal-context-menu li', localized('向右拆分', 'Split right')],
      ['splitDown', '.terminal-context-menu button, .terminal-context-menu li', localized('向下拆分', 'Split down')],
      ['inputCmd', '.terminal-context-menu button, .terminal-context-menu li', localized('输入命令', 'Enter command')],
      ['aiCmd', '.terminal-context-menu button, .terminal-context-menu li', localized('AI 命令', 'AI command')],
      ['fileMgr', '.terminal-context-menu button, .terminal-context-menu li', localized('文件管理', 'File manager')]
    ])
  })

  await scene('05-terminal-split', async () => {
    await page.locator('.terminal-context-menu button, .terminal-context-menu li').filter({ hasText: localized('向右拆分', 'Split right') }).first().click()
    await page.waitForTimeout(3500)
    await page.keyboard.type('top -b -n 1 | head -12', { delay: 12 }).catch(() => {})
    await page.keyboard.press('Enter').catch(() => {})
    await page.waitForTimeout(1500)
    await snap(page, '05-terminal-split', [
      ['pane1', '.terminal-pane >> nth=0'],
      ['pane2', '.terminal-pane >> nth=1'],
      ['tabBar', '.terminal-tabs']
    ])
  })

  await scene('06-ai-panel-chat', async () => {
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('[data-testid="ai-panel-mode-open"]').click()
    await page.locator('[data-testid="ai-mode-classic"]').waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('[data-testid="ai-mode-classic"]').click()
    await page.waitForTimeout(2500)
    const composer = page.locator('.chat-editable').first()
    await composer.click({ timeout: 8000 })
    await composer.fill(localized('帮我查看根分区磁盘使用率，超过 80% 给出清理建议', 'Check root filesystem usage and suggest cleanup steps when it exceeds 80%.'))
    await page.waitForTimeout(400)
    await page.locator('.chat-input button[type="submit"]').first().click()
    await page.locator('.message.assistant').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
    await page.waitForTimeout(2000)
    await page.evaluate(async ({ title, summary, history }) => {
      const snapshot = await window.aiops.listChatConversations()
      const selectedId = snapshot?.data?.selectedConversationId
      if (!snapshot?.ok || !selectedId) throw new Error('The active documentation conversation was not persisted.')
      const result = await window.aiops.updateChatConversation({ id: selectedId, title, summary })
      if (!result?.ok) throw new Error(result?.errorMessage || 'Could not localize the documentation conversation.')
      const productSession = await window.aiops.updateProductSession({ id: selectedId, title })
      if (!productSession?.ok) throw new Error(productSession?.errorMessage || 'Could not localize the active product session.')
      const otherConversations = snapshot.data.conversations.filter((conversation) => conversation.id !== selectedId)
      for (const [index, conversation] of otherConversations.entries()) {
        const localizedHistory = history[index] || history[history.length - 1]
        const update = await window.aiops.updateChatConversation({
          id: conversation.id,
          title: localizedHistory.title,
          summary: localizedHistory.summary,
          preserveSelection: true
        })
        if (!update?.ok) throw new Error(update?.errorMessage || 'Could not localize a documentation conversation.')
      }
    }, {
      title: localized('磁盘空间检查', 'Disk space check'),
      summary: localized('检查根分区并给出清理建议', 'Check the root filesystem and recommend cleanup steps'),
      history: LOCALE === 'en-US'
        ? [
            { title: 'Database query analysis', summary: 'Review a slow database query' },
            { title: 'Kubernetes release failure', summary: 'Diagnose a failed Kubernetes release' },
            { title: 'Production inspection', summary: 'Inspect the production environment' }
          ]
        : [
            { title: '数据库慢查询', summary: '检查数据库慢查询' },
            { title: 'K8s 发布失败', summary: '诊断 Kubernetes 发布失败' },
            { title: '生产巡检', summary: '检查生产环境运行状态' }
          ]
    })
    await page.waitForTimeout(600)
    await snap(page, '06-ai-panel-chat', [
      ['aiPanel', '.ai-panel'],
      ['composer', '.chat-editable'],
      ['send', '.chat-input button[type="submit"]'],
      ['modelSelect', '[data-testid="ai-model-select"]'],
      ['contextTag', '.context-trigger-tag'],
      ['userMsg', '.message.user'],
      ['assistantMsg', '.message.assistant'],
      ['modeOpen', '[data-testid="ai-panel-mode-open"]']
    ])
  })

  await scene('06b-ai-project-files', async () => {
    const activeTab = page.locator('.terminal-tab.active').first()
    const terminalSessionId = await activeTab.getAttribute('data-terminal-session-id')
    const panelId = await activeTab.getAttribute('data-panel-id')
    await page.evaluate(async ({ cwd, terminalSessionId, panelId, transcriptPath }) => {
      await window.aiops.publishAiAgentSessionEvent({
        source: 'codex',
        sessionId: 'docs-project-session',
        event: 'SessionStart',
        title: 'Service API changes',
        summary: 'Updating server status',
        cwd,
        transcriptPath,
        terminalSessionId,
        panelId
      })
    }, { cwd: projectRoot, terminalSessionId, panelId, transcriptPath: codexTranscriptPath })
    await page.waitForTimeout(1800)
    await page.evaluate(async () => {
      await window.aiops.mutateProjectEntry({
        source: 'codex',
        sessionId: 'docs-project-session',
        kind: 'create-file',
        relativePath: 'src/generated.ts'
      })
    })
    await page.waitForTimeout(1200)
    await page.locator('[data-testid="ai-project-files-toggle"]').click()
    await page.locator('.project-files-panel').waitFor({ state: 'visible', timeout: 10000 })
    await snap(page, '06b-ai-project-files', [
      ['toggle', '[data-testid="ai-project-files-toggle"]'],
      ['header', '.project-files-header'],
      ['recent', '.project-files-recent'],
      ['recentRow', '.project-files-recent-row'],
      ['tree', '.project-files-tree'],
      ['treeRow', '.project-files-tree-row']
    ])
    await page.locator('[data-testid="project-files-close"]').click()
  })

  await scene('07-agents-mode', async () => {
    await page.locator('[data-testid="agents-mode-entry"]').click()
    await page.locator('.agents-search input').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(2000)
    await snap(page, '07-agents-mode', [
      ['sidebar', '.agents-sidebar'],
      ['search', '.agents-search'],
      ['row1', '.product-session-item >> nth=0'],
      ['row2', '.product-session-item >> nth=1'],
      ['aiPanel', '.ai-panel'],
      ['agentsEntry', '[data-testid="agents-mode-entry"]']
    ])
  })

  await scene('07b-agents-new-menu', async () => {
    const searchBox = await page.locator('.agents-search').first().boundingBox()
    await page.mouse.click(searchBox.x + searchBox.width + 25, searchBox.y + searchBox.height / 2)
    await page.waitForTimeout(900)
    await snap(page, '07b-agents-new-menu', [
      ['newMenu', '.agents-new-session-menu'],
      ['search', '.agents-search']
    ])
    await page.locator('.agents-search input').click()
    await page.locator('.agents-new-session-menu').waitFor({ state: 'hidden', timeout: 5000 })
  })

  await scene('07c-agents-restore', async () => {
    await page.locator('.product-session-item:visible')
      .filter({ hasText: localized('磁盘空间检查', 'Disk space check') })
      .first()
      .click()
    await page.waitForTimeout(3500)
    await snap(page, '07c-agents-restore', [
      ['row', '.product-session-item:visible'],
      ['aiPanel', '.ai-panel'],
      ['userMsg', '.message.user'],
      ['assistantMsg', '.message.assistant'],
      ['composer', '.chat-editable']
    ])
    await rail('workspace').click()
    await page.waitForTimeout(800)
  })

  await scene('08-ai-sessions', async () => {
    await rail('aiSessions').click()
    await page.waitForTimeout(3000)
    await snap(page, '08-ai-sessions', [['row', '.ai-session-row']])
  })

  await scene('08b-ai-session-content', async () => {
    const sessionRow = page.locator('.ai-session-row').filter({ hasText: 'Service API changes' }).first()
    await sessionRow.click({ button: 'right', timeout: 8000 })
    await page.locator('.ai-session-context-menu button').filter({ hasText: localized('打开会话内容', 'Open session content') }).click()
    await page.locator('.managed-ai-session-content').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(2500)
    await snap(page, '08b-ai-session-content', [
      ['workspace', '.managed-ai-session-content'],
      ['toolbar', '.managed-ai-session-content-toolbar'],
      ['record', '.managed-ai-session-record-card >> nth=1'],
      ['actions', '.managed-ai-session-record-actions >> nth=1'],
      ['status', '.managed-ai-session-content-status']
    ])
  })

  await scene('09-quick-commands', async () => {
    await rail('snippets').click()
    await page.waitForTimeout(2200)
    await snap(page, '09-quick-commands', [
      ['toolbar', '.snippets-toolbar'],
      ['toolbarLeft', '.snippets-toolbar-left'],
      ['toolbarRight', '.snippets-toolbar-right'],
      ['list', '.snippets-list'],
      ['item', '.snippet-item']
    ])
  })

  await scene('09b-files-workspace', async () => {
    await rail('files').click()
    await page.locator('.files-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2500)
    await snap(page, '09b-files-workspace', [
      ['workspace', '.files-workspace'],
      ['modeSwitch', '.files-mode-switch'],
      ['leftSide', '.files-transfer-side >> nth=0'],
      ['rightSide', '.files-transfer-side >> nth=1']
    ])
  })

  await scene('10-knowledge', async () => {
    await rail('knowledge').click()
    await page.waitForTimeout(2500)
    await snap(page, '10-knowledge', [
      ['addBtn', '.kb-add-button'],
      ['search', '.kb-search'],
      ['tree', '.kb-tree-wrapper'],
      ['node', '.kb-tree-node'],
      ['capacity', '.kb-capacity-bar'],
      ['header', '.kb-panel-header']
    ])
  })

  await scene('10b-knowledge-editor', async () => {
    const docNode = page.locator('.kb-tree-node').filter({ hasText: localized('文档', 'document') }).first()
    await docNode.dblclick({ timeout: 8000 })
    await page.waitForTimeout(4000)
    await snap(page, '10b-knowledge-editor', [
      ['editor', '.kb-editor-root'],
      ['modeToggle', '.kb-editor-mode'],
      ['actions', '.kb-editor-actions'],
      ['header', '.kb-editor-header'],
      ['tree', '.kb-tree-wrapper']
    ])
  })

  await scene('11-assets', async () => {
    await rail('assets').click()
    await page.locator('.assets-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2000)
    await snap(page, '11-assets', [
      ['workspace', '.assets-workspace'],
      ['tabHosts', '.assets-workspace [role=tab], .assets-workspace button', localized('主机管理', 'Host management')],
      ['tabBastion', '.assets-workspace [role=tab], .assets-workspace button', localized('堡垒机管理', 'Bastion management')],
      ['tabKeys', '.assets-workspace [role=tab], .assets-workspace button', localized('密钥管理', 'Key management')],
      ['tabProxy', '.assets-workspace [role=tab], .assets-workspace button', localized('代理管理', 'Proxy management')],
      ['hostCard', '.assets-workspace [class*=card], .assets-workspace [class*=host-row]', 'prod-bastion']
    ])
  })

  await scene('11a-extensions-workspace', async () => {
    await rail('extensions').click()
    await page.locator('.extensions-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2500)
    await snap(page, '11a-extensions-workspace', [
      ['list', '.extension_list_container'],
      ['search', '.extension_search_box'],
      ['item', '.extension_item >> nth=0'],
      ['detail', '.extensions-workspace'],
      ['dragTarget', '.extension_drag_placeholder']
    ])
  })

  await scene('11b-database-workspace', async () => {
    await rail('database').click()
    await page.locator('.database-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2200)
    await snap(page, '11b-database-workspace', [
      ['workspace', '.database-workspace'],
      ['sidebar', '.db-sidebar'],
      ['tree', '.db-tree'],
      ['main', '.db-main'],
      ['tabs', '.db-workspace-tabs'],
      ['overview', '.db-overview']
    ])
  })

  await scene('11b2-database-ai-workflow', async () => {
    await page.locator('.db-workspace-add-tab').click()
    await page.locator('.db-sql-editor').waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('.db-ai-pane-toggle').click()
    await page.locator('.db-ai-pane').waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('.db-ai-pane-quick-actions button').filter({ hasText: localized('生成 SELECT', 'Generate SELECT') }).click()
    await page.locator('.db-ai-pane-message.assistant').last().waitFor({ state: 'visible', timeout: 25000 })
    await page.waitForTimeout(1600)
    await snap(page, '11b2-database-ai-workflow', [
      ['context', '.db-ai-pane-context-card'],
      ['composer', '.db-ai-pane-composer'],
      ['quickActions', '.db-ai-pane-quick-actions'],
      ['sqlResult', '.db-ai-pane-sql-result'],
      ['sqlActions', '.db-ai-pane-sql-result header']
    ])
  })

  await scene('11c-kubernetes-workspace', async () => {
    await rail('kubernetes').click()
    await page.locator('.k8s-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2200)
    await snap(page, '11c-kubernetes-workspace', [
      ['workspace', '.k8s-workspace'],
      ['contexts', '.k8s-context-strip'],
      ['terminal', '.k8s-terminal-surface'],
      ['clusterConfig', '.k8s-cluster-config-container'],
      ['resources', '.k8s-resource-workspace']
    ])
  })

  await scene('11d-kubernetes-ai-workflow', async () => {
    const prodCluster = page.locator('.k8s-cluster-item').filter({ hasText: 'prod-cluster' }).first()
    if (await prodCluster.count()) await prodCluster.click()
    await page.locator('.k8s-resource-workspace').waitFor({ state: 'visible', timeout: 10000 })
    const namespace = page.locator('.k8s-resource-filter select').first()
    if (await namespace.count()) await namespace.selectOption('ops')
    const search = page.locator('.k8s-resource-search input').first()
    if (await search.count()) await search.fill('billing')
    const resourceRow = page.locator('.k8s-resource-table tbody tr').filter({ hasText: 'billing-worker' }).first()
    await resourceRow.getByTitle('Logs').click()
    await page.locator('.k8s-resource-output').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(1200)
    await snap(page, '11d-kubernetes-ai-workflow', [
      ['agentBar', '.k8s-agent-bar'],
      ['agentCommand', '.k8s-agent-command'],
      ['resource', '.k8s-resource-workspace'],
      ['output', '.k8s-resource-output'],
      ['sendAi', '.k8s-resource-output-actions button:nth-child(3)']
    ])
  })

  const settingsPage = async (settingsKey, shotName, extra) => {
    await rail('settings').click()
    await page.waitForTimeout(1200)
    await page.locator(`.settings-nav-item[data-settings-key="${settingsKey}"]`).click()
    await page.waitForTimeout(2200)
    await snap(page, shotName, [['nav', `.settings-nav-item[data-settings-key="${settingsKey}"]`], ...(extra || [])])
  }
  await scene('12-settings-general', () => settingsPage('general', '12-settings-general', [
    ['langRow', '.settings-form-row', localized('语言', 'Language')],
    ['bgRow', '.settings-form-row', localized('背景', 'Background')]
  ]))
  await scene('13-settings-terminal', () => settingsPage('terminal', '13-settings-terminal', [
    ['fontRow', '.settings-form-row', localized('字体', 'Font')],
    ['termType', '.settings-form-row', localized('终端类型', 'Terminal Type')],
    ['cursorRow', '.settings-form-row', localized('光标', 'Cursor')]
  ]))
  await scene('14-settings-models', () => settingsPage('models', '14-settings-models', []))
  await scene('15-settings-shortcuts', () => settingsPage('shortcuts', '15-settings-shortcuts', []))
  await scene('16b-settings-export-mcp', () => settingsPage('exportMcp', '16b-settings-export-mcp', [
    ['bridgeCard', '.export-mcp-card >> nth=0'],
    ['hostsHeader', '.external-codex-mcp-card .agent-hook-card-header', 'aiopsterm_hosts']
  ]))
  await scene('17-settings-about', () => settingsPage('about', '17-settings-about', []))
  await scene('18-settings-ai-notifications', () => settingsPage('aiNotifications', '18-settings-ai-notifications', [
    ['preferences', '.settings-section-card >> nth=0'],
    ['soundRow', '.settings-checkbox-item', localized('通知声音', 'Notification sound')],
    ['customSound', '.notification-sound-row'],
    ['hookInstaller', '.agent-hook-card-header']
  ]))

  await scene('hostagent-and-mcp', async () => {
    await rail('settings').click()
    await page.waitForTimeout(1200)
    await page.locator('.settings-nav-item[data-settings-key="aiRemoteHostManagement"]').click()
    await page.waitForTimeout(2000)
    await snap(page, '19-settings-hostagent', [
      ['nav', '.settings-nav-item[data-settings-key="aiRemoteHostManagement"]'],
      ['tabs', '.settings-agent-tabs']
    ])
    await page.locator('.settings-agent-tabs button').filter({ hasText: 'MCP' }).first().click()
    await page.waitForTimeout(3000)
    await snap(page, '16-settings-mcp', [
      ['tabs', '.settings-agent-tabs'],
      ['tabMcp', '.settings-agent-tabs button', 'MCP'],
      ['addBtn', 'button', 'Add Server'],
      ['toolHeader', '.mcp-tool-header']
    ])
    await page.locator('.settings-agent-tabs button').filter({ hasText: localized('规则', 'Rules') }).first().click()
    await page.waitForTimeout(2000)
    await snap(page, '20-settings-rules', [
      ['tabs', '.settings-agent-tabs'],
      ['rulesList', '.rules-list']
    ])
  })

  log('closing app')
  await app.close().catch(() => {})
  if (failures.length) {
    throw new Error(`Screenshot capture failed (${failures.length}): ${failures.join('; ')}`)
  }
  log('DONE — now run: python3 scripts/docs-screenshots/annotate.py')
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
