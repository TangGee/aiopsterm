import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer } from 'http'
import { chmod, mkdir, readFile, rm, writeFile } from 'fs/promises'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'
import { deflateRawSync } from 'zlib'

const launchApp = async (name: string, env: NodeJS.ProcessEnv = {}) => {
  const userDataDir = path.join(os.tmpdir(), `aiopsterm-e2e-${name}-${Date.now()}`)
  await mkdir(userDataDir, { recursive: true })
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...env,
      NODE_ENV: 'test',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_CHAT_HISTORY_ENABLE_SEED: '1',
      AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED: '1',
      AIOPSTERM_ALIASES_ENABLE_SEED: '1',
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
    }
  })
}

const createFakeKubectl = async () => {
  const dir = path.join(os.tmpdir(), `aiopsterm-e2e-kubectl-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, 'kubectl')
  await writeFile(
    filePath,
    [
      '#!/bin/sh',
      'set -eu',
      'case "$1:$2" in',
      '  get:namespaces)',
      '    echo "NAME STATUS AGE"',
      '    echo "e2e Active 1d"',
      '    echo "default Active 1d"',
      '    ;;',
      '  *)',
      '    echo "unexpected kubectl args: $*" >&2',
      '    exit 17',
      '    ;;',
      'esac'
    ].join('\n'),
    'utf-8'
  )
  await chmod(filePath, 0o755)
  return { dir, filePath }
}

const crcTable = new Uint32Array(256).map((_, value) => {
  let crc = value
  for (let index = 0; index < 8; index++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const createZipFixture = (entries: Array<{ name: string; content: string }>) => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const compressedContent = deflateRawSync(content)
    const checksum = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressedContent.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, compressedContent)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressedContent.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + compressedContent.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const endHeader = Buffer.alloc(22)
  endHeader.writeUInt32LE(0x06054b50, 0)
  endHeader.writeUInt16LE(0, 4)
  endHeader.writeUInt16LE(0, 6)
  endHeader.writeUInt16LE(entries.length, 8)
  endHeader.writeUInt16LE(entries.length, 10)
  endHeader.writeUInt32LE(centralSize, 12)
  endHeader.writeUInt32LE(centralOffset, 16)
  endHeader.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, endHeader])
}

const createE2eExtensionStore = async () => {
  const dir = path.join(os.tmpdir(), `aiopsterm-e2e-extension-store-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const manifest = {
    id: 'ops-runbook',
    displayName: 'Ops Runbook',
    version: '1.3.0',
    description: '本地维护流程和技能模板。',
    main: 'main.js',
    iconKey: 'runbook',
    categories: ['Tools', 'Runbook'],
    functions: [
      { title: '巡检模板', desc: '生成磁盘、负载、服务状态的检查清单。' },
      { title: '发布守卫', desc: '把发布前后验证步骤整理为可复用流程。' }
    ],
    contributes: { views: [{ id: 'opsRunbook', name: 'Ops Runbook' }] }
  }
  await writeFile(
    path.join(dir, 'ops-runbook-1.3.0.external-reference'),
    createZipFixture([
      { name: 'plugin.json', content: JSON.stringify(manifest) },
      { name: 'main.js', content: 'module.exports = {}' },
      { name: 'README.md', content: '# Ops Runbook\n\nE2E store package.' }
    ])
  )
  return { dir }
}

const startVoiceTranscriptionServer = async () => {
  const requests: Array<{ method?: string; url?: string; authorization?: string; body: Buffer }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body
      })
      if (request.method !== 'POST' || request.url !== '/v1/audio/transcriptions' || request.headers.authorization !== 'Bearer e2e-voice-key') {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unexpected voice transcription request' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: 'Provider transcript from E2E voice backend' }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

const configureVoiceTranscriptionProvider = async (page: Page, baseUrl: string) => {
  await page.evaluate(async (providerBaseUrl) => {
    const api = (window as unknown as { aiops: { getConfig: () => Promise<any>; saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
    const config = await api.getConfig()
    const modelSettings = config.modelSettings || {}
    const providers = modelSettings.providers || {}
    const options = Array.isArray(modelSettings.options) ? modelSettings.options.filter((option: { name?: string }) => option.name !== 'whisper-e2e') : []
    await api.saveConfig({
      modelProvider: 'openai-compatible',
      modelName: 'whisper-e2e',
      modelSettings: {
        ...modelSettings,
        providers: {
          ...providers,
          openai: {
            ...(providers.openai || {}),
            baseUrl: providerBaseUrl,
            apiKey: 'e2e-voice-key',
            modelId: 'whisper-1',
            apiFormat: 'chat-completions'
          }
        },
        options: [...options, { name: 'whisper-e2e', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
      }
    })
  }, baseUrl)
}

const restoreLocalAiProvider = async (page: Page) => {
  await page.evaluate(async () => {
    const api = (window as unknown as { aiops: { saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
    await api.saveConfig({
      modelProvider: 'local',
      modelName: 'aiopsterm-local-agent'
    })
  })
}

const configureModelSelectorOptions = async (page: Page) => {
  await page.evaluate(async () => {
    const api = (window as unknown as { aiops: { getConfig: () => Promise<any>; saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
    const config = await api.getConfig()
    const modelSettings = config.modelSettings || {}
    const providers = modelSettings.providers || {}
    const options = Array.isArray(modelSettings.options)
      ? modelSettings.options.filter((option: { name?: string }) => option.name !== 'qwen2.5-coder' && option.name !== 'gpt-5-Thinking')
      : []
    await api.saveConfig({
      modelSettings: {
        ...modelSettings,
        providers: {
          ...providers,
          ollama: {
            ...(providers.ollama || {}),
            baseUrl: 'http://localhost:11434',
            apiKey: '',
            modelId: 'qwen2.5-coder'
          }
        },
        options: [
          ...options,
          { name: 'gpt-5-Thinking', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
          { name: 'qwen2.5-coder', locked: false, checked: true, type: 'custom', apiProvider: 'ollama' }
        ]
      }
    })
  })
}

const installVoiceRecorderDouble = async (page: Page) => {
  await page.evaluate(() => {
    class MockMediaRecorder {
      static isTypeSupported() {
        return true
      }

      state: 'inactive' | 'recording' = 'inactive'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onerror: ((event: { error: Error }) => void) | null = null
      onstop: (() => void) | null = null
      private readonly mimeType: string

      constructor(_stream: unknown, options: { mimeType?: string } = {}) {
        this.mimeType = options.mimeType || 'audio/webm'
      }

      start() {
        this.state = 'recording'
      }

      stop() {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        this.ondataavailable?.({
          data: new Blob([new Uint8Array(4096)], { type: this.mimeType })
        })
        this.onstop?.()
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }]
        })
      }
    })
  })
}

const disableE2eMotion = async (page: Page) => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `
  })
}

test('aiopsterm primary desktop flows', async () => {
  test.setTimeout(360_000)
  await mkdir('test-results', { recursive: true })
  const filesFixtureDir = path.join(os.tmpdir(), `aiopsterm-e2e-files-${Date.now()}`)
  await mkdir(filesFixtureDir, { recursive: true })
  await writeFile(path.join(filesFixtureDir, 'e2e-visible.txt'), 'E2E visible local file\n', 'utf-8')
  await writeFile(path.join(filesFixtureDir, '.hidden-e2e.env'), 'AIOPSTERM_E2E=1\n', 'utf-8')
  const fakeKubectl = await createFakeKubectl()
  const extensionStore = await createE2eExtensionStore()
  const voiceServer = await startVoiceTranscriptionServer()
  const app = await launchApp('primary', {
    AIOPSTERM_KUBECTL_PATH: fakeKubectl.filePath,
    AIOPSTERM_EXTENSION_STORE_DIR: extensionStore.dir
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await installVoiceRecorderDouble(page)
    await configureModelSelectorOptions(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await installVoiceRecorderDouble(page)

    await expect(page.getByText('aiopsterm', { exact: true })).toBeVisible()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'local shell' })).toBeVisible()
    await expect(page.getByText('智能助手')).toBeVisible()
    await expect(page.locator('.top-bar[data-onboarding-id="top-layout-controls"]')).toBeVisible()
    await expect(page.locator('.mode-button')).toHaveCount(1)
    await expect(page.locator('.right-ai-toggle[data-onboarding-id="right-ai-toggle"]')).toBeVisible()
    await expect(page.locator('.top-update-badge')).toContainText('本地版本')
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.workspace-tabs')).not.toBeVisible()
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.workspace-tabs')).toBeVisible()
    await page.locator('.right-ai-toggle').click()
    await expect(page.getByText('智能助手')).not.toBeVisible()
    await page.locator('.right-ai-toggle').click()
    await expect(page.getByText('智能助手')).toBeVisible()
    await expect(page.locator('.workspace-tabs button').filter({ hasText: '直接连接' })).toBeVisible()
    await expect(page.locator('.workspace-tabs button').filter({ hasText: '堡垒机资源' })).toBeVisible()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: '最近连接' })).toBeVisible()
    await page.locator('.workspace-search input').fill('mysql')
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'mysql-primary' })).toBeVisible()
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'staging-api' })).not.toBeVisible()
    await page.locator('.workspace-search input').fill('')
    await page.locator('.workspace-button[title="显示 IP"]').click()
    await expect(page.locator('.workspace-host-row').filter({ hasText: '10.24.8.12' }).first()).toBeVisible()
    await page.locator('.workspace-tabs button').filter({ hasText: '堡垒机资源' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'jumpserver-org' })).toBeVisible()
    await page.locator('.workspace-row-action.refresh').click()
    await expect(page.locator('.workspace-host-row').filter({ hasText: '10.90.0.15' })).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: '10.24.8.12' }).first().click({ button: 'right' })
    await expect(page.locator('.workspace-node-menu')).toBeVisible()
    await page.locator('.workspace-node-menu button').filter({ hasText: '编辑备注' }).click()
    await page.locator('.workspace-host-row').filter({ hasText: '10.24.8.12' }).first().dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'prod-bastion' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.24.8.12:22' })).toHaveCount(0)
    await page.locator('.workspace-tabs button').filter({ hasText: '直接连接' }).click()
    await page.locator('.workspace-button[title="显示主机名"]').click()
    await page.locator('.workspace-button[title="主机"]').click()
    await expect(page.locator('.workspace-host-modal')).toContainText('新建主机')
    await page.locator('.workspace-host-form label').filter({ hasText: '主机名' }).locator('input').fill('workspace-e2e')
    await page.locator('.workspace-host-form label').filter({ hasText: '地址' }).locator('input').fill('10.72.0.5')
    await page.locator('.workspace-host-form label').filter({ hasText: '用户名' }).locator('input').fill('ops')
    await page.locator('.workspace-host-form label').filter({ hasText: '分组' }).locator('input').fill('E2E-Workspace')
    await page.locator('.workspace-host-form label').filter({ hasText: '端口' }).locator('input').fill('2205')
    await page.locator('.workspace-host-form label').filter({ hasText: '备注' }).locator('textarea').fill('workspace e2e host')
    await page.locator('.workspace-host-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'workspace-e2e' })).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: 'workspace-e2e' }).dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'workspace-e2e' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.72.0.5:2205' })).toHaveCount(0)
    await page.locator('.workspace-tabs button').filter({ hasText: '堡垒机资源' }).click()
    await page.locator('.workspace-button[title="新建"]').click()
    await page.locator('.workspace-add-menu button').filter({ hasText: '自定义文件夹' }).click()
    await page.locator('.workspace-folder-modal .files-folder-form input').fill('E2E 文件夹')
    await page.locator('.workspace-folder-modal .files-folder-form textarea').fill('e2e folder')
    await page.locator('.workspace-folder-modal .files-folder-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'E2E 文件夹' })).toBeVisible()
    await page.locator('.workspace-folder-row').filter({ hasText: 'E2E 文件夹' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '编辑文件夹' }).click()
    await page.locator('.workspace-folder-modal .files-folder-form input').fill('E2E 归档')
    await page.locator('.workspace-folder-modal .files-folder-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'E2E 归档' })).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: 'prod-bastion' }).first().click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '编辑备注' }).click()
    await page.locator('.workspace-comment-edit input').fill('e2e workspace note')
    await page.locator('.workspace-comment-edit input').press('Enter')
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'e2e workspace note' })).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: 'prod-bastion' }).first().click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '从文件夹移除' }).click()
    await expect(page.getByText('已从 核心业务 移除 prod-bastion')).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: 'prod-bastion' }).first().click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '移动到文件夹' }).click()
    await page.locator('.files-folder-option').filter({ hasText: 'E2E 归档' }).click()
    await expect(page.getByText('已移动 prod-bastion 到 E2E 归档')).toBeVisible()
    await page.locator('.workspace-folder-row').filter({ hasText: 'E2E 归档' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '删除文件夹' }).click()
    await expect(page.locator('.files-folder-confirm')).toContainText('其中 1 个主机将移出该文件夹')
    await page.locator('.files-folder-confirm footer button').filter({ hasText: '删除' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'E2E 归档' })).not.toBeVisible()
    await page.getByRole('button', { name: 'jumpserver-org (同步资产) 堡垒机资源' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '管理资产' }).click()
    await expect(page.locator('.workspace-management-modal')).toContainText('管理资产 · jumpserver-org')
    await page.locator('.workspace-management-modal header button').click()

    await page.getByTitle('资产').click()
    await expect(page.getByText('主机管理')).toBeVisible()
    await expect(page.getByText('密钥管理')).toBeVisible()
    await page.getByText('主机管理').click()
    await expect(page.locator('.host-card').filter({ hasText: 'prod-bastion' })).toBeVisible()
    await page.locator('.asset-search-input input').fill('mysql')
    await expect(page.locator('.host-card').filter({ hasText: 'mysql-primary' })).toBeVisible()
    await expect(page.locator('.host-card').filter({ hasText: 'prod-bastion' })).not.toBeVisible()
    await page.locator('.asset-search-input input').fill('')
    await page.getByTestId('asset-new-host-button').click()
    await expect(page.locator('.asset-form-panel header').filter({ hasText: '新建主机' })).toBeVisible()
    await page.getByTitle('关闭').click()
    await page.getByTitle('导入帮助').click()
    await expect(page.getByText('导入文件需要包含 username')).toBeVisible()
    await page.locator('.host-card').filter({ hasText: 'prod-bastion' }).click({ button: 'right' })
    await expect(page.locator('.asset-context-menu')).toBeVisible()
    await expect(page.locator('.asset-context-menu').getByText('克隆')).toBeVisible()
    await page.locator('.asset-context-menu').getByText('克隆').click()
    await expect(page.locator('.asset-form-panel input').first()).toHaveValue('prod-bastion_Clone')
    await page.getByTitle('关闭').click()
    await page.getByTestId('asset-new-host-button').click()
    await page.locator('.asset-form-panel label').filter({ hasText: '主机名' }).locator('input').fill('e2e-host')
    await page.locator('.asset-form-panel label').filter({ hasText: '地址' }).locator('input').fill('10.66.0.8')
    await page.locator('.asset-form-panel label').filter({ hasText: '用户名' }).locator('input').fill('ops')
    await page.locator('.asset-form-panel label').filter({ hasText: '分组' }).locator('input').fill('E2E')
    await page.locator('.asset-form-panel label').filter({ hasText: '端口' }).locator('input').fill('2200')
    await page.locator('[data-onboarding-id="asset-form-submit"]').click()
    await expect(page.locator('.host-card').filter({ hasText: 'e2e-host' })).toBeVisible()
    const optionalAssetFormClose = page.locator('.asset-form-panel header button[title="关闭"]')
    if ((await optionalAssetFormClose.count()) > 0) {
      await optionalAssetFormClose.click()
      await expect(page.locator('.asset-form-panel')).toBeHidden()
    }
    await page.locator('.host-card').filter({ hasText: 'e2e-host' }).dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'e2e-host' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.66.0.8:2200' })).toHaveCount(0)
    await page.locator('.terminal-tab').filter({ hasText: 'e2e-host' }).click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toContainText('Fork SSH Channel')
    await page.locator('.tab-menu button').filter({ hasText: 'Fork SSH Channel' }).click()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'e2e-host fork' })).toBeVisible()
    await expect(page.locator('.terminal-pane.active .terminal-output-mirror')).not.toContainText('aiopsterm ssh ops@10.66.0.8:2200')
    await page.getByText('导出').click()
    await expect(page.getByText('选择导出主机')).toBeVisible()
    await expect(page.locator('.export-assets-modal footer button').filter({ hasText: '确认' })).toBeDisabled()
    await page.locator('.export-assets-modal .export-leaf-row').filter({ hasText: 'prod-bastion' }).locator('input').check()
    await page.locator('.export-assets-modal').getByText('确认').click()
    await expect(page.getByText('选择导出主机')).not.toBeVisible()
    await page.locator('.asset-action-button').filter({ hasText: '导入' }).click()
    await expect(page.locator('.import-assets-modal')).toContainText('e2e-imported-json')
    await page.locator('.import-assets-modal footer button').filter({ hasText: '确认导入' }).click()
    await expect(page.locator('.host-card').filter({ hasText: 'e2e-imported-json' })).toBeVisible()
    const jumpserverCard = page.getByRole('button', { name: 'jumpserver-org 主机, sync' })
    await jumpserverCard.click({ button: 'right' })
    await page.locator('.asset-context-menu').getByText('刷新资产').click()
    await expect(page.locator('.host-card').filter({ hasText: 'jumpserver-org-synced-asset' })).toBeVisible()
    await jumpserverCard.click({ button: 'right' })
    await page.locator('.asset-context-menu').getByText('管理资产').click()
    await expect(page.locator('.asset-management-context')).toContainText('jumpserver-org')
    await expect(page.locator('.asset-table-scroll tbody tr').filter({ hasText: 'jumpserver-org-synced-asset' })).toBeVisible()
    await page.locator('.asset-table-scroll tbody tr').filter({ hasText: 'jumpserver-org-synced-asset' }).getByText('编辑').click()
    await expect(page.locator('.managed-asset-form label').filter({ hasText: '主机名' }).locator('input')).toBeDisabled()
    await page.locator('.managed-asset-form label').filter({ hasText: '备注' }).locator('textarea').fill('e2e-refresh-comment')
    await page.locator('.managed-asset-form .asset-submit-button').click()
    await expect(page.locator('.asset-table-scroll tbody tr').filter({ hasText: 'e2e-refresh-comment' })).toBeVisible()
    await page.locator('.asset-table-toolbar').getByText('添加资产').click()
    await page.locator('.managed-asset-form label').filter({ hasText: '主机名' }).locator('input').fill('e2e-managed')
    await page.locator('.managed-asset-form label').filter({ hasText: '主机 IP' }).locator('input').fill('10.88.0.8')
    await page.locator('.managed-asset-form label').filter({ hasText: '备注' }).locator('textarea').fill('e2e manual')
    await page.locator('.managed-asset-form .asset-submit-button').click()
    await expect(page.locator('.asset-table-scroll tbody tr').filter({ hasText: 'e2e-managed' })).toBeVisible()
    await page.locator('.rail-button[title="文件"]').click()
    await page.locator('.rail-button[title="资产"]').click()
    await page.getByText('密钥管理').click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'prod-ed25519' })).toBeVisible()
    await page.getByTestId('key-new-button').click()
    await page.locator('.key-form-panel label').filter({ hasText: '名称' }).locator('input').fill('e2e-key')
    await page.locator('.key-form-panel label').filter({ hasText: '私钥' }).locator('textarea').fill('-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----')
    await page.locator('.key-form-panel label').filter({ hasText: '公钥' }).locator('textarea').fill('ssh-ed25519')
    await page.locator('.key-form-panel .asset-submit-button').click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).toBeVisible()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).toContainText('类型ed25519')
    await page.getByTestId('key-new-button').click()
    await page.locator('.key-form-panel label').filter({ hasText: '名称' }).locator('input').fill('e2e-import-key')
    await page.locator('.key-drop-area').click()
    await expect(page.getByText('已导入 e2e-import-rsa.pem，识别为 RSA')).toBeVisible()
    await page.locator('.key-form-panel .asset-submit-button').click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-import-key' })).toContainText('类型rsa')
    await page.locator('.keychain-card').filter({ hasText: 'e2e-key' }).click({ button: 'right' })
    await page.locator('.asset-context-menu .delete').click()
    await expect(page.locator('.asset-confirm-modal')).toContainText('删除密钥')
    await page.locator('.asset-confirm-modal input').fill('e2e-key')
    await page.locator('.asset-confirm-modal footer .danger').click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).not.toBeVisible()

    await page.locator('.rail-button[title="文件"]').click()
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
    await expect(page.getByRole('button', { name: '拖拽模式' })).toBeVisible()
    await expect(page.getByText('新增连接 或 左侧拖拽至此')).toBeVisible()
    await expect(page.locator('.file-table')).toBeVisible()
    await page.locator('.files-session-header select').selectOption('asset-1')
    await expect(page.locator('.files-session-card').filter({ hasText: 'prod-bastion' }).locator('.file-error')).toContainText(
      'SFTP connection is unavailable for this file session.'
    )
    await expect(page.locator('.files-session-card').filter({ hasText: 'prod-bastion' }).locator('.file-table')).not.toContainText('release-note.md')
    await page.locator('.files-session-header select').selectOption('local')
    const transferLocalBrowser = page.locator('.files-session-card').filter({ hasText: 'Local' })
    await transferLocalBrowser.locator('.file-path-input').fill(filesFixtureDir)
    await transferLocalBrowser.locator('.file-path-input').press('Enter')
    await expect(transferLocalBrowser.locator('.file-table')).toContainText('e2e-visible.txt')
    await expect(transferLocalBrowser.locator('.file-table')).toContainText('.hidden-e2e.env')
    await transferLocalBrowser.locator('.file-icon-button[title="隐藏隐藏文件"]').click()
    await expect(transferLocalBrowser.locator('.file-table')).not.toContainText('.hidden-e2e.env')
    await expect(page.locator('.transfer-progress-panel')).not.toBeVisible()
    await page.getByRole('button', { name: '默认模式' }).click()
    await expect(page.locator('.files-default-layout')).toBeVisible()
    await page.locator('.files-default-title').filter({ hasText: 'prod-bastion' }).click()
    await expect(page.locator('.files-default-session').filter({ hasText: 'prod-bastion' }).locator('.file-error')).toContainText(
      'SFTP connection is unavailable for this file session.'
    )
    const defaultLocalBrowser = page.locator('.files-default-session').filter({ hasText: 'Local' })
    await defaultLocalBrowser.locator('.file-path-input').fill(filesFixtureDir)
    await defaultLocalBrowser.locator('.file-path-input').press('Enter')
    await expect(defaultLocalBrowser.locator('.file-table')).toContainText('e2e-visible.txt')
    const localFileRow = defaultLocalBrowser.locator('tbody tr').filter({ hasText: 'e2e-visible.txt' })
    await localFileRow.hover()
    await localFileRow.locator('.file-row-actions button[title="更多"]').click({ force: true })
    await expect(defaultLocalBrowser.locator('.file-more-menu')).toBeVisible()
    await defaultLocalBrowser.locator('.file-more-menu button').first().click()
    await expect(page.getByText('复制到')).toBeVisible()
    await page.locator('.file-modal-card header button[title="关闭"]').click()

    await page.getByTitle('知识库').click()
    await expect(page.getByRole('heading', { name: '知识库' })).toBeVisible()
    await expect(page.getByText('commands')).toBeVisible()
    await page.locator('.kb-search input').fill('interface')
    await expect(page.getByText('interface.png')).toBeVisible()
    await expect(page.getByText('Summary to Doc.md')).not.toBeVisible()
    await page.locator('.kb-search input').fill('')
    await page.locator('.kb-add-button').click()
    await page.locator('.kb-add-menu button').filter({ hasText: '新建文件夹' }).click()
    await page.locator('.kb-rename-input').fill('Runbooks')
    await page.locator('.kb-rename-input').press('Enter')
    await expect(page.getByText('Runbooks')).toBeVisible()
    await page.getByText('明细').click()
    await expect(page.getByText('容量来源明细')).toBeVisible()
    await page.locator('.file-modal-card header button[title="关闭"]').click()
    await page.locator('.kb-add-button').click()
    await page.locator('.kb-add-menu button').filter({ hasText: '上传文件' }).click()
    await expect(page.locator('.kb-transfer')).toBeVisible()

    await page.getByTitle('片段').click()
    await expect(page.getByRole('heading', { name: '快捷命令' })).toBeVisible()
    await expect(page.getByText('巡检命令')).toBeVisible()
    await page.locator('.snippet-item.group-folder').filter({ hasText: '巡检命令' }).click()
    await expect(page.getByText('磁盘巡检')).toBeVisible()
    await page.locator('.snippets-panel-native').getByTitle('搜索').click()
    await page.locator('.snippet-search input').fill('Nginx')
    await expect(page.getByText('Nginx 状态')).toBeVisible()
    await page.locator('.snippet-search input').fill('')
    await page.locator('.snippet-search input').blur()
    await page.locator('.snippet-item').filter({ hasText: '磁盘巡检' }).click()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'df -h' })).toHaveCount(0)
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'free -m' })).toHaveCount(0)
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'uptime' })).toHaveCount(0)
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: '[snippet] 磁盘巡检' })).toHaveCount(0)
    await page.getByTitle('新建片段').click()
    await expect(page.getByText('新建片段')).toBeVisible()
    await page.locator('.snippet-edit-panel input').fill('E2E 片段')
    await page.locator('.script-editor-container textarea').fill('pwd\nsleep==1000\nctrl+c')
    await page.locator('.snippet-edit-panel footer button').filter({ hasText: '确定' }).click()
    await expect(page.getByText('E2E 片段')).toBeVisible()
    await page.getByTitle('宏录制').click()
    await expect(page.getByText('录制中')).toBeVisible()
    await page.getByText('停止录制').click()
    await expect(page.getByText('录制中')).not.toBeVisible()

    await page.getByTitle('扩展').click()
    await expect(page.locator('.extension_panel').getByRole('heading', { name: '插件' })).toBeVisible()
    await expect(page.locator('.extension_item').filter({ hasText: 'Jumpserver Support' })).toBeVisible()
    await expect(page.locator('.extension_item').filter({ hasText: 'Alias' })).toBeVisible()
    await page.locator('.extension_search_box input').fill('Alias')
    await expect(page.locator('.extension_item').filter({ hasText: 'Alias' })).toBeVisible()
    await expect(page.locator('.extension_item').filter({ hasText: 'Cloud Assets' })).not.toBeVisible()
    await page.locator('.extension_item').filter({ hasText: 'Alias' }).click()
    await expect(page.locator('.alias-config-table')).toBeVisible()
    await page.locator('.alias-search-input input').fill('gst')
    await expect(page.locator('.alias-config-table input').first()).toHaveValue('gst')
    await page.locator('.alias-search-input input').fill('')
    await page.locator('.alias-config-toolbar button').click()
    await page.locator('.alias-config-table tbody tr').first().locator('input').fill('e2ealias')
    await page.locator('.alias-config-table tbody tr').first().locator('textarea').fill('echo e2e')
    await page.locator('.alias-config-table tbody tr').first().getByTitle('保存').click()
    await expect(page.locator('.alias-config-table input').first()).toHaveValue('e2ealias')
    await page.locator('.extension_search_box input').fill('Runbook')
    await page.locator('.extension_item').filter({ hasText: 'Ops Runbook' }).click()
    await expect(page.locator('.plugin_detail_view').getByRole('heading', { name: 'Ops Runbook' })).toBeVisible()
    await expect(page.getByText('插件标识')).toBeVisible()
    await page.getByRole('button', { name: '插件功能' }).click()
    await expect(page.getByText('巡检模板')).toBeVisible()

    await page.getByTitle('Kubernetes').click()
    await expect(page.locator('.k8s-context-item').filter({ hasText: 'prod/admin' })).toBeVisible()
    await expect(page.locator('.k8s-cluster-item').filter({ hasText: 'prod-cluster' })).toBeVisible()
    await page.locator('.k8s-search').first().locator('input').fill('staging')
    await expect(page.locator('.k8s-cluster-item').filter({ hasText: 'staging-cluster' })).toBeVisible()
    await page.locator('.k8s-search').first().getByTitle('清除搜索').click()
    await expect(page.locator('.k8s-cluster-item').filter({ hasText: 'prod-cluster' })).toBeVisible()
    await page.locator('.k8s-search').first().locator('input').fill('staging')
    await page.locator('.k8s-cluster-item').filter({ hasText: 'staging-cluster' }).click()
    await expect(page.locator('.k8s-tab-item').filter({ hasText: 'staging-cluster' })).toBeVisible()
    await expect(page.locator('.k8s-cluster-item.active').filter({ hasText: 'staging-cluster' })).toBeVisible()
    await page.locator('.k8s-command-line input').fill('kubectl get pods -A')
    await page.locator('.k8s-command-line input').press('Enter')
    await expect(page.getByText('[aiopsterm kubectl] kubectl get pods -A')).toBeVisible()
    await page.locator('.k8s-search').first().getByTitle('清除搜索').click()
    await page.locator('.k8s-cluster-item').filter({ hasText: 'prod-cluster' }).click()
    await expect(page.locator('.k8s-cluster-item.active').filter({ hasText: 'prod-cluster' })).toBeVisible()
    await expect(page.locator('.k8s-resource-header p')).toContainText('prod-cluster')
    await expect(page.locator('.k8s-resource-header p')).toContainText('prod/admin')
    await expect(page.locator('.k8s-resource-workspace').getByText('资源概览')).toBeVisible()
    await expect(page.locator('.k8s-resource-table').getByText('api-gateway-6d8c9bb7f6-l6j2m')).toBeVisible()
    await page.locator('.k8s-resource-filter select').selectOption('ops')
    await expect(page.locator('.k8s-resource-table').getByText('billing-worker-7f9d6f9dd9-rx8mm')).toBeVisible()
    await page.locator('.k8s-resource-search input').fill('billing')
    await page.locator('.k8s-resource-table tbody tr').filter({ hasText: 'billing-worker-7f9d6f9dd9-rx8mm' }).getByTitle('Describe').click()
    await expect(page.locator('.k8s-resource-output').getByText('kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')).toBeVisible()
    await page.locator('.k8s-resource-table tbody tr').filter({ hasText: 'billing-worker-7f9d6f9dd9-rx8mm' }).getByTitle('Logs').click()
    await expect(page.locator('.k8s-resource-output').getByText('kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')).toBeVisible()
    await page.locator('.k8s-resource-output').getByTitle('发送输出到 AI').click()
    await expect(page.locator('.message.user').filter({ hasText: '请分析这个 Kubernetes 输出' }).first()).toBeVisible()
    await page.locator('.k8s-resource-output').getByTitle('清空输出').click()
    await expect(page.locator('.k8s-resource-output').getByText('选择 Kubernetes 资源后')).toBeVisible()
    await expect(page.locator('.k8s-resource-header button.k8s-workspace-button')).toBeEnabled()
    const billingResourceRow = page.locator('.k8s-resource-table tbody tr').filter({ hasText: 'billing-worker-7f9d6f9dd9-rx8mm' })
    await expect(billingResourceRow).toBeVisible()
    const sendBillingToTerminal = billingResourceRow.getByTitle('发送到终端')
    await expect(sendBillingToTerminal).toBeEnabled()
    await sendBillingToTerminal.dispatchEvent('click')
    await expect(page.getByText('[aiopsterm kubectl] kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')).toBeVisible()
    await page.locator('.k8s-form-actions.inline').getByRole('button', { name: /Agent 代理/ }).click()
    await page.locator('.k8s-proxy-config-modal .k8s-switch-row input').first().check()
    await page.locator('.k8s-proxy-config-modal select').selectOption('HTTPS')
    await page.locator('.k8s-proxy-config-modal input').nth(1).fill('proxy.e2e.local')
    await page.locator('.k8s-proxy-config-modal input').nth(2).fill('9443')
    await page.locator('.k8s-proxy-config-modal footer .primary').click()
    await page.locator('.k8s-form-actions.inline').getByRole('button', { name: /Agent 代理/ }).click()
    await expect(page.locator('.k8s-proxy-config-modal input').nth(1)).toHaveValue('proxy.e2e.local')
    await page.locator('.k8s-proxy-config-modal header').getByTitle('关闭').click()
    await expect(page.getByText('本地集群')).toBeVisible()
    const k8sConfigSearch = page.locator('.k8s-search-header .k8s-search')
    const configSearchClear = k8sConfigSearch.getByTitle('清除搜索')
    if (await configSearchClear.count()) {
      await configSearchClear.click()
    } else {
      await k8sConfigSearch.locator('input').fill('')
    }
    await page.locator('.k8s-tab-bar button').filter({ hasText: '堡垒机资源' }).click()
    await expect(page.getByText('jumpserver-org')).toBeVisible()
    await page.locator('.k8s-tab-bar button').filter({ hasText: '本地集群' }).click()
    await page.locator('.k8s-action-button').click()
    await expect(page.locator('.k8s-add-cluster-modal header').filter({ hasText: '添加集群' })).toBeVisible()
    await page.locator('.k8s-file-picker-row button').click()
    await expect(page.locator('.k8s-add-cluster-modal select')).toContainText('e2e/admin')
    await page.locator('.k8s-test-connection button').click()
    await expect(page.getByText('连接成功')).toBeVisible()
    await page.locator('.k8s-add-cluster-modal footer button').filter({ hasText: '保存' }).click()
    await expect(page.locator('.k8s-config-cluster-item').filter({ hasText: 'e2e-cluster' })).toBeVisible()
    await page.locator('.k8s-action-button').click()
    await page.locator('.k8s-modal-tabs button').filter({ hasText: '手动配置' }).click()
    await page.locator('.k8s-add-cluster-modal textarea').fill(
      [
        'apiVersion: v1',
        'kind: Config',
        'current-context: manual/admin',
        'clusters:',
        '- name: manual-cluster',
        '  cluster:',
        '    server: https://manual.k8s.test:6443',
        'contexts:',
        '- name: manual/admin',
        '  context:',
        '    cluster: manual-cluster',
        '    namespace: default'
      ].join('\n')
    )
    await page.locator('.k8s-test-connection button').click()
    await expect(page.getByText('连接成功')).toBeVisible()
    await page.locator('.k8s-add-cluster-modal footer button').filter({ hasText: '保存' }).click()
    await expect(page.locator('.k8s-config-cluster-item').filter({ hasText: 'manual-cluster' })).toBeVisible()

    await page.getByTitle('数据库').click()
    await expect(page.locator('.db-sidebar-header').filter({ hasText: 'Database' })).toBeVisible()
    await expect(page.locator('.db-tree-row.connection').filter({ hasText: 'orders-postgres' })).toBeVisible()
    await expect(page.locator('.db-overview').getByText('New Connection')).toBeVisible()
    await page.locator('.db-search input').fill('metrics')
    await expect(page.locator('.db-search-clear')).toBeVisible()
    await page.locator('.db-search-clear').click()
    await expect(page.locator('.db-search input')).toHaveValue('')
    await page.locator('.db-search input').fill('oracle')
    await page.locator('.db-search input').press('Escape')
    await expect(page.locator('.db-search input')).toHaveValue('')
    await page.locator('.db-sidebar-actions button[title="Add"]').click()
    await expect(page.locator('.db-add-menu')).toBeVisible()
    await page.locator('.db-add-menu button').filter({ hasText: 'PostgreSQL' }).click()
    const dbConnectionModal = page.locator('.db-connection-modal')
    await expect(dbConnectionModal).toContainText('PostgreSQL')
    await expect(dbConnectionModal).toContainText('SSL Mode')
    await dbConnectionModal.locator('input').first().fill('e2e-postgres')
    await dbConnectionModal.locator('select').nth(3).selectOption('verify-full')
    await expect(dbConnectionModal.locator('input').nth(7)).toHaveValue('jdbc:postgresql://127.0.0.1:5432')
    await dbConnectionModal.locator('footer button').filter({ hasText: 'Test Connection' }).click()
    await expect(dbConnectionModal).toContainText('PostgreSQL 16 local backend validation')
    await dbConnectionModal.locator('button[type="submit"]').click()
    await expect(page.locator('.db-tree-row.connection').filter({ hasText: 'e2e-postgres' })).toBeVisible()
    await page.locator('.db-workspace-add-tab').click()
    await expect(page.locator('.db-workspace-tab').filter({ hasText: 'Query 1' })).toBeVisible()
    const sqlSaveButton = page.locator('.db-sql-toolbar-save')
    const sqlSaveAsButton = page.locator('.db-sql-toolbar-save-as')
    await expect(sqlSaveButton).toBeEnabled()
    await expect(sqlSaveAsButton).toBeEnabled()
    await page.locator('.db-sql-editor').fill("select id, service from public.orders where status = 'open' order by updated_at desc limit 5; select * from ops.ops_incidents;")
    const e2eSqlSavePath = path.join(os.homedir(), 'Downloads', 'Query-1-orders-postgres-orders-public.sql')
    await rm(e2eSqlSavePath, { force: true })
    await sqlSaveAsButton.click()
    await expect(page.locator('.db-sql-save-state')).toContainText('Saved:')
    await expect
      .poll(async () => {
        try {
          return await readFile(e2eSqlSavePath, 'utf-8')
        } catch {
          return ''
        }
      })
      .toContain("select id, service from public.orders where status = 'open'")
    await page.locator('.db-sql-editor').fill("select id from public.orders where status = 'open';")
    await expect(page.locator('.db-sql-save-state')).toContainText('Unsaved changes')
    await sqlSaveButton.click()
    await expect(page.locator('.db-sql-save-state')).toContainText('Saved:')
    await expect.poll(async () => readFile(e2eSqlSavePath, 'utf-8')).toContain("select id from public.orders where status = 'open';")
    await rm(e2eSqlSavePath, { force: true })
    await page.locator('.db-sql-editor').fill("select id, service from public.orders where status = 'open' order by updated_at desc limit 5; select * from ops.ops_incidents;")
    await page.getByTitle('Format').click()
    await expect(page.locator('.db-sql-editor')).toHaveValue(/SELECT\n  id/)
    await page.getByTitle('Run all').click()
    await expect(page.locator('.db-result-tabs').filter({ hasText: '#1-1' })).toBeVisible()
    await expect(page.locator('.db-result-table').filter({ hasText: 'payment-api' })).toBeVisible()
    await page.locator('.db-result-table th').filter({ hasText: 'service' }).getByTitle('Filter').click()
    await expect(page.locator('.db-filter-popover')).toContainText('payment-api')
    await page.locator('.db-filter-search input').fill('orders')
    await page.locator('.db-filter-popover input[type="checkbox"]').first().check()
    await page.locator('.db-filter-footer .primary').click()
    await expect(page.locator('.db-result-table')).toContainText('orders-worker')
    await expect(page.locator('.db-result-table')).not.toContainText('payment-api')
    await page.locator('.db-result-table th').filter({ hasText: 'service' }).getByTitle('Filter').click()
    await page.locator('.db-filter-row.all button').click()
    await expect(page.locator('.db-result-table')).toContainText('payment-api')
    await page.locator('.db-result-tabs [role="tab"]').filter({ hasText: 'Overview' }).click()
    await expect(page.locator('.db-sql-overview th')).toHaveText(['SQL', 'Message', 'Time'])
    await expect(page.locator('.db-sql-overview')).toContainText('Execution OK')
    await page.locator('.db-sql-overview tbody tr').first().click()
    await expect(page.locator('.db-result-table').filter({ hasText: 'payment-api' })).toBeVisible()
    await page.locator('.db-sql-editor').evaluate((node: HTMLTextAreaElement) => {
      const offset = node.value.indexOf('ops_incidents')
      node.setSelectionRange(offset, offset)
    })
    await page.getByTitle('Run current statement').click()
    await expect(page.locator('.db-result-table').filter({ hasText: 'checkout' })).toBeVisible()
    await page.locator('.db-sql-editor').fill('select id from "public"."orders" where status = \'open\';\nselect * from ops.ops_incidents;')
    await page.locator('.db-sql-editor').evaluate((node: HTMLTextAreaElement) => {
      const selected = 'select id from "public"."orders" where status = \'open\''
      node.setSelectionRange(0, selected.length)
    })
    await page.getByTitle('AI Convert SQL').click()
    await expect(page.locator('.db-ai-drawer')).toContainText('Convert SQL')
    await expect(page.locator('.db-ai-section').filter({ hasText: 'Reasoning' })).toBeVisible()
    await expect(page.locator('.db-ai-section').filter({ hasText: 'Response' })).toBeVisible()
    await page.locator('.db-ai-dialect-row select').selectOption('mssql')
    await expect(page.locator('.db-ai-drawer')).toContainText('Text-only conversion')
    await expect(page.locator('.db-ai-sql-actions pre')).toContainText('SELECT TOP (100)')
    await expect(page.locator('.db-ai-sql-actions button').filter({ hasText: 'Run ReadOnly' })).toBeDisabled()
    await page.locator('.db-ai-drawer footer button').filter({ hasText: 'Clear' }).click()
    const ordersTableRow = page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).first()
    await ordersTableRow.locator('button').click()
    await expect(page.locator('.db-tree-row.column').filter({ hasText: 'owner' })).toBeVisible()
    await page.locator('.db-tree-row.column').filter({ hasText: 'owner' }).click()
    await expect(page.locator('.db-tree-row.column').filter({ hasText: 'owner' })).toHaveClass(/selected/)
    await ordersTableRow.click({ button: 'right' })
    await page.locator('.db-context-menu button').filter({ hasText: 'Query Console' }).click()
    await expect(page.locator('.db-sql-editor')).toHaveValue('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
    await ordersTableRow.dblclick()
    await expect(page.locator('.db-where-bar').filter({ hasText: 'orders' })).toBeVisible()
    await page.locator('.db-where-bar input').fill('status = investigating')
    await page.locator('.db-where-bar button').click()
    await expect(page.locator('.db-result-table').filter({ hasText: 'investigating' })).toBeVisible()
    await page.locator('.db-result-table tbody tr').first().locator('td').nth(4).dblclick()
    await page.locator('.db-result-table td input').fill('alice-e2e')
    await page.locator('.db-result-table td input').press('Enter')
    await expect(page.locator('.db-result-table tbody tr.updated')).toBeVisible()
    await expect(page.locator('.db-edit-summary')).toContainText('1 Updated')
    await expect(page.locator('.db-edit-summary pre')).toContainText('UPDATE "public"."orders"')
    await page.locator('.db-toolbar button[title="Undo"]').click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await expect(page.locator('.db-result-table')).toContainText('alice')
    await page.locator('.db-toolbar button[title="Add row"]').click()
    await expect(page.locator('.db-result-table tbody tr.new')).toBeVisible()
    await expect(page.locator('.db-edit-summary')).toContainText('1 New')
    await page.locator('.db-result-table tbody tr.new td').nth(4).dblclick()
    await page.locator('.db-result-table tbody tr.new input').fill('e2e-owner')
    await page.locator('.db-result-table tbody tr.new input').press('Enter')
    await expect(page.locator('.db-edit-summary pre')).toContainText('INSERT INTO "public"."orders"')
    await page.locator('.db-result-table tbody tr.new').click()
    await page.locator('.db-toolbar button[title="Delete row"]').click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await page.locator('.db-result-table tbody tr').first().click()
    await page.locator('.db-toolbar button[title="Delete row"]').click()
    await expect(page.locator('.db-result-table tbody tr.deleted')).toBeVisible()
    await expect(page.locator('.db-edit-summary')).toContainText('1 Deleted')
    await expect(page.locator('.db-edit-summary pre')).toContainText('DELETE FROM "public"."orders"')
    await page.locator('.db-edit-summary-actions button').filter({ hasText: 'Discard All' }).click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).click({ button: 'right' })
    await expect(page.locator('.db-context-menu')).toBeVisible()
    await page.locator('.db-context-menu button').filter({ hasText: 'View DDL' }).click()
    await expect(page.locator('.db-ddl-modal textarea')).toHaveValue(/CREATE TABLE/)
    await page.locator('.db-ddl-modal header button').click()
    await page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).click({ button: 'right' })
    await page.locator('.db-context-menu button').filter({ hasText: 'Drop' }).click()
    await expect(page.locator('.db-danger-confirm')).toContainText('DROP TABLE')
    await page.locator('.db-danger-confirm input').fill('orders')
    await page.locator('.db-danger-confirm footer .danger').click()
    await expect(page.locator('.db-ai-drawer')).toContainText('DROP TABLE public.orders')
    await expect(page.locator('.db-ai-sql-actions')).toContainText('Generated SQL')

    await page.getByTitle('设置').click()
    await expect(page.locator('.settings-workspace-title').getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.locator('.settings-nav-item').filter({ hasText: '通用' })).toBeVisible()
    await expect(page.getByText('基础设置')).toBeVisible()
    await expect(page.getByText('默认背景')).toBeVisible()
    await page.locator('.settings-bg-tile.preset').first().click()
    await expect(page.locator('.settings-sliders')).toBeVisible()
    await page.getByRole('button', { name: '打开入门引导' }).click()
    await expect(page.getByRole('heading', { name: '入门引导' })).toBeVisible()
    await expect(page.locator('.onboarding-progress-line')).toContainText('已完成 0 / 4')
    await page.locator('.onboarding-module-card').filter({ hasText: '界面导览' }).click()
    await expect(page.locator('.spotlight-card')).toContainText('模块切换栏')
    await page.locator('.spotlight-card .primary').click()
    await expect(page.locator('.spotlight-card')).toContainText('左侧功能面板')
    await page.locator('.spotlight-close').click()
    await page.getByTitle('设置').click()
    await page.locator('.settings-nav-item').filter({ hasText: '通用' }).click()
    await page.locator('input[name="defaultLayout"]').nth(1).check()
    await expect(page.locator('input[name="defaultLayout"]').nth(1)).toBeChecked()
    await page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
    await expect(page.getByText('终端类型')).toBeVisible()
    await page.getByTitle('竖线光标').click()
    await expect(page.locator('.cursor-style-button.active').filter({ has: page.locator('.cursor-preview.bar') })).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '模型' }).click()
    await expect(page.getByText('模型名称')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'LiteLLM' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Amazon Bedrock' })).toBeVisible()
    await expect(page.locator('.provider-card').filter({ hasText: 'Amazon Bedrock' }).getByText('AWS Region')).toBeVisible()
    await page.locator('.provider-card').filter({ hasText: 'LiteLLM' }).locator('.settings-input').first().fill('http://litellm.e2e')
    await page.locator('.provider-card').filter({ hasText: 'LiteLLM' }).getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('LiteLLM Save 成功')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: 'AI 偏好设置' }).click()
    await expect(page.getByText('启用 Extended Thinking')).toBeVisible()
    await expect(page.getByText('OpenAI Reasoning Effort')).toBeVisible()
    await page.locator('.settings-section-card').filter({ hasText: '启用代理' }).locator('input[type="checkbox"]').first().check()
    await expect(page.getByText('代理类型')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: 'MCP' }).click()
    await expect(page.getByRole('heading', { name: 'MCP Servers' })).toBeVisible()
    await page.locator('.mcp-tool-header button').filter({ hasText: 'read_file' }).click()
    await expect(page.getByText('read_file 已禁用')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: 'Skills' }).click()
    await expect(page.getByText('incident-triage')).toBeVisible()
    await page.getByRole('button', { name: 'Create' }).click()
    await page.locator('.settings-modal-card label').filter({ hasText: 'Skill Name' }).locator('input').fill('e-skill')
    await page.locator('.settings-modal-card label').filter({ hasText: 'Description' }).locator('textarea').fill('E2E skill description')
    await page.locator('.settings-modal-card label').filter({ hasText: 'Content' }).locator('textarea').fill('E2E skill content')
    await page.locator('.settings-modal-card footer button').filter({ hasText: '创建' }).click()
    await expect(page.locator('.skills-list').getByText('e-skill', { exact: true })).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '快捷键' }).click()
    await page.locator('.shortcut-display').first().click()
    await page.locator('.shortcut-modal input').fill('Ctrl+K')
    await page.locator('.shortcut-modal footer button').filter({ hasText: '保存' }).click()
    await expect(page.locator('.shortcut-display').first().getByText('K')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '隐私' }).click()
    await page.locator('input[name="secretRedaction"]').first().check()
    await expect(page.getByText('Supported Patterns')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '关于' }).click()
    await expect(page.getByText('Log Diagnostics')).toBeVisible()
    await expect(page.locator('.diagnostics-card-header').getByText('Feedback', { exact: true })).toBeVisible()
    await page.locator('.about-card .settings-button').click()
    await expect(page.locator('.about-card .settings-button')).toContainText('Latest Version')
    await page.locator('.diagnostics-card').filter({ hasText: 'Log Diagnostics' }).getByRole('button', { name: /Open Log Dir/ }).click()
    await expect(page.getByText('日志目录已打开')).toBeVisible()

    await page.locator('.user-rail-trigger').click()
    await expect(page.locator('.user-menu-popover')).toBeVisible()
    await expect(page.locator('.user-menu-popover')).toContainText('账号中心')
    await expect(page.locator('.user-menu-popover')).toContainText('个人信息')
    await expect(page.locator('.user-menu-popover')).toContainText('退出登录')
    await page.locator('.user-menu-popover button').filter({ hasText: '个人信息' }).click()
    await expect(page.locator('.user-info-title').getByRole('heading', { name: '个人信息' })).toBeVisible()
    await expect(page.locator('.user-info-card')).toContainText('Local Operator')
    await expect(page.locator('.user-info-card')).toContainText('VIP用户')
    await expect(page.locator('.user-status-strip')).toContainText('本地账号')
    await page.locator('.user-info-footer button').filter({ hasText: '账号中心' }).click()
    await expect(page.locator('.user-account-modal')).toContainText('可信设备')
    await expect(page.locator('.user-account-modal')).toContainText('Linux Workstation')
    await expect(page.locator('.user-account-modal')).toContainText('MacBook')
    await expect(page.locator('.account-device-actions button[title="当前设备不能移除"]')).toBeDisabled()
    await page.locator('.account-device-actions button[title="移除可信设备"]').click()
    await expect(page.locator('.user-trusted-device-confirm')).toContainText('确认移除该可信设备')
    await page.locator('.user-trusted-device-confirm footer .primary').click()
    await expect(page.locator('.user-info-notice')).toContainText('可信设备已移除')
    await expect(page.locator('.user-account-modal')).not.toContainText('MacBook')
    await page.locator('.user-account-modal header').getByTitle('关闭').click()

    await page.locator('button[title="编辑"]').click()
    await page.locator('.user-info-form input').first().fill('E2E Operator')
    await page.locator('button[title="保存"]').click()
    await expect(page.locator('.user-info-card')).toContainText('E2E Operator')

    await page.locator('button[title="修改邮箱"]').click()
    await expect(page.locator('.user-modal-card').filter({ hasText: '修改邮箱' })).toBeVisible()
    await page.locator('.user-modal-card input').first().fill('e2e@example.local')
    await page.locator('.user-code-row button').click()
    await expect(page.locator('.user-code-row button')).toContainText('300s')
    await page.locator('.user-modal-card input').nth(1).fill('123456')
    await page.locator('.user-modal-card footer .primary').click()
    await expect(page.locator('.user-info-form')).toContainText('e2e@example.local')

    await page.locator('button[title="重置密码"]').click()
    await page.locator('.user-modal-card input[type="password"]').first().fill('Aa123456!')
    await page.locator('.user-modal-card input[type="password"]').nth(1).fill('Aa123456!')
    await page.locator('.user-modal-card footer .primary').click()
    await expect(page.locator('.user-info-notice')).toContainText('密码重置成功')

    await page.locator('.user-avatar.large').click()
    await expect(page.locator('.avatar-settings-modal')).toBeVisible()
    await expect(page.locator('.avatar-preview-placeholder')).toContainText('点击上传头像')
    await expect(page.locator('.avatar-settings-modal footer .primary')).toBeDisabled()
    await page.locator('.avatar-settings-modal header').getByTitle('关闭').click()

    await page.locator('.user-info-footer .danger').click()
    await expect(page.locator('.user-login-card')).toContainText('请先登录')
    await expect(page.locator('.user-login-tabs')).toContainText('邮箱登录')
    await page.locator('.user-login-tabs button').filter({ hasText: '邮箱登录' }).click()
    await page.locator('.user-login-form input').first().fill('e2e-login@example.local')
    await page.locator('.user-login-form .user-code-row button').click()
    await expect(page.locator('.user-login-form .user-code-row button')).toContainText('300s')
    await page.locator('.user-login-form input').nth(1).fill('246810')
    await page.locator('.user-login-form .primary').click()
    await expect(page.locator('.user-info-card')).toContainText('E2E Operator')

    await page.getByTitle('切换到 Agents 模式').click()
    const agentsSidebar = page.locator('.agents-sidebar')
    await expect(page.locator('.agents-search input')).toBeVisible()
    await expect(agentsSidebar.getByTitle('新建会话')).toBeVisible()
    await expect(page.getByText('Agents 工作台')).toBeVisible()
    await expect(page.locator('.right-ai-toggle')).not.toBeVisible()
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.agents-search input')).not.toBeVisible()
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.agents-search input')).toBeVisible()

    await page.locator('.agents-search input').fill('conv-2')
    await expect(agentsSidebar.getByText('K8s 发布失败')).toBeVisible()
    await expect(agentsSidebar.getByText('生产巡检')).not.toBeVisible()
    await page.locator('.agents-search input').fill('')

    await agentsSidebar.getByTitle('新建会话').click()
    await expect(page.getByText('请输入本次运维目标。')).toBeVisible()
    const modeSelect = page.locator('[data-onboarding-id="ai-mode-select"]')
    await expect(modeSelect).toContainText('Agent')
    await expect(modeSelect).toHaveAttribute('style', /width:/)
    await modeSelect.click()
    await expect(page.locator('.ai-mode-popup')).toHaveAttribute('style', /min-width:/)
    await expect(page.locator('.ai-mode-popup .select-list button').first()).toContainText('Agent')
    await expect(page.locator('.ai-mode-popup .select-list button').filter({ hasText: '自动规划并等待确认' })).not.toBeVisible()
    await page.locator('.ai-mode-popup .select-list button').filter({ hasText: 'Command' }).click()
    await expect(modeSelect).toContainText('Command')
    await page.locator('.context-trigger-tag').click()
    await expect(page.locator('.context-select-popup')).toBeVisible()
    await expect(page.locator('[data-onboarding-id="ai-context-hosts-menu"]')).not.toBeVisible()
    await expect(page.locator('[data-onboarding-id="ai-localhost-option"]')).not.toBeVisible()
    await expect(page.locator('.context-select-popup .select-list button').filter({ hasText: '文档' })).toBeVisible()
    await page.locator('.context-select-popup header input').press('Escape')
    await modeSelect.click()
    await page.locator('.ai-mode-popup .select-list button').filter({ hasText: 'Agent' }).click()
    await expect(modeSelect).toContainText('Agent')
    await page.getByTestId('ai-model-select').click()
    await page.locator('.ai-model-popup header input').fill('qwen')
    const qwenModelRow = page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'qwen2.5-coder' })
    await expect(qwenModelRow).toBeVisible()
    await expect(page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'gpt-5' })).not.toBeVisible()
    await qwenModelRow.click()
    await expect(page.getByTestId('ai-model-select')).toContainText('qwen2.5-coder')
    await page.getByTestId('ai-model-select').click()
    await expect(page.locator('.ai-model-popup header input')).toHaveValue('')
    await page.locator('.ai-model-popup header input').fill('missing-model')
    await expect(page.locator('.ai-model-popup .select-list')).toContainText('没有匹配的模型')
    await page.locator('.ai-model-popup header input').fill('')
    const thinkingModelRow = page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'gpt-5' })
    await expect(thinkingModelRow).toBeVisible()
    await expect(page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'gpt-5-Thinking' })).not.toBeVisible()
    const lockedModelRow = page.locator('.ai-model-popup .select-list button.locked-model-option').filter({ hasText: 'gpt-5-pro' })
    await expect(lockedModelRow).toBeVisible()
    await expect(lockedModelRow).toBeDisabled()
    await expect(lockedModelRow).toHaveAttribute('title', /升级 VIP/)
    await thinkingModelRow.click()
    await expect(page.getByTestId('ai-model-select')).toContainText('gpt-5')
    await expect(page.getByTestId('ai-model-select')).not.toContainText('Thinking')
    await page.getByTestId('ai-model-select').click()
    await page.locator('.ai-model-popup header input').fill('aiopsterm-local')
    await page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'aiopsterm-local-agent' }).click()
    await expect(page.getByTestId('ai-model-select')).toContainText('aiopsterm-local-agent')

    await page.locator('.context-trigger-tag').click()
    await expect(page.locator('.context-select-popup')).toBeVisible()
    await page.locator('[data-onboarding-id="ai-context-hosts-menu"]').click()
    await expect(page.locator('.host-batch-footer')).toContainText('全选')
    await page.locator('.context-select-popup header input').fill('10.32.6.9')
    await page.locator('.host-batch-footer .batch-action-btn').first().click()
    await expect(page.locator('.context-tag').filter({ hasText: '10.32.6.9' })).toBeVisible()
    await expect(page.locator('.host-batch-footer')).toContainText('取消全选')
    await expect(page.locator('.host-batch-footer')).toContainText('清空选择')
    await page.locator('.host-batch-footer .batch-action-btn').filter({ hasText: '清空选择' }).click()
    await expect(page.locator('.context-tag').filter({ hasText: '10.32.6.9' })).not.toBeVisible()
    await page.locator('.context-select-popup header input').press('Escape')
    await page.locator('.context-select-popup header input').press('Escape')
    await page.locator('.context-trigger-tag').click()
    await expect(page.locator('.context-select-popup')).toBeVisible()
    await page.locator('.context-select-popup .select-list button').filter({ hasText: '文档' }).click()
    await expect(page.locator('.context-select-popup .select-list button').filter({ hasText: 'commands' })).toBeVisible()
    await page.locator('.context-select-popup header input').fill('Markdown')
    await page.locator('.context-select-popup .select-list button').filter({ hasText: 'Markdown语法指南.md' }).click()
    await expect(page.locator('.context-tag').filter({ hasText: 'Markdown语法指南.md' })).toBeVisible()

    await page.locator('.chat-editable').fill('')
    await page.locator('.chat-editable').press('/')
    await expect(page.locator('.command-select-popup')).toBeVisible()
    await page.locator('.command-select-popup header input').fill('summary')
    await expect(page.locator('.command-select-popup .select-list button').filter({ hasText: 'Summary to Doc' })).toBeVisible()
    await expect(page.locator('.command-select-popup .select-list button').filter({ hasText: '/Summary to Doc' })).not.toBeVisible()
    await page.locator('.command-select-popup header input').fill('rollback')
    await page.locator('.command-select-popup .select-list button').filter({ hasText: 'rollback-plan' }).click()
    await expect(page.locator('.chat-editable .mention-chip-command').filter({ hasText: '/rollback-plan' })).toBeVisible()
    await expect(page.getByTestId('ai-context-usage-ring')).toHaveCount(0)
    await expect(page.getByTestId('ai-file-upload-button')).toBeVisible()
    await expect(page.getByTestId('ai-file-upload-button')).toHaveAttribute('title', '上传文件')
    await page.getByTestId('ai-file-upload-button').click()
    await expect(page.locator('.input-placeholder-notice')).toContainText('已添加文件')
    await expect(page.locator('.chat-editable .mention-chip-doc').filter({ hasText: 'e2e-chat-attachment.md' })).toBeVisible()
    await expect(page.getByTestId('ai-voice-button')).toBeVisible()
    await expect(page.getByTestId('ai-voice-button')).toHaveAttribute('title', '开始语音输入')
    await configureVoiceTranscriptionProvider(page, voiceServer.baseUrl)
    await page.getByTestId('ai-voice-button').click()
    await expect(page.getByTestId('ai-voice-button')).toHaveClass(/recording/)
    await expect(page.getByTestId('ai-voice-button')).toHaveAttribute('title', '停止语音录制')
    await page.waitForTimeout(240)
    await page.getByTestId('ai-voice-button').click()
    await expect(page.locator('.input-placeholder-notice')).toContainText('语音转写完成')
    await expect(page.locator('.chat-editable')).toContainText('Provider transcript from E2E voice backend')
    expect(voiceServer.requests).toHaveLength(1)
    expect(voiceServer.requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      authorization: 'Bearer e2e-voice-key'
    })
    expect(voiceServer.requests[0].body.toString('utf8')).toContain('name="model"')
    await restoreLocalAiProvider(page)

    await page.locator('.todo-inline-header').click()
    await expect(page.locator('.todo-compact-list')).not.toBeVisible()
    await page.locator('.todo-inline-header').click()
    await expect(page.locator('.todo-compact-list')).toBeVisible()
    await expect(page.locator('.todo-item.in-progress.is-focused .todo-focus-badge')).toBeVisible()
    await expect(page.locator('.todo-compact-list .subtasks')).toContainText('检查风险级别')

    await page.locator('.chat-editable').fill('检查生产磁盘')
    await page.locator('.chat-input button[type="submit"]').click()
    await expect(page.locator('.message.user').filter({ hasText: '检查生产磁盘' })).toBeVisible()
    await expect(page.getByTestId('ai-context-usage-ring')).toBeVisible()
    await expect(page.getByTestId('ai-context-usage-ring')).toHaveAttribute('title', /\d+% - .+ \/ 128\.0K context used/)
    await expect(page.getByTestId('ai-file-upload-button')).toBeDisabled()
    await expect(page.getByTestId('ai-voice-button')).toBeDisabled()
    await expect(page.locator('.chat-input button[title="上传图片"]')).toBeDisabled()
    await expect(page.getByText('当前响应由 aiopsterm 本地后端生成')).toBeVisible()
    await expect(page.getByTestId('ai-file-upload-button')).toBeEnabled()

    await page.screenshot({ path: path.join('test-results', 'aiopsterm-agents.png'), fullPage: true })
  } finally {
    await app.close()
    await voiceServer.close()
    await rm(filesFixtureDir, { recursive: true, force: true })
    await rm(fakeKubectl.dir, { recursive: true, force: true })
    await rm(extensionStore.dir, { recursive: true, force: true })
  }
})

test('terminal tab operations and visual baseline', async () => {
  await mkdir('test-results', { recursive: true })
  const app = await launchApp('terminal')

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)

    await page.getByTitle('新建终端').click()
    await expect(page.locator('.terminal-tab')).toHaveCount(2)

    await page.getByText('向右拆分').click()
    await expect(page.locator('.terminal-tab')).toHaveCount(3)

    await page.locator('.command-line input').first().fill('df -h')
    await page.locator('.command-line input').first().press('Enter')
    await expect(page.locator('.top-notice')).toContainText('终端会话不可用')
    await expect(page.locator('.terminal-output-mirror').first()).not.toContainText('[aiopsterm] no live terminal session for: df -h')
    await expect(page.locator('.command-line input').first()).toHaveValue('df -h')

    await page.locator('.terminal-tab').first().click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toBeVisible()
    await expect(page.locator('.tab-menu')).not.toContainText('Fork SSH Channel')
    await page.keyboard.press('Escape')

    await page.locator('.terminal-search input').fill('aiopsterm')
    await page.getByTitle('下一个').click()

    await page.locator('.xterm-host').first().click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-context-menu button').filter({ hasText: '搜索' }).click()
    await expect(page.locator('.terminal-search-overlay')).toBeVisible()
    await page.locator('.terminal-search-overlay input').fill('aiopsterm')
    await expect(page.locator('.terminal-search-overlay')).not.toContainText(/1\/\d+/)
    await page.keyboard.press('Escape')

    await page.locator('.xterm-host').first().click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-context-menu button').filter({ hasText: '清屏' }).click()
    await expect(page.locator('.terminal-output-mirror').first()).not.toContainText('[aiopsterm] no live terminal session for: df -h')

    await page.locator('.xterm-host').first().click({ button: 'right' })
    await page.locator('.terminal-context-menu button').filter({ hasText: '全局执行' }).click()
    await expect(page.locator('.terminal-global-command')).toBeVisible()
    await page.locator('.terminal-global-command input').fill('uptime')
    await page.locator('.terminal-global-command input').press('Enter')
    await expect(page.locator('.top-notice')).toContainText('终端会话不可用')
    await expect(page.locator('.terminal-output-mirror').first()).not.toContainText('[aiopsterm] broadcast queued without live sessions: uptime')

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await expect(page.locator('.terminal-command-dialog')).toBeVisible()
    await expect(page.locator('.terminal-command-dialog')).not.toContainText('gpt-5-Thinking')
    await page.locator('.terminal-command-dialog textarea').fill('检查磁盘空间')
    await page.locator('.terminal-command-dialog textarea').press('Enter')
    await expect(page.locator('.terminal-output-mirror').first()).toContainText('df -h')
    await expect(page.locator('.terminal-command-dialog textarea')).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(page.locator('.terminal-command-dialog')).not.toBeVisible()

    await page.locator('.command-line input').first().fill('kubectl ge')
    await expect(page.locator('.terminal-suggestions')).toBeVisible()
    await expect(page.locator('.terminal-suggestions')).toContainText('kubectl get')

    await page.locator('.xterm-host').first().click({ button: 'right' })
    await page.locator('.terminal-context-menu button').filter({ hasText: '文件管理' }).click()
    await expect(page.locator('.files-workspace')).toBeVisible()
    await expect(page.locator('.files-transfer-side').first()).toContainText('Local')
    await page.getByTitle('工作区').click()

    await page.getByRole('button', { name: '放大' }).click()
    await page.getByRole('button', { name: '缩小' }).click()

    await page.screenshot({ path: path.join('test-results', 'aiopsterm-terminal.png'), fullPage: true })
  } finally {
    await app.close()
  }
})
