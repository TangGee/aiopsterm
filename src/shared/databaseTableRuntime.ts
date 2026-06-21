import type {
  DatabaseColumnFilter,
  DatabaseColumnSort,
  DatabaseTableMutationInput
} from './contracts/database'

export const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

export const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

export const cloneRows = (rows: Record<string, Array<Record<string, unknown>>>) =>
  Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.map((row) => ({ ...row }))]))

export const cloneColumns = (columns: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value.slice()]))

export const columnsByTableRows = (rows: Record<string, Array<Record<string, unknown>>>) =>
  cloneColumns(Object.fromEntries(Object.entries(rows).map(([key, rowValues]) => [key, columnsForRows(rowValues)])))

export const cloneDdlEntries = <T extends { ddl: string; error?: { code: string; message: string } }>(entries: Record<string, T>) =>
  Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { ddl: value.ddl, error: value.error ? { ...value.error } : undefined }])) as Record<
    string,
    T
  >

const normalizeFilterValue = (value: unknown) => {
  if (value === null || value === undefined) return null
  return String(value)
}

const matchesFilter = (value: unknown, filter: DatabaseColumnFilter) => {
  const normalized = normalizeFilterValue(value)
  if (filter.operator === 'isnull') return normalized === null
  if (filter.operator === 'notnull') return normalized !== null
  if (normalized === null) return false
  if (filter.operator === 'like') return normalized.toLowerCase().includes(String(filter.value ?? '').toLowerCase())
  if (filter.operator === 'eq') return normalized === String(filter.value ?? '')
  if (filter.operator === 'neq') return normalized !== String(filter.value ?? '')
  if (filter.operator === 'in') return (filter.values ?? []).map(String).includes(normalized)
  return true
}

export function parseWhereRaw(whereRaw: string | null | undefined): DatabaseColumnFilter[] {
  const raw = trim(whereRaw)
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [
    {
      column: match[1],
      operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq',
      value: match[3]
    }
  ]
}

export const filterRows = (rows: Array<Record<string, unknown>>, filters: DatabaseColumnFilter[]) => {
  if (!filters.length) return rows
  return rows.filter((row) => filters.every((filter) => matchesFilter(row[filter.column], filter)))
}

export const sortRows = (rows: Array<Record<string, unknown>>, sort: DatabaseColumnSort | null | undefined) => {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[sort.column]
    const bv = b[sort.column]
    const factor = sort.direction === 'asc' ? 1 : -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor
  })
}

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

export function parseOrderByRaw(orderByRaw: string | null | undefined, knownColumns: string[]): DatabaseColumnSort | null {
  const raw = trim(orderByRaw).replace(/^order\s+by\s+/i, '')
  if (!raw) return null
  const knownColumnMap = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const first = raw.split(',')[0]?.trim() || ''
  const match = first.match(
    /^((?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*))*)(?:\s+(asc|desc))?/i
  )
  if (!match) return null
  const column = normalizeOrderByIdentifier(match[1])
  const knownColumn = knownColumnMap.get(column.toLowerCase())
  if (!knownColumn) return null
  return { column: knownColumn, direction: match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
}

export const rowKeyFor = (row: Record<string, unknown>, primaryKey: string[], index: number) => {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((column) => row[column] ?? null))
}

export const applySeedTableMutation = (
  rowsByKey: Record<string, Array<Record<string, unknown>>>,
  columnsByKey: Record<string, string[]>,
  ddlByKey: Record<string, unknown>,
  key: string,
  mutations: DatabaseTableMutationInput['mutations']
) => {
  const rows = rowsByKey[key]
  let affected = 0

  mutations.forEach((mutation) => {
    if (mutation.kind === 'drop') {
      affected += rows.length
      delete rowsByKey[key]
      delete columnsByKey[key]
      delete ddlByKey[key]
      return
    }
    if (mutation.kind === 'truncate') {
      affected += rows.length
      rows.splice(0, rows.length)
      return
    }
    if (mutation.kind === 'insert') {
      rows.push({ ...mutation.values })
      affected += 1
      return
    }

    const index = rows.findIndex((row, rowIndex) => rowKeyFor(row, mutation.primaryKey, rowIndex) === mutation.rowKey)
    if (index < 0) return

    if (mutation.kind === 'delete') {
      rows.splice(index, 1)
      affected += 1
      return
    }

    rows[index] = { ...rows[index], ...mutation.patch }
    affected += 1
  })

  return affected
}
