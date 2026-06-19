import { describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/preload'

type AgentHookInstallerBackend = {
  agentHookCommandFor: (source: AgentHookInstallerSource, hookEvent: string, scriptPath?: string) => string
  codexHookHash: (eventName: string, command: string, timeout: number, matcher?: string) => string
  mergeAgentHookJson: (
    existing: Record<string, unknown>,
    definition: unknown,
    scriptPath: string,
    install: boolean
  ) => { config: Record<string, unknown>; removed: number }
  installCodexHooksFeature: (content: string) => string
  uninstallCodexHooksFeature: (content: string) => string
  __testing: {
    hookDefinitions: Array<{ source: AgentHookInstallerSource }>
    ownedMarker: string
    installCodexHookTrust: (content: string, configPath: string, hooks: Record<string, unknown>) => string
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/agentHookInstaller'
  return (await import(modulePath)) as AgentHookInstallerBackend
}

describe('agent hook installer backend', () => {
  it('installs Codex hooks without removing existing user hooks', async () => {
    const { __testing, agentHookCommandFor, mergeAgentHookJson } = await loadBackend()
    const codex = __testing.hookDefinitions.find((definition) => definition.source === 'codex')!
    const existing = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: 'python3 /home/user/custom-stop.py', timeout: 20 }]
          }
        ]
      }
    }

    const result = mergeAgentHookJson(existing, codex, '/opt/aiopsterm/aiopsterm-agent-hook.js', true)
    const hooks = result.config.hooks as Record<string, unknown[]>
    const stopGroups = hooks.Stop as Array<{ hooks: Array<{ command: string }> }>

    expect(stopGroups).toHaveLength(2)
    expect(stopGroups[0].hooks[0].command).toBe('python3 /home/user/custom-stop.py')
    expect(stopGroups[1].hooks[0].command).toBe(agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/aiopsterm-agent-hook.js'))
    expect(JSON.stringify(result.config)).toContain(__testing.ownedMarker)
  })

  it('uninstalls only aiopsterm-owned hook entries', async () => {
    const { __testing, agentHookCommandFor, mergeAgentHookJson } = await loadBackend()
    const claude = __testing.hookDefinitions.find((definition) => definition.source === 'claude-code')!
    const existing = {
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: 'python3 /home/user/doc_phase_guard_hook.py' },
              { type: 'command', command: agentHookCommandFor('claude-code', 'Stop', '/opt/aiopsterm/aiopsterm-agent-hook.js'), timeout: 5 }
            ]
          }
        ]
      }
    }

    const result = mergeAgentHookJson(existing, claude, '/opt/aiopsterm/aiopsterm-agent-hook.js', false)
    const hooks = result.config.hooks as Record<string, unknown[]>
    const stopGroups = hooks.Stop as Array<{ hooks: Array<{ command: string }> }>

    expect(result.removed).toBe(1)
    expect(stopGroups).toEqual([
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'python3 /home/user/doc_phase_guard_hook.py' }]
      }
    ])
  })

  it('restores a previous Codex hooks feature line on uninstall', async () => {
    const { installCodexHooksFeature, uninstallCodexHooksFeature } = await loadBackend()
    const installed = installCodexHooksFeature('[features]\nhooks = false\n')

    expect(installed).toContain('aiopsterm-codex-hooks-feature begin')
    expect(installed).toContain('hooks = true')

    const uninstalled = uninstallCodexHooksFeature(installed)
    expect(uninstalled).toBe('[features]\nhooks = false\n')
  })

  it('preserves dotted Codex hooks feature syntax and removes legacy codex_hooks keys', async () => {
    const { installCodexHooksFeature, uninstallCodexHooksFeature } = await loadBackend()
    const installed = installCodexHooksFeature('codex_hooks = true\nfeatures.hooks = false\nfeatures.experimental = true\n')

    expect(installed).not.toContain('codex_hooks')
    expect(installed).toContain('features.hooks = true')
    expect(installed).toContain('features.experimental = true')

    const uninstalled = uninstallCodexHooksFeature(installed)
    expect(uninstalled).toBe('features.hooks = false\nfeatures.experimental = true\n')
  })

  it('installs additional JSON-based agent hooks without nesting flat hook formats', async () => {
    const { __testing, agentHookCommandFor, mergeAgentHookJson } = await loadBackend()
    const cursor = __testing.hookDefinitions.find((definition) => definition.source === 'cursor')!
    const gemini = __testing.hookDefinitions.find((definition) => definition.source === 'gemini')!

    const cursorResult = mergeAgentHookJson({ version: 1 }, cursor, '/opt/aiopsterm/aiopsterm-agent-hook.js', true)
    const cursorHooks = cursorResult.config.hooks as Record<string, Array<{ command: string }>>
    expect(cursorHooks.beforeSubmitPrompt[0]).toEqual({
      command: agentHookCommandFor('cursor', 'prompt_submit', '/opt/aiopsterm/aiopsterm-agent-hook.js'),
      timeout: 5
    })

    const geminiResult = mergeAgentHookJson({}, gemini, '/opt/aiopsterm/aiopsterm-agent-hook.js', true)
    const geminiHooks = geminiResult.config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
    expect(geminiHooks.SessionStart[0].hooks[0].command).toBe(agentHookCommandFor('gemini', 'SessionStart', '/opt/aiopsterm/aiopsterm-agent-hook.js'))
  })

  it('uses Codex-compatible fail-open hook commands and stable trust hashes', async () => {
    const { agentHookCommandFor, codexHookHash } = await loadBackend()
    const command = agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/aiopsterm-agent-hook.js')

    expect(command).toBe(
      "command -v node >/dev/null 2>&1 && AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1 node '/opt/aiopsterm/aiopsterm-agent-hook.js' --source 'codex' --event 'Stop' || echo '{}'"
    )
    expect(command).not.toContain('printf')
    expect(codexHookHash('Stop', command, 5)).toBe('sha256:9602d844b7330ac63541d559890c9f6dd9f155c1814bb8af441aa4e3999041ca')
  })

  it('writes Codex hook trust entries using Codex hook state keys', async () => {
    const { __testing, agentHookCommandFor, codexHookHash, mergeAgentHookJson } = await loadBackend()
    const codex = __testing.hookDefinitions.find((definition) => definition.source === 'codex')!
    const result = mergeAgentHookJson({}, codex, '/opt/aiopsterm/aiopsterm-agent-hook.js', true)
    const hooks = result.config.hooks as Record<string, unknown>
    const command = agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/aiopsterm-agent-hook.js')
    const trusted = __testing.installCodexHookTrust('[features]\nhooks = true\n', '/home/ops/.codex/hooks.json', hooks)

    expect(trusted).toContain('[hooks.state."/home/ops/.codex/hooks.json:stop:0:0"]')
    expect(trusted).toContain(`trusted_hash = "${codexHookHash('Stop', command, 5)}"`)
    expect(trusted).toContain('[hooks.state."/home/ops/.codex/hooks.json:permission_request:0:0"]')
  })
})
