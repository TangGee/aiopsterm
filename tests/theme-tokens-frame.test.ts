import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { themeCssVariables, themePresets } from '@/services/app/themeRuntime'

// app-shell-tokens-frame.less 的 :root 静态块是主题变量在 JS 注入前的兜底值,
// 它必须与 themeRuntime 生成的 dark 主题保持逐字节一致,否则会出现两份事实来源漂移。
const tokensFramePath = resolve(__dirname, '../src/renderer/src/styles/app-shell-tokens-frame.less')

const parseRootBlock = () => {
  const source = readFileSync(tokensFramePath, 'utf8')
  const start = source.indexOf(':root {')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  const variables: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = line.match(/^\s{2}(--[a-z0-9-]+):\s*(.+);$/)
    if (match) variables[match[1]] = match[2]
  }
  return variables
}

describe('app-shell-tokens-frame :root defaults', () => {
  const rootVars = parseRootBlock()
  const darkVars = themeCssVariables(themePresets.dark)

  it('matches every generated dark theme variable literally', () => {
    for (const [key, value] of Object.entries(rootVars)) {
      if (!key.startsWith('--theme-')) continue
      if (key.startsWith('--theme-terminal-active-')) continue
      if (key.startsWith('--theme-module-active-')) continue
      expect(darkVars[key], `:root 中的 ${key} 与 themeRuntime 生成值漂移`).toBe(value)
    }
  })

  it('does not define stale variables that the runtime no longer generates', () => {
    for (const key of Object.keys(rootVars)) {
      if (!key.startsWith('--theme-')) continue
      if (key.startsWith('--theme-terminal-active-')) continue
      if (key.startsWith('--theme-module-active-')) continue
      expect(darkVars[key], `:root 中的 ${key} 已不在 themeRuntime 输出中`).toBeDefined()
    }
  })

  it('maps every terminal-active default onto its base variable', () => {
    for (const [key, value] of Object.entries(rootVars)) {
      if (!key.startsWith('--theme-terminal-active-')) continue
      const baseKey = key.replace('--theme-terminal-active-', '--theme-terminal-base-')
      expect(value).toBe(`var(${baseKey})`)
      expect(darkVars[baseKey], `terminal-active 映射目标 ${baseKey} 不存在`).toBeDefined()
    }
  })

  it('keeps module-active fallbacks aligned with the dark workspace base layer', () => {
    const workspace = themePresets.dark.modules.workspace
    const kebab = (value: string) => value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    const expected: Record<string, string> = {}
    const { base, withBackground, ...plain } = workspace
    void withBackground
    for (const [key, value] of Object.entries(base)) expected[`--theme-module-active-${kebab(key)}`] = value
    for (const [key, value] of Object.entries(plain)) {
      if (typeof value === 'string') expected[`--theme-module-active-${kebab(key)}`] = value
    }
    for (const [key, value] of Object.entries(rootVars)) {
      if (!key.startsWith('--theme-module-active-')) continue
      expect(expected[key], `:root 中的 ${key} 与 dark workspace base 层漂移`).toBe(value)
    }
  })
})
