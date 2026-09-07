import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTerminalRecoveryStore, normalizeTerminalRecovery, recoveryHistoryText, terminalRecoveryLimits } from '../src/main/backend/terminal/terminalRecoveryStore'

const snapshot = (title = 'terminal') => ({ version: 1, activePanelId: 'one', tabs: [{ id: 'one', title, cwd: '/tmp', history: 'hello\nworld', ssh: { host: 'host', username: 'user', port: 22, assetName: 'host', password: 'never-store', privateKey: 'never-store', passphrase: 'never-store' } }] })

describe('terminal recovery persistence', () => {
  it('whitelists metadata, excludes credentials and repairs stale layout references', () => {
    const input = snapshot()
    Object.assign(input.tabs[0], { splitSourceId: 'missing', env: { TOKEN: 'secret' } })
    const result = normalizeTerminalRecovery(input)
    expect(JSON.stringify(result)).not.toMatch(/never-store|TOKEN|splitSourceId/)
    expect(result.tabs[0].history).toBe('hello\nworld')
  })
  it('bounds snapshots and rejects duplicate identities, invalid targets and versions', () => {
    expect(() => normalizeTerminalRecovery({ ...snapshot(), version: 2 })).toThrow()
    expect(() => normalizeTerminalRecovery({ ...snapshot(), tabs: Array(33).fill(snapshot().tabs[0]) })).toThrow()
    expect(() => normalizeTerminalRecovery({ ...snapshot(), tabs: Array(2).fill(snapshot().tabs[0]) })).toThrow()
    const input = snapshot(); input.tabs[0].ssh.port = 0
    expect(() => normalizeTerminalRecovery(input)).toThrow()
    expect(recoveryHistoryText('a'.repeat(1_000_000))).toHaveLength(terminalRecoveryLimits.historyChars)
  })
  it('removes executable terminal controls while preserving plain history', () => {
    expect(recoveryHistoryText('\x1b]52;c;secret\x07\x1b[31mtext\x1b[0m\nend')).toBe('text\nend')
  })
  it('writes atomically in request order with private permissions and handles corrupt files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-recovery-'))
    const file = join(root, 'recovery.json')
    const store = createTerminalRecoveryStore(() => file)
    try {
      expect(await store.load()).toBeNull()
      await Promise.all([store.save(snapshot('first')), store.save(snapshot('last'))])
      expect((await store.load())?.tabs[0].title).toBe('last')
      expect(await readFile(file, 'utf8')).not.toContain('never-store')
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
      await writeFile(file, '{broken')
      expect(await store.load()).toBeNull()
      await store.save({ version: 1, activePanelId: '', tabs: [] })
      expect((await store.load())?.tabs).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('normalizes a full 32-tab checkpoint within a bounded performance budget', () => {
    const input = { version: 1, activePanelId: '0', tabs: Array.from({ length: 32 }, (_, i) => ({ id: String(i), title: 'terminal', cwd: '/', history: 'x'.repeat(128 * 1024) })) }
    const start = performance.now()
    const normalized = normalizeTerminalRecovery(input)
    expect(normalized.tabs).toHaveLength(32)
    expect(Buffer.byteLength(JSON.stringify(normalized))).toBeLessThan(16 * 1024 * 1024)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
