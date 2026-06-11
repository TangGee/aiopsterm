import { writeFile } from 'fs/promises'
import type { DatabaseExportInput, DatabaseExportResult } from '@shared/preload'
import { buildDatabaseExportCsv, sanitizeDatabaseExportFileName } from '@shared/databaseExport'

type DatabaseExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<void>
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
    if (saveResult?.canceled || !saveResult?.filePath) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    const csv = buildDatabaseExportCsv(normalizedInput)
    await (runtime.writeFile || writeFile)(saveResult.filePath, csv, 'utf-8')
    return {
      ok: true,
      data: {
        exported: rows.length,
        fileName,
        filePath: saveResult.filePath,
        csv
      }
    }
  } catch (error) {
    return databaseExportErrorResult(error)
  }
}
