import { AsyncLocalStorage } from 'async_hooks'

const rendererOwnerContext = new AsyncLocalStorage<number>()

export const withClineAgentRendererOwner = <T>(ownerWebContentsId: number, callback: () => T): T => {
  if (!Number.isSafeInteger(ownerWebContentsId) || ownerWebContentsId <= 0) return callback()
  return rendererOwnerContext.run(ownerWebContentsId, callback)
}

export const currentClineAgentRendererOwner = () => rendererOwnerContext.getStore()
