import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/contracts/agentHooks'

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
  configureAgentHookInstallerRuntime: (config?: {
    getHomeDir?: () => string
    getEnv?: () => NodeJS.ProcessEnv
    getPlatform?: () => NodeJS.Platform
    getAgentHookScriptPath?: () => string
    getJsRuntimeExecutable?: () => string
  }) => void
  installAgentHook: (input: { source: AgentHookInstallerSource }) => Promise<{ ok: boolean; errorMessage?: string }>
  uninstallAgentHook: (input: { source: AgentHookInstallerSource }) => Promise<{ ok: boolean; errorMessage?: string }>
  __testing: {
    hookDefinitions: Array<{ source: AgentHookInstallerSource }>
    fileHookMarker: string
    ownedMarker: string
    isOwnedHookCommand: (command: unknown) => boolean
    mergeOpenCodePluginRegistration: (existing: Record<string, unknown>, install: boolean) => Record<string, unknown>
    pluginFileContentFor: (definition: unknown) => string
    rovoDevYamlHooksBlock: (definition: unknown, scriptPath: string) => string
    installCodexHookTrust: (content: string, configPath: string, hooks: Record<string, unknown>) => string
  }
}

const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs.length = 0
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/agent/agentHookInstaller'
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
    expect(__testing.isOwnedHookCommand(stopGroups[1].hooks[0].command)).toBe(true)
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

  it('exposes control_compat-style agent installers', async () => {
    const { __testing } = await loadBackend()
    expect(__testing.hookDefinitions.map((definition) => definition.source)).toEqual(
      expect.arrayContaining(['opencode', 'amp', 'pi', 'omp', 'kiro', 'rovodev'])
    )
    expect(__testing.hookDefinitions.find((definition) => definition.source === 'rovodev')).toEqual(
      expect.objectContaining({ launchCommand: 'acli rovodev run' })
    )
  })

  it('installs Kiro agent JSON hooks with timeout_ms entries', async () => {
    const { __testing, agentHookCommandFor, mergeAgentHookJson } = await loadBackend()
    const kiro = __testing.hookDefinitions.find((definition) => definition.source === 'kiro')!

    const result = mergeAgentHookJson({}, kiro, '/opt/aiopsterm/aiopsterm-agent-hook.js', true)
    const hooks = result.config.hooks as Record<string, Array<{ command: string; timeout_ms: number }>>

    expect(result.config).toEqual(
      expect.objectContaining({
        name: 'aiopsterm',
        description: expect.stringContaining('aiopsterm'),
        tools: ['*']
      })
    )
    expect(hooks.agentSpawn[0]).toEqual({
      command: agentHookCommandFor('kiro', 'SessionStart', '/opt/aiopsterm/aiopsterm-agent-hook.js'),
      timeout_ms: 5000
    })
    expect(hooks.preToolUse[0].command).toBe(agentHookCommandFor('kiro', 'PreToolUse', '/opt/aiopsterm/aiopsterm-agent-hook.js'))
    expect(hooks.postToolUse[0].command).toBe(agentHookCommandFor('kiro', 'PostToolUse', '/opt/aiopsterm/aiopsterm-agent-hook.js'))
  })

  it('generates marked plugin and YAML hook files for plugin-style agents', async () => {
    const { __testing } = await loadBackend()
    const opencode = __testing.hookDefinitions.find((definition) => definition.source === 'opencode')!
    const amp = __testing.hookDefinitions.find((definition) => definition.source === 'amp')!
    const rovodev = __testing.hookDefinitions.find((definition) => definition.source === 'rovodev')!

    expect(__testing.pluginFileContentFor(opencode)).toContain(__testing.fileHookMarker)
    expect(__testing.pluginFileContentFor(opencode)).toContain('source = "opencode"')
    expect(__testing.pluginFileContentFor(opencode)).toContain("report('PostToolUse'")
    expect(__testing.pluginFileContentFor(amp)).toContain('source = "amp"')

    const yaml = __testing.rovoDevYamlHooksBlock(rovodev, '/opt/aiopsterm/aiopsterm-agent-hook.js')
    expect(yaml).toContain('aiopsterm-rovodev-hooks begin')
    expect(yaml).toContain('SessionStart')
    expect(yaml).toContain(process.platform === 'win32' ? '-EncodedCommand' : 'AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1')
  })

  it('registers and unregisters the OpenCode plugin without removing user plugins', async () => {
    const { __testing } = await loadBackend()
    const installed = __testing.mergeOpenCodePluginRegistration({ plugin: ['user-plugin'] }, true)
    expect(installed.plugin).toEqual(['user-plugin', './plugins/aiopsterm-session.js'])

    const uninstalled = __testing.mergeOpenCodePluginRegistration(installed, false)
    expect(uninstalled.plugin).toEqual(['user-plugin'])
  })

  it('installs and uninstalls OpenCode plugin files and registration', async () => {
    const backend = await loadBackend()
    const home = await mkdtemp(join(tmpdir(), 'aiopsterm-opencode-hooks-'))
    cleanupDirs.push(home)
    backend.configureAgentHookInstallerRuntime({
      getHomeDir: () => home,
      getEnv: () => ({ HOME: home, PATH: process.env.PATH || '' }),
      getAgentHookScriptPath: () => '/opt/aiopsterm/aiopsterm-agent-hook.js'
    })
    try {
      await expect(backend.installAgentHook({ source: 'opencode' })).resolves.toEqual(expect.objectContaining({ ok: true }))
      const pluginPath = join(home, '.config/opencode/plugins/aiopsterm-session.js')
      const configPath = join(home, '.config/opencode/opencode.json')
      expect(await readFile(pluginPath, 'utf-8')).toContain(backend.__testing.fileHookMarker)
      expect(JSON.parse(await readFile(configPath, 'utf-8'))).toEqual({
        plugin: ['./plugins/aiopsterm-session.js']
      })

      await expect(backend.uninstallAgentHook({ source: 'opencode' })).resolves.toEqual(expect.objectContaining({ ok: true }))
      expect(JSON.parse(await readFile(configPath, 'utf-8'))).toEqual({})
    } finally {
      backend.configureAgentHookInstallerRuntime()
    }
  })

  it('detects Windows command shims through PATHEXT when reporting installer status', async () => {
    const backend = await loadBackend()
    const home = await mkdtemp(join(tmpdir(), 'aiopsterm-win-hooks-'))
    cleanupDirs.push(home)
    const binDir = join(home, 'bin')
    await import('node:fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(binDir, { recursive: true }).then(() => writeFile(join(binDir, 'codex.cmd'), '@echo off\r\n', 'utf-8'))
    )
    backend.configureAgentHookInstallerRuntime({
      getHomeDir: () => home,
      getEnv: () => ({ USERPROFILE: home, HOME: home, PATH: binDir, PATHEXT: '.EXE;.CMD;.BAT' }),
      getPlatform: () => 'win32',
      getAgentHookScriptPath: () => 'C:\\Program Files\\aiopsterm\\aiopsterm-agent-hook.js'
    })
    try {
      const snapshot = await backend.installAgentHook({ source: 'codex' })
      expect(snapshot).toEqual(expect.objectContaining({ ok: true }))
    } finally {
      backend.configureAgentHookInstallerRuntime()
    }
  })

  it.each(['linux', 'darwin'] as const)('uses Codex-compatible fail-open hook commands and stable trust hashes on %s', async (platform) => {
    const backend = await loadBackend()
    backend.configureAgentHookInstallerRuntime({
      getPlatform: () => platform,
      getJsRuntimeExecutable: () => '/opt/aiopsterm/aiopsterm'
    })
    try {
      const { agentHookCommandFor, codexHookHash } = backend
      const command = agentHookCommandFor('codex', 'Stop', '/opt/aiopsterm/aiopsterm-agent-hook.js')

      expect(command).toBe(
        "ELECTRON_RUN_AS_NODE=1 AIOPSTERM_AGENT_HOOK_MARKER=aiopsterm-agent-hook-v1 '/opt/aiopsterm/aiopsterm' '/opt/aiopsterm/aiopsterm-agent-hook.js' --source 'codex' --event 'Stop' || echo '{}'"
      )
      expect(command).not.toContain('printf')
      expect(codexHookHash('Stop', command, 5)).toBe('sha256:1f8728044e5ea2880e5c6069fbd69718aa139bbeb7319e4e579359f418df31df')
    } finally {
      backend.configureAgentHookInstallerRuntime()
    }
  })

  it('uses cmd-compatible fail-open hook commands on Windows', async () => {
    const backend = await loadBackend()
    backend.configureAgentHookInstallerRuntime({
      getPlatform: () => 'win32',
      getJsRuntimeExecutable: () => 'C:\\Program Files\\aiopsterm\\aiopsterm.exe'
    })
    try {
      const command = backend.agentHookCommandFor('codex', 'Stop', 'C:\\Program Files\\aiopsterm\\aiopsterm-agent-hook.js')
      expect(command).toMatch(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/)
      expect(Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le')).toContain("-Source 'codex' -Event 'Stop'")
    } finally {
      backend.configureAgentHookInstallerRuntime()
    }
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
