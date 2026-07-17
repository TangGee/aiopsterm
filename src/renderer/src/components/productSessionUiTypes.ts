import type { ProductSessionSurface } from '@shared/contracts/productSessions'

export type ProductSessionUiAction = 'create' | 'focus' | 'restore'

export type ProductSessionUiRequestInput = {
  action: ProductSessionUiAction
  surface: ProductSessionSurface
  sessionId?: string
}

export type ProductSessionUiRequest = ProductSessionUiRequestInput & {
  sequence: number
}
