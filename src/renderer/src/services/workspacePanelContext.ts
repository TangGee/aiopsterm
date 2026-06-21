import { inject, provide, type InjectionKey } from 'vue'
import type { useWorkspacePanelRuntime } from '@/services/workspacePanelRuntime'

export type WorkspacePanelRuntimeContext = ReturnType<typeof useWorkspacePanelRuntime>

const workspacePanelRuntimeKey: InjectionKey<WorkspacePanelRuntimeContext> = Symbol('WorkspacePanelRuntime')

export function provideWorkspacePanelRuntime(runtime: WorkspacePanelRuntimeContext) {
  provide(workspacePanelRuntimeKey, runtime)
}

export function useWorkspacePanelRuntimeContext() {
  const runtime = inject(workspacePanelRuntimeKey)
  if (!runtime) throw new Error('WorkspacePanel runtime context is missing.')
  return runtime
}
