import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ProductSessionBridge = Pick<
  AiopsPreloadApi,
  | 'listProductSessions'
  | 'getProductSession'
  | 'createProductSession'
  | 'updateProductSession'
  | 'deleteProductSession'
  | 'closeProductSession'
  | 'listProductSessionProjectionMessages'
  | 'replaceProductSessionProjectionMessages'
  | 'upsertProductSessionProjectionMessages'
  | 'reviseProductSessionProjectionMessages'
  | 'onProductSessionChanged'
>

const bridgeMethod = createBridgeMethod<ProductSessionBridge>()

export const productSessionClient = {
  list: () => bridgeMethod('listProductSessions'),
  get: () => bridgeMethod('getProductSession'),
  create: () => bridgeMethod('createProductSession'),
  update: () => bridgeMethod('updateProductSession'),
  delete: () => bridgeMethod('deleteProductSession'),
  close: () => bridgeMethod('closeProductSession'),
  listProjectionMessages: () => bridgeMethod('listProductSessionProjectionMessages'),
  replaceProjectionMessages: () => bridgeMethod('replaceProductSessionProjectionMessages'),
  upsertProjectionMessages: () => bridgeMethod('upsertProductSessionProjectionMessages'),
  reviseProjectionMessages: () => bridgeMethod('reviseProductSessionProjectionMessages'),
  onChanged: () => bridgeMethod('onProductSessionChanged')
}
