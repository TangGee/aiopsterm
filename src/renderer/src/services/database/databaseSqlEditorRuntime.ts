export type TextRange = { start: number; end: number }

export function firstStatement(sql: string) {
  return (
    sql
      .split(';')
      .map((item) => item.trim())
      .find(Boolean) || ''
  )
}

export function sqlCursorPosition(text: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, clamped)
  const line = before ? before.split('\n').length : 1
  const lastBreak = before.lastIndexOf('\n')
  return { line, column: clamped - lastBreak }
}

export function findSqlTextMatches(text: string, query: string, caseSensitive: boolean): TextRange[] {
  if (!query) return []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: TextRange[] = []
  let cursor = 0
  while (cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break
    matches.push({ start: index, end: index + query.length })
    cursor = index + Math.max(1, query.length)
  }
  return matches
}

export function firstSqlFindMatchAtOrAfter(offset: number, matches: TextRange[]) {
  const index = matches.findIndex((match) => match.start >= offset)
  return index >= 0 ? index : 0
}

export function currentSqlStatement(sql: string, cursorOffset: number) {
  const range = currentSqlStatementRange(sql, cursorOffset)
  return sql.slice(range.start, range.end).trim()
}

export function currentSqlStatementRange(sql: string, cursorOffset: number): TextRange {
  const offset = Math.max(0, Math.min(cursorOffset, sql.length))
  let start = 0
  let end = sql.length
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== ';') continue
    if (index < offset) start = index + 1
    else {
      end = index
      break
    }
  }
  while (start < end && /\s/.test(sql[start])) start += 1
  while (end > start && /\s/.test(sql[end - 1])) end -= 1
  return { start, end }
}

export function formatSqlText(sql: string) {
  const normalized = sql
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, ';\n\n')
    .trim()
  const clauses = ['select', 'from', 'where', 'group by', 'having', 'order by', 'limit', 'offset', 'values', 'set', 'returning']
  let formatted = normalized
  clauses.forEach((clause) => {
    const keyword = clause.toUpperCase()
    const pattern = new RegExp(`\\b${clause.replace(' ', '\\s+')}\\b`, 'gi')
    formatted = formatted.replace(pattern, `\n${keyword}`)
  })
  formatted = formatted
    .replace(/^\n/, '')
    .replace(/\s*,\s*/g, ',\n  ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\nSELECT\s+/g, '\nSELECT\n  ')
    .replace(/^SELECT\s+/, 'SELECT\n  ')
    .replace(/\nFROM\s+/g, '\nFROM\n  ')
    .replace(/\nWHERE\s+/g, '\nWHERE\n  ')
    .replace(/\nGROUP BY\s+/g, '\nGROUP BY\n  ')
    .replace(/\nORDER BY\s+/g, '\nORDER BY\n  ')
    .replace(/\nLIMIT\s+/g, '\nLIMIT ')
    .replace(/\nOFFSET\s+/g, '\nOFFSET ')
    .replace(/\n\n+/g, '\n\n')
    .trim()
  return formatted.endsWith(';') ? formatted : `${formatted};`
}

export function stripLeadingSqlComments(sql: string) {
  let next = sql.trim()
  let changed = true
  while (changed) {
    changed = false
    const before = next
    next = next.replace(/^--[^\n]*(?:\n|$)/, '').replace(/^\/\*[\s\S]*?\*\//, '').trimStart()
    changed = next !== before
  }
  return next
}

export function isReadOnlySql(sql: string) {
  const cleaned = stripLeadingSqlComments(sql).trim()
  if (!/^(select|with|explain)\b/i.test(cleaned)) return false
  return !/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|execute)\b/i.test(cleaned)
}

export function extractSql(text: string) {
  const match = text.match(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql|clickhouse|presto)?\s*\n([\s\S]*?)```/i)
  return match?.[1].trim() ?? text
}
