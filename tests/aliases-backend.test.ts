import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AliasCommandConfig, AliasCommandDeleteInput, AliasCommandSaveInput } from '@shared/preload'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir()
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

type AliasBackend = {
  configureAliasBackendRuntime: (config?: { databasePath?: string; useSeedData?: boolean; forceFallbackStore?: boolean }) => void
  resetAliasesForTests: () => void
  listAliasCommands: (query?: string) => any
  saveAliasCommand: (input: AliasCommandSaveInput) => any
  deleteAliasCommand: (input: AliasCommandDeleteInput) => any
}

let backend: AliasBackend
const tempDirs: string[] = []

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/aliases'
  backend = (await import(modulePath)) as AliasBackend
}

const useTempRuntime = async (options: { useSeedData: boolean; forceFallbackStore?: boolean; prefix?: string }) => {
  const dir = await mkdtemp(join(tmpdir(), options.prefix || 'aiopsterm-aliases-'))
  tempDirs.push(dir)
  const databasePath = join(dir, 'aliases.sqlite3')
  backend.configureAliasBackendRuntime({
    databasePath,
    useSeedData: options.useSeedData,
    forceFallbackStore: options.forceFallbackStore
  })
  backend.resetAliasesForTests()
  return databasePath
}

const expectOkData = <T>(result: { ok: boolean; data?: T }) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as T
}

const readAliasesFromSqlite = (databasePath: string): AliasCommandConfig[] => {
  const db = new Database(databasePath, { readonly: true })
  try {
    return db
      .prepare('SELECT id, alias, command, created_at FROM aliases ORDER BY created_at DESC')
      .all()
      .map((row) => {
        const item = row as { id: string; alias: string; command: string; created_at: number }
        return { id: item.id, alias: item.alias, command: item.command, createdAt: item.created_at }
      })
  } finally {
    db.close()
  }
}

describe('alias command backend boundary', () => {
  beforeEach(async () => {
    await loadBackend()
    await useTempRuntime({ useSeedData: true })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('lists backend-owned seed aliases only when seed mode is enabled', async () => {
    let all = backend.listAliasCommands()
    expect(all.ok).toBe(true)
    expect(all.data.map((item: AliasCommandConfig) => item.alias)).toEqual(['kctx', 'gst', 'll'])

    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-aliases-nonseed-' })
    all = backend.listAliasCommands()

    expect(all).toEqual({ ok: true, data: [] })
  })

  it('keeps non-seed fallback storage empty instead of exposing development aliases', async () => {
    await useTempRuntime({ useSeedData: false, forceFallbackStore: true, prefix: 'aiopsterm-aliases-fallback-' })

    expect(backend.listAliasCommands()).toEqual({ ok: true, data: [] })

    const created = expectOkData<{ command: AliasCommandConfig; commands: AliasCommandConfig[] }>(
      backend.saveAliasCommand({ alias: 'ports', command: 'ss -tulpn' })
    ).command

    expect(created).toMatchObject({
      id: expect.stringMatching(/^alias-/),
      alias: 'ports',
      command: 'ss -tulpn'
    })
    expect(backend.listAliasCommands().data).toEqual([expect.objectContaining({ alias: 'ports' })])
  })

  it('searches, rejects duplicates, renames, and deletes aliases through returned snapshots', () => {
    const result = backend.listAliasCommands('git')
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([expect.objectContaining({ alias: 'gst', command: 'git status' })])

    expect(backend.saveAliasCommand({ alias: 'll', command: 'ls' })).toEqual({
      ok: false,
      errorCode: 'ALIAS_DUPLICATE',
      errorMessage: 'Alias already exists.'
    })

    const created = expectOkData<{ command: AliasCommandConfig; commands: AliasCommandConfig[] }>(
      backend.saveAliasCommand({ alias: 'ports-test', command: 'ss -tulpn' })
    )
    expect(created.command).toMatchObject({ alias: 'ports-test', command: 'ss -tulpn' })
    expect(created.commands.some((item) => item.alias === 'ports-test')).toBe(true)

    const renamed = expectOkData<{ command: AliasCommandConfig; commands: AliasCommandConfig[] }>(
      backend.saveAliasCommand({
        id: created.command.id,
        previousAlias: 'ports-test',
        alias: 'ports-renamed-test',
        command: 'netstat -tunlp'
      })
    )
    expect(renamed.commands.some((item) => item.alias === 'ports-test')).toBe(false)
    expect(renamed.commands.some((item) => item.alias === 'ports-renamed-test')).toBe(true)

    const deleted = expectOkData<{ deleted: AliasCommandConfig; commands: AliasCommandConfig[] }>(backend.deleteAliasCommand({ id: created.command.id }))
    expect(deleted.deleted.alias).toBe('ports-renamed-test')
    expect(deleted.commands.some((item) => item.alias === 'ports-renamed-test')).toBe(false)
  })

  it('persists SQLite aliases and restores them after runtime reset', async () => {
    const databasePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-aliases-sqlite-' })
    const created = expectOkData<{ command: AliasCommandConfig; commands: AliasCommandConfig[] }>(
      backend.saveAliasCommand({ alias: 'hosts', command: 'cat /etc/hosts' })
    ).command

    expect(readAliasesFromSqlite(databasePath)).toEqual([expect.objectContaining({ id: created.id, alias: 'hosts' })])

    backend.configureAliasBackendRuntime({ databasePath, useSeedData: false })
    const restored = backend.listAliasCommands()

    expect(restored.ok).toBe(true)
    expect(restored.data).toEqual([expect.objectContaining({ id: created.id, alias: 'hosts', command: 'cat /etc/hosts' })])
  })

  it('removes unmodified legacy seed aliases from non-seed runtime while preserving user-edited rows', async () => {
    const databasePath = await useTempRuntime({ useSeedData: true, prefix: 'aiopsterm-aliases-legacy-seed-' })
    expect(backend.listAliasCommands().data.map((item: AliasCommandConfig) => item.alias)).toEqual(['kctx', 'gst', 'll'])

    expectOkData(
      backend.saveAliasCommand({
        id: 'alias-ll',
        previousAlias: 'll',
        alias: 'll',
        command: 'ls -lah'
      })
    )

    backend.configureAliasBackendRuntime({ databasePath, useSeedData: false })
    const nonSeedSnapshot = backend.listAliasCommands()

    expect(nonSeedSnapshot.ok).toBe(true)
    expect(nonSeedSnapshot.data).toEqual([expect.objectContaining({ id: 'alias-ll', alias: 'll', command: 'ls -lah' })])
    expect(readAliasesFromSqlite(databasePath)).toEqual([expect.objectContaining({ id: 'alias-ll', alias: 'll', command: 'ls -lah' })])
  })
})
