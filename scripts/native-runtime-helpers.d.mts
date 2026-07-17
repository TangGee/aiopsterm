export interface NativeRuntimeLockOwner {
  schemaVersion: 1
  pid: number
  ownerToken: string
  createdAt: number
}

export interface ShadowBindingPathOptions {
  sqliteRoot: string
  nodeVersion: string
  platform: string
  arch: string
  bindingName?: string
}

export interface NativeLockRecoveryOptions {
  lockContents: string
  lockMtimeMs: number
  now: number
  staleAfterMs: number
  isProcessAlive: (pid: number) => boolean
}

export const parseNativeManifest: (raw: string) => Record<string, unknown> | null
export const sanitizeNativeRebuildEnvironment: (
  source: Record<string, string | undefined>
) => Record<string, string | undefined>
export const shadowBindingPaths: (options: ShadowBindingPathOptions) => string[]
export const parseLockOwner: (lockContents: string) => NativeRuntimeLockOwner | null
export const shouldRecoverLock: (options: NativeLockRecoveryOptions) => boolean
export const lockOwnedBy: (lockContents: string, ownerToken: string) => boolean
export const mergeNativeManifest: (options: {
  currentManifest: Record<string, unknown> | null
  base: Record<string, unknown>
  records: Record<string, unknown>
  isRecordValid: (runtime: string, record: unknown) => boolean
}) => Record<string, unknown>
