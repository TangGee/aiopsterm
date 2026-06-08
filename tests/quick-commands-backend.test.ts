import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiopsMutationResult,
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandGroupSaveInput,
  QuickCommandReorderInput,
  QuickCommandReorderResult,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig
} from '@shared/preload'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-quick-commands-test'
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

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store quick-command backend in tests')
})

type QuickCommandsBackend = {
  getQuickCommands: () => QuickCommandsUserConfig
  saveQuickCommands: (config: QuickCommandsUserConfig) => AiopsMutationResult<QuickCommandsUserConfig>
  saveQuickCommandGroup: (input: QuickCommandGroupSaveInput) => QuickCommandGroupMutationResult
  deleteQuickCommandGroup: (uuid: string) => QuickCommandGroupDeleteResult
  saveQuickCommandSnippet: (input: QuickCommandSnippetSaveInput) => QuickCommandSnippetMutationResult
  deleteQuickCommandSnippet: (id: number) => QuickCommandSnippetDeleteResult
  reorderQuickCommands: (input: QuickCommandReorderInput) => QuickCommandReorderResult
}

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/quickCommands'
  return import(modulePath) as Promise<QuickCommandsBackend>
}

describe('quick commands backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('owns group and snippet identity for new quick-command rows', async () => {
    const backend = await loadBackend()
    const groupResult = backend.saveQuickCommandGroup({ group_name: '发布命令' })

    expect(groupResult.ok).toBe(true)
    expect(groupResult.data?.group).toEqual(
      expect.objectContaining({
        id: 2,
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
        id: 4,
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

  it('updates and deletes through backend snapshots', async () => {
    const backend = await loadBackend()
    const created = backend.saveQuickCommandSnippet({
      snippet_name: '临时命令',
      snippet_content: 'uptime',
      group_uuid: null
    }).data!.snippet

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

  it('deletes groups with their grouped commands to mirror the panel flow', async () => {
    const backend = await loadBackend()
    const group = backend.saveQuickCommandGroup({ group_name: '待删除组' }).data!.group
    const grouped = backend.saveQuickCommandSnippet({
      snippet_name: '组内命令',
      snippet_content: 'date',
      group_uuid: group.uuid
    }).data!.snippet

    const deletedGroup = backend.deleteQuickCommandGroup(group.uuid)
    expect(deletedGroup.ok).toBe(true)
    expect(deletedGroup.data?.groups.some((item) => item.uuid === group.uuid)).toBe(false)
    expect(deletedGroup.data?.snippets.some((item) => item.id === grouped.id)).toBe(false)
  })

  it('persists reorder as a backend-owned snapshot', async () => {
    const backend = await loadBackend()
    backend.saveQuickCommands({
      groups: [],
      snippets: [
        { id: 1, uuid: 'snippet-first', snippet_name: 'first', snippet_content: 'echo first', group_uuid: null },
        { id: 2, uuid: 'snippet-second', snippet_name: 'second', snippet_content: 'echo second', group_uuid: null }
      ]
    })

    const reordered = backend.reorderQuickCommands({ orderedIds: [2, 1] })
    expect(reordered.ok).toBe(true)
    expect(reordered.data?.snippets.map((snippet) => snippet.id)).toEqual([2, 1])
  })

  it('returns mutation errors instead of renderer-side validation results', async () => {
    const backend = await loadBackend()

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
})
