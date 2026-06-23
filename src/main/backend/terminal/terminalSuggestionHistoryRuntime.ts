import { dirname, join } from 'path'
import { mkdirSync } from 'fs'
import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'
import {
  isValidTerminalCommandForHistory,
  maxSuggestionRows,
  normalizeHost,
  nowSecondsFrom,
  type TerminalSuggestionRuntimeConfig
} from './terminalSuggestionCommon'

type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint }

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): SqliteRunResult
  }
}

export type TerminalSuggestionHistoryRow = {
  command: string
  host: string
  count: number
  last_used_at: number
}

export type TerminalSuggestionStore = {
  record(command: string, host?: string): void
  query(command: string, host?: string, limit?: number): TerminalCommandSuggestion[]
}

export type TerminalSuggestionHistoryRuntime = {
  getStore(): TerminalSuggestionStore
  reset(): void
}

const resolveUserDataPath = () => {
  if (process.env.AIOPSTERM_USER_DATA_DIR) return process.env.AIOPSTERM_USER_DATA_DIR
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath(name: 'userData'): string } }
    const userDataPath = electron.app?.getPath?.('userData')
    if (userDataPath) return userDataPath
  } catch {
    // Tests and non-Electron tools can still use an in-process fallback store.
  }
  return process.cwd()
}

function decayScore(count: number, lastUsedAt: number, nowSeconds: number): number {
  const ageHours = Math.max(0, (nowSeconds - lastUsedAt) / 3600)
  return count * Math.pow(0.5, ageHours / 24)
}

function fuzzyScore(query: string, target: string): number {
  if (!query || query.length > target.length) return 0
  let score = 0
  let queryIndex = 0
  let previousMatchIndex = -2
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  for (let index = 0; index < t.length && queryIndex < q.length; index += 1) {
    if (t[index] !== q[queryIndex]) continue
    queryIndex += 1
    if (index === 0) score += 10
    if (index === previousMatchIndex + 1) score += 5
    if (index === 0 || t[index - 1] === ' ' || t[index - 1] === '/' || t[index - 1] === '-' || t[index - 1] === '_') score += 3
    score += 1
    previousMatchIndex = index
  }
  return queryIndex === q.length ? score : 0
}

export function queryTerminalSuggestionHistoryRows(
  rows: TerminalSuggestionHistoryRow[],
  command: string,
  host: string,
  limit: number,
  nowSeconds: number
): TerminalCommandSuggestion[] {
  const query = command.trim().toLowerCase()
  if (query.length < 2) return []
  const seen = new Set<string>()
  const prefixCandidates: Array<{ row: TerminalSuggestionHistoryRow; score: number }> = []

  for (const row of rows) {
    if (seen.has(row.command)) continue
    if (!row.command.toLowerCase().startsWith(query)) continue
    seen.add(row.command)
    const hostBoost = row.host === host ? 10 : 1
    prefixCandidates.push({ row, score: decayScore(row.count, row.last_used_at, nowSeconds) * hostBoost })
  }

  prefixCandidates.sort((a, b) => b.score - a.score)
  const suggestions = prefixCandidates.slice(0, limit).map(({ row }) => ({
    command: row.command,
    source: 'history' as const,
    explanation: row.host === host ? 'history on this host' : `history from ${row.host}`
  }))

  if (suggestions.length >= Math.min(3, limit) || query.length < 2) return suggestions.slice(0, limit)

  const fuzzyCandidates = rows
    .filter((row) => !seen.has(row.command))
    .map((row) => ({
      row,
      score: fuzzyScore(query, row.command) * decayScore(row.count, row.last_used_at, nowSeconds) * (row.host === host ? 10 : 1)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  for (const { row } of fuzzyCandidates) {
    if (suggestions.length >= limit) break
    seen.add(row.command)
    suggestions.push({
      command: row.command,
      source: 'history',
      explanation: row.host === host ? 'history fuzzy match' : `history from ${row.host}`
    })
  }

  return suggestions
}

class MemoryTerminalSuggestionStore implements TerminalSuggestionStore {
  private rows = new Map<string, TerminalSuggestionHistoryRow>()

  constructor(private readonly nowSeconds: () => number) {}

  record(command: string, host?: string): void {
    const normalized = command.trim()
    if (!isValidTerminalCommandForHistory(normalized)) return
    const normalizedHost = normalizeHost(host)
    const key = `${normalizedHost}\0${normalized}`
    const existing = this.rows.get(key)
    if (existing) {
      existing.count += 1
      existing.last_used_at = this.nowSeconds()
      return
    }
    this.rows.set(key, {
      command: normalized,
      host: normalizedHost,
      count: 1,
      last_used_at: this.nowSeconds()
    })
  }

  query(command: string, host?: string, limit = maxSuggestionRows): TerminalCommandSuggestion[] {
    return queryTerminalSuggestionHistoryRows(Array.from(this.rows.values()), command, normalizeHost(host), limit, this.nowSeconds())
  }
}

class SqliteTerminalSuggestionStore implements TerminalSuggestionStore {
  constructor(
    private db: SqliteDatabase,
    private readonly nowSeconds: () => number
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        host TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        UNIQUE(command, host)
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_command_history_host_command ON terminal_command_history(host, command);
      CREATE INDEX IF NOT EXISTS idx_terminal_command_history_last_used ON terminal_command_history(last_used_at DESC);
    `)
  }

  record(command: string, host?: string): void {
    const normalized = command.trim()
    if (!isValidTerminalCommandForHistory(normalized)) return
    const normalizedHost = normalizeHost(host)
    const now = this.nowSeconds()
    this.db
      .prepare(
        `INSERT INTO terminal_command_history (command, host, count, created_at, updated_at, last_used_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(command, host) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at,
           last_used_at = excluded.last_used_at`
      )
      .run(normalized, normalizedHost, now, now, now)
  }

  query(command: string, host?: string, limit = maxSuggestionRows): TerminalCommandSuggestion[] {
    const normalized = command.trim()
    if (normalized.length < 2) return []
    const rows = this.db
      .prepare(
        `SELECT command, host, count, last_used_at
         FROM terminal_command_history
         WHERE command != ?
         ORDER BY last_used_at DESC
         LIMIT 500`
      )
      .all(normalized) as TerminalSuggestionHistoryRow[]
    return queryTerminalSuggestionHistoryRows(rows, normalized, normalizeHost(host), limit, this.nowSeconds())
  }
}

export function createTerminalSuggestionHistoryRuntime(getConfig: () => TerminalSuggestionRuntimeConfig): TerminalSuggestionHistoryRuntime {
  let storeInstance: TerminalSuggestionStore | null = null
  const nowSeconds = () => nowSecondsFrom(getConfig().now)

  const createStore = (): TerminalSuggestionStore => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
      const databasePath = getConfig().databasePath || join(resolveUserDataPath(), 'aiopsterm-state.db')
      if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
      return new SqliteTerminalSuggestionStore(new Database(databasePath), nowSeconds)
    } catch {
      return new MemoryTerminalSuggestionStore(nowSeconds)
    }
  }

  return {
    getStore() {
      if (!storeInstance) storeInstance = createStore()
      return storeInstance
    },
    reset() {
      storeInstance = null
    }
  }
}
