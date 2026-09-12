import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const modulePath = '../scripts/packaged-pty-files.mjs'
const { packagedPtyFiles, preparePackagedPtyHelper } = await import(modulePath)
const roots: string[] = []
const fixture = (directory: string) => {
  const root = mkdtempSync(join(tmpdir(), 'aiopsterm-pty-audit-'))
  roots.push(root)
  for (const file of ['lib/index.js', 'lib/windowsTerminal.js', ...['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe'].map((name) => `${directory}/${name}`)]) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'fixture')
  }
  return root
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('packaged node-pty audit', () => {
  it.each(['build/Release', 'build/Debug', 'prebuilds/win32-x64'])('accepts the complete Windows runtime in %s', (directory) => {
    const root = fixture(directory)
    expect(packagedPtyFiles(root, 'win32', 'x64').every(existsSync)).toBe(true)
  })
  it('rejects prebuilds for a different architecture', () => {
    const root = fixture('prebuilds/win32-arm64')
    expect(packagedPtyFiles(root, 'win32', 'x64').every(existsSync)).toBe(false)
  })
  it.each(['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe'])('rejects a missing %s', (name) => {
    const root = fixture('prebuilds/win32-x64')
    rmSync(join(root, 'prebuilds/win32-x64', name))
    expect(packagedPtyFiles(root, 'win32', 'x64').every(existsSync)).toBe(false)
  })
  it('checks dependencies beside the module selected by the native loader', () => {
    const root = fixture('prebuilds/win32-x64')
    mkdirSync(join(root, 'build/Release'), { recursive: true })
    writeFileSync(join(root, 'build/Release/pty.node'), 'fixture')
    expect(packagedPtyFiles(root, 'win32', 'x64')).toContain(join(root, 'build/Release/winpty.dll'))
    expect(packagedPtyFiles(root, 'win32', 'x64').every(existsSync)).toBe(false)
  })
  it.each(['build/Release', 'prebuilds/darwin-arm64'])('requires the macOS launch helper beside %s', (directory) => {
    const root = fixture(directory)
    writeFileSync(join(root, 'lib/unixTerminal.js'), 'fixture')
    const helper = join(root, directory, 'spawn-helper')
    expect(packagedPtyFiles(root, 'darwin', 'arm64')).toContain(helper)
    expect(packagedPtyFiles(root, 'darwin', 'arm64').every(existsSync)).toBe(false)
    expect(() => preparePackagedPtyHelper(root, 'darwin', 'arm64')).toThrow()
    writeFileSync(helper, 'helper')
    expect(packagedPtyFiles(root, 'darwin', 'arm64').every(existsSync)).toBe(true)
  })
  it.skipIf(process.platform === 'win32')('repairs npm helper permissions before signing without changing its bytes', () => {
    const root = fixture('prebuilds/darwin-arm64')
    const helper = join(root, 'prebuilds/darwin-arm64/spawn-helper')
    writeFileSync(helper, 'helper')
    chmodSync(helper, 0o644)
    preparePackagedPtyHelper(root, 'darwin', 'arm64')
    expect(statSync(helper).mode & 0o777).toBe(0o755)
    expect(readFileSync(helper, 'utf8')).toBe('helper')
    preparePackagedPtyHelper(root, 'darwin', 'arm64')
    expect(statSync(helper).mode & 0o777).toBe(0o755)
  })
  it('does not require a macOS helper on Linux or Windows', () => {
    const root = fixture('build/Release')
    expect(packagedPtyFiles(root, 'linux', 'x64')).not.toContain(join(root, 'build/Release/spawn-helper'))
    expect(() => preparePackagedPtyHelper(root, 'linux', 'x64')).not.toThrow()
    expect(() => preparePackagedPtyHelper(root, 'win32', 'x64')).not.toThrow()
  })
})
