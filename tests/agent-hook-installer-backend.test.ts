import { describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/preload'

type AgentHookInstallerBackend = {
  agentHookCommandFor: (source: AgentHookInstallerSource, hookEvent: string, scriptPath?: string) => string
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
})
