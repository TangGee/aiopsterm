import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  AiopsMutationResult,
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandGroupSaveInput,
  QuickCommandMacroMutationResult,
  QuickCommandMacroSaveInput,
  QuickCommandReorderInput,
  QuickCommandReorderResult,
  QuickCommandScriptPlanInput,
  QuickCommandScriptPlanResult,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig
} from '@shared/preload'

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

type QuickCommandsBackend = {
  configureQuickCommandBackendRuntime: (config?: { databasePath?: string; useSeedData?: boolean; forceFallbackStore?: boolean }) => void
  resetQuickCommandsForTests: () => void
  getQuickCommands: () => QuickCommandsUserConfig
  saveQuickCommands: (config: QuickCommandsUserConfig) => AiopsMutationResult<QuickCommandsUserConfig>
  saveQuickCommandGroup: (input: QuickCommandGroupSaveInput) => QuickCommandGroupMutationResult
  deleteQuickCommandGroup: (uuid: string) => QuickCommandGroupDeleteResult
  saveQuickCommandSnippet: (input: QuickCommandSnippetSaveInput) => QuickCommandSnippetMutationResult
  saveQuickCommandMacro: (input: QuickCommandMacroSaveInput) => QuickCommandMacroMutationResult
  deleteQuickCommandSnippet: (id: number) => QuickCommandSnippetDeleteResult
  reorderQuickCommands: (input: QuickCommandReorderInput) => QuickCommandReorderResult
  planQuickCommandScript: (input: QuickCommandScriptPlanInput) => QuickCommandScriptPlanResult
}

let backend: QuickCommandsBackend
const tempDirs: string[] = []

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/quickCommands'
  backend = (await import(modulePath)) as QuickCommandsBackend
}

const useTempRuntime = async (options: { useSeedData: boolean; forceFallbackStore?: boolean; prefix?: string }) => {
  const dir = await mkdtemp(join(tmpdir(), options.prefix || 'aiopsterm-quick-commands-'))
  tempDirs.push(dir)
  const databasePath = join(dir, 'quick-commands.sqlite3')
  backend.configureQuickCommandBackendRuntime({
    databasePath,
    useSeedData: options.useSeedData,
    forceFallbackStore: options.forceFallbackStore
  })
  backend.resetQuickCommandsForTests()
  return databasePath
}

const expectOkData = <T>(result: AiopsMutationResult<T>) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as T
}

const readSqliteCount = (databasePath: string, table: string) => {
  const db = new Database(databasePath, { readonly: true })
  try {
    return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count
  } finally {
    db.close()
  }
}

describe('quick commands backend boundary', () => {
  beforeEach(async () => {
    await loadBackend()
    await useTempRuntime({ useSeedData: true })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('lists backend-owned seed commands only when seed mode is enabled', async () => {
    let snapshot = backend.getQuickCommands()

    expect(snapshot.groups.map((group) => group.uuid)).toEqual(['snippet-group-inspection'])
    expect(snapshot.snippets.map((snippet) => snippet.uuid)).toEqual(['snippet-disk-check', 'snippet-nginx-status', 'snippet-root-pwd'])

    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-nonseed-' })
    snapshot = backend.getQuickCommands()

    expect(snapshot.groups).toEqual([])
    expect(snapshot.snippets).toEqual([])
  })

  it('keeps non-seed fallback storage empty instead of exposing development commands', async () => {
    await useTempRuntime({ useSeedData: false, forceFallbackStore: true, prefix: 'aiopsterm-quick-commands-fallback-' })

    expect(backend.getQuickCommands()).toEqual({ groups: [], snippets: [] })

    const group = expectOkData(backend.saveQuickCommandGroup({ group_name: 'Fallback Group' })).group
    const snippet = expectOkData(
      backend.saveQuickCommandSnippet({
        snippet_name: 'Fallback Command',
        snippet_content: 'echo fallback',
        group_uuid: group.uuid
      })
    ).snippet

    expect(group.id).toBe(1)
    expect(snippet.id).toBe(1)
    expect(backend.getQuickCommands().snippets).toEqual([expect.objectContaining({ id: 1, snippet_name: 'Fallback Command' })])

    const deletedGroup = backend.deleteQuickCommandGroup(group.uuid)
    expect(deletedGroup.ok).toBe(true)
    expect(deletedGroup.data?.groups).toEqual([])
    expect(deletedGroup.data?.snippets).toEqual([
      expect.objectContaining({
        id: snippet.id,
        snippet_name: 'Fallback Command',
        group_uuid: null
      })
    ])
    expect(backend.deleteQuickCommandSnippet(snippet.id).ok).toBe(true)
    expect(backend.deleteQuickCommandSnippet(snippet.id)).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command snippet not found'
      })
    )
  })

  it('owns group and snippet identity for new quick-command rows', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-identity-' })
    const groupResult = backend.saveQuickCommandGroup({ group_name: '发布命令' })

    expect(groupResult.ok).toBe(true)
    expect(groupResult.data?.group).toEqual(
      expect.objectContaining({
        id: 1,
        uuid: expect.stringMatching(/^snippet-group-/),
        group_name: '发布命令'
      })
    )

    const snippetResult = backend.saveQuickCommandSnippet({
      snippet_name: '回滚确认',
      snippet_content: 'echo rollback',
      group_uuid: groupResult.data?.group.uuid
    })

    expect(snippetResult.ok).toBe(true)
    expect(snippetResult.data?.snippet).toEqual(
      expect.objectContaining({
        id: 1,
        uuid: expect.stringMatching(/^snippet-/),
        snippet_name: '回滚确认',
        snippet_content: 'echo rollback',
        group_uuid: groupResult.data?.group.uuid,
        create_at: '刚刚',
        update_at: '刚刚'
      })
    )
    expect(snippetResult.data?.snippets.some((snippet) => snippet.uuid === snippetResult.data?.snippet.uuid)).toBe(true)
  })

  it('persists SQLite quick commands and restores saved script plans after runtime reset', async () => {
    const databasePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-sqlite-' })
    const group = expectOkData(backend.saveQuickCommandGroup({ group_name: '发布命令' })).group
    const snippet = expectOkData(
      backend.saveQuickCommandSnippet({
        snippet_name: '发布检查',
        snippet_content: 'echo persisted\nsleep==100\necho done',
        group_uuid: group.uuid
      })
    ).snippet

    expect(readSqliteCount(databasePath, 'quick_command_groups')).toBe(1)
    expect(readSqliteCount(databasePath, 'quick_command_snippets')).toBe(1)

    backend.configureQuickCommandBackendRuntime({ databasePath, useSeedData: false })
    const restored = backend.getQuickCommands()

    expect(restored.groups).toEqual([expect.objectContaining({ uuid: group.uuid, group_name: '发布命令' })])
    expect(restored.snippets).toEqual([expect.objectContaining({ id: snippet.id, snippet_name: '发布检查' })])

    const planned = expectOkData(backend.planQuickCommandScript({ snippetId: snippet.id, autoExecute: true }))
    expect(planned).toMatchObject({
      source: 'snippet',
      snippetId: snippet.id,
      snippetName: '发布检查',
      autoExecute: true
    })
    expect(planned.securityCommand).toBe('echo persisted')
    expect(planned.segments).toEqual([
      { text: 'echo persisted\n', delayBeforeMs: 0 },
      { text: 'echo done\n', delayBeforeMs: 100 }
    ])
    expect(expectOkData(backend.planQuickCommandScript({ snippetContent: 'echo inline', autoExecute: false }))).toMatchObject({
      source: 'inline',
      snippetId: null,
      snippetName: '',
      autoExecute: false,
      shellText: 'echo inline'
    })
  })

  it('removes unmodified legacy seed rows from non-seed runtime while preserving user-edited rows', async () => {
    const databasePath = await useTempRuntime({ useSeedData: true, prefix: 'aiopsterm-quick-commands-legacy-seed-' })
    expect(backend.getQuickCommands().snippets).toHaveLength(3)

    expectOkData(backend.saveQuickCommandGroup({ uuid: 'snippet-group-inspection', group_name: '我的巡检命令' }))
    expectOkData(
      backend.saveQuickCommandSnippet({
        id: 1,
        snippet_name: '我的磁盘巡检',
        snippet_content: 'df -h',
        group_uuid: 'snippet-group-inspection'
      })
    )

    backend.configureQuickCommandBackendRuntime({ databasePath, useSeedData: false })
    const nonSeedSnapshot = backend.getQuickCommands()

    expect(nonSeedSnapshot.groups).toEqual([expect.objectContaining({ uuid: 'snippet-group-inspection', group_name: '我的巡检命令' })])
    expect(nonSeedSnapshot.snippets).toEqual([
      expect.objectContaining({
        id: 1,
        uuid: 'snippet-disk-check',
        snippet_name: '我的磁盘巡检',
        snippet_content: 'df -h'
      })
    ])
    expect(readSqliteCount(databasePath, 'quick_command_snippets')).toBe(1)
  })

  it('updates and deletes through backend snapshots', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-update-' })
    const created = expectOkData(
      backend.saveQuickCommandSnippet({
        snippet_name: '临时命令',
        snippet_content: 'uptime',
        group_uuid: null
      })
    ).snippet

    const updated = backend.saveQuickCommandSnippet({
      id: created.id,
      snippet_name: '临时命令更新',
      snippet_content: 'whoami',
      group_uuid: 'missing-group'
    })

    expect(updated.ok).toBe(true)
    expect(updated.data?.snippet).toEqual(
      expect.objectContaining({
        id: created.id,
        uuid: created.uuid,
        snippet_name: '临时命令更新',
        snippet_content: 'whoami',
        group_uuid: null
      })
    )

    const deleted = backend.deleteQuickCommandSnippet(created.id)
    expect(deleted.ok).toBe(true)
    expect(deleted.data?.snippets.some((snippet) => snippet.id === created.id)).toBe(false)
  })

  it('deletes groups by moving grouped commands back to the root level like External reference', async () => {
    const databasePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-delete-group-' })
    const group = expectOkData(backend.saveQuickCommandGroup({ group_name: '待删除组' })).group
    const grouped = expectOkData(
      backend.saveQuickCommandSnippet({
        snippet_name: '组内命令',
        snippet_content: 'date',
        group_uuid: group.uuid
      })
    ).snippet

    const deletedGroup = backend.deleteQuickCommandGroup(group.uuid)
    expect(deletedGroup.ok).toBe(true)
    expect(deletedGroup.data?.groups.some((item) => item.uuid === group.uuid)).toBe(false)
    expect(deletedGroup.data?.snippets).toEqual([
      expect.objectContaining({
        id: grouped.id,
        snippet_name: '组内命令',
        group_uuid: null,
        update_at: '刚刚'
      })
    ])

    backend.configureQuickCommandBackendRuntime({ databasePath, useSeedData: false })
    expect(backend.getQuickCommands().snippets).toEqual([
      expect.objectContaining({
        id: grouped.id,
        group_uuid: null
      })
    ])
  })

  it('rejects stale group and snippet mutation targets instead of returning no-op success snapshots', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-stale-mutations-' })
    const group = expectOkData(backend.saveQuickCommandGroup({ group_name: '真实分组' })).group
    const command = expectOkData(
      backend.saveQuickCommandSnippet({
        snippet_name: '真实命令',
        snippet_content: 'echo real',
        group_uuid: group.uuid
      })
    ).snippet

    expect(backend.saveQuickCommandGroup({ uuid: 'missing-group', group_name: '假分组' })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command group not found'
      })
    )
    expect(backend.deleteQuickCommandGroup('missing-group')).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command group not found'
      })
    )
    expect(
      backend.saveQuickCommandSnippet({
        id: command.id + 100,
        snippet_name: '假命令',
        snippet_content: 'echo fake',
        group_uuid: null
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command snippet not found'
      })
    )
    expect(backend.deleteQuickCommandSnippet(command.id + 100)).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command snippet not found'
      })
    )

    expect(backend.getQuickCommands().groups).toEqual([expect.objectContaining({ uuid: group.uuid })])
    expect(backend.getQuickCommands().snippets).toEqual([expect.objectContaining({ id: command.id, group_uuid: group.uuid })])
  })

  it('persists group-scoped reorder as a backend-owned snapshot and rejects stale order lists', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-reorder-' })
    backend.saveQuickCommands({
      groups: [
        { id: 1, uuid: 'group-a', group_name: 'A' },
        { id: 2, uuid: 'group-b', group_name: 'B' }
      ],
      snippets: [
        { id: 1, uuid: 'snippet-a1', snippet_name: 'a1', snippet_content: 'echo a1', group_uuid: 'group-a' },
        { id: 2, uuid: 'snippet-a2', snippet_name: 'a2', snippet_content: 'echo a2', group_uuid: 'group-a' },
        { id: 3, uuid: 'snippet-root', snippet_name: 'root', snippet_content: 'echo root', group_uuid: null },
        { id: 4, uuid: 'snippet-b1', snippet_name: 'b1', snippet_content: 'echo b1', group_uuid: 'group-b' }
      ]
    })

    const reordered = backend.reorderQuickCommands({ orderedIds: [2, 1], groupUuid: 'group-a' })
    expect(reordered.ok).toBe(true)
    expect(reordered.data?.snippets.filter((snippet) => snippet.group_uuid === 'group-a').map((snippet) => snippet.id)).toEqual([2, 1])
    expect(reordered.data?.snippets.filter((snippet) => snippet.group_uuid === 'group-b').map((snippet) => snippet.id)).toEqual([4])
    expect(reordered.data?.snippets.filter((snippet) => !snippet.group_uuid).map((snippet) => snippet.id)).toEqual([3])

    expect(backend.reorderQuickCommands({ orderedIds: [2], groupUuid: 'group-a' })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command reorder list is stale'
      })
    )
    expect(backend.reorderQuickCommands({ orderedIds: [2, 2], groupUuid: 'group-a' })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command reorder ids must be unique'
      })
    )
    expect(backend.reorderQuickCommands({ orderedIds: [3, 1], groupUuid: 'group-a' })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command reorder list is stale'
      })
    )
  })

  it('returns mutation errors instead of renderer-side validation results', async () => {
    const invalidGroup = backend.saveQuickCommandGroup({ group_name: '   ' })
    expect(invalidGroup).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Group name is required'
      })
    )

    const invalidSnippet = backend.saveQuickCommandSnippet({
      snippet_name: '空内容',
      snippet_content: '',
      group_uuid: null
    })
    expect(invalidSnippet).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Snippet content is required'
      })
    )
  })

  it('builds backend-owned script plans with External reference syntax semantics', async () => {
    const planned = backend.planQuickCommandScript({
      snippetContent: `
        # ignored
        echo first
        sleep==250
        CTRL+C
        up
        echo second
      `,
      autoExecute: false
    })

    expect(planned.ok).toBe(true)
    expect(planned.data).toEqual({
      securityCommand: 'echo first',
      commands: ['echo first', 'echo second'],
      shellText: 'echo first\n\x03\x1b[Aecho second',
      segments: [
        { text: 'echo first\n', delayBeforeMs: 0 },
        { text: '\x03\x1b[Aecho second', delayBeforeMs: 250 }
      ],
      source: 'inline',
      snippetId: null,
      snippetName: '',
      autoExecute: false
    })
  })

  it('saves macro recordings as backend-owned snippets and script content', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-macro-' })
    const group = expectOkData(backend.saveQuickCommandGroup({ group_name: '宏录制' })).group
    const result = backend.saveQuickCommandMacro({
      snippet_name: 'macro-release-check',
      group_uuid: group.uuid,
      sleepThresholdMs: 400,
      entries: [
        { command: 'uptime', timestamp: 1000 },
        { command: 'up', timestamp: 1600 },
        { command: 'whoami', timestamp: 1650 }
      ]
    })

    const saved = expectOkData(result).snippet
    expect(saved).toEqual(
      expect.objectContaining({
        id: 1,
        uuid: expect.stringMatching(/^snippet-/),
        snippet_name: 'macro-release-check',
        snippet_content: 'uptime\nsleep==600\nup\nwhoami',
        group_uuid: group.uuid
      })
    )
    expect(backend.getQuickCommands().snippets).toEqual([expect.objectContaining({ id: saved.id, snippet_content: saved.snippet_content })])

    const planned = expectOkData(backend.planQuickCommandScript({ snippetId: saved.id, autoExecute: true }))
    expect(planned.segments).toEqual([
      { text: 'uptime\n', delayBeforeMs: 0 },
      { text: '\x1b[Awhoami\n', delayBeforeMs: 600 }
    ])
    expect(planned.commands).toEqual(['uptime', 'whoami'])
  })

  it('rejects malformed macro recordings before creating snippets', async () => {
    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-quick-commands-macro-invalid-' })

    expect(backend.saveQuickCommandMacro({ entries: [] })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Macro recording entries are required'
      })
    )
    expect(
      backend.saveQuickCommandMacro({
        entries: [
          { command: 'first', timestamp: 2000 },
          { command: 'second', timestamp: 1000 }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Macro recording timestamps must be ordered'
      })
    )
    expect(
      backend.saveQuickCommandMacro({
        entries: Array.from({ length: 51 }, (_, index) => ({ command: `cmd-${index}`, timestamp: index }))
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Macro recording command limit exceeded'
      })
    )
    expect(backend.getQuickCommands().snippets).toEqual([])
  })

  it('returns structured errors for missing script plan inputs', async () => {
    expect(backend.planQuickCommandScript({ snippetId: 404 })).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command snippet not found'
      })
    )
    expect(backend.planQuickCommandScript({})).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
        errorMessage: 'Quick command script content is required'
      })
    )
  })
})
