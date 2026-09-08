import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, truncate, chmod } from 'node:fs/promises'
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
  it('retains the newest history when input exceeds the capture cap', () => {
    const result = recoveryHistoryText('old'.repeat(200_000) + '\nLATEST')
    expect(result.endsWith('\nLATEST')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(terminalRecoveryLimits.historyChars)
  })
  it('does not swallow normal text between ST-terminated OSC sequences', () => {
    expect(recoveryHistoryText('\x1b]0;title\x1b\\keep\x1b]0;title2\x1b\\tail')).toBe('keeptail')
  })
  it('removes unterminated OSC, DCS and C1 string controls from replay', () => {
    expect(recoveryHistoryText('before\x1b]52;c;payload')).toBe('before')
    expect(recoveryHistoryText('a\x1bPsecret\x1b\\b\x9d0;title\x9ctail')).toBe('abtail')
  })
  it.each([null, [], {}, { version: 1, tabs: 'bad' }, { version: 1, tabs: [null] }])('rejects malformed snapshot shape %j', (input) => {
    expect(() => normalizeTerminalRecovery(input)).toThrow('Invalid')
  })
  it('repairs missing selection, strips invalid cwd, and refuses duplicate truncated IDs', () => {
    const tab = { ...snapshot().tabs[0], cwd: '/tmp/bad\npath', cwdVerified: true }
    const result = normalizeTerminalRecovery({ version: 1, activePanelId: 'gone', tabs: [tab] })
    expect(result.activePanelId).toBe('one')
    expect(result.tabs[0].cwd).toBe('')
    expect(result.tabs[0].cwdVerified).toBe(false)
    expect(() => normalizeTerminalRecovery({ version: 1, tabs: [{ id: 'x'.repeat(300) }, { id: 'x'.repeat(299) + 'y' }] })).toThrow()
  })
  it('ignores interrupted temporary writes and resumes after a failed save', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-recovery-fault-'))
    const file = join(root, 'snapshot.json')
    const store = createTerminalRecoveryStore(() => file)
    try {
      await store.save(snapshot('safe'))
      await writeFile(file + '.tmp', '{partial')
      expect((await store.load())?.tabs[0].title).toBe('safe')
      await rm(file + '.tmp')
      await mkdir(file + '.tmp')
      await expect(store.save(snapshot('failed'))).rejects.toThrow()
      expect((await store.load())?.tabs[0].title).toBe('safe')
      await rm(file + '.tmp', { recursive: true })
      await store.save(snapshot('recovered'))
      expect((await store.load())?.tabs[0].title).toBe('recovered')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('rejects an oversized on-disk snapshot before parsing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-recovery-large-'))
    const file = join(root, 'snapshot.json')
    try {
      await writeFile(file, '{}'); await truncate(file, terminalRecoveryLimits.fileBytes + 1)
      expect(await createTerminalRecoveryStore(() => file).load()).toBeNull()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it.skipIf(process.platform === 'win32')('repairs permissions when reusing an interrupted temporary file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-recovery-mode-'))
    const file = join(root, 'snapshot.json')
    try {
      await writeFile(file + '.tmp', '{partial')
      await chmod(file + '.tmp', 0o644)
      const store = createTerminalRecoveryStore(() => file)
      await store.save(snapshot())
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect((await store.load())?.tabs[0].history).toBe('hello\nworld')
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
