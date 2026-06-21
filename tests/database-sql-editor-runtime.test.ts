import { describe, expect, it } from 'vitest'
import {
  currentSqlStatement,
  currentSqlStatementRange,
  extractSql,
  findSqlTextMatches,
  firstSqlFindMatchAtOrAfter,
  firstStatement,
  formatSqlText,
  isReadOnlySql,
  sqlCursorPosition,
  stripLeadingSqlComments
} from '@/services/databaseSqlEditorRuntime'

describe('databaseSqlEditorRuntime', () => {
  it('finds SQL matches with cursor wrapping helpers', () => {
    const matches = findSqlTextMatches('select id from orders where id = 1', 'id', false)

    expect(matches).toEqual([
      { start: 7, end: 9 },
      { start: 28, end: 30 }
    ])
    expect(findSqlTextMatches('SELECT select', 'select', true)).toEqual([{ start: 7, end: 13 }])
    expect(firstSqlFindMatchAtOrAfter(8, matches)).toBe(1)
    expect(firstSqlFindMatchAtOrAfter(40, matches)).toBe(0)
  })

  it('derives cursor positions and current statements', () => {
    const sql = 'select 1;\n\nselect * from orders where status = "open";'

    expect(sqlCursorPosition(sql, 12)).toEqual({ line: 3, column: 2 })
    expect(firstStatement(sql)).toBe('select 1')
    expect(currentSqlStatement(sql, sql.length - 1)).toBe('select * from orders where status = "open"')
    expect(currentSqlStatementRange(sql, sql.length - 1)).toEqual({ start: 11, end: sql.length - 1 })
    expect(currentSqlStatement(sql, sql.length)).toBe('')
  })

  it('formats SQL text with stable clause breaks', () => {
    expect(formatSqlText('select id, name from users where active = 1 order by name')).toBe(
      ['SELECT', '  id,', '  name ', 'FROM', '  users ', 'WHERE', '  active = 1 ', 'ORDER BY', '  name;'].join('\n')
    )
  })

  it('extracts fenced SQL and rejects mutating statements for read-only execution', () => {
    expect(extractSql('Reason\n```sql\nselect * from users;\n```')).toBe('select * from users;')
    expect(stripLeadingSqlComments('-- ok\n/* block */\nselect 1')).toBe('select 1')
    expect(isReadOnlySql('-- report\nselect * from users')).toBe(true)
    expect(isReadOnlySql('with rows as (select 1) select * from rows')).toBe(true)
    expect(isReadOnlySql('select * from users; delete from users')).toBe(false)
    expect(isReadOnlySql('update users set active = 0')).toBe(false)
  })
})
