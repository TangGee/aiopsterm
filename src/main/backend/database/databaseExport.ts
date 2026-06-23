import { stat, writeFile } from 'fs/promises'
import { isAbsolute } from 'path'
import type { DatabaseExportInput, DatabaseExportResult } from '@shared/contracts/database'
import { buildDatabaseExportCsv, sanitizeDatabaseExportFileName } from '@shared/databaseExport'

type DatabaseExportWriteResult =
  | void
  | {
      filePath?: string
      bytes?: number
    }

type DatabaseExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<DatabaseExportWriteResult>
  now?: () => Date
}

class DatabaseExportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'DatabaseExportError'
  }
}

const databaseExportErrorResult = (error: unknown): DatabaseExportResult => ({
  ok: false,
  errorCode: error instanceof DatabaseExportError ? error.errorCode : 'DATABASE_EXPORT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Database export failed.')
})

const normalizeRows = (rows: unknown) => (Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row))) : [])

const isWriteMetadata = (value: DatabaseExportWriteResult): value is Exclude<DatabaseExportWriteResult, void> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const exportDatabaseRows = async (input: DatabaseExportInput, runtime: DatabaseExportRuntime): Promise<DatabaseExportResult> => {
  try {
    if (!runtime?.showSaveDialog) throw new DatabaseExportError('DATABASE_EXPORT_SAVE_DIALOG_UNAVAILABLE', 'Database export save dialog is unavailable.')
    const columns = Array.isArray(input?.columns) ? input.columns.filter((column) => typeof column === 'string' && column.trim()) : []
    const rows = normalizeRows(input?.rows)
    if (!columns.length) throw new DatabaseExportError('DATABASE_EXPORT_EMPTY_COLUMNS', 'Database export requires at least one column.')
    if (!rows.length) throw new DatabaseExportError('DATABASE_EXPORT_EMPTY_ROWS', 'Database export requires at least one row.')
    const normalizedInput: DatabaseExportInput = {
      title: input.title || 'Database Export',
      kind: input.kind === 'table-page' ? 'table-page' : 'sql-result',
      columns,
      rows,
      metadata: input.metadata
    }
    const fileName = sanitizeDatabaseExportFileName(normalizedInput, runtime.now?.() || new Date())
    const saveResult = await runtime.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    })
    if (saveResult?.canceled) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const filePath = typeof saveResult.filePath === 'string' ? saveResult.filePath : ''
    if (!filePath.trim() || !isAbsolute(filePath)) {
      throw new DatabaseExportError('DATABASE_EXPORT_SAVE_PATH_INVALID', 'Database export save path must be absolute.')
    }
    const csv = buildDatabaseExportCsv(normalizedInput)
    const expectedBytes = Buffer.byteLength(csv, 'utf8')
    const writeResult = await (runtime.writeFile || writeFile)(filePath, csv, 'utf-8')
    if (isWriteMetadata(writeResult)) {
      if (writeResult.filePath !== filePath) {
        throw new DatabaseExportError('DATABASE_EXPORT_WRITE_CONFIRMATION_INVALID', 'Database export writer returned a different file path.')
      }
      if (writeResult.bytes !== expectedBytes) {
        throw new DatabaseExportError('DATABASE_EXPORT_WRITE_CONFIRMATION_INVALID', 'Database export writer returned an unexpected byte count.')
      }
    }
    let writtenSize = -1
    try {
      writtenSize = (await stat(filePath)).size
    } catch {
      throw new DatabaseExportError('DATABASE_EXPORT_WRITE_CONFIRMATION_INVALID', 'Database export file could not be verified after write.')
    }
    if (writtenSize !== expectedBytes) {
      throw new DatabaseExportError('DATABASE_EXPORT_WRITE_CONFIRMATION_INVALID', 'Database export file size does not match the generated CSV byte count.')
    }
    return {
      ok: true,
      data: {
        exported: rows.length,
        fileName,
        filePath,
        bytes: expectedBytes,
        csv
      }
    }
  } catch (error) {
    return databaseExportErrorResult(error)
  }
}
