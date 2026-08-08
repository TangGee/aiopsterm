import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'http'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { createConnection, type AddressInfo } from 'net'
import os from 'os'
import path from 'path'
import { deflateRawSync } from 'zlib'

const e2eUserDataDir = (name: string) => path.join(os.tmpdir(), `aiopsterm-e2e-${name}-${Date.now()}`)

const launchApp = async (name: string, env: NodeJS.ProcessEnv = {}, options: { userDataDir?: string } = {}) => {
  const userDataDir = options.userDataDir || e2eUserDataDir(name)
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

const commandExists = async (command: string) => {
  return new Promise<boolean>((resolve) => {
    const child = process.platform === 'win32'
      ? spawn('where.exe', [command], { stdio: 'ignore', windowsHide: true })
      : spawn('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

type JsonObject = Record<string, any>

const pollValue = async <T>(producer: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  let lastValue: T
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      lastValue = await producer()
      if (predicate(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (lastError) throw lastError
  throw new Error('Timed out waiting for E2E poll value.')
}

const socketJsonRequest = <T extends JsonObject = JsonObject>(socketPath: string, request: JsonObject) =>
  new Promise<T>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(10_000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      socket.end()
      try {
        resolve(JSON.parse(line) as T)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`socket request timed out: ${socketPath}`))
    })
    socket.on('error', reject)
  })

const firstSocketFile = async (directory: string) => {
  const entries = await readdir(directory).catch(() => [])
  return entries.find((entry) => entry.endsWith('.sock')) || ''
}

const controlSocketPathForUserData = (userDataDir: string, pid = process.pid) =>
  pollValue(
    async () => {
      if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-control-${pid}`
      const socketFile = await firstSocketFile(path.join(userDataDir, 'control'))
      return socketFile ? path.join(userDataDir, 'control', socketFile) : ''
    },
    (value) => typeof value === 'string' && value.length > 0
  )

const terminalReplayText = async (controlSocket: string, params: JsonObject = {}) => {
  const response = await socketJsonRequest(controlSocket, {
    id: `e2e-terminal-replay-${Date.now()}`,
    method: 'terminal.replay',
    params: { tailLines: 80, ...params }
  })
  if (!response.ok) throw new Error(response.errorMessage || response.errorCode || 'terminal.replay failed')
  const data = response.data || {}
  return String(data.text || data.snapshot_text || '')
}

const expectTerminalReplayToContain = async (controlSocket: string, text: string) => {
  await expect.poll(() => terminalReplayText(controlSocket), { timeout: 10_000 }).toContain(text)
}

const setRangeInputValue = async (page: Page, selector: string, index: number, value: string) => {
  await page.locator(selector).nth(index).evaluate((input, nextValue) => {
    const element = input as HTMLInputElement
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

const setNumberInputValue = async (page: Page, selector: string, value: string) => {
  await page.locator(selector).evaluate((input, nextValue) => {
    const element = input as HTMLInputElement
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

const sendTerminalCommand = async (page: Page, command: string) => {
  await page.locator('.terminal-pane .xterm-host').last().click({ button: 'right' })
  await expect(page.locator('.terminal-context-menu')).toBeVisible()
  await page.locator('.terminal-context-menu button').filter({ hasText: '输入命令' }).click()
  const input = page.locator('.command-line.floating input')
  await expect(input).toBeVisible()
  await input.fill(command)
  await input.press('Enter')
  await expect(input).toHaveCount(0)
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const expectAiSessionRowState = async (row: Locator, state: 'working' | 'needsInput' | 'linked' | 'other', label: string) => {
  await expect(row.locator(`.ai-session-state.dot-${state}`)).toHaveCount(1)
  await expect(row).toHaveAttribute('title', new RegExp(escapeRegExp(label)))
}

const expectAiSessionRowTooltip = async (row: Locator, text: string) => {
  await expect(row).toHaveAttribute('title', new RegExp(escapeRegExp(text)))
}

type McpJsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number
  result?: JsonObject
  error?: { code: number; message: string }
}

const startExternalCodexMcpScript = (socketPath: string, token: string, scope: 'hosts' | 'ai-sessions' | 'databases') => {
  const child = spawn(process.execPath, [path.join(process.cwd(), 'resources', 'aiopsterm-external-codex-mcp.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socketPath,
      AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: scope
    },
    stdio: 'pipe'
  }) as ChildProcessWithoutNullStreams
  const pending = new Map<string, { resolve: (response: McpJsonRpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let buffer = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      const response = JSON.parse(line) as McpJsonRpcResponse
      const waiter = pending.get(String(response.id))
      if (!waiter) continue
      clearTimeout(waiter.timer)
      pending.delete(String(response.id))
      waiter.resolve(response)
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('exit', (code) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`external MCP script exited before response ${id}: ${code}; stderr=${stderr}`))
    }
    pending.clear()
  })
  return {
    request: (message: JsonObject) =>
      new Promise<McpJsonRpcResponse>((resolve, reject) => {
        const id = Object.prototype.hasOwnProperty.call(message, 'id') ? String(message.id) : ''
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`external MCP response timed out for ${id}; stderr=${stderr}`))
        }, 10_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify(message)}\n`)
      }),
    close: async () => {
      child.kill()
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve()
          return
        }
        child.once('exit', () => resolve())
        setTimeout(() => resolve(), 1000)
      })
    }
  }
}

const hookCommandFromConfig = (config: unknown, eventName: string) => {
  const record = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {}
  const hooks = record.hooks && typeof record.hooks === 'object' && !Array.isArray(record.hooks) ? (record.hooks as Record<string, unknown>) : {}
  const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    const entries = Array.isArray((group as Record<string, unknown>).hooks) ? ((group as Record<string, unknown>).hooks as unknown[]) : [group]
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const command = (entry as Record<string, unknown>).command
      if (typeof command === 'string' && command.includes('aiopsterm-agent-hook-v1')) return command
    }
  }
  throw new Error(`Installed hook command not found for ${eventName}`)
}

const createFakeKubectl = async () => {
  const dir = path.join(os.tmpdir(), `aiopsterm-e2e-kubectl-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, process.platform === 'win32' ? 'kubectl.cjs' : 'kubectl')
  if (process.platform === 'win32') {
    await writeFile(filePath, [
      "const args = process.argv.slice(2)",
      "if (args[0] === 'get' && args[1] === 'namespaces') process.stdout.write('NAME STATUS AGE\\ne2e Active 1d\\ndefault Active 1d\\n')",
      "else { process.stderr.write(`unexpected kubectl args: ${args.join(' ')}\\n`); process.exitCode = 17 }"
    ].join('\n'), 'utf-8')
  } else {
    await writeFile(filePath, [
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
    ].join('\n'), 'utf-8')
    await chmod(filePath, 0o755)
  }
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
    main: 'main.cjs',
    engines: { aiopsterm: '>=0.1.0' },
    iconKey: 'runbook',
    categories: ['Tools', 'Runbook'],
    functions: [
      { title: '巡检模板', desc: '生成磁盘、负载、服务状态的检查清单。' },
      { title: '发布守卫', desc: '把发布前后验证步骤整理为可复用流程。' }
    ],
    contributes: {
      commands: [{ id: 'ops-runbook.check', title: '巡检模板', description: '生成基础巡检结果。', command: 'uptime' }]
    }
  }
  await writeFile(
    path.join(dir, 'ops-runbook-1.3.0.aiopsterm-plugin'),
    createZipFixture([
      { name: 'aiopsterm.plugin.json', content: JSON.stringify(manifest) },
      { name: 'main.cjs', content: 'exports.activate = function () {}' },
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

const startOllamaChatServer = async () => {
  const requests: Array<{ method?: string; url?: string; body: Buffer }> = []
  const content = '当前响应由 E2E Ollama 后端生成。\n\n建议先执行只读检查，再确认是否需要后续修复。'
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({
        method: request.method,
        url: request.url,
        body
      })
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'unexpected chat request' }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      setTimeout(() => {
        const chunks = [
          {
            id: 'chatcmpl-e2e-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'qwen2.5-coder',
            choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
          },
          {
            id: 'chatcmpl-e2e-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'qwen2.5-coder',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }
          },
          '[DONE]'
        ]
        response.end(`${chunks.map((chunk) => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}`).join('\n\n')}\n\n`)
      }, 700)
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

const configureModelSelectorOptions = async (page: Page, ollamaBaseUrl: string) => {
  await page.evaluate(async (providerBaseUrl) => {
    const api = (window as unknown as { aiops: { getConfig: () => Promise<any>; saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
    const config = await api.getConfig()
    const modelSettings = config.modelSettings || {}
    const providers = modelSettings.providers || {}
    const options = Array.isArray(modelSettings.options)
      ? modelSettings.options.filter((option: { name?: string }) => option.name !== 'qwen2.5-coder' && option.name !== 'gpt-5-Thinking')
      : []
    await api.saveConfig({
      aiPreferences: {
        ...(config.aiPreferences || {}),
        needProxy: false,
        proxy: {
          ...((config.aiPreferences || {}).proxy || {}),
          host: '',
          port: 7890,
          enableProxyIdentity: false,
          username: '',
          password: ''
        }
      },
      modelSettings: {
        ...modelSettings,
        providers: {
          ...providers,
          ollama: {
            ...(providers.ollama || {}),
            baseUrl: providerBaseUrl,
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
  }, ollamaBaseUrl)
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

test('quick architecture migration baseline @quick', async () => {
  test.setTimeout(120_000)
  const userDataDir = e2eUserDataDir('quick-architecture-baseline')
  let app = await launchApp('quick-architecture-baseline', {}, { userDataDir })

  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)

    await expect(page.getByText('aiopsterm', { exact: true })).toBeVisible()
    await expect(page.locator('.terminal-dashboard')).toContainText('与AI对话')
    await expect(page.getByTestId('ai-panel-mode-open')).toBeVisible()
    await expect(page.getByTestId('ai-panel-mode-open')).toHaveAttribute('title', /AI 面板模式:/)
    await expect(page.locator('.ai-panel')).toBeVisible()
    await expect(page.locator('.message.assistant').filter({ hasText: '欢迎' })).toHaveCount(0)

    const leftPaneBeforeResize = await page.locator('[data-layout-pane="terminal-left"]').boundingBox()
    expect(leftPaneBeforeResize?.width).toBeGreaterThan(250)
    const initialLeftPanelWidth = Math.round(leftPaneBeforeResize!.width)
    const leftResizer = page.locator('[data-layout-resizer="terminal-left"]')
    const leftResizerBox = await leftResizer.boundingBox()
    expect(leftResizerBox).not.toBeNull()
    await page.mouse.move(leftResizerBox!.x + leftResizerBox!.width / 2, leftResizerBox!.y + leftResizerBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(leftResizerBox!.x + leftResizerBox!.width / 2 + 54, leftResizerBox!.y + leftResizerBox!.height / 2)
    await page.mouse.up()
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const config = await (window as unknown as { aiops: { getConfig: () => Promise<JsonObject> } }).aiops.getConfig()
            const paneWidth = document.querySelector<HTMLElement>('[data-layout-pane="terminal-left"]')?.getBoundingClientRect().width || 0
            return { paneWidth: Math.round(paneWidth), leftPanelWidth: config.leftPanelWidth }
          }),
        { timeout: 10_000 }
      )
      .toEqual(expect.objectContaining({ paneWidth: initialLeftPanelWidth + 54, leftPanelWidth: initialLeftPanelWidth + 54 }))

    await page.locator('.workspace-search input').fill('127.0.0.1')
    const localRow = page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first()
    await expect(localRow).toBeVisible()
    await localRow.dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: '127.0.0.1' })).toBeVisible()
    await expect(page.locator('.terminal-pane.active .xterm-host')).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh' })).toHaveCount(0)

    await page.locator('.side-rail .rail-button[title="设置"]').click()
    await expect(page.locator('.settings-workspace-title').getByRole('heading', { name: '设置' })).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
    await page.locator('.settings-form-row').filter({ hasText: '终端类型' }).locator('select').selectOption('vt100')
    await setNumberInputValue(page, '.settings-form-row:has-text("字体大小") input', '17')
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const config = await (window as unknown as { aiops: { getConfig: () => Promise<JsonObject> } }).aiops.getConfig()
            return config.terminal
          }),
        { timeout: 10_000 }
      )
      .toEqual(expect.objectContaining({ terminalType: 'vt100', fontSize: 17 }))

    const deepLinkResult = await page.evaluate(async () => {
      const aiops = (window as unknown as {
        aiops: {
          handleProtocolUrl: (url: string) => Promise<JsonObject>
          consumeDeepLinks: () => Promise<JsonObject[]>
        }
      }).aiops
      const result = await aiops.handleProtocolUrl('aiopsterm://open/settings?section=mcp&source=e2e')
      return { result, pending: await aiops.consumeDeepLinks() }
    })
    expect(deepLinkResult.result).toEqual(expect.objectContaining({ success: true }))
    expect(deepLinkResult.pending).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'settings', module: 'settings', settingsSection: 'mcp' })])
    )

    await app.close()
    app = await launchApp('quick-architecture-baseline', {}, { userDataDir })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    const configAfterRestart = await page.evaluate(async () => {
      const config = await (window as unknown as { aiops: { getConfig: () => Promise<JsonObject> } }).aiops.getConfig()
      return config.terminal
    })
    expect(configAfterRestart).toEqual(expect.objectContaining({ terminalType: 'vt100', fontSize: 17 }))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('focus ownership survives module and window transitions @quick', async () => {
  test.setTimeout(120_000)
  const userDataDir = e2eUserDataDir('focus-ownership')
  const app = await launchApp('focus-ownership', {}, { userDataDir })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)

    await page.locator('.workspace-search input').fill('127.0.0.1')
    const localRow = page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first()
    await expect(localRow).toBeVisible()
    await localRow.dblclick()
    const terminalHost = page.locator('.terminal-pane.active .xterm-host')
    await expect(terminalHost).toBeVisible()
    await terminalHost.click()
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.terminal-pane.active .xterm-host'))))
      .toBe(true)

    await page.locator('[data-module-key="settings"]').click()
    await expect(page.locator('[data-ui-focus-scope="settings"]')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-ui-focus-scope') || ''))
      .toBe('settings')

    await page.locator('[data-module-key="workspace"]').click()
    await expect(terminalHost).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.terminal-pane.active .xterm-host'))))
      .toBe(true)

    await page.locator('.window-control-button').nth(1).click()
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.terminal-pane.active .xterm-host'))))
      .toBe(true)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('managed AI session notifications flow through real local terminal hooks', async () => {
  test.setTimeout(120_000)
  const hasCodex = await commandExists('codex')
  const hasClaude = await commandExists('claude')
  test.skip(!hasCodex || !hasClaude, 'Codex and Claude Code CLIs must be installed for this real-agent notification E2E.')

  const hookHome = path.join(os.tmpdir(), `aiopsterm-e2e-agent-home-${Date.now()}`)
  const codexHome = path.join(hookHome, '.codex')
  await mkdir(codexHome, { recursive: true })
  const app = await launchApp('ai-agent-hooks', {
    HOME: hookHome,
    CODEX_HOME: codexHome
  })
  const runId = Date.now()
  const quoteShell = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const runInstalledHookCommand = (command: string, payload: Record<string, unknown>) => process.platform === 'win32'
    ? `(echo ${JSON.stringify(payload)}) | ${command}`
    : `printf "%s\\n" ${quoteShell(JSON.stringify(payload))} | ( ${command} )`

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)

    await page.evaluate(async () => {
      const api = (window as unknown as {
        aiops: {
          installAgentHook: (input: { source: 'codex' | 'claude-code' }) => Promise<{ ok?: boolean; errorMessage?: string }>
        }
      }).aiops
      const codex = await api.installAgentHook({ source: 'codex' })
      if (!codex?.ok) throw new Error(codex?.errorMessage || 'Codex hook install failed')
      const claude = await api.installAgentHook({ source: 'claude-code' })
      if (!claude?.ok) throw new Error(claude?.errorMessage || 'Claude hook install failed')
    })
    const codexConfig = JSON.parse(await readFile(path.join(codexHome, 'hooks.json'), 'utf-8')) as unknown
    const claudeConfig = JSON.parse(await readFile(path.join(hookHome, '.claude', 'settings.json'), 'utf-8')) as unknown
    const codexToml = await readFile(path.join(codexHome, 'config.toml'), 'utf-8')
    expect(codexToml).toContain('hooks = true')
    expect(codexToml).toContain('aiopsterm-codex-hook-trust begin')
    const codexPermissionCommand = hookCommandFromConfig(codexConfig, 'PermissionRequest')
    const codexStopCommand = hookCommandFromConfig(codexConfig, 'Stop')
    const claudeQuestionCommand = hookCommandFromConfig(claudeConfig, 'AskUserQuestion')
    const claudeNotificationCommand = hookCommandFromConfig(claudeConfig, 'Notification')
    const claudeStopCommand = hookCommandFromConfig(claudeConfig, 'Stop')

    await expect(page.locator('.workspace-search input')).toBeVisible()
    await page.locator('.workspace-search input').fill('127.0.0.1')
    const localRow = page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first()
    await expect(localRow).toBeVisible()
    await localRow.dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: '127.0.0.1' })).toBeVisible()
    await expect(page.locator('.terminal-pane.active .xterm-host')).toBeVisible()
    await expect(page.getByTestId('ai-attention-count')).toHaveCount(0)

    await sendTerminalCommand(
      page,
      runInstalledHookCommand(codexPermissionCommand, {
          session_id: `codex-e2e-${runId}`,
          project_dir: `/tmp/aiopsterm-codex-project-${runId}`,
          tool_name: 'shell',
          tool_input: { command: 'echo codex approval' },
          transcript_path: `/tmp/aiopsterm-codex-${runId}.jsonl`
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('1')
    await page.locator('.side-rail .rail-button[title="AI 会话"]').click()
    await expect(page.locator('.ai-sessions-panel')).toBeVisible()
    const codexRow = page.locator('.ai-session-row').filter({ hasText: `Codex ·` }).filter({ hasText: `aiopsterm-codex-project-${runId}` })
    await expectAiSessionRowState(codexRow, 'needsInput', '待处理')
    await expect(codexRow).toContainText(`shell: echo codex approval`)
    await expectAiSessionRowTooltip(codexRow, `/tmp/aiopsterm-codex-project-${runId}`)
    await codexRow.click()
    await expect(codexRow).toHaveClass(/active/)
    await expect(page.locator('.ai-session-detail')).toHaveCount(0)
    await expect(page.locator('.terminal-tab').filter({ hasText: '127.0.0.1' })).toHaveClass(/active/)
    await codexRow.locator('.ai-session-handle').click()
    await expect(page.getByTestId('ai-attention-count')).toHaveCount(0)
    await sendTerminalCommand(
      page,
      runInstalledHookCommand(codexStopCommand, {
        session_id: `codex-e2e-${runId}`,
        project_dir: `/tmp/aiopsterm-codex-project-${runId}`,
        last_assistant_message: 'Codex turn complete'
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('1')
    await page.locator('.ai-sessions-mode-button.mode-pending').click()
    await expectAiSessionRowState(codexRow, 'needsInput', '待处理')
    await expect(codexRow).toContainText('Codex turn complete')
    await sendTerminalCommand(
      page,
      runInstalledHookCommand(codexPermissionCommand, {
        session_id: `codex-e2e-${runId}`,
        project_dir: `/tmp/aiopsterm-codex-project-${runId}`,
        tool_name: 'shell',
        tool_input: { command: 'echo codex approval again' },
        transcript_path: `/tmp/aiopsterm-codex-${runId}.jsonl`
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('1')
    await expectAiSessionRowState(codexRow, 'needsInput', '待处理')
    await expect(codexRow).toContainText(`shell: echo codex approval again`)
    await codexRow.locator('.ai-session-handle').click()
    await expect(page.getByTestId('ai-attention-count')).toHaveCount(0)

    await sendTerminalCommand(
      page,
      runInstalledHookCommand(claudeQuestionCommand, {
          session_id: `claude-question-e2e-${runId}`,
          project_dir: `/tmp/aiopsterm-claude-question-${runId}`,
          transcript_path: `/tmp/aiopsterm-claude-question-${runId}.jsonl`,
          tool_name: 'ask_user_question',
          tool_input: {
            questions: [{ question: 'Pick an environment', options: [{ label: 'staging' }, { label: 'prod' }] }]
          }
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('1')
    await page.getByTestId('ai-attention-bell').click()
    const questionRow = page.locator('.ai-session-row').filter({ hasText: `Claude Code ·` }).filter({ hasText: `aiopsterm-claude-question-${runId}` })
    await expectAiSessionRowState(questionRow, 'needsInput', '待处理')
    await expect(questionRow).toContainText('Pick an environment')
    await expectAiSessionRowTooltip(questionRow, `/tmp/aiopsterm-claude-question-${runId}`)
    await questionRow.click()
    await expect(questionRow).toHaveClass(/active/)
    await expect(page.getByTestId('ai-attention-count')).toHaveText('1')

    const terminalTabCount = await page.locator('.terminal-tab').count()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T')
    await expect(page.locator('.terminal-tab')).toHaveCount(terminalTabCount + 1)
    await expect(page.locator('.terminal-pane.active .xterm-host')).toBeVisible()

    await sendTerminalCommand(
      page,
      runInstalledHookCommand(claudeNotificationCommand, {
          session_id: `claude-notification-e2e-${runId}`,
          project_dir: `/tmp/aiopsterm-claude-notification-${runId}`,
          transcript_path: `/tmp/aiopsterm-claude-notification-${runId}.jsonl`,
          message: 'Claude Code needs attention'
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('2')
    await page.getByTestId('ai-attention-bell').click()
    const notificationRow = page.locator('.ai-session-row').filter({ hasText: `Claude Code ·` }).filter({ hasText: `aiopsterm-claude-notification-${runId}` })
    await expectAiSessionRowState(notificationRow, 'needsInput', '待处理')
    await expect(notificationRow).toContainText('Claude Code needs attention')
    await expectAiSessionRowTooltip(notificationRow, `/tmp/aiopsterm-claude-notification-${runId}`)

    await sendTerminalCommand(
      page,
      runInstalledHookCommand(claudeStopCommand, {
          session_id: `claude-notification-e2e-${runId}`,
          project_dir: `/tmp/aiopsterm-claude-notification-${runId}`,
          last_assistant_message: 'Turn complete'
      })
    )
    await expect(page.getByTestId('ai-attention-count')).toHaveText('2')
    await expectAiSessionRowState(notificationRow, 'needsInput', '待处理')
    await expect(notificationRow).toContainText('Turn complete')
  } finally {
    await app.close()
    await rm(hookHome, { recursive: true, force: true })
  }
})

test('control socket and external Codex MCP expose automation without browser compatibility leaks', async () => {
  test.setTimeout(120_000)
  const userDataDir = e2eUserDataDir('automation')
  const externalSocketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\aiopsterm-e2e-external-${Date.now()}`
    : path.join(userDataDir, 'external-codex-mcp.sock')
  const externalToken = `e2e-token-${Date.now()}`
  const app = await launchApp(
    'automation',
    {
      AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE: '1',
      AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: externalToken,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: externalSocketPath
    },
    { userDataDir }
  )
  let mcp: ReturnType<typeof startExternalCodexMcpScript> | null = null
  let aiMcp: ReturnType<typeof startExternalCodexMcpScript> | null = null
  let databaseMcp: ReturnType<typeof startExternalCodexMcpScript> | null = null

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await expect(page.locator('.terminal-dashboard')).toContainText('与AI对话')
  } catch (error) {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    throw error
  }

  try {
    const page = await app.firstWindow()
    const controlSocket = await controlSocketPathForUserData(userDataDir, app.process().pid)

    const ping = await socketJsonRequest(controlSocket, { id: 'e2e-ping', method: 'system.ping' })
    expect(ping).toEqual(expect.objectContaining({ id: 'e2e-ping', ok: true, data: expect.objectContaining({ pong: true }) }))

    const capabilities = await socketJsonRequest(controlSocket, { id: 'e2e-capabilities', method: 'system.capabilities' })
    expect(capabilities).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          protocol: 'aiopsterm-control',
          capabilities: expect.arrayContaining(['workspace.snapshot', 'surface.create', 'surface.operations', 'settings.open'])
        })
      })
    )
    expect(JSON.stringify(capabilities)).not.toContain('browserDisabled')
    expect(JSON.stringify(capabilities)).not.toContain('BROWSER_DISABLED')

    const createdSurface = await socketJsonRequest(controlSocket, {
      id: 'e2e-surface-create',
      method: 'surface.create',
      params: { title: 'E2E Control Surface', cwd: os.tmpdir(), focus: true }
    })
    expect(createdSurface).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          action: 'surface.create',
          surface: expect.objectContaining({ title: 'E2E Control Surface' })
        })
      })
    )
    const surfaceId = createdSurface.data.surfaceId || createdSurface.data.surface_id
    expect(surfaceId).toBeTruthy()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'E2E Control Surface' })).toBeVisible()

    const renamed = await socketJsonRequest(controlSocket, {
      id: 'e2e-surface-rename',
      method: 'surface.action',
      params: { surfaceId, action: 'rename', title: 'E2E Renamed Surface' }
    })
    expect(renamed).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'rename', title: 'E2E Renamed Surface' }) }))
    await expect(page.locator('.terminal-tab').filter({ hasText: 'E2E Renamed Surface' })).toBeVisible()

    const unknownAction = await socketJsonRequest(controlSocket, {
      id: 'e2e-surface-unknown',
      method: 'surface.action',
      params: { surfaceId, action: 'open_preview_right' }
    })
    expect(unknownAction).toEqual(expect.objectContaining({ ok: false, errorCode: 'SURFACE_ACTION_UNKNOWN' }))
    expect(JSON.stringify(unknownAction)).not.toContain('browserDisabled')

    const settingsOpen = await socketJsonRequest(controlSocket, {
      id: 'e2e-settings-open',
      method: 'settings.open',
      params: { target: 'ai-remote-host-management' }
    })
    expect(settingsOpen).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ target: 'aiRemoteHostManagement' }) }))
    await expect(page.locator('.settings-workspace-title').getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.locator('.settings-nav-item').filter({ hasText: '主机Agent' })).toHaveClass(/active/)

    await pollValue(() => socketJsonRequest(externalSocketPath, { id: 'external-ping', method: 'list_hosts', params: {}, token: externalToken }), (response) => response.ok === true)
    mcp = startExternalCodexMcpScript(externalSocketPath, externalToken, 'hosts')
    aiMcp = startExternalCodexMcpScript(externalSocketPath, externalToken, 'ai-sessions')
    databaseMcp = startExternalCodexMcpScript(externalSocketPath, externalToken, 'databases')
    const initialize = await mcp.request({ jsonrpc: '2.0', id: 'mcp-init', method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(initialize.result?.serverInfo?.name).toBe('aiopsterm-hosts')

    const tools = await mcp.request({ jsonrpc: '2.0', id: 'mcp-tools', method: 'tools/list', params: {} })
    expect(tools.result?.tools).toHaveLength(14)
    expect((tools.result?.tools || []).map((tool: JsonObject) => tool.name)).toEqual(
      expect.arrayContaining(['list_hosts', 'list_connections', 'disconnect_host'])
    )

    const aiTools = await aiMcp.request({ jsonrpc: '2.0', id: 'mcp-ai-tools', method: 'tools/list', params: {} })
    expect(aiTools.result?.tools).toHaveLength(17)
    expect((aiTools.result?.tools || []).map((tool: JsonObject) => tool.name)).toEqual(
      expect.arrayContaining(['list_ai_sessions', 'list_ai_notifications'])
    )

    const databaseTools = await databaseMcp.request({ jsonrpc: '2.0', id: 'mcp-database-tools', method: 'tools/list', params: {} })
    expect(databaseTools.result?.tools).toHaveLength(12)
    expect((databaseTools.result?.tools || []).map((tool: JsonObject) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_database_connections',
        'list_databases',
        'list_schemas',
        'list_tables',
        'search_database_objects',
        'describe_database_table',
        'get_database_table_ddl',
        'query_database_table',
        'sample_rows',
        'count_rows',
        'inspect_indexes',
        'explain_plan'
      ])
    )

    const databaseReadsDisabled = await databaseMcp.request({
      jsonrpc: '2.0',
      id: 'mcp-database-disabled',
      method: 'tools/call',
      params: { name: 'list_database_connections', arguments: {} }
    })
    expect(databaseReadsDisabled.result?.isError).toBe(true)
    expect(databaseReadsDisabled.result?.structuredContent).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'DB_MCP_DATABASE_READ_DISABLED' })
    )

    const hosts = await mcp.request({ jsonrpc: '2.0', id: 'mcp-hosts', method: 'tools/call', params: { name: 'list_hosts', arguments: { query: 'prod' } } })
    expect(hosts.result?.isError).toBe(false)
    expect(hosts.result?.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          hosts: expect.arrayContaining([expect.objectContaining({ assetId: 'asset-1', title: 'prod-bastion' })])
        })
      })
    )
    expect(JSON.stringify(hosts)).not.toContain('password')

    const connections = await mcp.request({ jsonrpc: '2.0', id: 'mcp-connections', method: 'tools/call', params: { name: 'list_connections', arguments: {} } })
    expect(connections.result?.structuredContent).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 0, connections: [] }) }))

    const refusedTerminalDisconnect = await mcp.request({
      jsonrpc: '2.0',
      id: 'mcp-disconnect-visible',
      method: 'tools/call',
      params: { name: 'disconnect_host', arguments: { connectionId: 'terminal-visible-1' } }
    })
    expect(refusedTerminalDisconnect.result?.isError).toBe(true)
    expect(refusedTerminalDisconnect.result?.structuredContent).toEqual(expect.objectContaining({ ok: false, errorCode: 'TERMINAL_OWNED_CONNECTION' }))

    const aiSessions = await aiMcp.request({ jsonrpc: '2.0', id: 'mcp-ai-sessions', method: 'tools/call', params: { name: 'list_ai_sessions', arguments: { includeEvents: true } } })
    expect(aiSessions.result?.structuredContent).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ sessions: expect.any(Array) }) }))

    const exportSettingsOpen = await socketJsonRequest(controlSocket, {
      id: 'e2e-export-mcp-settings-open',
      method: 'settings.open',
      params: { target: 'export-mcp' }
    })
    expect(exportSettingsOpen).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ target: 'exportMcp' }) }))
    const exportMcpCards = page.locator('.external-codex-mcp-card')
    await expect(exportMcpCards).toHaveCount(3)
    await expect(exportMcpCards.nth(0)).toContainText('aiopsterm_hosts')
    await expect(exportMcpCards.nth(1)).toContainText('aiopsterm_ai_sessions')
    await expect(exportMcpCards.nth(2)).toContainText('aiopsterm_databases')
    await expect(page.locator('.export-mcp-installer-row')).toHaveCount(6)
  } finally {
    await mcp?.close()
    await aiMcp?.close()
    await databaseMcp?.close()
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('settings background and terminal preferences persist after restart', async () => {
  test.setTimeout(120_000)
  const userDataDir = e2eUserDataDir('settings-persist')
  let app = await launchApp('settings-persist', {}, { userDataDir })

  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await page.locator('.side-rail .rail-button[title="设置"]').click()
    await expect(page.locator('.settings-workspace-title').getByRole('heading', { name: '设置' })).toBeVisible()
    await page.locator('.settings-bg-tile.preset').nth(1).click()
    await expect(page.locator('.settings-sliders')).toBeVisible()
    await setRangeInputValue(page, '.settings-sliders input[type="range"]', 0, '0.7')
    await setRangeInputValue(page, '.settings-sliders input[type="range"]', 1, '0.9')
    await page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
    await page.locator('.settings-form-row').filter({ hasText: '终端类型' }).locator('select').selectOption('vt100')
    await page.locator('.settings-form-row').filter({ hasText: '字体' }).locator('select').selectOption('"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace')
    await setNumberInputValue(page, '.settings-form-row:has-text("字体大小") input', '18')

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const config = await (window as unknown as { aiops: { getConfig: () => Promise<JsonObject> } }).aiops.getConfig()
            return {
              background: config.background,
              terminal: config.terminal,
              shellClass: document.querySelector('.app-shell')?.className || '',
              shellStyle: (document.querySelector('.app-shell') as HTMLElement | null)?.getAttribute('style') || ''
            }
          }),
        { timeout: 10_000 }
      )
      .toEqual(
        expect.objectContaining({
          background: expect.objectContaining({ mode: 'preset', image: expect.any(String), opacity: 0.7, brightness: 0.9 }),
          terminal: expect.objectContaining({
            terminalType: 'vt100',
            fontFamily: '"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace',
            fontSize: 18
          }),
          shellClass: expect.stringContaining('has-app-background'),
          shellStyle: expect.stringContaining('--app-bg-opacity: 0.7')
        })
      )
    await app.close()

    app = await launchApp('settings-persist', {}, { userDataDir })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    const controlSocket = await controlSocketPathForUserData(userDataDir, app.process().pid)
    await expect(page.locator('.app-shell')).toHaveClass(/has-app-background/)
    await expect(page.locator('.app-shell')).toHaveAttribute('style', /--app-bg-opacity: 0\.7/)

    const configAfterRestart = await page.evaluate(async () => {
      const config = await (window as unknown as { aiops: { getConfig: () => Promise<JsonObject> } }).aiops.getConfig()
      return { background: config.background, terminal: config.terminal }
    })
    expect(configAfterRestart).toEqual(
      expect.objectContaining({
        background: expect.objectContaining({ mode: 'preset', opacity: 0.7, brightness: 0.9 }),
        terminal: expect.objectContaining({ terminalType: 'vt100', fontSize: 18 })
      })
    )

    await page.locator('.side-rail .rail-button[title="工作区"]').click()
    await expect(page.locator('.workspace-search input')).toBeVisible()
    await page.locator('.workspace-search input').fill('127.0.0.1')
    const localRow = page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first()
    await expect(localRow).toBeVisible()
    await localRow.dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: '127.0.0.1' })).toBeVisible()
    await expect(page.locator('.terminal-pane .xterm-host').last()).toBeVisible()
    await sendTerminalCommand(page, process.platform === 'win32' ? 'echo E2E_TERM=%TERM%' : 'echo "E2E_TERM=$TERM"')
    await expectTerminalReplayToContain(controlSocket, 'E2E_TERM=vt100')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

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
  const aiChatServer = await startOllamaChatServer()
  const userDataDir = e2eUserDataDir('primary')
  const primaryEnv = {
    AIOPSTERM_KUBECTL_PATH: fakeKubectl.filePath,
    AIOPSTERM_EXTENSION_STORE_DIR: extensionStore.dir
  }
  let app = await launchApp('primary', primaryEnv, { userDataDir })

  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await configureModelSelectorOptions(page, aiChatServer.baseUrl)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await installVoiceRecorderDouble(page)

    await expect(page.getByText('aiopsterm', { exact: true })).toBeVisible()
    await expect(page.locator('.terminal-tab').filter({ hasText: '欢迎' })).toHaveCount(0)
    await expect(page.locator('.terminal-dashboard')).toContainText('与AI对话')
    await expect(page.getByTestId('ai-panel-mode-open')).toBeVisible()
    await expect(page.getByTestId('ai-panel-mode-open')).toHaveAttribute('title', /AI 面板模式:/)
    await expect(page.locator('.top-bar[data-onboarding-id="top-layout-controls"]')).toBeVisible()
    await expect(page.locator('.mode-button')).toHaveCount(0)
    await expect(page.getByTestId('agents-mode-entry')).toBeVisible()
    await expect(page.locator('.right-ai-toggle[data-onboarding-id="right-ai-toggle"]')).toBeVisible()
    await expect(page.locator('.top-update-badge')).toContainText('本地版本')
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.workspace-tabs')).not.toBeVisible()
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.workspace-tabs')).toBeVisible()
    await page.locator('.right-ai-toggle').click()
    await expect(page.getByTestId('ai-panel-mode-open')).not.toBeVisible()
    await page.locator('.right-ai-toggle').click()
    await expect(page.getByTestId('ai-panel-mode-open')).toBeVisible()
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
    const workspaceProdHostByIp = page.locator('.workspace-host-row').filter({ hasText: '10.24.8.12' }).first()
    await workspaceProdHostByIp.click({ button: 'right' })
    await expect(page.locator('.workspace-node-menu')).toBeVisible()
    const workspaceFavoriteButton = page.locator('.workspace-node-menu button').filter({ hasText: /加入收藏|取消收藏/ }).first()
    await expect(workspaceFavoriteButton).toBeVisible()
    const workspaceFavoriteAction = (await workspaceFavoriteButton.textContent())?.includes('取消收藏') ? '取消收藏' : '加入收藏'
    await workspaceFavoriteButton.click()
    await expect(page.locator('.workspace-notice')).toContainText(workspaceFavoriteAction === '加入收藏' ? '已收藏' : '已取消收藏')
    await workspaceProdHostByIp.click({ button: 'right' })
    const workspaceFlippedFavoriteAction = workspaceFavoriteAction === '加入收藏' ? '取消收藏' : '加入收藏'
    const workspaceFlippedFavoriteButton = page.locator('.workspace-node-menu button').filter({ hasText: workspaceFlippedFavoriteAction }).first()
    await expect(workspaceFlippedFavoriteButton).toBeVisible()
    await workspaceFlippedFavoriteButton.click()
    await expect(page.locator('.workspace-notice')).toContainText(workspaceFlippedFavoriteAction === '加入收藏' ? '已收藏' : '已取消收藏')
    await workspaceProdHostByIp.click({ button: 'right' })
    await expect(page.locator('.workspace-node-menu')).toBeVisible()
    await page.locator('.workspace-node-menu button').filter({ hasText: '编辑备注' }).click()
    await page.locator('.workspace-host-row').filter({ hasText: '10.24.8.12' }).first().dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'prod-bastion' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.24.8.12:22' })).toHaveCount(0)
    await page.locator('.workspace-tabs button').filter({ hasText: '直接连接' }).click()
    await page.locator('.workspace-button[title="显示主机名"]').click()
    await page.locator('.workspace-folder-row').filter({ hasText: '生产' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '新建子分组' }).click()
    await page.locator('.workspace-folder-modal .files-folder-form input').fill('E2E-Workspace')
    await page.locator('.workspace-folder-modal .files-folder-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'E2E-Workspace' })).toBeVisible()
    await page.locator('.workspace-folder-row').filter({ hasText: 'E2E-Workspace' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '新建主机' }).click()
    await expect(page.locator('.workspace-host-modal')).toContainText('新建主机')
    await expect(page.locator('.workspace-host-form label').filter({ hasText: '分组' })).toHaveCount(0)
    await page.locator('.workspace-host-form label').filter({ hasText: '主机名' }).locator('input').fill('workspace-e2e')
    await page.locator('.workspace-host-form label').filter({ hasText: '地址' }).locator('input').fill('10.72.0.5')
    await page.locator('.workspace-host-form label').filter({ hasText: '用户名' }).locator('input').fill('ops')
    await page.locator('.workspace-host-form label').filter({ hasText: '端口' }).locator('input').fill('2205')
    await page.locator('.workspace-host-form label').filter({ hasText: '备注' }).locator('textarea').fill('workspace e2e host')
    await page.locator('.workspace-host-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'workspace-e2e' })).toBeVisible()
    await page.locator('.workspace-host-row').filter({ hasText: 'workspace-e2e' }).dblclick()
    await expect(page.locator('.terminal-tab').filter({ hasText: 'workspace-e2e' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.72.0.5:2205' })).toHaveCount(0)
    await page.locator('.workspace-tabs button').filter({ hasText: '堡垒机资源' }).click()
    await page.locator('.workspace-tree').click({ button: 'right', position: { x: 220, y: 260 } })
    await page.locator('.workspace-node-menu button').filter({ hasText: '新建顶级分组' }).click()
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
    await page.locator('.workspace-host-row').filter({ hasText: 'prod-bastion' }).first().click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '移动到文件夹' }).click()
    await page.locator('.files-folder-option').filter({ hasText: 'E2E 归档' }).click()
    await page.locator('.workspace-folder-row').filter({ hasText: 'E2E 归档' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '删除文件夹' }).click()
    await expect(page.locator('.files-folder-confirm')).toContainText('其中 1 个主机将移出该文件夹')
    await page.locator('.files-folder-confirm footer button').filter({ hasText: '删除' }).click()
    await expect(page.locator('.workspace-folder-row').filter({ hasText: 'E2E 归档' })).not.toBeVisible()
    await page.getByRole('button', { name: 'jumpserver-org (同步资产) 堡垒机资源' }).click({ button: 'right' })
    await page.locator('.workspace-node-menu button').filter({ hasText: '管理资产' }).click()
    await expect(page.locator('.workspace-management-modal')).toContainText('管理资产 · jumpserver-org')
    await page.locator('.workspace-management-modal header button').click()

    await page.locator('.side-rail .rail-button[title="资产"]').click()
    await expect(page.locator('.assets-workspace')).toBeVisible()
    await expect(page.locator('.asset-workspace-tabs')).toContainText('主机管理')
    await expect(page.locator('.asset-workspace-tabs')).toContainText('密钥管理')
    await page.locator('.asset-workspace-tab').filter({ hasText: '主机管理' }).click()
    await expect(page.locator('.host-card').filter({ hasText: 'prod-bastion' })).toBeVisible()
    await page.locator('.asset-search-input input').fill('mysql')
    await expect(page.locator('.host-card').filter({ hasText: 'mysql-primary' })).toBeVisible()
    await expect(page.locator('.host-card').filter({ hasText: 'prod-bastion' })).not.toBeVisible()
    await page.locator('.asset-search-input input').fill('')
    await page.locator('.asset-tree-group-row').filter({ hasText: /^生产/ }).first().click({ button: 'right' })
    await page.locator('.asset-context-menu button').filter({ hasText: '新建主机' }).click()
    await expect(page.locator('.asset-form-panel header').filter({ hasText: '新建主机' })).toBeVisible()
    await page.locator('.asset-form-panel header button[title="关闭"]').click()
    await page.locator('.assets-workspace button[title="导入帮助"]').click()
    await expect(page.locator('.asset-import-help-modal')).toContainText('导入说明')
    await page.locator('.asset-import-help-modal').getByRole('button', { name: '知道了' }).click()
    await expect(page.locator('.asset-import-help-modal')).toHaveCount(0)
    await page.locator('.host-card').filter({ hasText: 'prod-bastion' }).click({ button: 'right' })
    await expect(page.locator('.asset-context-menu')).toBeVisible()
    await expect(page.locator('.asset-context-menu').getByText('克隆')).toBeVisible()
    await page.locator('.asset-context-menu').getByText('克隆').click()
    await expect(page.locator('.asset-form-panel input').first()).toHaveValue('prod-bastion_Clone')
    await page.locator('.asset-form-panel header button[title="关闭"]').click()
    await page.locator('.asset-tree-group-row').filter({ hasText: /^生产/ }).first().click({ button: 'right' })
    await page.locator('.asset-context-menu button').filter({ hasText: '新建主机' }).click()
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
    await expect(page.locator('.terminal-tab.active').filter({ hasText: 'e2e-host' })).toBeVisible()
    await expect(page.locator('.terminal-output-mirror').filter({ hasText: 'aiopsterm ssh ops@10.66.0.8:2200' })).toHaveCount(0)
    await page.locator('.terminal-tab').filter({ hasText: 'e2e-host' }).click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toContainText('Fork SSH Channel')
    await page.locator('.tab-menu button').filter({ hasText: 'Fork SSH Channel' }).click()
    await expect(page.locator('.terminal-tab.active').filter({ hasText: 'e2e-host' })).toBeVisible()
    await expect(page.locator('.terminal-pane.active .terminal-output-mirror')).not.toContainText('aiopsterm ssh ops@10.66.0.8:2200')
    await page.locator('.rail-button[title="资产"]').click()
    await expect(page.locator('.assets-workspace')).toBeVisible()
    await page.locator('.asset-workspace-tab').filter({ hasText: '主机管理' }).click()
    await page.locator('.host-card').filter({ hasText: 'e2e-host' }).click({ button: 'right' })
    await page.locator('.asset-context-menu button.delete').filter({ hasText: '删除' }).click()
    await expect(page.locator('.asset-confirm-modal')).toContainText('删除主机')
    await page.locator('.asset-confirm-modal input').fill('e2e-host')
    await page.locator('.asset-confirm-modal footer .danger').click()
    await expect(page.locator('.host-card').filter({ hasText: 'e2e-host' })).not.toBeVisible()
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
    await expect(page.locator('.assets-workspace')).toBeVisible()
    await page.locator('.asset-workspace-tab').filter({ hasText: '密钥管理' }).click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'prod-ed25519' })).toBeVisible()
    await page.getByTestId('key-new-button').click()
    await page.locator('.key-form-panel label').filter({ hasText: '名称' }).locator('input').fill('e2e-key')
    await page.locator('.key-form-panel label').filter({ hasText: '私钥' }).locator('textarea').fill('-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----')
    await page.locator('.key-form-panel label').filter({ hasText: '公钥' }).locator('textarea').fill('ssh-ed25519')
    await page.locator('.key-form-panel').getByRole('button', { name: '创建密钥' }).click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).toBeVisible()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).toContainText('类型ed25519')
    await page.getByTestId('key-new-button').click()
    await page.locator('.key-form-panel label').filter({ hasText: '名称' }).locator('input').fill('e2e-import-key')
    await page.locator('.key-drop-area').click()
    await expect(page.getByText('已导入 e2e-import-rsa.pem，识别为 RSA')).toBeVisible()
    await page.locator('.key-form-panel').getByRole('button', { name: '创建密钥' }).click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-import-key' })).toContainText('类型rsa')
    await page.locator('.keychain-card').filter({ hasText: 'e2e-key' }).click({ button: 'right' })
    await page.locator('.asset-context-menu .delete').click()
    await expect(page.locator('.asset-confirm-modal')).toContainText('删除密钥')
    await page.locator('.asset-confirm-modal input').fill('e2e-key')
    await page.locator('.asset-confirm-modal footer .danger').click()
    await expect(page.locator('.keychain-card').filter({ hasText: 'e2e-key' })).not.toBeVisible()

    await page.locator('.rail-button[title="文件"]').click()
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
    const filesPanelProdSession = page.locator('.files-tree-session').filter({ hasText: 'prod-bastion' }).first()
    await expect(filesPanelProdSession).toBeVisible()
    await filesPanelProdSession.click({ button: 'right' })
    await expect(page.locator('.asset-context-menu')).toBeVisible()
    await page.locator('.asset-context-menu button').filter({ hasText: /添加备注|编辑备注/ }).click()
    await filesPanelProdSession.locator('.files-comment-edit input').fill('e2e files panel note')
    await filesPanelProdSession.locator('.files-comment-edit input').press('Enter')
    await expect(filesPanelProdSession).toContainText('e2e files panel note')
    await filesPanelProdSession.click({ button: 'right' })
    const filesPanelFavoriteButton = page.locator('.asset-context-menu button').filter({ hasText: /加入收藏|取消收藏/ })
    await expect(filesPanelFavoriteButton).toBeVisible()
    const favoriteActionText = (await filesPanelFavoriteButton.textContent())?.includes('取消收藏') ? '取消收藏' : '加入收藏'
    await filesPanelFavoriteButton.click()
    await filesPanelProdSession.click({ button: 'right' })
    const flippedFavoriteAction = favoriteActionText === '加入收藏' ? '取消收藏' : '加入收藏'
    await expect(page.locator('.asset-context-menu button').filter({ hasText: flippedFavoriteAction })).toBeVisible()
    await page.locator('.asset-context-menu button').filter({ hasText: flippedFavoriteAction }).click()
    await page.locator('.files-source-tabs button').filter({ hasText: '堡垒机资源' }).click()
    await expect(page.locator('.files-tree-group-row').filter({ hasText: '核心业务' })).toBeVisible()
    await page.locator('.files-tree-session').filter({ hasText: 'prod-bastion' }).first().click({ button: 'right' })
    await page.locator('.asset-context-menu button').filter({ hasText: '移动到文件夹' }).click()
    await expect(page.locator('.files-folder-modal').filter({ hasText: '移动到文件夹' })).toBeVisible()
    await page.locator('.files-folder-option').filter({ hasText: '核心业务' }).click()
    await expect(page.locator('.files-folder-modal')).not.toBeVisible()
    const filesCoreFolder = page.locator('.files-tree-group-row').filter({ hasText: '核心业务' })
    await filesCoreFolder.click({ button: 'right' })
    await page.locator('.asset-context-menu button').filter({ hasText: '编辑文件夹' }).click()
    await expect(page.locator('.files-folder-modal').filter({ hasText: '编辑文件夹' })).toBeVisible()
    await page.locator('.files-folder-form input').fill('核心业务 E2E')
    await page.locator('.files-folder-form textarea').fill('files side panel folder')
    await page.locator('.files-folder-form footer button').filter({ hasText: '确定' }).click()
    await expect(page.locator('.files-tree-group-row').filter({ hasText: '核心业务 E2E' })).toBeVisible()
    await page.locator('.files-tree-group-row').filter({ hasText: '核心业务 E2E' }).click({ button: 'right' })
    await page.locator('.asset-context-menu button').filter({ hasText: '删除文件夹' }).click()
    await expect(page.locator('.files-folder-confirm')).toContainText('确定删除文件夹 核心业务 E2E')
    await page.locator('.files-folder-confirm footer button').filter({ hasText: '取消' }).click()
    await page.locator('.files-source-tabs button').filter({ hasText: '直接连接' }).click()
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

    await page.locator('.rail-button[title="快捷命令"]').click()
    await expect(page.locator('.snippets-panel-native').getByRole('heading', { name: '快捷命令' })).toBeVisible()
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
    await page.getByTitle('新建快捷命令').click()
    await expect(page.getByText('新建快捷命令')).toBeVisible()
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
    await page.locator('.k8s-resource-header button.k8s-workspace-button').filter({ hasText: '输出' }).click()
    await page.locator('.k8s-resource-table tbody tr').filter({ hasText: 'billing-worker-7f9d6f9dd9-rx8mm' }).getByTitle('Logs').click()
    await expect(page.locator('.k8s-resource-output').getByText('kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')).toBeVisible()
    await page.locator('.k8s-resource-output').getByTitle('发送输出到 AI').click()
    await expect(page.locator('.message.user').filter({ hasText: '请分析这个 Kubernetes 输出' })).toHaveCount(1)
    await page.locator('.k8s-resource-output').getByTitle('清空输出').click()
    await expect(page.locator('.k8s-resource-output')).toHaveCount(0)
    await expect(page.locator('.k8s-resource-header button.k8s-workspace-button').filter({ hasText: '输出' })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.k8s-resource-header button.k8s-workspace-button').filter({ hasText: '刷新' })).toBeEnabled()
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
    await page.locator('.k8s-cluster-detail').getByTitle('关闭').click()
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
    await expect(page.locator('.k8s-cluster-detail').getByRole('heading', { name: 'e2e-cluster' })).toBeVisible()
    await page.locator('.k8s-cluster-detail').getByTitle('关闭').click()
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
    await expect(page.locator('.k8s-cluster-detail').getByRole('heading', { name: 'manual-cluster' })).toBeVisible()
    await page.locator('.k8s-cluster-detail input').first().fill('manual-cluster-renamed')
    await page.locator('.k8s-cluster-detail').getByRole('button', { name: '保存' }).click()
    await expect(page.locator('.k8s-cluster-detail').getByRole('heading', { name: 'manual-cluster-renamed' })).toBeVisible()
    await page.locator('.k8s-cluster-detail').getByTitle('删除').click()
    await expect(page.locator('.k8s-delete-confirm')).toContainText('manual-cluster-renamed')
    await page.locator('.k8s-delete-confirm footer button.danger').click()
    await expect(page.locator('.k8s-config-cluster-item').filter({ hasText: 'manual-cluster-renamed' })).toHaveCount(0)

    await page.getByTitle('数据库').click()
    await expect(page.locator('.db-sidebar-header').filter({ hasText: '数据库' })).toBeVisible()
    await expect(page.locator('.db-tree-row.connection').filter({ hasText: 'orders-postgres' })).toBeVisible()
    await page.locator('.db-tree-row.connection').filter({ hasText: 'orders-postgres' }).click({ button: 'right' })
    const dbConnectionMenu = page.locator('.db-context-menu')
    await expect(dbConnectionMenu).toBeVisible()
    await expect(dbConnectionMenu.locator('button').filter({ hasText: '关闭连接' })).toBeVisible()
    await expect(dbConnectionMenu.locator('button').filter({ hasText: '查询控制台' })).toBeEnabled()
    await expect(dbConnectionMenu.locator('button').filter({ hasText: '创建数据库' })).toBeEnabled()
    await dbConnectionMenu.locator('.db-popup-submenu-wrap').filter({ hasText: '移动到' }).hover()
    await expect(dbConnectionMenu.locator('.db-popup-submenu button').filter({ hasText: '根分组' })).toBeEnabled()
    await expect(dbConnectionMenu.locator('.db-popup-submenu button').filter({ hasText: 'Local Lab' })).toBeVisible()
    await page.locator('.db-sidebar-header').click()
    await expect(dbConnectionMenu).not.toBeVisible()
    await expect(page.locator('.db-overview').getByText('新建连接')).toBeVisible()
    await page.locator('.db-search input').fill('metrics')
    await expect(page.locator('.db-search-clear')).toBeVisible()
    await page.locator('.db-search-clear').click()
    await expect(page.locator('.db-search input')).toHaveValue('')
    await page.locator('.db-search input').fill('oracle')
    await page.locator('.db-search input').press('Escape')
    await expect(page.locator('.db-search input')).toHaveValue('')
    await page.locator('.db-sidebar-actions button[title="添加"]').click()
    await expect(page.locator('.db-add-menu')).toBeVisible()
    await page.locator('.db-sidebar-header').click()
    await expect(page.locator('.db-add-menu')).not.toBeVisible()
    await page.locator('.db-sidebar-actions button[title="添加"]').click()
    await expect(page.locator('.db-add-menu')).toBeVisible()
    await page.locator('.db-add-menu button').filter({ hasText: 'PostgreSQL' }).click()
    const dbConnectionModal = page.locator('.db-connection-modal')
    await expect(dbConnectionModal).toContainText('PostgreSQL')
    await expect(dbConnectionModal).toContainText('SSL 模式')
    await dbConnectionModal.locator('input').first().fill('e2e-postgres')
    await dbConnectionModal.locator('select').nth(3).selectOption('verify-full')
    await expect(dbConnectionModal.locator('input').nth(7)).toHaveValue('jdbc:postgresql://127.0.0.1:5432')
    await dbConnectionModal.locator('footer button').filter({ hasText: '测试连接' }).click()
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
    await expect(page.locator('.db-sql-save-state')).toContainText('已保存：')
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
    await expect(page.locator('.db-sql-save-state')).toContainText('有未保存的更改')
    await sqlSaveButton.click()
    await expect(page.locator('.db-sql-save-state')).toContainText('已保存：')
    await expect.poll(async () => readFile(e2eSqlSavePath, 'utf-8')).toContain("select id from public.orders where status = 'open';")
    await rm(e2eSqlSavePath, { force: true })
    await page.locator('.db-sql-editor').fill("select id, service from public.orders where status = 'open' order by updated_at desc limit 5; select * from ops.ops_incidents;")
    await page.getByTitle('格式化').click()
    await expect(page.locator('.db-sql-editor')).toHaveValue(/SELECT\n  id/)
    await page.getByTitle('运行全部').click()
    await expect(page.locator('.db-result-tabs').filter({ hasText: '#1-1' })).toBeVisible()
    await expect(page.locator('.db-result-table').filter({ hasText: 'payment-api' })).toBeVisible()
    await page.locator('.db-result-table th').filter({ hasText: 'service' }).getByTitle('筛选').click()
    await expect(page.locator('.db-filter-popover')).toContainText('payment-api')
    await page.locator('.db-filter-search input').fill('orders')
    await page.locator('.db-filter-popover input[type="checkbox"]').first().check()
    await page.locator('.db-filter-footer .primary').click()
    await expect(page.locator('.db-result-table')).toContainText('orders-worker')
    await expect(page.locator('.db-result-table')).not.toContainText('payment-api')
    await page.locator('.db-result-table th').filter({ hasText: 'service' }).getByTitle('筛选').click()
    await page.locator('.db-filter-row.all button').click()
    await expect(page.locator('.db-result-table')).toContainText('payment-api')
    await page.locator('.db-result-tabs [role="tab"]').filter({ hasText: '概览' }).click()
    await expect(page.locator('.db-sql-overview th')).toHaveText(['SQL', '消息', '时间'])
    await expect(page.locator('.db-sql-overview')).toContainText('执行成功')
    await page.locator('.db-sql-overview tbody tr').first().click()
    await expect(page.locator('.db-result-table').filter({ hasText: 'payment-api' })).toBeVisible()
    await page.locator('.db-sql-editor').evaluate((node: HTMLTextAreaElement) => {
      const offset = node.value.indexOf('ops_incidents')
      node.setSelectionRange(offset, offset)
    })
    await page.getByTitle('运行当前语句').click()
    await expect(page.locator('.db-result-table').filter({ hasText: 'checkout' })).toBeVisible()
    await page.locator('.db-sql-editor').fill('select id from "public"."orders" where status = \'open\';\nselect * from ops.ops_incidents;')
    await page.locator('.db-sql-editor').evaluate((node: HTMLTextAreaElement) => {
      const selected = 'select id from "public"."orders" where status = \'open\''
      node.setSelectionRange(0, selected.length)
    })
    await page.getByTitle('AI 解释 SQL').click()
    await expect(page.locator('.db-ai-pane')).toBeVisible()
    const firstExplainAssistant = page.locator('.db-ai-pane-message.assistant').last()
    await expect(firstExplainAssistant.locator('.db-ai-pane-message-status')).toContainText('已完成')
    await expect(firstExplainAssistant.locator('.db-ai-pane-message-content')).toContainText('当前 SQL 编辑器内容和数据库上下文')
    await expect(firstExplainAssistant).not.toContainText('DB AI pane request was not found.')
    await page.getByTitle('重置对话').click()
    await expect(page.locator('.db-ai-pane-message')).toHaveCount(0)
    await page.getByTitle('AI 转换 SQL').click()
    await expect(page.locator('.db-ai-drawer')).toHaveCount(0)
    await expect(page.locator('.db-ai-pane')).toBeVisible()
    await expect(page.locator('.db-ai-pane-message.user').last()).toContainText('转换 SQL')
    await expect(page.locator('.db-ai-pane-message.user').last().locator('.db-ai-pane-source-sql')).toContainText('select id from "public"."orders"')
    const convertAssistant = page.locator('.db-ai-pane-message.assistant').last()
    await expect(convertAssistant.locator('.db-ai-pane-message-status')).toContainText('已完成')
    await expect(convertAssistant.locator('.db-ai-pane-message-content')).toContainText('已通过 aiopsterm 后端边界读取当前数据库上下文')
    await expect(convertAssistant.locator('.db-ai-pane-sql-result')).toBeVisible()
    await convertAssistant.locator('.db-ai-pane-sql-result select[title="目标方言"]').selectOption('mssql')
    await expect(convertAssistant.locator('.db-ai-pane-message-content')).toContainText('SQL Server')
    await expect(convertAssistant.locator('.db-ai-pane-sql-result pre')).toContainText('SELECT TOP (100)')
    await expect(convertAssistant.locator('.db-ai-pane-sql-result button[aria-label="运行只读 SQL"]')).toBeDisabled()
    await page.getByTitle('重置对话').click()
    await expect(page.locator('.db-ai-pane-message')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(async () => {
        const api = (window as unknown as { aiops: { getDatabaseAiPaneState: () => Promise<any> } }).aiops
        const result = await api.getDatabaseAiPaneState()
        return result?.data?.archivedSessions?.find((session: any) =>
          session.messages?.some((message: any) => String(message.content || '').includes('当前 SQL 编辑器内容和数据库上下文'))
        )?.conversationId || ''
      }))
      .not.toBe('')
    const restoredDbAiSessionId = String((await page.evaluate(async () => {
      const api = (window as unknown as { aiops: { getDatabaseAiPaneState: () => Promise<any> } }).aiops
      const result = await api.getDatabaseAiPaneState()
      return result?.data?.archivedSessions?.find((session: any) =>
        session.messages?.some((message: any) => String(message.content || '').includes('当前 SQL 编辑器内容和数据库上下文'))
      )?.conversationId || ''
    })))
    await page.getByTestId('agents-mode-entry').click()
    await page.locator('.agents-search input').fill(restoredDbAiSessionId)
    await page.locator(`.product-session-item[data-session-id="${restoredDbAiSessionId}"] .product-session-main`).click()
    await expect(page.locator('.db-ai-pane')).toBeVisible()
    await expect(page.locator('.db-ai-pane-message.assistant').last().locator('.db-ai-pane-message-content')).toContainText(
      '当前 SQL 编辑器内容和数据库上下文'
    )
    await page.getByTitle('重置对话').click()
    await expect(page.locator('.db-ai-pane-message')).toHaveCount(0)
    const ordersTableRow = page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).first()
    await ordersTableRow.locator('button').click()
    await expect(page.locator('.db-tree-row.column').filter({ hasText: 'owner' })).toBeVisible()
    await page.locator('.db-tree-row.column').filter({ hasText: 'owner' }).click()
    await expect(page.locator('.db-tree-row.column').filter({ hasText: 'owner' })).toHaveClass(/selected/)
    await ordersTableRow.click({ button: 'right' })
    await page.locator('.db-context-menu button').filter({ hasText: '查询控制台' }).click()
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
    await expect(page.locator('.db-edit-summary')).toContainText('1 已更新')
    await expect(page.locator('.db-edit-summary pre')).toContainText('UPDATE "public"."orders"')
    await page.locator('.db-toolbar button[title="撤销"]').click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await expect(page.locator('.db-result-table')).toContainText('alice')
    await page.locator('.db-toolbar button[title="添加行"]').click()
    await expect(page.locator('.db-result-table tbody tr.new')).toBeVisible()
    await expect(page.locator('.db-edit-summary')).toContainText('1 新增')
    await page.locator('.db-result-table tbody tr.new td').nth(4).dblclick()
    await page.locator('.db-result-table tbody tr.new input').fill('e2e-owner')
    await page.locator('.db-result-table tbody tr.new input').press('Enter')
    await expect(page.locator('.db-edit-summary pre')).toContainText('INSERT INTO "public"."orders"')
    await page.locator('.db-result-table tbody tr.new').click()
    await page.locator('.db-toolbar button[title="删除行"]').click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await page.locator('.db-result-table tbody tr').first().click()
    await page.locator('.db-toolbar button[title="删除行"]').click()
    await expect(page.locator('.db-result-table tbody tr.deleted')).toBeVisible()
    await expect(page.locator('.db-edit-summary')).toContainText('1 已删除')
    await expect(page.locator('.db-edit-summary pre')).toContainText('DELETE FROM "public"."orders"')
    await page.locator('.db-edit-summary-actions button').filter({ hasText: '全部丢弃' }).click()
    await expect(page.locator('.db-edit-summary')).not.toBeVisible()
    await page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).click({ button: 'right' })
    await expect(page.locator('.db-context-menu')).toBeVisible()
    await page.locator('.db-context-menu button').filter({ hasText: '查看 DDL' }).click()
    await expect(page.locator('.db-ddl-modal textarea')).toHaveValue(/CREATE TABLE/)
    await page.locator('.db-ddl-modal header button').click()
    await page.locator('.db-tree-row.table').filter({ hasText: 'orders' }).click({ button: 'right' })
    await page.locator('.db-context-menu button').filter({ hasText: '删除 table' }).click()
    await expect(page.locator('.db-danger-confirm')).toContainText('DROP TABLE')
    await page.locator('.db-danger-confirm input').fill('orders')
    await page.locator('.db-danger-confirm footer .danger').click()
    await expect(page.locator('.db-ai-drawer')).toHaveCount(0)
    await expect(page.locator('.db-ai-pane-message.user').last()).toContainText('删除 table')
    await expect(page.locator('.db-ai-pane-message.user').last().locator('.db-ai-pane-source-sql')).toContainText('DROP TABLE public.orders')
    await expect(page.locator('.db-ai-pane-sql-result').last().locator('pre')).toContainText('DROP TABLE public.orders;')
    await expect(page.locator('.db-ai-pane-sql-result').last().locator('button[aria-label="运行只读 SQL"]')).toBeDisabled()

    await page.locator('.side-rail .rail-button[title="设置"]').click()
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
    await expect(page.locator('.spotlight-highlight')).toBeVisible()
    await page.locator('.spotlight-card .primary').click()
    await expect(page.locator('.spotlight-card')).toContainText('左侧功能面板')
    await page.locator('.spotlight-close').click()
    await page.locator('.side-rail .rail-button[title="设置"]').click()
    await page.locator('.settings-nav-item').filter({ hasText: '通用' }).click()
    await page.locator('input[name="defaultLayout"]').nth(1).check()
    await expect(page.locator('input[name="defaultLayout"]').nth(1)).toBeChecked()
    await page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
    await expect(page.getByText('终端类型', { exact: true })).toBeVisible()
    await expect(page.getByText('字体只有系统已安装或能匹配到对应字体时才会明显变化')).toBeVisible()
    await page.locator('.settings-form-row').filter({ hasText: '字体' }).locator('select').selectOption('"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace')
    await expect(page.locator('.settings-form-row').filter({ hasText: '字体' }).locator('select')).toHaveValue('"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace')
    await page.getByTitle('竖线光标').click()
    await expect(page.locator('.cursor-style-button.active').filter({ has: page.locator('.cursor-preview.bar') })).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '模型' }).click()
    await expect(page.getByText('模型名称')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'LiteLLM' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Amazon Bedrock' })).toBeVisible()
    await expect(page.locator('.provider-card').filter({ hasText: 'Amazon Bedrock' }).getByText('AWS Region')).toBeVisible()
    const liteLlmCard = page.locator('.provider-card').filter({ hasText: 'LiteLLM' })
    const liteLlmBaseUrl = liteLlmCard.locator('.settings-input').first()
    await liteLlmBaseUrl.fill('http://litellm.e2e')
    await liteLlmCard.getByRole('button', { name: 'Check' }).click()
    await expect(liteLlmCard.getByText('检测到可用的地址修正')).toBeVisible()
    await expect(liteLlmCard.getByText('http://litellm.e2e/v1', { exact: true })).toBeVisible()
    await liteLlmCard.getByRole('button', { name: '应用并检测' }).click()
    await expect(liteLlmBaseUrl).toHaveValue('http://litellm.e2e/v1')
    await expect(liteLlmCard.getByText('已自动修正，输入框和保存配置已同步')).toBeVisible()
    await liteLlmCard.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('LiteLLM Save 成功')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '模型' }).click()
    await expect(page.getByText('启用 Extended Thinking')).toBeVisible()
    await expect(page.getByText('OpenAI Reasoning Effort')).toBeVisible()
    await page.locator('.settings-section-card').filter({ hasText: '启用代理' }).locator('input[type="checkbox"]').first().check()
    await expect(page.getByText('代理类型')).toBeVisible()
    await page.locator('.settings-nav-item').filter({ hasText: '主机Agent' }).click()
    await page.locator('.settings-agent-tabs button').filter({ hasText: 'MCP' }).click()
    await expect(page.getByRole('heading', { name: 'MCP Servers' })).toBeVisible()
    await page.locator('.mcp-tool-header button').filter({ hasText: 'read_file' }).click()
    await expect(page.getByText('read_file 已禁用')).toBeVisible()
    await page.locator('.settings-agent-tabs button').filter({ hasText: 'Skills' }).click()
    await expect(page.getByText('incident-triage')).toBeVisible()
    await page.getByRole('button', { name: 'Create' }).click()
    await page.locator('.settings-modal-card label').filter({ hasText: 'Skill Name' }).locator('input').fill('e-skill')
    await page.locator('.settings-modal-card label').filter({ hasText: 'Description' }).locator('textarea').fill('E2E skill description')
    await page.locator('.settings-modal-card label').filter({ hasText: 'Content' }).locator('textarea').fill('E2E skill content')
    await page.locator('.settings-modal-card footer button').filter({ hasText: '创建' }).click()
    await expect(page.locator('.skills-list').getByText('e-skill', { exact: true })).toBeVisible()
    await page.locator('.settings-agent-tabs button').filter({ hasText: '规则' }).click()
    await page.getByRole('button', { name: /添加规则/ }).click()
    await page.locator('.rules-list textarea').first().fill('E2E rule check')
    await page.locator('.rules-list button').filter({ hasText: '完成' }).click()
    await expect(page.locator('.rules-list')).toContainText('E2E rule check')
    await page.locator('.rules-list').getByRole('button', { name: '编辑' }).first().click()
    await page.locator('.rules-list textarea').first().fill('E2E rule discarded')
    await page.locator('.rules-list button').filter({ hasText: '取消' }).click()
    await expect(page.locator('.rules-list')).toContainText('E2E rule check')
    await expect(page.locator('.rules-list')).not.toContainText('E2E rule discarded')
    await page.locator('.rules-list').getByRole('button', { name: '删除' }).first().click()
    await expect(page.locator('.rules-list')).not.toContainText('E2E rule check')
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

    await page.getByTestId('agents-mode-entry').click()
    const agentsSidebar = page.locator('.agents-sidebar')
    const agentsRightPane = page.locator('[data-layout-pane="agents-right"]')
    await expect(page.locator('.side-rail')).toBeVisible()
    await expect(page.locator('.agents-search input')).toBeVisible()
    await expect(page.locator('.terminal-workspace')).toBeVisible()
    await expect(agentsRightPane).toBeVisible()
    await expect(page.getByTestId('agents-new-session-open')).toBeVisible()
    await expect(page.getByTestId('ai-panel-mode-open')).toBeVisible()
    await expect(page.locator('.right-ai-toggle')).not.toBeVisible()
    const [railBox, sidebarBox, terminalBox, aiBox] = await Promise.all([
      page.locator('.side-rail').boundingBox(),
      agentsSidebar.boundingBox(),
      page.locator('.terminal-workspace').boundingBox(),
      agentsRightPane.boundingBox()
    ])
    expect(railBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    expect(terminalBox).not.toBeNull()
    expect(aiBox).not.toBeNull()
    expect(railBox!.x).toBeLessThan(sidebarBox!.x)
    expect(sidebarBox!.x).toBeLessThan(terminalBox!.x)
    expect(terminalBox!.x).toBeLessThan(aiBox!.x)
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.agents-search input')).not.toBeVisible()
    await page.locator('.top-bar .layout-toggle').first().click()
    await expect(page.locator('.agents-search input')).toBeVisible()

    await page.locator('.agents-search input').fill('conv-2')
    await expect(agentsSidebar.getByText('K8s 发布失败')).toBeVisible()
    await expect(agentsSidebar.getByText('生产巡检')).not.toBeVisible()
    await page.locator('.agents-search input').fill('')

    await page.getByTestId('agents-new-session-open').click()
    await page.getByTestId('agents-new-classic').click()
    await expect(page.getByTestId('agents-resource-dialog')).toBeVisible()
    await page.getByTestId('agents-resource-create').click()
    await expect(page.locator('.ai-empty-chat')).toBeVisible()
    await expect(page.getByText('请输入本次运维目标。')).not.toBeVisible()
    const modeSelect = page.locator('[data-onboarding-id="ai-mode-select"]')
    await expect(modeSelect).toContainText('Agent')
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
    await expect(page.locator('.ai-model-popup .select-list')).toContainText('没有匹配的模型')
    await page.keyboard.press('Escape')
    await expect(page.locator('.ai-model-popup')).toHaveCount(0)
    await page.getByTestId('ai-model-select').click()
    await page.locator('.ai-model-popup header input').fill('qwen')
    await page.locator('.ai-model-popup .select-list button:not(.locked-model-option)').filter({ hasText: 'qwen2.5-coder' }).click()
    await expect(page.getByTestId('ai-model-select')).toContainText('qwen2.5-coder')

    await page.locator('.context-trigger-tag').click()
    await expect(page.locator('.context-select-popup')).toBeVisible()
    await page.locator('[data-onboarding-id="ai-context-hosts-menu"]').click()
    await expect(page.locator('.host-batch-footer')).toContainText('全选')
    await page.locator('.context-select-popup header input').fill('10.32.6.9')
    await page.locator('.host-batch-footer .batch-action-btn').first().click()
    await expect(page.locator('.context-tag').filter({ hasText: 'mysql-primary' })).toBeVisible()
    await expect(page.locator('.host-batch-footer')).toContainText('取消全选')
    await expect(page.locator('.host-batch-footer')).toContainText('清空选择')
    await page.locator('.host-batch-footer .batch-action-btn').filter({ hasText: '清空选择' }).click()
    await expect(page.locator('.context-tag').filter({ hasText: 'mysql-primary' })).not.toBeVisible()
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
    await page.evaluate(async () => {
      const api = (window as unknown as { aiops: { saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
      await api.saveConfig({ modelName: 'qwen2.5-coder', modelProvider: 'ollama' })
    })
    await expect.poll(() => page.evaluate(async () => {
      const api = (window as unknown as { aiops: { getConfig: () => Promise<any> } }).aiops
      const config = await api.getConfig()
      return `${config.modelProvider}:${config.modelName}`
    })).toBe('ollama:qwen2.5-coder')
    await expect(page.locator('.todo-inline-display')).toHaveCount(0)
    await expect(page.locator('.todo-compact-list')).toHaveCount(0)
    await expect(page.getByText('任务进度')).toHaveCount(0)

    await page.evaluate(async () => {
      const api = (window as unknown as { aiops: { getConfig: () => Promise<any>; saveConfig: (patch: Record<string, unknown>) => Promise<any> } }).aiops
      const config = await api.getConfig()
      await api.saveConfig({
        aiPreferences: {
          ...(config.aiPreferences || {}),
          needProxy: false,
          proxy: {
            ...((config.aiPreferences || {}).proxy || {}),
            host: '',
            port: 7890,
            enableProxyIdentity: false,
            username: '',
            password: ''
          }
        }
      })
    })
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (window as unknown as { aiops: { getConfig: () => Promise<any> } }).aiops
            return Boolean((await api.getConfig()).aiPreferences?.needProxy)
          }),
        { timeout: 5000 }
      )
      .toBe(false)
    await page.locator('.chat-editable').fill('检查生产磁盘')
    await expect(page.locator('.chat-editable .mention-chip-command')).toHaveCount(0)
    await expect(page.locator('.chat-editable .mention-chip-doc')).toHaveCount(0)
    await page.locator('.chat-input button[type="submit"]').click()
    await expect(page.locator('.message.user').filter({ hasText: '检查生产磁盘' })).toBeVisible()
    await expect(page.getByTestId('ai-context-usage-ring')).toBeVisible()
    await expect(page.getByTestId('ai-context-usage-ring')).toHaveAttribute('title', /\d+% - .+ \/ 128\.0K context used/)
    await expect.poll(() => aiChatServer.requests.map((request) => request.url), { timeout: 10_000 }).toContain('/chat/completions')
    await expect(page.getByText('当前响应由 E2E Ollama 后端生成。')).toBeVisible({ timeout: 30_000 })
    expect(aiChatServer.requests.at(-1)?.url).toMatch(/\/chat\/completions$/)
    const finalAiChatRequestBody = aiChatServer.requests.at(-1)?.body.toString('utf8') || ''
    expect(finalAiChatRequestBody).toContain('qwen2.5-coder')
    expect(finalAiChatRequestBody).toContain('检查生产磁盘')
    expect(finalAiChatRequestBody).not.toContain('/rollback-plan')
    expect(finalAiChatRequestBody).not.toContain('e2e-chat-attachment.md')
    await expect(page.getByTestId('ai-file-upload-button')).toBeEnabled()

    const classicConversationWithResponseId = await page.locator('.ai-conversation-tab.active').getAttribute('data-conversation-id')
    expect(classicConversationWithResponseId).toBeTruthy()
    const classicTabCountBeforeNew = await page.getByTestId('ai-conversation-tab').count()
    await page.getByTestId('ai-new-chat').click()
    await expect(page.getByTestId('ai-conversation-tab')).toHaveCount(classicTabCountBeforeNew + 1)
    const newClassicTab = page.locator('.ai-conversation-tab.active')
    const newClassicConversationId = await newClassicTab.getAttribute('data-conversation-id')
    const newClassicConversationTitle = (await newClassicTab.locator('.ai-conversation-tab-title').textContent())?.trim()
    expect(newClassicConversationId).toBeTruthy()
    expect(newClassicConversationTitle).toBeTruthy()
    await newClassicTab.locator('.ai-conversation-tab-close').click()
    await expect(page.getByTestId('ai-conversation-tab')).toHaveCount(classicTabCountBeforeNew)
    await page.locator(`.ai-conversation-tab[data-conversation-id="${classicConversationWithResponseId}"]`).click()
    await expect(page.locator('.message.user').filter({ hasText: '检查生产磁盘' })).toBeVisible()
    await page.locator('.agents-search input').fill(newClassicConversationId!)
    const closedClassicSession = page.locator(`.product-session-item[data-session-id="${newClassicConversationId}"]`)
    await expect(closedClassicSession).toBeVisible()
    await expect(closedClassicSession).not.toHaveClass(/open/)
    await closedClassicSession.locator('.product-session-main').click()
    await expect(page.locator(`.ai-conversation-tab[data-conversation-id="${newClassicConversationId}"]`)).toBeVisible()

    await page.screenshot({ path: path.join('test-results', 'aiopsterm-agents.png'), fullPage: true })

    await page.evaluate(async () => {
      const api = (window as unknown as {
        aiops: {
          createProductSession: (input: Record<string, unknown>) => Promise<any>
        }
      }).aiops
      const open = await api.createProductSession({
        id: 'e2e-codex-open',
        surface: 'codex',
        title: 'E2E Codex open',
        isOpen: true
      })
      const closed = await api.createProductSession({
        id: 'e2e-codex-closed',
        surface: 'codex',
        title: 'E2E Codex resume',
        isOpen: false,
        nativeBinding: {
          engine: 'codex',
          nativeSessionId: 'e2e-codex-thread',
          profile: 'embedded-tui'
        }
      })
      if (!open?.ok || !closed?.ok) throw new Error(open?.errorMessage || closed?.errorMessage || 'Codex E2E session setup failed')
    })
    await app.close()
    app = await launchApp('primary', primaryEnv, { userDataDir })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    await expect(page.getByTestId('agents-mode-entry')).toHaveClass(/active/)
    await expect(page.locator('.side-rail')).toBeVisible()
    await expect(page.locator('.agents-search input')).toBeVisible()
    await expect(page.locator('.terminal-workspace')).toBeVisible()
    await expect(page.locator('[data-layout-pane="agents-right"]')).toBeVisible()
    await expect(page.getByTestId('ai-codex-tab')).toHaveCount(0)
    await expect(page.getByTestId('ai-conversation-tab')).toHaveCount(0)
    await page.locator('.agents-search input').fill('e2e-codex-closed')
    const closedCodexSession = page.locator('.product-session-item[data-session-id="e2e-codex-closed"]')
    await expect(closedCodexSession).toBeVisible()
    await expect(closedCodexSession).not.toHaveClass(/open/)
    await closedCodexSession.locator('.product-session-main').click()
    const restoredCodexTab = page.locator('.ai-conversation-tab[data-codex-conversation-id="e2e-codex-closed"]')
    await expect(restoredCodexTab).toBeVisible()
    await restoredCodexTab.locator('.ai-conversation-tab-close').click()
    await expect(restoredCodexTab).toHaveCount(0)
    await expect(closedCodexSession).not.toHaveClass(/open/)
    await closedCodexSession.locator('.product-session-main').click()
    await expect(page.locator('.ai-conversation-tab[data-codex-conversation-id="e2e-codex-closed"]')).toBeVisible()
  } finally {
    await app.close().catch(() => undefined)
    await voiceServer.close()
    await aiChatServer.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(filesFixtureDir, { recursive: true, force: true })
    await rm(fakeKubectl.dir, { recursive: true, force: true })
    await rm(extensionStore.dir, { recursive: true, force: true })
  }
})

test('terminal tab operations and visual baseline', async () => {
  await mkdir('test-results', { recursive: true })
  const userDataDir = e2eUserDataDir('terminal')
  const app = await launchApp('terminal', {}, { userDataDir })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await disableE2eMotion(page)
    const controlSocket = await controlSocketPathForUserData(userDataDir, app.process().pid)
    const closeTabMenu = async () => {
      if ((await page.locator('.tab-menu').count()) === 0) return
      await page.locator('.terminal-grid').click({ position: { x: 10, y: 10 } })
      await expect(page.locator('.tab-menu')).not.toBeVisible()
    }
    const openTerminalContextAction = async (label: string) => {
      await closeTabMenu()
      await page.locator('.xterm-host').first().click({ button: 'right' })
      await expect(page.locator('.terminal-context-menu')).toBeVisible()
      await page.locator('.terminal-context-menu button').filter({ hasText: label }).click()
      await expect(page.locator('.terminal-context-menu')).not.toBeVisible()
    }
    const openFloatingCommandLine = async () => {
      await openTerminalContextAction('输入命令')
      await expect(page.locator('.command-line.floating input')).toBeVisible()
      return page.locator('.command-line.floating input')
    }

    await expect(page.locator('.terminal-dashboard')).toContainText('与AI对话')
    await expect(page.locator('.terminal-pane')).toHaveCount(0)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T')
    await expect(page.locator('.terminal-tab')).toHaveCount(1)
    await expect(page.locator('.terminal-grid')).not.toHaveClass(/split/)

    await page.locator('.terminal-tab').last().click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toBeVisible()
    await page.locator('.terminal-grid').click()
    await expect(page.locator('.tab-menu')).not.toBeVisible()
    await page.locator('.terminal-tab').last().click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toBeVisible()
    await page.locator('.tab-menu button').filter({ hasText: '向右拆分' }).click()
    await expect(page.locator('.terminal-tab')).toHaveCount(2)
    await expect(page.locator('.terminal-grid')).toHaveClass(/split-right/)
    await expect(page.locator('.terminal-pane')).toHaveCount(2)
    const rightSplitBoxes = await page.locator('.terminal-pane').evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().toJSON()))
    expect(Math.abs(rightSplitBoxes[0].y - rightSplitBoxes[1].y)).toBeLessThan(4)
    expect(rightSplitBoxes[1].x).toBeGreaterThan(rightSplitBoxes[0].x)

    await page.locator('.terminal-pane').last().click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-tabs').click()
    await expect(page.locator('.terminal-context-menu')).not.toBeVisible()
    await page.locator('.terminal-pane').last().click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-context-menu button').filter({ hasText: '向下拆分' }).click()
    await expect(page.locator('.terminal-tab')).toHaveCount(3)
    await expect(page.locator('.terminal-pane')).toHaveCount(3)
    const nestedSplitBoxes = await page.locator('.terminal-pane').evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().toJSON()))
    expect(nestedSplitBoxes[0].height).toBeGreaterThan(nestedSplitBoxes[1].height * 1.8)
    expect(nestedSplitBoxes[0].height).toBeGreaterThan(nestedSplitBoxes[2].height * 1.8)
    expect(Math.abs(nestedSplitBoxes[1].x - nestedSplitBoxes[2].x)).toBeLessThan(4)
    expect(nestedSplitBoxes[2].y).toBeGreaterThan(nestedSplitBoxes[1].y)
    expect(nestedSplitBoxes[0].x).toBeLessThan(nestedSplitBoxes[1].x)
    await page.locator('.terminal-pane').first().click()
    await expect(page.locator('.terminal-pane')).toHaveCount(3)
    await page.locator('.terminal-pane').first().click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-context-menu button').filter({ hasText: '向右拆分' }).click()
    await expect(page.locator('.terminal-tab')).toHaveCount(4)
    await expect(page.locator('.terminal-pane')).toHaveCount(4)
    await page.locator('.terminal-pane').nth(2).click()
    await expect(page.locator('.terminal-pane')).toHaveCount(4)
    await page.locator('.terminal-pane').nth(2).click({ button: 'right' })
    await expect(page.locator('.terminal-context-menu')).toBeVisible()
    await page.locator('.terminal-context-menu button').filter({ hasText: '取消拆分' }).click()
    await expect(page.locator('.terminal-tab')).toHaveCount(4)
    await expect(page.locator('.terminal-dashboard')).toHaveCount(0)
    await expect(page.locator('.terminal-pane')).toHaveCount(1)
    await expect(page.locator('.terminal-grid')).not.toHaveClass(/split/)
    await page.locator('.terminal-tab').nth(1).click()
    await expect(page.locator('.terminal-pane')).toHaveCount(3)

    await expect(page.locator('.terminal-toolbar')).toHaveCount(0)
    await expect(page.locator('.command-line input')).toHaveCount(0)
    const commandInput = await openFloatingCommandLine()
    await commandInput.fill('echo E2E_FLOATING_OK')
    await commandInput.press('Enter')
    await expect(page.locator('.command-line input')).toHaveCount(0)
    await expectTerminalReplayToContain(controlSocket, 'E2E_FLOATING_OK')

    await page.locator('.terminal-tab').first().click({ button: 'right' })
    await expect(page.locator('.tab-menu')).toBeVisible()
    await expect(page.locator('.tab-menu')).not.toContainText('Fork SSH Channel')
    await closeTabMenu()

    await openTerminalContextAction('搜索')
    await expect(page.locator('.terminal-search-overlay')).toBeVisible()
    await page.locator('.terminal-search-overlay input').fill('aiopsterm')
    await expect(page.locator('.terminal-search-overlay')).not.toContainText(/1\/\d+/)
    await page.locator('.terminal-search-overlay button[title="关闭"]').click()
    await expect(page.locator('.terminal-search-overlay')).not.toBeVisible()

    await openTerminalContextAction('清屏')
    await expect.poll(() => terminalReplayText(controlSocket), { timeout: 10_000 }).not.toContain('E2E_FLOATING_OK')

    await openTerminalContextAction('全局执行')
    await expect(page.locator('.terminal-global-command')).toBeVisible()
    await page.locator('.terminal-global-command input').fill('echo "E2E_GLOBAL_OK"')
    await page.locator('.terminal-global-command input').press('Enter')
    await expectTerminalReplayToContain(controlSocket, 'E2E_GLOBAL_OK')
    await page.locator('.terminal-global-command button[title="关闭"]').click()
    await expect(page.locator('.terminal-global-command')).toHaveCount(0)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K')
    await expect(page.locator('.terminal-command-dialog')).toBeVisible()
    await expect(page.locator('.terminal-command-dialog')).not.toContainText('gpt-5-Thinking')
    await page.locator('.terminal-command-dialog textarea').fill('检查磁盘空间')
    await page.locator('.terminal-command-dialog textarea').press('Enter')
    await expect(page.locator('.terminal-command-dialog textarea')).toHaveValue('检查磁盘空间')
    await expect(page.locator('.terminal-command-dialog .generated-command-row')).toHaveCount(0)
    await expect(page.locator('.terminal-output-mirror').first()).not.toContainText('[aiopsterm] no live terminal session for: df -h')
    await page.locator('.terminal-command-dialog button[title="关闭"]').click()
    await expect(page.locator('.terminal-command-dialog')).not.toBeVisible()

    await (await openFloatingCommandLine()).fill('kubectl ge')
    await expect(page.locator('.terminal-suggestions')).toBeVisible()
    await expect(page.locator('.terminal-suggestions')).toContainText('kubectl get')

    await openTerminalContextAction('文件管理')
    await expect(page.locator('.files-workspace')).toBeVisible()
    await expect(page.locator('.files-transfer-side').first()).toContainText('Local')
    await page.locator('.side-rail .rail-button[title="工作区"]').click()

    await openTerminalContextAction('字体放大')
    await openTerminalContextAction('字体缩小')

    const tabCountBeforeOverflow = await page.locator('.terminal-tab').count()
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T')
    }
    await expect(page.locator('.terminal-tab')).toHaveCount(tabCountBeforeOverflow + 10)
    await expect.poll(
      () =>
        page.locator('.terminal-tabs').evaluate((element) => {
          const stripRect = element.getBoundingClientRect()
          const visibleTabs = Array.from(element.querySelectorAll<HTMLElement>('.terminal-tab')).filter((tab) => {
            const rect = tab.getBoundingClientRect()
            return rect.right > stripRect.left + 2 && rect.left < stripRect.right - 2 && rect.width > 20
          })
          const activeTab = element.querySelector<HTMLElement>('.terminal-tab.active')
          const activeRect = activeTab?.getBoundingClientRect()
          const activeIconRect = activeTab?.querySelector<HTMLElement>('.terminal-tab-icon')?.getBoundingClientRect()
          const activeTitleRect = activeTab?.querySelector<HTMLElement>('.terminal-tab-title')?.getBoundingClientRect()
          const activeCloseRect = activeTab?.querySelector<HTMLElement>('.terminal-tab-close')?.getBoundingClientRect()
          const activeVisible = Boolean(
            activeRect &&
              activeRect.right > stripRect.left + 2 &&
              activeRect.left < stripRect.right - 2 &&
              activeRect.width >= 112 &&
              activeIconRect &&
              activeIconRect.width >= 14 &&
              activeTitleRect &&
              activeTitleRect.width >= 38 &&
              activeCloseRect &&
              activeCloseRect.width >= 20 &&
              activeIconRect.right <= activeTitleRect.left &&
              activeTitleRect.right <= activeCloseRect.left
          )
          const visibleTitles = visibleTabs.filter((tab) => {
            const title = tab.querySelector<HTMLElement>('.terminal-tab-title')
            const titleRect = title?.getBoundingClientRect()
            return Boolean(title?.textContent?.trim() && titleRect && titleRect.width > 8)
          }).length
          return (
            activeVisible &&
            Math.round(stripRect.width) > 160 &&
            element.scrollWidth > stripRect.width &&
            visibleTabs.length > 0 &&
            visibleTitles > 0
          )
        }),
      { timeout: 10_000 }
    ).toBe(true)
    const overflowMetrics = await page.locator('.terminal-tabs').evaluate((element) => {
      const stripRect = element.getBoundingClientRect()
      return {
        clientWidth: Math.round(stripRect.width),
        scrollWidth: element.scrollWidth,
        visibleTabs: Array.from(element.querySelectorAll<HTMLElement>('.terminal-tab')).filter((tab) => {
          const rect = tab.getBoundingClientRect()
          return rect.right > stripRect.left + 2 && rect.left < stripRect.right - 2 && rect.width > 20
        }).length,
        visibleTitles: Array.from(element.querySelectorAll<HTMLElement>('.terminal-tab-title')).filter((title) => {
          const rect = title.getBoundingClientRect()
          return Boolean(title.textContent?.trim() && rect.right > stripRect.left + 2 && rect.left < stripRect.right - 2 && rect.width > 8)
        }).length
      }
    })
    expect(overflowMetrics.clientWidth).toBeGreaterThan(160)
    expect(overflowMetrics.scrollWidth).toBeGreaterThan(overflowMetrics.clientWidth)
    expect(overflowMetrics.visibleTabs).toBeGreaterThan(0)
    expect(overflowMetrics.visibleTitles).toBeGreaterThan(0)
    await expect(page.locator('.terminal-tabs-scroll.right')).toBeVisible()

    await page.screenshot({ path: path.join('test-results', 'aiopsterm-terminal.png'), fullPage: true })
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
