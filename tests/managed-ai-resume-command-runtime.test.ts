import { describe, expect, it } from 'vitest'
import { resumeCommandForTerminal } from '../src/renderer/src/services/ai/managedAiResumeCommandRuntime'

const command = "cd '\\?\\E:\\gitee\\aiopsterm' && codex resume '019ff641-892b-7c52-a692-f455eb69176a' -m 'gpt-5.6-sol' -c model_reasoning_effort='high'"

describe('managed AI resume command shell adaptation', () => {
  it('uses PowerShell separators for local Windows PowerShell sessions', () => {
    expect(
      resumeCommandForTerminal({ title: 'powershell.exe', terminalLifecycle: { kind: 'local', shell: 'powershell.exe' } }, command)
    ).toBe("Set-Location -LiteralPath '\\?\\E:\\gitee\\aiopsterm'; codex resume '019ff641-892b-7c52-a692-f455eb69176a' -m 'gpt-5.6-sol' -c model_reasoning_effort='high'")
  })

  it('uses an encoded PowerShell command from local CMD sessions', () => {
    const adapted = resumeCommandForTerminal({ title: 'cmd.exe', terminalLifecycle: { kind: 'local', shell: 'cmd.exe' } }, command)
    expect(adapted).toMatch(/^powershell\.exe -NoLogo -NoProfile -EncodedCommand [A-Za-z0-9+/=]+$/)
    expect(adapted).not.toContain(' && ')
  })

  it('keeps POSIX and SSH commands unchanged', () => {
    expect(resumeCommandForTerminal({ title: 'bash', terminalLifecycle: { kind: 'local', shell: '/bin/bash' } }, command)).toBe(command)
    expect(resumeCommandForTerminal({ title: 'ssh', sshSession: { host: 'linux.example', port: 22, username: 'root', assetName: 'linux' }, terminalLifecycle: { kind: 'ssh', shell: 'ssh' } }, command)).toBe(command)
  })
})
