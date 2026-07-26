// Capture documentation screenshots from the built app with seeded demo data.
//
// Usage:
//   npm run build
//   node scripts/docs-screenshots/capture.js            # on a machine with a display
//   xvfb-run -a node scripts/docs-screenshots/capture.js  # headless
//
// Raw PNGs + element bounding-box manifests go to test-results/docs-screenshots/raw.
// Then run: python3 scripts/docs-screenshots/annotate.py
const path = require('path')
const fs = require('fs')
const os = require('os')

const REPO = path.resolve(__dirname, '..', '..')
const OUT = path.join(REPO, 'test-results', 'docs-screenshots', 'raw')
const { _electron } = require(path.join(REPO, 'node_modules', 'playwright-core'))

const log = (m) => console.log(`[capture] ${m}`)

const seedEnv = (userDataDir) => ({
  ...process.env,
  SHELL: process.env.SHELL || '/bin/bash',
  NODE_ENV: 'test',
  AIOPSTERM_USER_DATA_DIR: userDataDir,
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
}

async function scene(name, fn) {
  try {
    await fn()
    log(`scene ok: ${name}`)
  } catch (err) {
    log(`scene FAIL: ${name}: ${String(err).split('\n')[0]}`)
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiopsterm-docs-shots-'))
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiopsterm-docs-project-'))
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Service API\n\nDocumentation screenshot project.\n')
  fs.writeFileSync(path.join(projectRoot, 'src', 'server.ts'), 'export const status = "ready"\n')
  log('launching built app...')
  const app = await _electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: REPO,
    env: seedEnv(userDataDir),
    timeout: 90000
  })
  const page = await app.firstWindow({ timeout: 90000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(8000)
  const rail = (title) => page.locator(`.side-rail .rail-button[title="${title}"]`)

  await scene('01-main-window', async () => {
    await snap(page, '01-main-window', [
      ['sideRail', '.side-rail'],
      ['modulePanel', '.module-panel'],
      ['dashboard', '.terminal-dashboard'],
      ['aiPanel', '.ai-panel'],
      ['topBar', '.top-bar'],
      ['agentsEntry', '[data-testid="agents-mode-entry"]'],
      ['railWorkspace', '.side-rail .rail-button[title="工作区"]'],
      ['railSettings', '.side-rail .rail-button[title="设置"]'],
      ['searchInput', '.workspace-search input'],
      ['directTab', '.workspace-tabs button', '直接连接'],
      ['bastionTab', '.workspace-tabs button', '堡垒机资源'],
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
      ['splitRight', '.terminal-context-menu button, .terminal-context-menu li', '向右拆分'],
      ['splitDown', '.terminal-context-menu button, .terminal-context-menu li', '向下拆分'],
      ['inputCmd', '.terminal-context-menu button, .terminal-context-menu li', '输入命令'],
      ['aiCmd', '.terminal-context-menu button, .terminal-context-menu li', 'AI 命令'],
      ['fileMgr', '.terminal-context-menu button, .terminal-context-menu li', '文件管理']
    ])
  })

  await scene('05-terminal-split', async () => {
    await page.locator('.terminal-context-menu button, .terminal-context-menu li').filter({ hasText: '向右拆分' }).first().click()
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
    await composer.fill('帮我查看根分区磁盘使用率，超过 80% 给出清理建议')
    await page.waitForTimeout(400)
    await page.locator('.chat-input button[type="submit"]').first().click()
    await page.locator('.message.assistant').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
    await page.waitForTimeout(2000)
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
    await page.evaluate(async ({ cwd, terminalSessionId, panelId }) => {
      await window.aiops.publishAiAgentSessionEvent({
        source: 'codex',
        sessionId: 'docs-project-session',
        event: 'SessionStart',
        title: 'Service API changes',
        summary: 'Updating server status',
        cwd,
        terminalSessionId,
        panelId
      })
    }, { cwd: projectRoot, terminalSessionId, panelId })
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
    await page.keyboard.press('Escape').catch(() => {})
  })

  await scene('07c-agents-restore', async () => {
    await page.locator('.product-session-item').filter({ hasText: '生产巡检' }).first().click()
    await page.waitForTimeout(3500)
    await snap(page, '07c-agents-restore', [
      ['row', '.product-session-item', '生产巡检'],
      ['aiPanel', '.ai-panel'],
      ['userMsg', '.message.user'],
      ['assistantMsg', '.message.assistant'],
      ['composer', '.chat-editable']
    ])
    await rail('工作区').click()
    await page.waitForTimeout(800)
  })

  await scene('08-ai-sessions', async () => {
    await rail('AI 会话').click()
    await page.waitForTimeout(3000)
    await snap(page, '08-ai-sessions', [['row', '.ai-session-row']])
  })

  await scene('09-quick-commands', async () => {
    await rail('快捷命令').click()
    await page.waitForTimeout(2200)
    await snap(page, '09-quick-commands', [
      ['toolbar', '.snippets-toolbar'],
      ['toolbarLeft', '.snippets-toolbar-left'],
      ['toolbarRight', '.snippets-toolbar-right'],
      ['list', '.snippets-list'],
      ['item', '.snippet-item']
    ])
  })

  await scene('10-knowledge', async () => {
    await rail('知识库').click()
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
    const docNode = page.locator('.kb-tree-node').filter({ hasText: '文档' }).first()
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
    await rail('资产').click()
    await page.locator('.assets-workspace').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(2000)
    await snap(page, '11-assets', [
      ['workspace', '.assets-workspace'],
      ['tabHosts', '.assets-workspace [role=tab], .assets-workspace button', '主机管理'],
      ['tabBastion', '.assets-workspace [role=tab], .assets-workspace button', '堡垒机管理'],
      ['tabKeys', '.assets-workspace [role=tab], .assets-workspace button', '密钥管理'],
      ['tabProxy', '.assets-workspace [role=tab], .assets-workspace button', '代理管理'],
      ['hostCard', '.assets-workspace [class*=card], .assets-workspace [class*=host-row]', 'prod-bastion']
    ])
  })

  await scene('11b-database-workspace', async () => {
    await rail('数据库').click()
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

  await scene('11c-kubernetes-workspace', async () => {
    await rail('Kubernetes').click()
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

  const settingsPage = async (navText, shotName, extra) => {
    await rail('设置').click()
    await page.waitForTimeout(1200)
    await page.locator('.settings-nav-item').filter({ hasText: navText }).first().click()
    await page.waitForTimeout(2200)
    await snap(page, shotName, [['nav', '.settings-nav-item', navText], ...(extra || [])])
  }
  await scene('12-settings-general', () => settingsPage('通用', '12-settings-general', [
    ['langRow', '.settings-form-row', '语言'],
    ['bgRow', '.settings-form-row', '背景']
  ]))
  await scene('13-settings-terminal', () => settingsPage('终端', '13-settings-terminal', [
    ['fontRow', '.settings-form-row', '字体'],
    ['termType', '.settings-form-row', '终端类型'],
    ['cursorRow', '.settings-form-row', '光标']
  ]))
  await scene('14-settings-models', () => settingsPage('模型', '14-settings-models', []))
  await scene('15-settings-shortcuts', () => settingsPage('快捷键', '15-settings-shortcuts', []))
  await scene('16b-settings-export-mcp', () => settingsPage('导出 MCP', '16b-settings-export-mcp', [
    ['bridgeCard', '.export-mcp-card >> nth=0'],
    ['hostsHeader', '.external-codex-mcp-card .agent-hook-card-header', 'aiopsterm_hosts']
  ]))
  await scene('17-settings-about', () => settingsPage('关于', '17-settings-about', []))
  await scene('18-settings-ai-notifications', () => settingsPage('AI 通知', '18-settings-ai-notifications', [
    ['preferences', '.settings-section-card >> nth=0'],
    ['soundRow', '.settings-checkbox-item', '通知声音'],
    ['customSound', '.notification-sound-row'],
    ['hookInstaller', '.agent-hook-card-header']
  ]))

  await scene('hostagent-and-mcp', async () => {
    await rail('设置').click()
    await page.waitForTimeout(1200)
    await page.locator('.settings-nav-item').filter({ hasText: '主机Agent' }).first().click()
    await page.waitForTimeout(2000)
    await snap(page, '19-settings-hostagent', [
      ['nav', '.settings-nav-item', '主机Agent'],
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
    await page.locator('.settings-agent-tabs button').filter({ hasText: '规则' }).first().click()
    await page.waitForTimeout(2000)
    await snap(page, '20-settings-rules', [
      ['tabs', '.settings-agent-tabs'],
      ['rulesList', '.rules-list']
    ])
  })

  log('closing app')
  await app.close().catch(() => {})
  log('DONE — now run: python3 scripts/docs-screenshots/annotate.py')
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
