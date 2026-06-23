import { inject, provide, type InjectionKey } from 'vue'
import type { useKubernetesWorkspaceRuntime } from '@/services/kubernetes/kubernetesWorkspaceRuntime'

export type KubernetesWorkspaceRuntimeContext = ReturnType<typeof useKubernetesWorkspaceRuntime>

const kubernetesWorkspaceRuntimeKey: InjectionKey<KubernetesWorkspaceRuntimeContext> = Symbol('KubernetesWorkspaceRuntime')

export function provideKubernetesWorkspaceRuntime(runtime: KubernetesWorkspaceRuntimeContext) {
  provide(kubernetesWorkspaceRuntimeKey, runtime)
}

export function useKubernetesWorkspaceRuntimeContext() {
  const runtime = inject(kubernetesWorkspaceRuntimeKey)
  if (!runtime) throw new Error('Kubernetes workspace runtime context is missing.')
  return runtime
}
