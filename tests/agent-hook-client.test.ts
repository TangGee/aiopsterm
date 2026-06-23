import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentHookClient } from '@/services/settings/agentHookClient'

const originalAiops = window.aiops

const codexInstaller = {
  source: 'codex' as const,
  label: 'Codex',
  binaryName: 'codex',
  binaryPath: '/usr/bin/codex',
  configPath: '/home/test/.codex/hooks.json',
  configExists: true,
  installed: false,
  scriptPath: '/opt/aiopsterm/agent-hook.js',
  warnings: []
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('agentHookClient', () => {
  it('returns undefined for unavailable bridge methods and binds Agent Hook methods', async () => {
    window.aiops = {
      ...originalAiops,
      listAgentHookInstallers: vi.fn(async () => ({
        ok: true,
        data: { installers: [codexInstaller] }
      })),
      installAgentHook: vi.fn(async (input) => ({
        ok: true,
        data: {
          operation: 'install' as const,
          source: input.source,
          status: { ...codexInstaller, installed: true },
          snapshot: { installers: [{ ...codexInstaller, installed: true }] }
        }
      })),
      uninstallAgentHook: vi.fn(async (input) => ({
        ok: true,
        data: {
          operation: 'uninstall' as const,
          source: input.source,
          status: { ...codexInstaller, installed: false },
          snapshot: { installers: [{ ...codexInstaller, installed: false }] }
        }
      }))
    }

    await expect(agentHookClient.listAgentHookInstallers()?.()).resolves.toEqual({
      ok: true,
      data: { installers: [codexInstaller] }
    })
    await expect(agentHookClient.installAgentHook()?.({ source: 'codex' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ operation: 'install', source: 'codex' }) })
    )
    await expect(agentHookClient.uninstallAgentHook()?.({ source: 'codex' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ operation: 'uninstall', source: 'codex' }) })
    )
    expect(window.aiops.listAgentHookInstallers).toHaveBeenCalledTimes(1)
    expect(window.aiops.installAgentHook).toHaveBeenCalledWith({ source: 'codex' })
    expect(window.aiops.uninstallAgentHook).toHaveBeenCalledWith({ source: 'codex' })

    window.aiops = {
      ...originalAiops,
      listAgentHookInstallers: undefined as any,
      installAgentHook: undefined as any,
      uninstallAgentHook: undefined as any
    }
    expect(agentHookClient.listAgentHookInstallers()).toBeUndefined()
    expect(agentHookClient.installAgentHook()).toBeUndefined()
    expect(agentHookClient.uninstallAgentHook()).toBeUndefined()
  })
})
