import { test, expect } from './support/desktop'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { mcpClient } from './support/mcp'

test('real Codex and Claude MCP installers preserve config and revoke rotated tokens @clients', async ({ desktop }) => {
  test.setTimeout(120000)
  const app = await desktop.app.evaluate(({ app }) => ({ root: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged }))
  const triple = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
  const binary = app.packaged ? join(app.resources, 'codex', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
    : join(app.root, 'codex', 'codex-rs', 'target', triple, 'aiopsterm-codex-package', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
  expect(existsSync(binary), `Missing real Codex package: ${binary}`).toBe(true)
  const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`
  await writeFile(join(desktop.root, 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'), process.platform === 'win32'
    ? `@echo off\r\n"${binary}" %*\r\n` : `#!/bin/sh\nexec ${quote(binary)} "$@"\n`)
  for (const source of ['codex', 'claude-code']) {
    const installed = await desktop.api('installExportMcp', { source, serverId: 'hosts' })
    expect(installed.ok, `${source}: ${JSON.stringify(installed)}`).toBe(true)
    const status = installed.data.status
    expect(status.configPath.startsWith(join(desktop.root, 'home'))).toBe(true)
    expect(await readFile(status.configPath, 'utf8')).toContain(status.serverName)
    const tokenPath = join(desktop.root, 'state', 'external-codex-mcp', 'token.json')
    const previous = JSON.parse(await readFile(tokenPath, 'utf8')).token
    expect((await desktop.api('resetExportMcpToken')).ok).toBe(true)
    const current = JSON.parse(await readFile(tokenPath, 'utf8')).token
    expect(current).not.toBe(previous)
    const oldClient = mcpClient(status.scriptPath, status.bridge.socketPath, previous, 'hosts')
    const newClient = mcpClient(status.scriptPath, status.bridge.socketPath, current, 'hosts')
    try {
      const rejected = await oldClient.request('tools/call', { name: 'list_hosts', arguments: {} })
      expect(Boolean(rejected.error || rejected.result?.isError)).toBe(true)
      const accepted = await newClient.request('tools/call', { name: 'list_hosts', arguments: {} })
      expect(accepted.error).toBeUndefined()
      expect(accepted.result.isError).not.toBe(true)
    } finally { await oldClient.close(); await newClient.close() }
    expect((await desktop.api('installExportMcp', { source, serverId: 'hosts' })).ok).toBe(true)
    const refreshed = await readFile(status.configPath, 'utf8')
    expect(refreshed).toContain(current)
    expect(refreshed).not.toContain(previous)
    expect((await desktop.api('uninstallExportMcp', { source, serverId: 'hosts' })).ok).toBe(true)
    expect(await readFile(status.configPath, 'utf8')).not.toContain(status.serverName)
  }
})
