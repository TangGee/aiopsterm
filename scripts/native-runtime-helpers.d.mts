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

export const electronHeadersUrl: (env: Record<string, string | undefined>) => string
export const electronRebuildInvocation: (options: {
  cliPath: string
  modules: string[]
  electronVersion: string
  headersUrl: string
}) => { commandArgs: string[] }
export const npmRebuildInvocation: (options: {
  platform: string
  nodeExecutable: string
  npmExecPath?: string
  modules: string[]
}) => { command: string; args: string[] }
export const shouldRebuildPty: (options: {
  force: boolean
  target: string
  runtime: string
  probeStatus: number | null
}) => boolean
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
