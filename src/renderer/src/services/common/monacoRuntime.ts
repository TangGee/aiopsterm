import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'

export type MonacoModule = typeof import('monaco-editor/esm/vs/editor/editor.api')
export type MonacoLanguageRegistration = {
  id: string
  extensions?: string[]
  filenames?: string[]
  filenamePatterns?: string[]
  firstLine?: string
}

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker?: (_moduleId: string, label: string) => Worker
  }
}

export const ensureMonacoEnvironment = () => {
  const monacoGlobal = globalThis as MonacoGlobal
  monacoGlobal.MonacoEnvironment = {
    ...monacoGlobal.MonacoEnvironment,
    getWorker(_moduleId: string, label: string) {
      return label === 'json' ? new jsonWorker() : new editorWorker()
    }
  }
}

let monacoPromise: Promise<MonacoModule> | null = null

const basename = (filePath: string) => filePath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || ''
const escapeRegExp = (value: string) => value.replace(/[|\\{}()[\]^$+.]/g, '\\$&')

const filenamePatternMatches = (pattern: string, filename: string) => {
  const expression = escapeRegExp(pattern)
    .replaceAll('*', '.*')
    .replaceAll('?', '.')
  try {
    return new RegExp(`^${expression}$`, 'i').test(filename)
  } catch {
    return false
  }
}

export const resolveMonacoLanguageId = (
  registrations: MonacoLanguageRegistration[],
  filePath: string,
  content = ''
) => {
  const filename = basename(filePath)
  const normalizedFilename = filename.toLowerCase()
  const byFilename = registrations.find((language) =>
    language.filenames?.some((candidate) => candidate.toLowerCase() === normalizedFilename)
  )
  if (byFilename) return byFilename.id

  const byPattern = registrations.find((language) =>
    language.filenamePatterns?.some((pattern) => filenamePatternMatches(pattern, filename))
  )
  if (byPattern) return byPattern.id

  const extensionMatches = registrations
    .flatMap((language) => (language.extensions || []).map((extension) => ({ id: language.id, extension: extension.toLowerCase() })))
    .filter(({ extension }) => normalizedFilename.endsWith(extension))
    .sort((left, right) => right.extension.length - left.extension.length)
  if (extensionMatches.length) return extensionMatches[0].id

  const firstLine = content.split(/\r?\n/, 1)[0] || ''
  if (firstLine) {
    const byFirstLine = registrations.find((language) => {
      if (!language.firstLine) return false
      try {
        return new RegExp(language.firstLine).test(firstLine)
      } catch {
        return false
      }
    })
    if (byFirstLine) return byFirstLine.id
  }
  return 'plaintext'
}

// monaco 主体与 contrib 全部走动态导入，保证不进入首屏 chunk；模块级 promise 缓存保证只加载一次
export const loadMonaco = (): Promise<MonacoModule> => {
  if (monacoPromise) return monacoPromise
  ensureMonacoEnvironment()
  monacoPromise = Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import('monaco-editor/esm/vs/editor/contrib/folding/browser/folding'),
    import('monaco-editor/esm/vs/editor/contrib/find/browser/findController'),
    import('monaco-editor/esm/vs/language/json/monaco.contribution'),
    import('monaco-editor/esm/vs/basic-languages/monaco.contribution')
  ]).then(([monaco]) => monaco)
  return monacoPromise
}
