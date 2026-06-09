import type {
  AgentInboundRequest,
  AgentProtocol,
  BaseAgent,
  ConnectConfig,
  GetStreamCallback,
  IdentityCallback,
  ParsedKey,
  SignCallback,
  SigningRequestOptions
} from 'ssh2'
import type { SshAgentKeyConfig, TerminalUserConfig } from '@shared/preload'

export type SshAgentRuntimeConfig = {
  terminal?: Partial<Pick<TerminalUserConfig, 'sshAgentsStatus'>> | null
  sshAgentKeys?: SshAgentKeyConfig[] | null
}

export type SshAgentKeySecret = {
  privateKey?: string
  passphrase?: string
}

export type SshAgentKeySecretResolver = (keyChainId: string) => SshAgentKeySecret

export type ConfiguredSshAgentAuth = {
  agent: BaseAgent<ParsedKey>
  keyCount: number
  keyChainIds: string[]
}

type Ssh2AgentRuntime = typeof import('ssh2')

type ResolvedSshAgentKey = {
  keyChainId: string
  comment: string
  privateKey: ParsedKey
  publicKey: ParsedKey
}

const loadSsh2AgentRuntime = (): Ssh2AgentRuntime | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ssh2') as Ssh2AgentRuntime
  } catch {
    return null
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const enabledSshAgentKeyConfigs = (config?: SshAgentRuntimeConfig | null) => {
  if (!config?.terminal?.sshAgentsStatus || !Array.isArray(config.sshAgentKeys)) return []
  const seen = new Set<string>()
  return config.sshAgentKeys.filter((key) => {
    const keyChainId = text(key?.keyChainId) || text(key?.id)
    if (!keyChainId || seen.has(keyChainId)) return false
    seen.add(keyChainId)
    return true
  })
}

const asParsedKeys = (parsed: ParsedKey | ParsedKey[] | Error) => {
  if (parsed instanceof Error) return []
  return Array.isArray(parsed) ? parsed : [parsed]
}

const parseConfiguredSshAgentKeys = (
  runtime: Ssh2AgentRuntime,
  config: SshAgentRuntimeConfig | null | undefined,
  resolveSecret: SshAgentKeySecretResolver
): ResolvedSshAgentKey[] => {
  return enabledSshAgentKeyConfigs(config)
    .map((keyConfig): ResolvedSshAgentKey | null => {
      const keyChainId = text(keyConfig.keyChainId) || text(keyConfig.id)
      const secret = resolveSecret(keyChainId)
      const privateKeyData = text(secret.privateKey)
      if (!privateKeyData) return null
      const parsed = asParsedKeys(runtime.utils.parseKey(privateKeyData, text(secret.passphrase) || undefined) as ParsedKey | ParsedKey[] | Error)
      const privateKey = parsed.find((key) => typeof key.isPrivateKey === 'function' && key.isPrivateKey())
      if (!privateKey) return null
      const publicKey = runtime.utils.parseKey(privateKey.getPublicSSH())
      if (publicKey instanceof Error || Array.isArray(publicKey)) return null
      return {
        keyChainId,
        comment: text(keyConfig.comment) || keyChainId,
        privateKey,
        publicKey
      }
    })
    .filter(Boolean) as ResolvedSshAgentKey[]
}

const createAgentClass = (runtime: Ssh2AgentRuntime, keys: ResolvedSshAgentKey[]) => {
  class AiopstermConfiguredSshAgent extends runtime.BaseAgent<ParsedKey> {
    getIdentities(callback: IdentityCallback<ParsedKey>): void {
      callback(null, keys.map((key) => key.publicKey))
    }

    sign(pubKey: ParsedKey, data: Buffer, options: SigningRequestOptions, callback?: SignCallback): void
    sign(pubKey: ParsedKey, data: Buffer, callback: SignCallback): void
    sign(pubKey: ParsedKey, data: Buffer, options: SigningRequestOptions | SignCallback, callback?: SignCallback): void {
      const signCallback = typeof options === 'function' ? options : callback
      const signOptions = typeof options === 'function' ? {} : options || {}
      if (typeof signCallback !== 'function') throw new Error('SSH Agent sign callback is required')
      const key = keys.find((candidate) => candidate.publicKey.equals(pubKey) || candidate.privateKey.equals(pubKey))
      if (!key) {
        signCallback(new Error('SSH Agent key not found'))
        return
      }
      const signature = key.privateKey.sign(data, signOptions.hash)
      if (signature instanceof Error) {
        signCallback(signature)
        return
      }
      signCallback(null, signature)
    }

    getStream(callback: GetStreamCallback): void {
      const protocol = new runtime.AgentProtocol(false)
      protocol.on('identities', (request: AgentInboundRequest) => {
        protocol.getIdentitiesReply(request, keys.map((key) => key.publicKey))
      })
      protocol.on('sign', (request: AgentInboundRequest, pubKey: ParsedKey, data: Buffer, options: SigningRequestOptions) => {
        this.sign(pubKey, data, options, (error, signature) => {
          if (error || !signature) {
            protocol.failureReply(request)
            return
          }
          protocol.signReply(request, signature)
        })
      })
      callback(null, protocol as AgentProtocol)
    }
  }
  return new AiopstermConfiguredSshAgent()
}

export const createConfiguredSshAgentAuth = (
  config: SshAgentRuntimeConfig | null | undefined,
  resolveSecret: SshAgentKeySecretResolver
): ConfiguredSshAgentAuth | null => {
  const runtime = loadSsh2AgentRuntime()
  if (!runtime) return null
  const keys = parseConfiguredSshAgentKeys(runtime, config, resolveSecret)
  if (!keys.length) return null
  return {
    agent: createAgentClass(runtime, keys),
    keyCount: keys.length,
    keyChainIds: keys.map((key) => key.keyChainId)
  }
}

export const applyConfiguredSshAgentAuth = (
  connectConfig: Pick<ConnectConfig, 'agent' | 'agentForward'>,
  config: SshAgentRuntimeConfig | null | undefined,
  resolveSecret: SshAgentKeySecretResolver,
  options: { enableForward?: boolean; overrideExistingAgent?: boolean } = {}
) => {
  if (connectConfig.agent && !options.overrideExistingAgent) return null
  const auth = createConfiguredSshAgentAuth(config, resolveSecret)
  if (!auth) return null
  connectConfig.agent = auth.agent
  if (options.enableForward) connectConfig.agentForward = true
  return auth
}
