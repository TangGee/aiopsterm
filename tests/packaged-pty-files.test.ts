import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const modulePath = '../scripts/packaged-pty-files.mjs'
const { packagedPtyFiles } = await import(modulePath)
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
})
