import type { DatabaseExportInput } from './preload'

const fileNameDatePart = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const sanitizeFilePart = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
  return normalized || 'database-export'
}

export const sanitizeDatabaseExportFileName = (input: Pick<DatabaseExportInput, 'title' | 'kind'>, date = new Date()) =>
  `${sanitizeFilePart(input.title || input.kind)}-${fileNameDatePart(date)}.csv`

const stringifyCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const csvEscape = (value: unknown) => {
  const text = stringifyCell(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

const metadataRows = (input: DatabaseExportInput) => {
  const metadata = input.metadata || {}
  return [
    ['# aiopsterm database export'],
    ['# kind', input.kind],
    metadata.connectionName ? ['# connection', metadata.connectionName] : null,
    metadata.databaseName ? ['# database', metadata.databaseName] : null,
    metadata.schemaName ? ['# schema', metadata.schemaName] : null,
    metadata.tableName ? ['# table', metadata.tableName] : null,
    metadata.sql ? ['# sql', metadata.sql] : null,
    typeof metadata.page === 'number' ? ['# page', String(metadata.page)] : null,
    typeof metadata.pageSize === 'number' ? ['# pageSize', String(metadata.pageSize)] : null,
    metadata.total === null || typeof metadata.total === 'number' ? ['# total', metadata.total === null ? '' : String(metadata.total)] : null
  ].filter((row): row is string[] => Array.isArray(row))
}

export const buildDatabaseExportCsv = (input: DatabaseExportInput) => {
  const columns = Array.isArray(input.columns) ? input.columns.filter((column) => typeof column === 'string' && column.trim()) : []
  const rows = Array.isArray(input.rows) ? input.rows : []
  const header = columns.map(csvEscape).join(',')
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))
  const metadata = metadataRows(input).map((row) => row.map(csvEscape).join(','))
  return [...metadata, header, ...body].join('\n') + '\n'
}
