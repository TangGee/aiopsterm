import { inject, provide, type InjectionKey } from 'vue'
import type { useAiPanelContainerRuntime } from '@/services/ai/aiPanelContainerRuntime'

export type AiPanelRuntimeContext = ReturnType<typeof useAiPanelContainerRuntime>

const aiPanelRuntimeKey: InjectionKey<AiPanelRuntimeContext> = Symbol('AiPanelRuntime')

export function provideAiPanelRuntime(runtime: AiPanelRuntimeContext) {
  provide(aiPanelRuntimeKey, runtime)
}

export function useAiPanelRuntimeContext() {
  const runtime = inject(aiPanelRuntimeKey)
  if (!runtime) throw new Error('AiPanel runtime context is missing.')
  return runtime
}
