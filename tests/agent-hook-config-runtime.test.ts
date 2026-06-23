import { describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/contracts/agentHooks'

type AgentHookDefinition = {
  source: AgentHookInstallerSource
  events: Array<{ agentEvent: string; hookEvent: string; timeout: number }>
}

type AgentHookConfigRuntimeModule = {
  agentHookCommandFor(source: AgentHookInstallerSource, hookEvent: string, scriptPath: string): string
  codexHookHash(eventName: string, command: string, timeout: number, matcher?: string): string
  fileHookMarker: string
  hookDefinitions: AgentHookDefinition[]
  installCodexHookTrust(content: string, configPath: string, hooks: Record<string, unknown>): string
  installCodexHooksFeature(content: string): string
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
  const modulePath = '../src/main/backend/agentHookConfigRuntime'
  return import(modulePath) as Promise<AgentHookConfigRuntimeModule>
}

const definition = async (source: AgentHookInstallerSource) => {
  const runtime = await loadRuntime()
  return runtime.hookDefinitions.find((item) => item.source === source)!
}

describe('agentHookConfigRuntime', () => {
  it('normalizes source aliases and renders fail-open hook commands', async () => {
    const runtime = await loadRuntime()

    expect(runtime.normalizeSource('claude_code')).toBe('claude-code')
    expect(runtime.normalizeSource('open-code')).toBe('opencode')
    expect(runtime.normalizeSource('unknown-agent')).toBeNull()
    expect(runtime.agentHookCommandFor('claude-code', 'PermissionRequest', '/opt/aiopsterm/agent hook.js')).toBe(
      "command -v node >/dev/null 2>&1 && AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1 node '/opt/aiopsterm/agent hook.js' --source 'claude-code' --event 'PermissionRequest' --wait-decision --wait-timeout-ms 120000 || echo '{}'"
    )
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
    expect(JSON.stringify(grouped.config)).toContain('aiopsterm-agent-hook-v1')

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
    expect(yaml).toContain('AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1')

    expect(runtime.mergeOpenCodePluginRegistration({ plugin: ['user-plugin'] }, true).plugin).toEqual(['user-plugin', './plugins/aiopsterm-session.js'])
    expect(runtime.mergeOpenCodePluginRegistration({ plugin: ['user-plugin', './plugins/aiopsterm-session.js'] }, false).plugin).toEqual(['user-plugin'])
  })
})
