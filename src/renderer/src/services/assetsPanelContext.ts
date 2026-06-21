import { inject, provide, type InjectionKey } from 'vue'
import type { useAssetsPanelRuntime } from '@/services/assetsPanelRuntime'

export type AssetsPanelRuntimeContext = ReturnType<typeof useAssetsPanelRuntime>

const assetsPanelRuntimeKey: InjectionKey<AssetsPanelRuntimeContext> = Symbol('AssetsPanelRuntime')

export function provideAssetsPanelRuntime(runtime: AssetsPanelRuntimeContext) {
  provide(assetsPanelRuntimeKey, runtime)
}

export function useAssetsPanelRuntimeContext() {
  const runtime = inject(assetsPanelRuntimeKey)
  if (!runtime) throw new Error('AssetsPanel runtime context is missing.')
  return runtime
}
