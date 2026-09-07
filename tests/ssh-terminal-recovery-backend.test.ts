import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecoveringSshTerminalSession } from '../src/main/backend/ssh/sshTerminalRecovery'
import { createSshCwdTracker, sshRecoveryShellCommand, validRecoveryCwd } from '../src/main/backend/ssh/sshShellRecovery'
import type { SshTerminalCreateResult, SshTerminalEventSink } from '../src/main/backend/ssh/sshTerminalTypes'
import type { TerminalCreateOptions, TerminalLifecycleEvent } from '../src/shared/contracts/terminalSessions'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lifecycle = (stage: TerminalLifecycleEvent['stage'], rest: Partial<TerminalLifecycleEvent> = {}): TerminalLifecycleEvent => ({ id: 's1', kind: 'ssh', stage, at: Date.now(), ...rest })
const fixture = () => {
  const attempts: { options: TerminalCreateOptions; sink: SshTerminalEventSink; process: NonNullable<SshTerminalCreateResult['session']> }[] = []
  const sink = { data: vi.fn(), lifecycle: vi.fn(), exit: vi.fn(), closed: vi.fn() }
  const factory = vi.fn((_id, options, events): SshTerminalCreateResult => {
    const process = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn() }
    attempts.push({ options, sink: events, process })
    events.lifecycle(lifecycle('connecting'))
    return { shell: 'ssh', cwd: '/home/test', session: process, connection: { host: 'host', port: 22, username: 'test' }, lifecycle: lifecycle('connecting') }
  })
  const result = createRecoveringSshTerminalSession('s1', { sshShellIntegration: true }, sink, factory)
  const ready = (index = attempts.length - 1) => attempts[index].sink.lifecycle(lifecycle('shell-ready'))
  const end = (reason: TerminalLifecycleEvent['reason'] = 'network', index = attempts.length - 1) => {
    const event = lifecycle('error', { reason, isNetworkDisconnect: reason === 'network' })
    attempts[index].sink.closed?.('s1')
    attempts[index].sink.lifecycle(event)
    attempts[index].sink.exit(event, 1)
  }
  return { attempts, sink, result, ready, end, factory }
}

describe('SSH automatic recovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('retains the logical session and history, reconnects automatically, and rejects offline input', () => {
    const f = fixture()
    expect(() => f.result.session!.write('early')).toThrow('not sent')
    f.ready()
    f.attempts[0].sink.data('history')
    f.result.session!.write('pwd\r')
    f.end()
    expect(f.sink.closed).not.toHaveBeenCalled()
    expect(f.sink.exit).not.toHaveBeenCalled()
    expect(f.sink.lifecycle).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'connecting' }))
    expect(() => f.result.session!.write('danger\r')).toThrow('not sent')
    vi.advanceTimersByTime(1000)
    expect(f.attempts).toHaveLength(2)
    f.ready()
    f.result.session!.write('next\r')
    expect(f.attempts[1].process.write).toHaveBeenCalledTimes(1)
    expect(f.attempts[1].process.write).toHaveBeenCalledWith('next\r')
    expect(f.sink.data.mock.calls[0][0]).toBe('history')
    expect(f.sink.data.mock.calls[1][0]).toContain('\x1b[?1049l')
  })
  it('ignores stale callbacks and carries the last directory, dimensions and pause state', () => {
    const f = fixture()
    f.ready()
    f.attempts[0].sink.data('\x1b]1337;CurrentDir=/srv/a b\x07')
    f.end()
    f.result.session!.resize(150, 45)
    f.result.session!.pause?.()
    const count = f.sink.data.mock.calls.length
    f.attempts[0].sink.data('late')
    f.ready(0)
    vi.advanceTimersByTime(1000)
    expect(f.sink.data.mock.calls).toHaveLength(count)
    expect(f.attempts[1].options).toMatchObject({ cwd: '/srv/a b', cols: 150, rows: 45 })
    expect(f.attempts[1].process.pause).toHaveBeenCalled()
    f.ready()
    f.end('process')
    expect(f.sink.closed).toHaveBeenCalledTimes(1)
    expect(f.sink.exit).toHaveBeenCalledTimes(1)
  })
  it.each(['manual', 'process', 'error'] as const)('does not reconnect after %s exit', (reason) => {
    const f = fixture()
    f.ready()
    f.end(reason)
    vi.runAllTimers()
    expect(f.attempts).toHaveLength(1)
    expect(f.sink.exit).toHaveBeenCalledTimes(1)
  })
  it('does not loop on initial authentication or connection failure', () => {
    const f = fixture()
    f.end()
    vi.runAllTimers()
    expect(f.attempts).toHaveLength(1)
  })
  it('cancels a pending reconnect when the tab closes', () => {
    const f = fixture()
    f.ready()
    f.end()
    f.result.session!.kill()
    vi.runAllTimers()
    expect(f.attempts).toHaveLength(1)
    expect(f.sink.exit).toHaveBeenCalledTimes(1)
    expect(f.sink.exit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'manual' }), 0)
  })
  it('kills an in-progress retry and ignores its eventual readiness', () => {
    const f = fixture()
    f.ready(); f.end(); vi.advanceTimersByTime(1000)
    f.result.session!.kill()
    f.ready()
    expect(f.attempts[1].process.kill).toHaveBeenCalledWith('manual')
    expect(() => f.result.session!.write('x')).toThrow()
    expect(f.sink.exit).toHaveBeenCalledTimes(1)
  })
  it('uses bounded exponential backoff and gives up after eight retries', () => {
    const f = fixture()
    f.ready()
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
      f.end()
      const before = f.attempts.length
      vi.advanceTimersByTime(delay - 1)
      expect(f.attempts).toHaveLength(before)
      vi.advanceTimersByTime(1)
      expect(f.attempts).toHaveLength(before + 1)
    }
    f.end()
    vi.runAllTimers()
    expect(f.attempts).toHaveLength(9)
    expect(f.sink.closed).toHaveBeenCalledTimes(1)
  })
})

describe('SSH shell directory integration', () => {
  it('parses split OSC and UTF-8 without trusting nested OSC 7 hosts', () => {
    const paths: string[] = []
    const track = createSshCwdTracker((cwd) => paths.push(cwd))
    const bytes = Buffer.from('noise\x1b]1337;CurrentDir=/tmp/中文\x1b\\')
    for (const byte of bytes) track(Buffer.from([byte]))
    track('\x1b]7;file://different-host/wrong\x07')
    track('\x1b]1337;CurrentDir=/bad\npath\x07')
    track('\x1b]' + 'x'.repeat(10000))
    track('\x1b]1337;CurrentDir=/good\x07')
    expect(paths).toEqual(['/tmp/中文', '/good'])
  })
  it('scans 64 MiB of output without retaining an unterminated OSC or adding visible data', () => {
    const cwd = vi.fn()
    const track = createSshCwdTracker(cwd)
    const chunk = Buffer.alloc(64 * 1024, 120)
    track('\x1b]')
    const started = performance.now()
    for (let index = 0; index < 1024; index++) track(chunk)
    track('\x1b]1337;CurrentDir=/after-load\x07')
    expect(cwd).toHaveBeenCalledTimes(1)
    expect(cwd).toHaveBeenCalledWith('/after-load')
    expect(performance.now() - started).toBeLessThan(2000)
  })
  it.skipIf(process.platform !== 'linux')('keeps a usable shell when the recovered directory is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'aiopsterm-cwd-missing-'))
    try {
      const output = execFileSync('/bin/sh', ['-c', sshRecoveryShellCommand(join(root, 'missing'))], {
        input: 'printf "USABLE\\n"\nexit\n', env: { ...process.env, HOME: root, SHELL: '/bin/bash' },
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000
      })
      expect(output).toContain('USABLE')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects control bytes and relative directories', () => {
    for (const cwd of ['../x', '/bad\ncmd', '/bad\x1b', '/bad\x00', '/' + 'a'.repeat(4096)]) expect(validRecoveryCwd(cwd)).toBe(false)
  })
  it.skipIf(process.platform !== 'linux')('starts a real interactive bash in a safely quoted directory without executing path text', () => {
    const root = mkdtempSync(join(tmpdir(), 'aiopsterm-cwd-'))
    const cwd = join(root, "a b'$(touch SHOULD_NOT_EXIST)")
    mkdirSync(cwd)
    try {
      const output = execFileSync('/bin/sh', ['-c', sshRecoveryShellCommand(cwd)], {
        input: 'printf "\\nRECOVERED=%s\\n" "$PWD"\nexit\n',
        env: { ...process.env, HOME: root, SHELL: '/bin/bash' }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000
      })
      expect(output).toContain(`RECOVERED=${cwd}`)
      expect(output).toContain(`\x1b]1337;CurrentDir=${cwd}\x07`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
