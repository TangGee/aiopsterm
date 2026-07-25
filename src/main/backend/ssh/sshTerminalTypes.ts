import type { ClientChannel, ConnectConfig } from 'ssh2'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type {
  TerminalDisconnectReason,
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'
import type { createSshProxySocketForAsset } from './sshProxy'
import type { SshTerminalConnectionTarget } from '../terminal/terminal'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from '../terminal/terminal'

export type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
}

type SshTerminalAsset = Partial<
  Pick<
    AiopsAssetRecord,
    | 'id'
    | 'name'
    | 'title'
    | 'host'
    | 'username'
    | 'port'
    | 'asset_type'
    | 'organizationId'
    | 'group_name'
    | 'auth_type'
    | 'needProxy'
    | 'proxyName'
    | 'keychainId'
    | 'jumpHostId'
  >
>

export type SshTerminalTarget = SshTerminalConnectionTarget & {
  asset?: SshTerminalAsset | null
  password?: string
  privateKey?: string
  passphrase?: string
}

export type SshTerminalSession = {
  write(data: string | Buffer): void
  runBackgroundCommand?(options: TerminalBackgroundCommandOptions): Promise<TerminalBackgroundCommandResult>
  resize(cols: number, rows: number): void
  kill(reason?: TerminalDisconnectReason): void
  pause?(): void
  resume?(): void
}

export type SshTerminalChannel = ClientChannel

export type SshTerminalClient = {
  on(event: 'ready', listener: () => void): SshTerminalClient
  on(event: 'error', listener: (error: Error) => void): SshTerminalClient
  on(event: 'close' | 'end', listener: () => void): SshTerminalClient
  off?(event: 'error', listener: (error: Error) => void): SshTerminalClient
  off?(event: 'close' | 'end', listener: () => void): SshTerminalClient
  on(
    event: 'keyboard-interactive',
    listener: (
      name: string,
      instructions: string,
      instructionsLang: string,
      prompts: TerminalKeyboardInteractivePrompt[],
      finish: (responses: string[]) => void
    ) => void
  ): SshTerminalClient
  connect(config: ConnectConfig): unknown
  exec?(command: string, callback: (error: Error | undefined, stream: SshTerminalChannel) => void): unknown
  shell(options: Record<string, unknown>, callback: (error: Error | undefined, stream: SshTerminalChannel) => void): unknown
  forwardOut?(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (error: Error | undefined, stream: SshTerminalChannel) => void
  ): unknown
  end(): unknown
}

export type SshAuthScope = 'target' | 'jump'

export class SshJumpForwardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshJumpForwardError'
  }
}

export type SshTerminalPtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

export type SshTerminalPtyRuntime = {
  spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): SshTerminalPtyProcess
}

export type SshTerminalWritable = {
  write(data: string | Buffer): unknown
  close?: () => unknown
  setWindow?: (...args: number[]) => void
  pause?: () => unknown
  resume?: () => unknown
}

export type SshTerminalSsh2Runtime = {
  Client: new () => SshTerminalClient
}

export type SshTerminalRuntimeUserConfig = {
  sshProxyConfigs?: SshProxyConfig[]
  sshAgentKeys?: UserConfig['sshAgentKeys']
  terminal?: Partial<NonNullable<UserConfig['terminal']>> | null
}

export type SshTerminalRuntimeConfig = {
  getConfig?: () => SshTerminalRuntimeUserConfig
  getAsset?: (id: string) => AiopsAssetRecord | null
  getAssetSecret?: (id: string) => AssetSecret
  getKeychainSecret?: (id: string) => AssetSecret
  ssh2Runtime?: SshTerminalSsh2Runtime | null
  createSshProxySocketForAsset?: typeof createSshProxySocketForAsset
  rememberAssetPassword?: (assetId: string, password: string) => void | Promise<void>
  loadPty?: () => SshTerminalPtyRuntime | null
  getEnv?: () => NodeJS.ProcessEnv
  getSshControlDir?: () => string
  useBackendDouble?: boolean
  readyTimeoutMs?: number
  keepaliveIntervalMs?: number
}

export type SshTerminalEventSink = {
  lifecycle: (event: TerminalLifecycleEvent) => void
  exit: (event: TerminalLifecycleEvent, code?: number | null) => void
  data: (chunk: string | Buffer) => void
  keyboardInteractive?: (request: TerminalKeyboardInteractiveRequest) => Promise<string[] | TerminalKeyboardInteractiveResponse>
  keyboardInteractiveResult?: (result: TerminalKeyboardInteractiveResult) => void
  closed?: (id: string) => void
}

export type SshTerminalCreateResult = {
  shell: 'ssh'
  cwd: string
  session: SshTerminalSession | null
  connection: SshTerminalTarget
  lifecycle: TerminalLifecycleEvent
}
