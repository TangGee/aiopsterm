import { test, expect } from './support/desktop'
import { startResponsesProvider } from './support/responses-provider'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { isolatedEnvironment } from './support/environment'
import { existsSync } from 'node:fs'

test('bundled Codex streams, cancels, reports errors and resumes edited context @codex', async ({ desktop }) => {
  test.setTimeout(process.platform === 'win32' ? 300000 : 180000)
  const provider = await startResponsesProvider()
  const codexHome = join(desktop.root, 'state', 'codex-agent')
  if (process.platform === 'win32') {
    // Keep the real read-only sandbox and approval flow, using the supported
    // non-admin backend in this disposable home instead of interactive UAC.
    await mkdir(codexHome, { recursive: true })
    await writeFile(join(codexHome, 'config.toml'), '[windows]\nsandbox = "unelevated"\n')
  }
  const submitPrompt = async (prompt: string) => {
    await desktop.page.keyboard.type(prompt)
    // Codex suppresses Enter briefly after a paste-like input burst. Let its
    // 120 ms suppression window expire before testing message submission.
    await desktop.page.waitForTimeout(250)
    await desktop.page.keyboard.press('Enter')
  }
  try {
    const config = await desktop.api('getConfig')
    await desktop.api('saveConfig', {
      modelProvider: 'openai', modelName: 'gpt-5.1',
      modelSettings: { ...config.modelSettings,
        providers: { ...config.modelSettings?.providers, openai: { apiFormat: 'responses', baseUrl: provider.baseUrl, apiKey: 'regression-local-only', modelId: 'gpt-5.1' } },
        options: [{ name: 'gpt-5.1', checked: true, locked: false, type: 'custom', apiProvider: 'openai' }]
      }
    })
    await desktop.page.reload()
    await desktop.localTerminal()
    await desktop.page.evaluate(() => {
      const state: { output: string; threads: any[]; lifecycle: any[] } = (window as any).__regressionCodex = { output: '', threads: [], lifecycle: [] }
      ;(window as any).aiops.onCodexSessionData((event: any) => { state.output += event.data })
      ;(window as any).aiops.onCodexSessionThread((event: any) => { state.threads.push(event) })
      ;(window as any).aiops.onCodexSessionLifecycle((event: any) => { state.lifecycle.push(event) })
    })
    await desktop.page.getByTestId('ai-panel-mode-open').click()
    await desktop.page.getByTestId('ai-mode-codex').click()
    await desktop.page.getByTestId('ai-codex-bind-open').click()
    await desktop.page.getByTestId('ai-codex-bind-current').click()
    const terminal = desktop.page.getByTestId('ai-codex-xterm').filter({ visible: true })
    const output = () => desktop.page.evaluate(() => (window as any).__regressionCodex.output as string)
    await expect.poll(output).toContain('Press enter to continue')
    await terminal.click()
    await desktop.page.keyboard.press('Enter')
    await expect.poll(output).toContain('/model')
    if (process.platform === 'win32') {
      const configured = await readFile(join(codexHome, 'config.toml'), 'utf8')
      expect(configured).toContain('sandbox_mode = "read-only"')
      expect(configured).toContain('approval_policy = "on-request"')
    }
    await terminal.click()
    await submitPrompt('REGRESSION_REMOVE_ME')
    await expect.poll(() => provider.requests.length).toBeGreaterThan(0)
    await expect.poll(output).toContain('REGRESSION_CODEX_ANSWER')
    provider.respond('REGRESSION_KEEP_ME')
    await submitPrompt('REGRESSION_KEEP_REQUEST')
    await expect.poll(output).toContain('REGRESSION_KEEP_ME')
    const commandTool = provider.requests[0].tools.find((tool: any) => tool.name === 'mcp__aiopsterm_remote__run_command')
    expect(commandTool, JSON.stringify(provider.requests[0].tools.map((tool: any) => tool.name))).toBeTruthy()
    for (const approved of [true, false]) {
      const sentinel = join(desktop.root, approved ? 'approved.txt' : 'rejected.txt')
      const quoted = `'${sentinel.replace(/'/g, "'\\''")}'`
      const command = process.platform === 'win32' ? `Set-Content -LiteralPath '${sentinel.replace(/'/g, "''")}' -Value approved` : `printf approved > ${quoted}`
      provider.respond(approved ? 'REGRESSION_APPROVAL_COMPLETE' : 'REGRESSION_REJECTION_COMPLETE')
      provider.tool(commandTool.name, { command, timeoutMs: process.platform === 'win32' ? 60000 : 10000 })
      const offset = (await output()).length
      await submitPrompt(approved ? 'REGRESSION_APPROVE_TOOL' : 'REGRESSION_REJECT_TOOL')
      await expect.poll(async () => (await output()).slice(offset)).toContain('enter to submit')
      expect(existsSync(sentinel)).toBe(false)
      await desktop.page.keyboard.press(approved ? 'Enter' : 'Escape')
      if (approved) {
        await expect.poll(() => existsSync(sentinel)).toBe(true)
        await expect.poll(output).toContain('REGRESSION_APPROVAL_COMPLETE')
      }
      else {
        await expect.poll(async () => (await output()).slice(offset)).toContain('REGRESSION_REJECTION_COMPLETE')
        expect(existsSync(sentinel)).toBe(false)
      }
    }
    provider.respond('REGRESSION_CANCEL_STREAM', 'hold')
    await submitPrompt('REGRESSION_CANCEL_REQUEST')
    await expect.poll(output).toContain('REGRESSION_CANCEL_STREAM')
    await desktop.page.keyboard.press('Escape')
    await expect.poll(output).toContain('Conversation interrupted')
    provider.finishHeld()
    provider.respond('', 'error')
    await submitPrompt('REGRESSION_ERROR_REQUEST')
    await expect.poll(output).toContain('REGRESSION_RESPONSE_ERROR')
    expect(await output()).not.toContain('REGRESSION_LATE_CANCELLED_OUTPUT')
    provider.respond('REGRESSION_AFTER_ERROR')
    await expect.poll(async () => desktop.page.evaluate(() => (window as any).__regressionCodex.threads.length)).toBeGreaterThan(0)
    const threads = await desktop.page.evaluate(() => (window as any).__regressionCodex.threads)
    expect(threads.length).toBeGreaterThan(0)
    const thread = threads.at(-1)
    const locate = async (directory: string): Promise<string[]> => {
      const files: string[] = []
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.isDirectory()) files.push(...await locate(join(directory, item.name)))
        else if (item.name.endsWith('.jsonl')) files.push(join(directory, item.name))
      }
      return files
    }
    const files = await locate(join(codexHome, 'sessions'))
    const transcriptPath = files.find((file) => file.includes(thread.threadId))
    expect(transcriptPath).toBeTruthy()
    await desktop.api('killCodexSession', thread.id)
    // Managed content resolves this Codex home from the scoped environment.
    await desktop.app.evaluate((_, home) => { process.env.CODEX_HOME = home }, codexHome)
    await desktop.api('publishAiAgentSessionEvent', { source: 'codex', sessionId: thread.threadId, event: 'session_start', transcriptPath, cwd: desktop.root, receivedAt: Date.now() })
    const list = await desktop.api('listManagedAiSessionContent', { source: 'codex', sessionId: thread.threadId, query: 'REGRESSION_REMOVE_ME', limit: 500 })
    expect(list.data.records.length).toBeGreaterThan(0)
    const selected = list.data.records
    const deleted = await desktop.api('deleteManagedAiSessionContentRecord', { source: 'codex', sessionId: thread.threadId,
      recordId: selected[0].recordId, recordIds: selected.map((record: any) => record.recordId), sourceRevision: selected[0].sourceRevision })
    expect(deleted.ok, JSON.stringify(deleted)).toBe(true)
    expect(await readFile(transcriptPath!, 'utf8')).not.toContain('REGRESSION_REMOVE_ME')
    const before = provider.requests.length
    const binary = await desktop.page.evaluate(() => (window as any).__regressionCodex.lifecycle.find((item: any) => item.binaryPath)?.binaryPath)
    expect(binary).toBeTruthy()
    // Resume through the same real binary and persisted home, with a fresh process.
    const resumed = spawn(binary, ['exec', 'resume', '--skip-git-repo-check', '--json', thread.threadId, 'REGRESSION_RESUME_PROBE'], {
      cwd: desktop.root, env: { ...await isolatedEnvironment(desktop.root), CODEX_HOME: codexHome, AIOPSTERM_CODEX_API_KEY: 'regression-local-only' }, stdio: ['ignore', 'pipe', 'pipe']
    })
    let resumedOutput = ''
    resumed.stdout.on('data', (data) => { resumedOutput += data.toString() })
    resumed.stderr.on('data', (data) => { resumedOutput += data.toString() })
    const exited = new Promise<number | null>((resolve, reject) => { resumed.once('exit', resolve); resumed.once('error', reject) })
    try {
      await expect.poll(() => ({ requests: provider.requests.length, output: resumedOutput }), { timeout: 30000 }).toMatchObject({ requests: before + 1 })
      const restoredInput = JSON.stringify(provider.requests.at(-1).input)
      expect(restoredInput).toContain('REGRESSION_KEEP_REQUEST')
      expect(restoredInput).not.toContain('REGRESSION_REMOVE_ME')
      expect(restoredInput).not.toContain('REGRESSION_LATE_CANCELLED_OUTPUT')
      await expect.poll(() => resumedOutput).toContain('REGRESSION_AFTER_ERROR')
      expect(await exited).toBe(0)
    } finally { resumed.kill(); await exited.catch(() => undefined) }
  } finally { await provider.close() }
})
