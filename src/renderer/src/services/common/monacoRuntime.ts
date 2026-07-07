import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

export type MonacoModule = typeof import('monaco-editor/esm/vs/editor/editor.api')

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

// monaco 主体与 contrib 全部走动态导入，保证不进入首屏 chunk；模块级 promise 缓存保证只加载一次
export const loadMonaco = (): Promise<MonacoModule> => {
  if (monacoPromise) return monacoPromise
  ensureMonacoEnvironment()
  monacoPromise = Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import('monaco-editor/esm/vs/editor/contrib/folding/browser/folding'),
    import('monaco-editor/esm/vs/editor/contrib/find/browser/findController'),
    import('monaco-editor/esm/vs/basic-languages/monaco.contribution')
  ]).then(([monaco]) => monaco)
  return monacoPromise
}
