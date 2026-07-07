import hljs from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// 只注册运维场景常用语言，禁止回退到 highlight.js 全量构建；
// ini 自带 toml 别名，xml 自带 html 别名，bash 自带 sh/zsh 别名。
const registeredLanguages: Array<[string, LanguageFn]> = [
  ['bash', bash],
  ['c', c],
  ['cpp', cpp],
  ['css', css],
  ['diff', diff],
  ['dockerfile', dockerfile],
  ['go', go],
  ['ini', ini],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['markdown', markdown],
  ['plaintext', plaintext],
  ['python', python],
  ['rust', rust],
  ['shell', shell],
  ['sql', sql],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml]
]

for (const [name, language] of registeredLanguages) {
  hljs.registerLanguage(name, language)
}

export const highlightAutoLanguageSubset = registeredLanguages.map(([name]) => name)

// 无 language 标注的大代码块跳过自动探测，避免同步阻塞渲染线程
export const highlightAutoLineLimit = 500

// 仅在已注册语言子集内做自动探测；超过行数上限返回 null，由调用方按纯文本处理
export const highlightAutoValue = (code: string): string | null => {
  if (code.split('\n').length > highlightAutoLineLimit) return null
  return hljs.highlightAuto(code, highlightAutoLanguageSubset).value
}

export { hljs }
