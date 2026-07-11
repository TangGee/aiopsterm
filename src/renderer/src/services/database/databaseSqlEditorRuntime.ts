export type TextRange = { start: number; end: number }

export function splitSqlStatements(sql: string) {
  const statements: string[] = []
  let buffer = ''
  let hasSqlToken = false
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' | 'dollar' = 'normal'
  let blockCommentDepth = 0
  let dollarDelimiter = ''

  const pushStatement = () => {
    const statement = buffer.trim()
    if (statement && hasSqlToken) statements.push(statement)
    buffer = ''
    hasSqlToken = false
  }

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1] || ''

    if (state === 'line-comment') {
      buffer += char
      if (char === '\n') state = 'normal'
      continue
    }
    if (state === 'block-comment') {
      buffer += char
      if (char === '/' && next === '*') {
        buffer += next
        blockCommentDepth += 1
        index += 1
      } else if (char === '*' && next === '/') {
        buffer += next
        blockCommentDepth -= 1
        index += 1
        if (blockCommentDepth === 0) state = 'normal'
      }
      continue
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarDelimiter, index)) {
        buffer += dollarDelimiter
        index += dollarDelimiter.length - 1
        state = 'normal'
      } else {
        buffer += char
      }
      continue
    }
    if (state !== 'normal') {
      buffer += char
      if (char === '\\' && next) {
        buffer += next
        index += 1
        continue
      }
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : state === 'backtick' ? '`' : ']'
      if (char !== quote) continue
      if (next === quote) {
        buffer += next
        index += 1
      } else {
        state = 'normal'
      }
      continue
    }

    if (char === '-' && next === '-') {
      buffer += `${char}${next}`
      state = 'line-comment'
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      buffer += `${char}${next}`
      state = 'block-comment'
      blockCommentDepth = 1
      index += 1
      continue
    }
    if (char === '$') {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        buffer += delimiter
        hasSqlToken = true
        dollarDelimiter = delimiter
        state = 'dollar'
        index += delimiter.length - 1
        continue
      }
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      buffer += char
      hasSqlToken = true
      state = char === "'" ? 'single' : char === '"' ? 'double' : char === '`' ? 'backtick' : 'bracket'
      continue
    }
    if (char === ';') {
      pushStatement()
      continue
    }

    buffer += char
    if (!/\s/.test(char)) hasSqlToken = true
  }

  pushStatement()
  return statements
}

export function firstStatement(sql: string) {
  return splitSqlStatements(sql)[0] || ''
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
  return extractFencedSql(text) || text
}

export function extractFencedSql(text: string) {
  const match = text.match(SQL_FENCE_PATTERN)
  return match?.[1].trim() ?? ''
}

export function stripFencedSql(text: string) {
  return text.replace(SQL_FENCE_PATTERN, '').trim()
}

const SQL_FENCE_PATTERN = /```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|mssql|tsql|clickhouse|presto)?[ \t]*\r?\n([\s\S]*?)```/i
