export type AiopsMutationResult<T> = {
  ok: boolean
  data?: T
  errorCode?: string
  errorMessage?: string
}
