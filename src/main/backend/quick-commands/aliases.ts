import { app } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { isAbsolute, join, resolve } from 'path'
import type { AiopsMutationResult } from '@shared/contracts/common'
import type {
  AliasCommandConfig,
  AliasCommandDeleteInput,
  AliasCommandDeleteResult,
  AliasCommandListResult,
  AliasCommandMutationResult,
  AliasCommandSaveInput
} from '@shared/contracts/aliases'
import { shouldUseAliasesSeedData } from '@shared/runtimeSwitches'

type AliasStoreShape = {
  aliases: AliasCommandConfig[]
}

type AliasBackendRuntimeConfig = {
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
}

type SqliteStatement = {
  all(...args: unknown[]): unknown[]
  get(...args: unknown[]): unknown
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

const defaultAliases: AliasCommandConfig[] = [
  { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 },
  { id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 1717286400000 },
  { id: 'alias-kctx', alias: 'kctx', command: 'kubectl config current-context', createdAt: 1717372800000 }
]

const cloneAlias = (command: AliasCommandConfig): AliasCommandConfig => ({ ...command })

const cloneAliases = (commands: AliasCommandConfig[]) => commands.map(cloneAlias)

const normalizeText = (value: unknown) => String(value || '').trim()

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const defaultAliasSeedMode = shouldUseAliasesSeedData

const defaultAliasDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_ALIASES_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

let runtimeConfig: Required<AliasBackendRuntimeConfig> = {
  databasePath: defaultAliasDatabasePath(),
  useSeedData: defaultAliasSeedMode(),
  forceFallbackStore: false
}

const seedAliases = () => defaultAliases.map(cloneAlias)

const emptyAliases = (): AliasCommandConfig[] => []

const normalizeAliases = (source?: unknown): AliasCommandConfig[] => {
  const rawAliases = Array.isArray(source) ? source : runtimeConfig.useSeedData ? seedAliases() : emptyAliases()
  const aliases: AliasCommandConfig[] = []
  const seenIds = new Set<string>()
  const seenAliases = new Set<string>()

  rawAliases.forEach((item, index) => {
    if (!isRecord(item)) return
    const alias = normalizeText(item.alias)
    const command = normalizeText(item.command)
    if (!alias || !command || seenAliases.has(alias)) return
    let id = normalizeText(item.id) && normalizeText(item.id) !== 'new' ? normalizeText(item.id) : `alias-${index + 1}`
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    seenAliases.add(alias)
    aliases.push({
      id,
      alias,
      command,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    })
  })

  return aliases.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

const stripLegacySeedAliases = (commands: AliasCommandConfig[]): AliasCommandConfig[] => {
  if (runtimeConfig.useSeedData) return commands
  const seeds = new Map(defaultAliases.map((alias) => [alias.id, alias]))
  return commands.filter((command) => {
    const seed = seeds.get(command.id)
    return !seed || JSON.stringify(command) !== JSON.stringify(seed)
  })
}

class FallbackAliasStore {
  private store: Store<AliasStoreShape> | null = null
  private memory = runtimeConfig.useSeedData ? cloneAliases(defaultAliases) : emptyAliases()

  constructor() {
    try {
      this.store = new Store<AliasStoreShape>({
        name: 'aiopsterm-aliases',
        defaults: {
          aliases: runtimeConfig.useSeedData ? defaultAliases : emptyAliases()
        }
      })
    } catch {
      this.store = null
    }
  }

  list(): AliasCommandConfig[] {
    const aliases = stripLegacySeedAliases(normalizeAliases(this.store ? this.store.get('aliases') : this.memory))
    if (this.store) this.store.set('aliases', aliases)
    else this.memory = cloneAliases(aliases)
    return cloneAliases(aliases)
  }

  save(commands: AliasCommandConfig[]) {
    const aliases = normalizeAliases(commands)
    if (this.store) this.store.set('aliases', aliases)
    else this.memory = cloneAliases(aliases)
    return cloneAliases(aliases)
  }
}

class SqliteAliasStore {
  private readonly insertStatement: SqliteStatement
  private readonly listStatement: SqliteStatement
  private readonly replaceAll: (commands: AliasCommandConfig[]) => void

  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS aliases (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL UNIQUE,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_aliases_created_at ON aliases(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);
    `)
    this.insertStatement = this.db.prepare('INSERT INTO aliases (id, alias, command, created_at) VALUES (?, ?, ?, ?)')
    this.listStatement = this.db.prepare('SELECT id, alias, command, created_at FROM aliases ORDER BY created_at DESC')
    this.replaceAll = this.db.transaction((commands: AliasCommandConfig[]) => {
      this.db.exec('DELETE FROM aliases;')
      for (const item of commands) {
        this.insertStatement.run(item.id, item.alias, item.command, item.createdAt || Date.now())
      }
    })
    if (runtimeConfig.useSeedData) this.seed()
  }

  private seed() {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM aliases').get() as { count: number }
    if (count?.count) return
    const seedTransaction = this.db.transaction(() => {
      for (const item of defaultAliases) {
        this.insertStatement.run(item.id, item.alias, item.command, item.createdAt || Date.now())
      }
    })
    seedTransaction()
  }

  list(): AliasCommandConfig[] {
    const aliases = this.listStatement.all().map((row) => {
      const item = row as { id: string; alias: string; command: string; created_at: number }
      return {
        id: item.id,
        alias: item.alias,
        command: item.command,
        createdAt: item.created_at
      }
    })
    const normalized = stripLegacySeedAliases(normalizeAliases(aliases))
    if (JSON.stringify(normalized) !== JSON.stringify(aliases)) return this.save(normalized)
    return normalized
  }

  save(commands: AliasCommandConfig[]) {
    this.replaceAll(normalizeAliases(commands))
    return this.list()
  }
}

let aliasStore: FallbackAliasStore | SqliteAliasStore | null = null

const createStore = () => {
  try {
    if (runtimeConfig.forceFallbackStore) throw new Error('force fallback alias store')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteAliasStore(new Database(runtimeConfig.databasePath))
  } catch {
    return new FallbackAliasStore()
  }
}

const getStore = () => {
  if (!aliasStore) aliasStore = createStore()
  return aliasStore
}

const asResult = <T>(fn: () => T, fallbackCode = 'ALIAS_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : fallbackCode
    return {
      ok: false,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

const listAllAliases = () => getStore().list()

const saveAllAliases = (commands: AliasCommandConfig[]) => getStore().save(commands)

const findAlias = (commands: AliasCommandConfig[], input: AliasCommandDeleteInput | Pick<AliasCommandSaveInput, 'id' | 'previousAlias'>) => {
  const id = normalizeText(input.id)
  const alias = normalizeText('alias' in input ? input.alias : 'previousAlias' in input ? input.previousAlias : '')
  return commands.find((item) => (id && item.id === id) || (alias && item.alias === alias)) || null
}

export const listAliasCommands = (query = ''): AliasCommandListResult =>
  asResult(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const aliases = listAllAliases()
    if (!normalizedQuery) return aliases
    return aliases.filter((item) => item.alias.toLowerCase().includes(normalizedQuery) || item.command.toLowerCase().includes(normalizedQuery))
  })

export const saveAliasCommand = (input: AliasCommandSaveInput): AliasCommandMutationResult => {
  const alias = normalizeText(input.alias)
  const command = normalizeText(input.command)
  if (!alias || !command) {
    return {
      ok: false,
      errorCode: 'ALIAS_REQUIRED',
      errorMessage: 'Alias and command are required.'
    }
  }

  return asResult(() => {
    const aliases = listAllAliases()
    const isUpdate = Boolean(normalizeText(input.id) || normalizeText(input.previousAlias))
    const existing = isUpdate ? findAlias(aliases, input) : null
    const id = existing?.id || normalizeText(input.id) || `alias-${randomUUID()}`
    const duplicate = aliases.find((item) => item.alias === alias && item.id !== id)
    if (duplicate) {
      throw Object.assign(new Error('Alias already exists.'), { code: 'ALIAS_DUPLICATE' })
    }

    const nextCommand: AliasCommandConfig = {
      id,
      alias,
      command,
      createdAt: existing?.createdAt || (typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : Date.now())
    }
    const nextAliases = aliases.filter((item) => item.id !== id && item.alias !== input.previousAlias)
    nextAliases.push(nextCommand)
    const commands = saveAllAliases(nextAliases)
    return {
      command: cloneAlias(nextCommand),
      commands
    }
  }, 'ALIAS_BACKEND_ERROR')
}

export const deleteAliasCommand = (input: AliasCommandDeleteInput): AliasCommandDeleteResult => {
  const id = normalizeText(input.id)
  const alias = normalizeText(input.alias)
  if (!id && !alias) {
    return {
      ok: false,
      errorCode: 'ALIAS_DELETE_TARGET_REQUIRED',
      errorMessage: 'Alias delete target is required.'
    }
  }

  return asResult(() => {
    const aliases = listAllAliases()
    const deleted = aliases.find((item) => (id && item.id === id) || (alias && item.alias === alias))
    if (!deleted) throw Object.assign(new Error('Alias not found.'), { code: 'ALIAS_NOT_FOUND' })
    const commands = saveAllAliases(aliases.filter((item) => item.id !== deleted.id))
    return {
      deleted: cloneAlias(deleted),
      commands
    }
  }, 'ALIAS_BACKEND_ERROR')
}

export const configureAliasBackendRuntime = (config: AliasBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultAliasDatabasePath(),
    useSeedData: config.useSeedData ?? defaultAliasSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore)
  }
  aliasStore = null
}

export const resetAliasesForTests = () => {
  aliasStore = null
}
