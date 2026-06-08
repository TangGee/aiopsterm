import { app } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type {
  AiopsMutationResult,
  QuickCommandGroupConfig,
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandGroupSaveInput,
  QuickCommandReorderInput,
  QuickCommandReorderResult,
  QuickCommandSnippetConfig,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig
} from '@shared/preload'

type QuickCommandStoreShape = {
  quickCommands: QuickCommandsUserConfig
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}

const defaultGroups: QuickCommandGroupConfig[] = [{ id: 1, uuid: 'snippet-group-inspection', group_name: '巡检命令' }]

const defaultSnippets: QuickCommandSnippetConfig[] = [
  {
    id: 1,
    uuid: 'snippet-disk-check',
    snippet_name: '磁盘巡检',
    snippet_content: 'df -h\nfree -m\nuptime',
    group_uuid: 'snippet-group-inspection',
    create_at: '初始',
    update_at: '初始'
  },
  {
    id: 2,
    uuid: 'snippet-nginx-status',
    snippet_name: 'Nginx 状态',
    snippet_content: 'systemctl status nginx\njournalctl -u nginx -n 20',
    group_uuid: 'snippet-group-inspection',
    create_at: '初始',
    update_at: '初始'
  },
  {
    id: 3,
    uuid: 'snippet-root-pwd',
    snippet_name: '当前目录',
    snippet_content: 'pwd\nls -la',
    group_uuid: null,
    create_at: '初始',
    update_at: '初始'
  }
]

const cloneGroup = (group: QuickCommandGroupConfig): QuickCommandGroupConfig => ({ ...group })
const cloneSnippet = (snippet: QuickCommandSnippetConfig): QuickCommandSnippetConfig => ({ ...snippet })

const cloneQuickCommands = (config: QuickCommandsUserConfig): QuickCommandsUserConfig => ({
  groups: config.groups.map(cloneGroup),
  snippets: config.snippets.map(cloneSnippet)
})

const defaultQuickCommands = (): QuickCommandsUserConfig => ({
  groups: defaultGroups.map(cloneGroup),
  snippets: defaultSnippets.map(cloneSnippet)
})

const nowText = () => '刚刚'
const nextGroupId = (groups: QuickCommandGroupConfig[]) => Math.max(0, ...groups.map((group) => group.id)) + 1
const nextSnippetId = (snippets: QuickCommandSnippetConfig[]) => Math.max(0, ...snippets.map((snippet) => snippet.id)) + 1

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeQuickCommands = (source?: Partial<QuickCommandsUserConfig>): QuickCommandsUserConfig => {
  const incoming = isRecord(source) ? source : {}
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : defaultGroups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : defaultSnippets
  const groupUuids = new Set<string>()
  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()

  const groups = rawGroups
    .map((item, index): QuickCommandGroupConfig | null => {
      if (!isRecord(item)) return null
      const groupName = typeof item.group_name === 'string' ? item.group_name.trim() : ''
      if (!groupName) return null
      const uuid = typeof item.uuid === 'string' && item.uuid.trim() ? item.uuid.trim() : `snippet-group-${index + 1}`
      if (groupUuids.has(uuid)) return null
      groupUuids.add(uuid)
      return {
        id: Number.isInteger(item.id) && Number(item.id) > 0 ? Number(item.id) : index + 1,
        uuid,
        group_name: groupName
      }
    })
    .filter(Boolean) as QuickCommandGroupConfig[]

  const snippets: QuickCommandSnippetConfig[] = []
  rawSnippets.forEach((item, index) => {
    if (!isRecord(item)) return
    const snippetName = typeof item.snippet_name === 'string' ? item.snippet_name.trim() : ''
    const snippetContent = typeof item.snippet_content === 'string' ? item.snippet_content : ''
    if (!snippetName || !snippetContent) return
    let id = Number.isInteger(item.id) && Number(item.id) > 0 ? Number(item.id) : index + 1
    while (snippetIds.has(id)) id += 1
    snippetIds.add(id)
    const uuid = typeof item.uuid === 'string' && item.uuid.trim() ? item.uuid.trim() : `snippet-${id}`
    if (snippetUuids.has(uuid)) return
    snippetUuids.add(uuid)
    const groupUuid = typeof item.group_uuid === 'string' && groupUuids.has(item.group_uuid) ? item.group_uuid : null
    snippets.push({
      id,
      uuid,
      snippet_name: snippetName,
      snippet_content: snippetContent,
      group_uuid: groupUuid,
      ...(typeof item.create_at === 'string' ? { create_at: item.create_at } : {}),
      ...(typeof item.update_at === 'string' ? { update_at: item.update_at } : {})
    })
  })

  return { groups, snippets }
}

class FallbackQuickCommandStore {
  private store = new Store<QuickCommandStoreShape>({
    name: 'aiopsterm-quick-commands',
    defaults: {
      quickCommands: defaultQuickCommands()
    }
  })

  get(): QuickCommandsUserConfig {
    const normalized = normalizeQuickCommands(this.store.get('quickCommands'))
    this.store.set('quickCommands', normalized)
    return cloneQuickCommands(normalized)
  }

  save(config: QuickCommandsUserConfig): QuickCommandsUserConfig {
    const normalized = normalizeQuickCommands(config)
    this.store.set('quickCommands', normalized)
    return cloneQuickCommands(normalized)
  }

  saveGroup(input: QuickCommandGroupSaveInput): QuickCommandsUserConfig & { group: QuickCommandGroupConfig } {
    const current = this.get()
    const name = input.group_name.trim()
    if (!name) throw new Error('Group name is required')
    const existing = input.uuid ? current.groups.find((group) => group.uuid === input.uuid) : undefined
    const group: QuickCommandGroupConfig = existing
      ? { ...existing, group_name: name }
      : { id: nextGroupId(current.groups), uuid: `snippet-group-${randomUUID()}`, group_name: name }
    const groups = existing ? current.groups.map((item) => (item.uuid === group.uuid ? group : item)) : [...current.groups, group]
    const saved = this.save({ groups, snippets: current.snippets })
    return { ...saved, group: saved.groups.find((item) => item.uuid === group.uuid)! }
  }

  deleteGroup(uuid: string): QuickCommandsUserConfig & { groupUuid: string } {
    const current = this.get()
    const saved = this.save({
      groups: current.groups.filter((group) => group.uuid !== uuid),
      snippets: current.snippets.filter((snippet) => snippet.group_uuid !== uuid)
    })
    return { ...saved, groupUuid: uuid }
  }

  saveSnippet(input: QuickCommandSnippetSaveInput): QuickCommandsUserConfig & { snippet: QuickCommandSnippetConfig } {
    const current = this.get()
    const name = input.snippet_name.trim()
    if (!name) throw new Error('Snippet name is required')
    if (!input.snippet_content) throw new Error('Snippet content is required')
    const existing = input.id ? current.snippets.find((snippet) => snippet.id === input.id) : undefined
    const groupUuid = input.group_uuid && current.groups.some((group) => group.uuid === input.group_uuid) ? input.group_uuid : null
    const snippet: QuickCommandSnippetConfig = existing
      ? { ...existing, snippet_name: name, snippet_content: input.snippet_content, group_uuid: groupUuid, update_at: nowText() }
      : {
          id: nextSnippetId(current.snippets),
          uuid: `snippet-${randomUUID()}`,
          snippet_name: name,
          snippet_content: input.snippet_content,
          group_uuid: groupUuid,
          create_at: nowText(),
          update_at: nowText()
        }
    const snippets = existing ? current.snippets.map((item) => (item.id === snippet.id ? snippet : item)) : [...current.snippets, snippet]
    const saved = this.save({ groups: current.groups, snippets })
    return { ...saved, snippet: saved.snippets.find((item) => item.id === snippet.id)! }
  }

  deleteSnippet(id: number): QuickCommandsUserConfig & { id: number } {
    const current = this.get()
    const saved = this.save({ groups: current.groups, snippets: current.snippets.filter((snippet) => snippet.id !== id) })
    return { ...saved, id }
  }

  reorder(input: QuickCommandReorderInput): QuickCommandsUserConfig {
    const current = this.get()
    const orderedIds = new Set(input.orderedIds)
    const ordered = input.orderedIds
      .map((id) => current.snippets.find((snippet) => snippet.id === id))
      .filter((snippet): snippet is QuickCommandSnippetConfig => Boolean(snippet))
    const rest = current.snippets.filter((snippet) => !orderedIds.has(snippet.id))
    return this.save({ groups: current.groups, snippets: [...rest, ...ordered] })
  }
}

class SqliteQuickCommandStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_command_groups (
        uuid TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quick_command_snippets (
        id INTEGER PRIMARY KEY,
        uuid TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `)
    this.seed()
  }

  private seed() {
    const groupCount = this.db.prepare('SELECT COUNT(*) as count FROM quick_command_groups').get() as { count: number }
    const snippetCount = this.db.prepare('SELECT COUNT(*) as count FROM quick_command_snippets').get() as { count: number }
    if (!groupCount) return
    if (!groupCount.count) {
      for (const group of defaultGroups) {
        this.db.prepare('INSERT INTO quick_command_groups (uuid, data) VALUES (?, ?)').run(group.uuid, JSON.stringify(group))
      }
    }
    if (!snippetCount.count) {
      for (const [index, snippet] of defaultSnippets.entries()) {
        this.db.prepare('INSERT INTO quick_command_snippets (id, uuid, data, sort_order) VALUES (?, ?, ?, ?)').run(snippet.id, snippet.uuid, JSON.stringify(snippet), (index + 1) * 10)
      }
    }
  }

  get(): QuickCommandsUserConfig {
    const groups = this.db
      .prepare('SELECT data FROM quick_command_groups ORDER BY json_extract(data, "$.id") ASC')
      .all()
      .map((row) => JSON.parse((row as { data: string }).data) as QuickCommandGroupConfig)
    const snippets = this.db
      .prepare('SELECT data FROM quick_command_snippets ORDER BY sort_order ASC, id ASC')
      .all()
      .map((row) => JSON.parse((row as { data: string }).data) as QuickCommandSnippetConfig)
    return normalizeQuickCommands({ groups, snippets })
  }

  save(config: QuickCommandsUserConfig): QuickCommandsUserConfig {
    const normalized = normalizeQuickCommands(config)
    this.db.exec('DELETE FROM quick_command_groups; DELETE FROM quick_command_snippets;')
    for (const group of normalized.groups) {
      this.db.prepare('INSERT INTO quick_command_groups (uuid, data) VALUES (?, ?)').run(group.uuid, JSON.stringify(group))
    }
    for (const [index, snippet] of normalized.snippets.entries()) {
      this.db.prepare('INSERT INTO quick_command_snippets (id, uuid, data, sort_order) VALUES (?, ?, ?, ?)').run(snippet.id, snippet.uuid || randomUUID(), JSON.stringify(snippet), (index + 1) * 10)
    }
    return cloneQuickCommands(normalized)
  }

  saveGroup(input: QuickCommandGroupSaveInput): QuickCommandsUserConfig & { group: QuickCommandGroupConfig } {
    const current = this.get()
    const name = input.group_name.trim()
    if (!name) throw new Error('Group name is required')
    const existing = input.uuid ? current.groups.find((group) => group.uuid === input.uuid) : undefined
    const group: QuickCommandGroupConfig = existing
      ? { ...existing, group_name: name }
      : { id: nextGroupId(current.groups), uuid: `snippet-group-${randomUUID()}`, group_name: name }
    const groups = existing ? current.groups.map((item) => (item.uuid === group.uuid ? group : item)) : [...current.groups, group]
    const saved = this.save({ groups, snippets: current.snippets })
    return { ...saved, group: saved.groups.find((item) => item.uuid === group.uuid)! }
  }

  deleteGroup(uuid: string): QuickCommandsUserConfig & { groupUuid: string } {
    const current = this.get()
    const saved = this.save({
      groups: current.groups.filter((group) => group.uuid !== uuid),
      snippets: current.snippets.filter((snippet) => snippet.group_uuid !== uuid)
    })
    return { ...saved, groupUuid: uuid }
  }

  saveSnippet(input: QuickCommandSnippetSaveInput): QuickCommandsUserConfig & { snippet: QuickCommandSnippetConfig } {
    const current = this.get()
    const name = input.snippet_name.trim()
    if (!name) throw new Error('Snippet name is required')
    if (!input.snippet_content) throw new Error('Snippet content is required')
    const existing = input.id ? current.snippets.find((snippet) => snippet.id === input.id) : undefined
    const groupUuid = input.group_uuid && current.groups.some((group) => group.uuid === input.group_uuid) ? input.group_uuid : null
    const snippet: QuickCommandSnippetConfig = existing
      ? { ...existing, snippet_name: name, snippet_content: input.snippet_content, group_uuid: groupUuid, update_at: nowText() }
      : {
          id: nextSnippetId(current.snippets),
          uuid: `snippet-${randomUUID()}`,
          snippet_name: name,
          snippet_content: input.snippet_content,
          group_uuid: groupUuid,
          create_at: nowText(),
          update_at: nowText()
        }
    const snippets = existing ? current.snippets.map((item) => (item.id === snippet.id ? snippet : item)) : [...current.snippets, snippet]
    const saved = this.save({ groups: current.groups, snippets })
    return { ...saved, snippet: saved.snippets.find((item) => item.id === snippet.id)! }
  }

  deleteSnippet(id: number): QuickCommandsUserConfig & { id: number } {
    const current = this.get()
    const saved = this.save({ groups: current.groups, snippets: current.snippets.filter((snippet) => snippet.id !== id) })
    return { ...saved, id }
  }

  reorder(input: QuickCommandReorderInput): QuickCommandsUserConfig {
    const current = this.get()
    const orderedIds = new Set(input.orderedIds)
    const ordered = input.orderedIds
      .map((id) => current.snippets.find((snippet) => snippet.id === id))
      .filter((snippet): snippet is QuickCommandSnippetConfig => Boolean(snippet))
    const rest = current.snippets.filter((snippet) => !orderedIds.has(snippet.id))
    return this.save({ groups: current.groups, snippets: [...rest, ...ordered] })
  }
}

let quickCommandStore: FallbackQuickCommandStore | SqliteQuickCommandStore | null = null

const createStore = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteQuickCommandStore(new Database(join(app.getPath('userData'), 'aiopsterm-state.db')))
  } catch {
    return new FallbackQuickCommandStore()
  }
}

const getStore = () => {
  if (!quickCommandStore) quickCommandStore = createStore()
  return quickCommandStore
}

const asResult = <T>(fn: () => T): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

export const getQuickCommands = (): QuickCommandsUserConfig => getStore().get()
export const saveQuickCommands = (config: QuickCommandsUserConfig): AiopsMutationResult<QuickCommandsUserConfig> => asResult(() => getStore().save(config))
export const saveQuickCommandGroup = (input: QuickCommandGroupSaveInput): QuickCommandGroupMutationResult => asResult(() => getStore().saveGroup(input))
export const deleteQuickCommandGroup = (uuid: string): QuickCommandGroupDeleteResult => asResult(() => getStore().deleteGroup(uuid))
export const saveQuickCommandSnippet = (input: QuickCommandSnippetSaveInput): QuickCommandSnippetMutationResult =>
  asResult(() => getStore().saveSnippet(input))
export const deleteQuickCommandSnippet = (id: number): QuickCommandSnippetDeleteResult => asResult(() => getStore().deleteSnippet(id))
export const reorderQuickCommands = (input: QuickCommandReorderInput): QuickCommandReorderResult => asResult(() => getStore().reorder(input))
