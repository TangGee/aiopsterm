import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

export const createBridgeMethod = <Bridge extends Partial<AiopsPreloadApi>>() => {
  return <Name extends keyof Bridge>(name: Name): Bridge[Name] | undefined => {
    const aiops = window.aiops
    const method = aiops?.[name as keyof AiopsPreloadApi]
    return typeof method === 'function' ? (method.bind(aiops) as Bridge[Name]) : undefined
  }
}
