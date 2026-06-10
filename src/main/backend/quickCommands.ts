import { app } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { isAbsolute, join, resolve } from 'path'
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
  QuickCommandScriptPlan,
  QuickCommandScriptPlanInput,
  QuickCommandScriptPlanResult,
  QuickCommandScriptSegment,
  QuickCommandsUserConfig
} from '@shared/preload'

type QuickCommandStoreShape = {
  quickCommands: QuickCommandsUserConfig
}

type QuickCommandBackendRuntimeConfig = {
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}

type ParsedQuickCommandScriptItem =
  | { type: 'COMMAND'; payload: string }
  | { type: 'SLEEP'; payload: number }
  | { type: 'KEY'; payload: keyof typeof keyMap }
  | { type: 'CTRL'; payload: keyof typeof ctrlKeyMap }

const keyMap = {
  esc: '\x1b',
  tab: '\t',
  return: '\r',
  backspace: '\b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}

const ctrlKeyMap = {
  'ctrl+a': '\x01',
  'ctrl+b': '\x02',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+f': '\x06',
  'ctrl+g': '\x07',
  'ctrl+h': '\x08',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+n': '\x0e',
  'ctrl+p': '\x10',
  'ctrl+r': '\x12',
  'ctrl+t': '\x14',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a'
}

const isKeyToken = (value: string): value is keyof typeof keyMap => Object.prototype.hasOwnProperty.call(keyMap, value)
const isCtrlToken = (value: string): value is keyof typeof ctrlKeyMap => Object.prototype.hasOwnProperty.call(ctrlKeyMap, value)

const parseQuickCommandScript = (text: string): ParsedQuickCommandScriptItem[] => {
  const commands: ParsedQuickCommandScriptItem[] = []
  text.split(/\r\n|\n|\r/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return
    const sleepMatch = trimmed.match(/^sleep==(\d+)$/i)
    if (sleepMatch) {
      commands.push({ type: 'SLEEP', payload: Number(sleepMatch[1]) })
      return
    }
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('ctrl+') && isCtrlToken(lower)) {
      commands.push({ type: 'CTRL', payload: lower })
      return
    }
    if (isKeyToken(lower)) {
      commands.push({ type: 'KEY', payload: lower })
      return
    }
    commands.push({ type: 'COMMAND', payload: trimmed })
  })
  return commands
}

const quickCommandScriptItemText = (
  item: Exclude<ParsedQuickCommandScriptItem, { type: 'SLEEP' }>,
  context: { autoExecute: boolean; lastCommandPayload?: string; commandCount: number; seenCommandCount: number }
) => {
  if (item.type === 'COMMAND') {
    context.seenCommandCount += 1
    const isLastCommand = item.payload === context.lastCommandPayload && context.seenCommandCount === context.commandCount
    const suffix = isLastCommand && !context.autoExecute ? '' : '\n'
    return `${item.payload}${suffix}`
  }
  if (item.type === 'KEY') return keyMap[item.payload]
  return ctrlKeyMap[item.payload]
}

const buildQuickCommandScriptPlan = (scriptContent: string, autoExecute: boolean, fallbackSecurityCommand = 'Quick Command'): QuickCommandScriptPlan => {
  const parsed = parseQuickCommandScript(scriptContent)
  const commandItems = parsed.filter((item): item is Extract<ParsedQuickCommandScriptItem, { type: 'COMMAND' }> => item.type === 'COMMAND')
  const context = {
    autoExecute,
    lastCommandPayload: commandItems.at(-1)?.payload,
    commandCount: commandItems.length,
    seenCommandCount: 0
  }
  const segments: QuickCommandScriptSegment[] = []
  let buffer = ''
  let delayBeforeMs = 0
  const flush = () => {
    if (!buffer) return
    segments.push({ text: buffer, delayBeforeMs })
    buffer = ''
    delayBeforeMs = 0
  }
  parsed.forEach((item) => {
    if (item.type === 'SLEEP') {
      flush()
      delayBeforeMs += item.payload
      return
    }
    buffer += quickCommandScriptItemText(item, context)
  })
  flush()
  const securityCommand = commandItems[0]?.payload || fallbackSecurityCommand.trim() || 'Quick Command'
  return {
    segments,
    shellText: segments.map((segment) => segment.text).join(''),
    securityCommand
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

const seedQuickCommands = (): QuickCommandsUserConfig => ({
  groups: defaultGroups.map(cloneGroup),
  snippets: defaultSnippets.map(cloneSnippet)
})

const emptyQuickCommands = (): QuickCommandsUserConfig => ({
  groups: [],
  snippets: []
})

const defaultQuickCommandSeedMode = () =>
  process.env.NODE_ENV === 'test' || String(process.env.AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED || '').trim() === '1'

const defaultQuickCommandDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_QUICK_COMMANDS_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

let runtimeConfig: Required<QuickCommandBackendRuntimeConfig> = {
  databasePath: defaultQuickCommandDatabasePath(),
  useSeedData: defaultQuickCommandSeedMode(),
  forceFallbackStore: false
}

const nowText = () => '刚刚'
const nextGroupId = (groups: QuickCommandGroupConfig[]) => Math.max(0, ...groups.map((group) => group.id)) + 1
const nextSnippetId = (snippets: QuickCommandSnippetConfig[]) => Math.max(0, ...snippets.map((snippet) => snippet.id)) + 1

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const quickCommandsEqual = (left: QuickCommandsUserConfig, right: QuickCommandsUserConfig) => JSON.stringify(left) === JSON.stringify(right)

const normalizeQuickCommands = (source?: Partial<QuickCommandsUserConfig>): QuickCommandsUserConfig => {
  const incoming = isRecord(source) ? source : {}
  const fallback = runtimeConfig.useSeedData ? seedQuickCommands() : emptyQuickCommands()
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : fallback.groups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : fallback.snippets
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

const stripLegacySeedQuickCommands = (config: QuickCommandsUserConfig): QuickCommandsUserConfig => {
  if (runtimeConfig.useSeedData) return config
  const seed = seedQuickCommands()
  const seedSnippets = new Map(seed.snippets.map((snippet) => [snippet.uuid, snippet]))
  const snippets = config.snippets.filter((snippet) => {
    const seedSnippet = seedSnippets.get(snippet.uuid)
    if (!seedSnippet) return true
    return JSON.stringify(snippet) !== JSON.stringify(seedSnippet)
  })
  const usedGroupUuids = new Set(snippets.map((snippet) => snippet.group_uuid).filter(Boolean))
  const seedGroups = new Map(seed.groups.map((group) => [group.uuid, group]))
  const groups = config.groups.filter((group) => {
    const seedGroup = seedGroups.get(group.uuid)
    if (!seedGroup) return true
    return usedGroupUuids.has(group.uuid) || JSON.stringify(group) !== JSON.stringify(seedGroup)
  })
  return { groups, snippets }
}

const reorderQuickCommandSnapshot = (current: QuickCommandsUserConfig, input: QuickCommandReorderInput): QuickCommandsUserConfig => {
  const orderedIds = Array.isArray(input.orderedIds) ? input.orderedIds.map(Number) : []
  if (!orderedIds.length) throw new Error('Quick command reorder ids are required')
  if (!orderedIds.every((id) => Number.isInteger(id) && id > 0)) throw new Error('Quick command reorder ids are invalid')
  if (new Set(orderedIds).size !== orderedIds.length) throw new Error('Quick command reorder ids must be unique')

  const groupUuid = typeof input.groupUuid === 'string' && input.groupUuid.trim() ? input.groupUuid.trim() : null
  if (groupUuid && !current.groups.some((group) => group.uuid === groupUuid)) throw new Error('Quick command reorder group not found')

  const groupSnippets = current.snippets.filter((snippet) => (snippet.group_uuid || null) === groupUuid)
  if (orderedIds.length !== groupSnippets.length) throw new Error('Quick command reorder list is stale')

  const snippetsById = new Map(groupSnippets.map((snippet) => [snippet.id, snippet]))
  const ordered = orderedIds.map((id) => snippetsById.get(id))
  if (ordered.some((snippet) => !snippet)) throw new Error('Quick command reorder list is stale')

  const orderedIdSet = new Set(orderedIds)
  return {
    groups: current.groups,
    snippets: [...current.snippets.filter((snippet) => (snippet.group_uuid || null) !== groupUuid || !orderedIdSet.has(snippet.id)), ...(ordered as QuickCommandSnippetConfig[])]
  }
}

class FallbackQuickCommandStore {
  private store = new Store<QuickCommandStoreShape>({
    name: 'aiopsterm-quick-commands',
    defaults: {
      quickCommands: runtimeConfig.useSeedData ? seedQuickCommands() : emptyQuickCommands()
    }
  })

  get(): QuickCommandsUserConfig {
    const normalized = stripLegacySeedQuickCommands(normalizeQuickCommands(this.store.get('quickCommands')))
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
    return this.save(reorderQuickCommandSnapshot(current, input))
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
    if (runtimeConfig.useSeedData) this.seed()
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

  private parseRecord<T>(row: unknown): T | null {
    try {
      const data = (row as { data?: unknown })?.data
      return typeof data === 'string' ? (JSON.parse(data) as T) : null
    } catch {
      return null
    }
  }

  get(): QuickCommandsUserConfig {
    const groups = this.db
      .prepare("SELECT data FROM quick_command_groups ORDER BY json_extract(data, '$.id') ASC")
      .all()
      .map((row) => this.parseRecord<QuickCommandGroupConfig>(row))
      .filter((item): item is QuickCommandGroupConfig => Boolean(item))
    const snippets = this.db
      .prepare('SELECT data FROM quick_command_snippets ORDER BY sort_order ASC, id ASC')
      .all()
      .map((row) => this.parseRecord<QuickCommandSnippetConfig>(row))
      .filter((item): item is QuickCommandSnippetConfig => Boolean(item))
    const normalized = stripLegacySeedQuickCommands(normalizeQuickCommands({ groups, snippets }))
    if (!quickCommandsEqual(normalized, { groups, snippets })) return this.save(normalized)
    return normalized
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
    return this.save(reorderQuickCommandSnapshot(current, input))
  }
}

let quickCommandStore: FallbackQuickCommandStore | SqliteQuickCommandStore | null = null

const createStore = () => {
  try {
    if (runtimeConfig.forceFallbackStore) throw new Error('force fallback quick-command store')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteQuickCommandStore(new Database(runtimeConfig.databasePath))
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
export const planQuickCommandScript = (input: QuickCommandScriptPlanInput): QuickCommandScriptPlanResult =>
  asResult(() => {
    if (!isRecord(input)) throw new Error('Quick command script input is required')
    const autoExecute = input.autoExecute !== false
    if (input.snippetId !== undefined) {
      const snippetId = Number(input.snippetId)
      if (!Number.isInteger(snippetId) || snippetId <= 0) throw new Error('Quick command snippet id is invalid')
      const snippet = getStore().get().snippets.find((item) => item.id === snippetId)
      if (!snippet) throw new Error('Quick command snippet not found')
      return buildQuickCommandScriptPlan(snippet.snippet_content, autoExecute, snippet.snippet_name)
    }
    if (typeof input.snippetContent !== 'string') throw new Error('Quick command script content is required')
    return buildQuickCommandScriptPlan(input.snippetContent, autoExecute)
  })

export const configureQuickCommandBackendRuntime = (config: QuickCommandBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultQuickCommandDatabasePath(),
    useSeedData: config.useSeedData ?? defaultQuickCommandSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore)
  }
  quickCommandStore = null
}

export const resetQuickCommandsForTests = () => {
  quickCommandStore = null
}
