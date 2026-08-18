import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/contracts/agentHooks'

type AgentHookDefinition = {
  source: AgentHookInstallerSource
  events: Array<{ agentEvent: string; hookEvent: string; timeout: number }>
}

type AgentHookConfigRuntimeModule = {
  agentHookCommandFor(source: AgentHookInstallerSource, hookEvent: string, scriptPath: string, platform?: NodeJS.Platform, jsRuntimeExecutable?: string): string
  codexHookHash(eventName: string, command: string, timeout: number, matcher?: string): string
  fileHookMarker: string
  hookDefinitions: AgentHookDefinition[]
  installCodexHookTrust(content: string, configPath: string, hooks: Record<string, unknown>): string
  installCodexHooksFeature(content: string): string
  isOwnedHookCommand(command: unknown): boolean
  mergeAgentHookJson(
    existing: Record<string, unknown>,
    definition: AgentHookDefinition,
    scriptPath: string,
    install: boolean
  ): { config: Record<string, unknown>; removed: number }
  mergeOpenCodePluginRegistration(existing: Record<string, unknown>, install: boolean): Record<string, unknown>
  normalizeSource(value: unknown): AgentHookInstallerSource | null
  pluginFileContentFor(definition: AgentHookDefinition): string
  removeOwnedHooksFromGroups(value: unknown): { value: unknown; removed: number }
  rovoDevYamlHooksBlock(definition: AgentHookDefinition, scriptPath: string): string
  uninstallCodexHooksFeature(content: string): string
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentHookConfigRuntime'
  return import(modulePath) as Promise<AgentHookConfigRuntimeModule>
}

const definition = async (source: AgentHookInstallerSource) => {
  const runtime = await loadRuntime()
  return runtime.hookDefinitions.find((item) => item.source === source)!
}

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('agentHookConfigRuntime', () => {
  it('normalizes source aliases and renders fail-open hook commands', async () => {
    const runtime = await loadRuntime()
    const jsRuntime = '/opt/aiopsterm/aiopsterm'

    expect(runtime.normalizeSource('claude_code')).toBe('claude-code')
    expect(runtime.normalizeSource('open-code')).toBe('opencode')
    expect(runtime.normalizeSource('unknown-agent')).toBeNull()
    expect(runtime.agentHookCommandFor('claude-code', 'PermissionRequest', '/opt/aiopsterm/agent hook.js', 'linux', jsRuntime)).toBe(
      "ELECTRON_RUN_AS_NODE=1 AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1 '/opt/aiopsterm/aiopsterm' '/opt/aiopsterm/agent hook.js' --source 'claude-code' --event 'PermissionRequest' --wait-decision --wait-timeout-ms 120000 || echo '{}'"
    )
  })

  it('renders Windows fail-open hook commands without requiring POSIX shell builtins', async () => {
    const runtime = await loadRuntime()
    const jsRuntime = 'C:\\Program Files\\aiopsterm\\aiopsterm.exe'

    const command = runtime.agentHookCommandFor('claude-code', 'AskUserQuestion', 'C:\\Program Files\\aiopsterm\\aiopsterm-agent-hook.js', 'win32', jsRuntime)
    expect(command).toMatch(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/)
    const decoded = Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le')
    expect(decoded).toContain("& 'C:\\Program Files\\aiopsterm\\aiopsterm-agent-hook-v1.ps1'")
    expect(decoded).toContain("-Runtime 'C:\\Program Files\\aiopsterm\\aiopsterm.exe'")
    expect(decoded).toContain("-Source 'claude-code' -Event 'AskUserQuestion' -WaitDecision")
  })

  it('uses the shell-neutral Windows launcher for every command-based agent', async () => {
    const runtime = await loadRuntime()
    for (const agent of runtime.hookDefinitions.filter((item) => item.events.length)) {
      for (const event of agent.events) {
        const command = runtime.agentHookCommandFor(agent.source, event.hookEvent, 'C:\\Users\\Ops User\\agent-hooks\\aiopsterm-agent-hook.js', 'win32', 'C:\\Program Files\\aiopsterm\\aiopsterm.exe')
        expect(command).toMatch(/^powershell\.exe .* -EncodedCommand [A-Za-z0-9+/=]+$/)
        expect(runtime.isOwnedHookCommand(command)).toBe(true)
        const decoded = Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le')
        expect(decoded).toContain(`-Source '${agent.source}' -Event '${event.hookEvent}'`)
      }
    }
  })

  windowsIt('runs the same Windows hook command through CMD and PowerShell', async () => {
    const runtime = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-hook-shells-'))
    try {
      const scriptPath = join(root, 'aiopsterm-agent-hook.js')
      const launcherPath = join(root, 'aiopsterm-agent-hook-v1.ps1')
      await copyFile(join(process.cwd(), 'resources', 'aiopsterm-agent-hook-v1.ps1'), launcherPath)
      await writeFile(
        scriptPath,
        `const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  const valid = process.env.ELECTRON_RUN_AS_NODE === '1' &&
    process.env.AIOPSTERM_AGENT_HOOK_MARKER === 'aiopsterm-agent-hook-v1' &&
    process.argv.includes('codex') && process.argv.includes('SessionStart') &&
    JSON.parse(Buffer.concat(chunks).toString('utf8')).session_id === 'shell-smoke'
  process.stdout.write(JSON.stringify({ received: valid }))
  process.exitCode = valid ? 0 : 7
})
`,
        'utf-8'
      )
      const command = runtime.agentHookCommandFor('codex', 'SessionStart', scriptPath, 'win32', process.execPath)
      const input = JSON.stringify({ session_id: 'shell-smoke' })
      const invocations = [
        { shell: process.env.COMSPEC || 'cmd.exe', args: ['/D', '/S', '/C', command] },
        { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
      ]

      for (const invocation of invocations) {
        const result = spawnSync(invocation.shell, invocation.args, { input, encoding: 'utf-8' })
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toContain('{"received":true}')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('merges grouped, flat, and Kiro JSON hooks while preserving user entries', async () => {
    const runtime = await loadRuntime()
    const codex = await definition('codex')
    const cursor = await definition('cursor')
    const kiro = await definition('kiro')

    const grouped = runtime.mergeAgentHookJson(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 user-stop.py', timeout: 20 }] }] } },
      codex,
      '/opt/aiopsterm/hook.js',
      true
    )
    expect((grouped.config.hooks as any).Stop).toHaveLength(2)
    expect((grouped.config.hooks as any).AskUserQuestion[0].hooks[0]).toEqual({
      type: 'command',
      command: runtime.agentHookCommandFor('codex', 'AskUserQuestion', '/opt/aiopsterm/hook.js'),
      timeout: 5
    })
    expect(runtime.isOwnedHookCommand((grouped.config.hooks as any).Stop[1].hooks[0].command)).toBe(true)

    const flat = runtime.mergeAgentHookJson({ version: 1 }, cursor, '/opt/aiopsterm/hook.js', true)
    expect((flat.config.hooks as any).beforeSubmitPrompt[0]).toEqual({
      command: runtime.agentHookCommandFor('cursor', 'prompt_submit', '/opt/aiopsterm/hook.js'),
      timeout: 5
    })

    const kiroResult = runtime.mergeAgentHookJson({}, kiro, '/opt/aiopsterm/hook.js', true)
    expect(kiroResult.config).toEqual(expect.objectContaining({ name: 'aiopsterm', tools: ['*'] }))
    expect((kiroResult.config.hooks as any).agentSpawn[0]).toEqual({
      command: runtime.agentHookCommandFor('kiro', 'SessionStart', '/opt/aiopsterm/hook.js'),
      timeout_ms: 5000
    })
  })

  it('removes only aiopsterm-owned grouped hooks', async () => {
    const runtime = await loadRuntime()
    const owned = runtime.agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/hook.js')

    expect(
      runtime.removeOwnedHooksFromGroups([
        { matcher: '', hooks: [{ command: 'python3 user.py' }, { command: owned }] },
        { command: owned }
      ])
    ).toEqual({
      removed: 2,
      value: [{ matcher: '', hooks: [{ command: 'python3 user.py' }] }]
    })
  })

  it('updates Codex feature and trust TOML blocks idempotently', async () => {
    const runtime = await loadRuntime()
    const codex = await definition('codex')
    const command = runtime.agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/hook.js')
    const installed = runtime.installCodexHooksFeature('[features]\nhooks = false\n')
    const hooks = runtime.mergeAgentHookJson({}, codex, '/opt/aiopsterm/hook.js', true).config.hooks as Record<string, unknown>
    const trusted = runtime.installCodexHookTrust(installed, '/home/ops/.codex/hooks.json', hooks)

    expect(installed).toContain('hooks = true')
    expect(runtime.uninstallCodexHooksFeature(trusted)).toBe('[features]\nhooks = false\n')
    expect(trusted).toContain('[hooks.state."/home/ops/.codex/hooks.json:stop:0:0"]')
    expect(trusted).toContain(`trusted_hash = "${runtime.codexHookHash('Stop', command, 5)}"`)
    expect(trusted).toContain('[hooks.state."/home/ops/.codex/hooks.json:ask_user_question:0:0"]')
  })

  it('renders plugin file templates, YAML hooks, and OpenCode registration without user plugin loss', async () => {
    const runtime = await loadRuntime()
    const opencode = await definition('opencode')
    const amp = await definition('amp')
    const rovodev = await definition('rovodev')

    expect(runtime.pluginFileContentFor(opencode)).toContain(runtime.fileHookMarker)
    expect(runtime.pluginFileContentFor(opencode)).toContain('source = "opencode"')
    expect(runtime.pluginFileContentFor(amp)).toContain('source = "amp"')

    const yaml = runtime.rovoDevYamlHooksBlock(rovodev, '/opt/aiopsterm/hook.js')
    expect(yaml).toContain('aiopsterm-rovodev-hooks begin')
    expect(yaml).toContain('SessionStart')
    expect(yaml).toContain(process.platform === 'win32' ? '-EncodedCommand' : 'AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1')

    expect(runtime.mergeOpenCodePluginRegistration({ plugin: ['user-plugin'] }, true).plugin).toEqual(['user-plugin', './plugins/aiopsterm-session.js'])
    expect(runtime.mergeOpenCodePluginRegistration({ plugin: ['user-plugin', './plugins/aiopsterm-session.js'] }, false).plugin).toEqual(['user-plugin'])
  })
})
