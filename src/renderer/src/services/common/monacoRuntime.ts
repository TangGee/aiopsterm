import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

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
