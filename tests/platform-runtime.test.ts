import { describe, expect, it } from 'vitest'

type PlatformRuntimeBackend = {
  defaultShellForPlatform: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string
  executableCandidateNames: (binaryName: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string[]
  localShellArgsForPlatform: (shell: string, platform: NodeJS.Platform) => string[]
  platformSocketPath: (userDataPath: string, namespace: string, options?: { platform?: NodeJS.Platform; pid?: number; directory?: string; uid?: number; stable?: boolean }) => string
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/app/platformRuntime'
  return (await import(modulePath)) as PlatformRuntimeBackend
}

describe('platform runtime helpers', () => {
  it('uses Electron/Node environment defaults without spreading platform branches', async () => {
    const { defaultShellForPlatform } = await loadBackend()
    expect(defaultShellForPlatform({ SHELL: '/bin/zsh' }, 'darwin')).toBe('/bin/zsh')
    expect(defaultShellForPlatform({}, 'darwin')).toBe('/bin/zsh')
    expect(defaultShellForPlatform({ SHELL: '/usr/bin/fish' }, 'linux')).toBe('/usr/bin/fish')
    expect(defaultShellForPlatform({}, 'linux')).toBe('/bin/bash')
    expect(defaultShellForPlatform({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, 'win32')).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(defaultShellForPlatform({}, 'win32')).toBe('powershell.exe')
  })

  it('adds login shell flags only for POSIX login shells', async () => {
    const { localShellArgsForPlatform } = await loadBackend()
    expect(localShellArgsForPlatform('/bin/zsh', 'darwin')).toEqual(['--login'])
    expect(localShellArgsForPlatform('/usr/bin/fish', 'linux')).toEqual(['--login'])
    expect(localShellArgsForPlatform('/usr/bin/python3', 'linux')).toEqual([])
    expect(localShellArgsForPlatform('powershell.exe', 'win32')).toEqual([])
  })

  it('expands Windows executable names using PATHEXT while preserving explicit extensions', async () => {
    const { executableCandidateNames } = await loadBackend()
    expect(executableCandidateNames('codex', {}, 'linux')).toEqual(['codex'])
    expect(executableCandidateNames('codex', { PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual(['codex', 'codex.exe', 'codex.cmd'])
    expect(executableCandidateNames('codex.exe', { PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual(['codex.exe'])
  })

  it('generates Unix socket paths and Windows named pipes from the same thin helper', async () => {
    const { platformSocketPath } = await loadBackend()
    expect(platformSocketPath('/home/user/.config/aiopsterm', 'aiopsterm-control', { platform: 'linux', pid: 42, directory: 'control' })).toBe(
      '/home/user/.config/aiopsterm/control/aiopsterm-control-42.sock'
    )
    expect(platformSocketPath('/tmp/aiopsterm', 'aiopsterm-control', { platform: 'darwin', pid: 42, directory: 'control' })).toBe(
      '/tmp/aiopsterm/control/aiopsterm-control-42.sock'
    )
    expect(platformSocketPath(
      '/Users/tangyumin/Library/Application Support/aiopsterm/profiles/primary-profile-with-long-name',
      'aiopsterm-agent-sessions',
      { platform: 'darwin', pid: 80015, uid: 501, directory: 'agent-sessions' }
    )).toBe('/tmp/aiopsterm-501/aiopsterm-agent-sessions-80015.sock')
    expect(platformSocketPath(
      '/tmp/aiopsterm-e2e-quick-architecture-baseline-with-a-profile-name-that-exceeds-the-unix-socket-limit',
      'aiopsterm-agent-sessions',
      { platform: 'linux', pid: 80016, uid: 1000, directory: 'agent-sessions' }
    )).toBe('/tmp/aiopsterm-1000/aiopsterm-agent-sessions-80016.sock')
    expect(platformSocketPath(
      '/Users/tangyumin/Library/Application Support/aiopsterm/profiles/primary-profile-with-long-name',
      'aiopsterm-external-codex',
      { platform: 'darwin', uid: 501, directory: 'external-codex-mcp', stable: true }
    )).toMatch(/^\/tmp\/aiopsterm-501\/aiopsterm-external-codex-[a-f0-9]{12}\.sock$/)
    expect(platformSocketPath('C:\\Users\\unit\\AppData\\Roaming\\aiopsterm', 'aiopsterm-control', { platform: 'win32', pid: 42 })).toBe(
      '\\\\.\\pipe\\aiopsterm-control-42'
    )
  })
})
