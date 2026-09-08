import { test, expect } from './support/desktop'
import { startAgentProvider } from './support/agent-provider'
import { isolatedEnvironment } from './support/environment'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

for (const source of ['claude', 'kimi-code']) {
  test(`real ${source} resume excludes deleted user content @agents`, async ({ desktop }) => {
    test.setTimeout(180000)
    const provider = await startAgentProvider()
    const sessionId = randomUUID()
    const home = join(desktop.root, 'home', source === 'claude' ? '.claude' : '.kimi-code')
    await mkdir(home, { recursive: true })
    if (source === 'kimi-code') await writeFile(join(home, 'config.toml'), `default_model = "regression"\ntelemetry = false\nmerge_all_available_skills = false\n[providers.regression]\ntype = "openai"\nbase_url = "${provider.baseUrl}/v1"\napi_key = "regression-local-only"\n[models.regression]\nprovider = "regression"\nmodel = "gpt-4.1"\nmax_context_size = 100000\n`)
    const run = async (prompt: string, resume: boolean) => {
      const args = source === 'claude' ? ['--bare', '--model', 'claude-sonnet-4-6', '--tools=', '-p', prompt, ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId])]
        : ['-m', 'regression', '-p', prompt, ...(resume ? ['--continue'] : [])]
      const child = spawn(source === 'claude' ? 'claude' : 'kimi', args, { cwd: desktop.root, shell: process.platform === 'win32',
        env: { ...await isolatedEnvironment(desktop.root), ANTHROPIC_BASE_URL: provider.baseUrl, ANTHROPIC_API_KEY: 'regression-local-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', KIMI_CODE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (data) => { output += data.toString() })
      child.stderr.on('data', (data) => { output += data.toString() })
      const timer = setTimeout(() => child.kill('SIGKILL'), 45000)
      try {
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
        expect(code, output).toBe(0)
        expect(output).toContain('REGRESSION_REAL_AGENT_ANSWER')
      } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
    }
    try {
      await run('REGRESSION_AGENT_REMOVE', false)
      await run('REGRESSION_AGENT_KEEP', true)
      const locate = async (directory: string): Promise<string[]> => {
        const files: string[] = []
        for (const item of await readdir(directory, { withFileTypes: true })) {
          if (item.isDirectory()) files.push(...await locate(join(directory, item.name)))
          else if (source === 'claude' ? item.name === `${sessionId}.jsonl` : item.name === 'wire.jsonl') files.push(join(directory, item.name))
        }
        return files
      }
      const files = await locate(home)
      expect(files).toHaveLength(1)
      const transcriptPath = files[0]
      await desktop.api('publishAiAgentSessionEvent', { source, sessionId, event: 'session_start', transcriptPath, cwd: desktop.root, receivedAt: Date.now() })
      const records = await desktop.api('listManagedAiSessionContent', { source, sessionId, query: 'REGRESSION_AGENT_REMOVE', limit: 500 })
      expect(records.data.records.length).toBeGreaterThan(0)
      const selected = records.data.records
      const deleted = await desktop.api('deleteManagedAiSessionContentRecord', { source, sessionId, recordId: selected[0].recordId, recordIds: selected.map((record: any) => record.recordId), sourceRevision: selected[0].sourceRevision })
      expect(deleted.ok, JSON.stringify(deleted)).toBe(true)
      expect(await readFile(transcriptPath, 'utf8')).not.toContain('REGRESSION_AGENT_REMOVE')
      provider.requests.splice(0)
      await run('REGRESSION_AGENT_RESUME', true)
      const inputs = provider.requests.filter((request) => JSON.stringify(request.messages).includes('REGRESSION_AGENT_RESUME'))
      expect(inputs.length).toBeGreaterThan(0)
      expect(JSON.stringify(inputs)).toContain('REGRESSION_AGENT_KEEP')
      expect(JSON.stringify(inputs)).not.toContain('REGRESSION_AGENT_REMOVE')
    } finally { await provider.close() }
  })
}
