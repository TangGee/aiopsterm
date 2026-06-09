import { generateKeyPairSync } from 'crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { AgentProtocol, type BaseAgent, type ConnectConfig, type ParsedKey } from 'ssh2'

type DestroyableReadWriteStream = NodeJS.ReadWriteStream & { destroy?: () => void }

type SshAgentRuntimeConfig = {
  terminal?: { sshAgentsStatus?: boolean } | null
  sshAgentKeys?: Array<{ id: string; keyChainId: string; fingerprint: string; comment: string; keyType: string }> | null
}
type ConfiguredSshAgentAuth = {
  agent: BaseAgent<ParsedKey>
  keyCount: number
  keyChainIds: string[]
}

let createConfiguredSshAgentAuth: (
  config: SshAgentRuntimeConfig | null | undefined,
  resolveSecret: (keyChainId: string) => { privateKey?: string; passphrase?: string }
) => ConfiguredSshAgentAuth | null
let applyConfiguredSshAgentAuth: (
  connectConfig: Pick<ConnectConfig, 'agent' | 'agentForward'>,
  config: SshAgentRuntimeConfig | null | undefined,
  resolveSecret: (keyChainId: string) => { privateKey?: string; passphrase?: string },
  options?: { enableForward?: boolean; overrideExistingAgent?: boolean }
) => ConfiguredSshAgentAuth | null

const createPrivateKey = () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  })
  return privateKey
}

const getIdentities = (agent: BaseAgent<ParsedKey>) =>
  new Promise<ParsedKey[]>((resolve, reject) => {
    agent.getIdentities((error, keys) => {
      if (error) reject(error)
      else resolve((keys || []).filter((key): key is ParsedKey => typeof key === 'object' && key !== null && 'verify' in key && typeof key.verify === 'function'))
    })
  })

const signWithAgent = (agent: BaseAgent<ParsedKey>, key: ParsedKey, data: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    agent.sign(key, data, { hash: 'sha256' }, (error, signature) => {
      if (error || !signature) reject(error || new Error('signature missing'))
      else resolve(signature)
    })
  })

describe('configured SSH Agent backend runtime', () => {
  beforeAll(async () => {
    const modulePath = '../src/main/backend/sshAgent'
    const backend = await import(modulePath)
    createConfiguredSshAgentAuth = backend.createConfiguredSshAgentAuth
    applyConfiguredSshAgentAuth = backend.applyConfiguredSshAgentAuth
  })

  it('loads enabled KeyChain private keys into a backend-owned ssh2 agent', async () => {
    const privateKey = createPrivateKey()
    const auth = createConfiguredSshAgentAuth(
      {
        terminal: { sshAgentsStatus: true },
        sshAgentKeys: [
          { id: 'agent-key-1', keyChainId: 'key-agent-1', fingerprint: 'SHA256:unit', comment: 'unit-agent', keyType: 'RSA' },
          { id: 'duplicate', keyChainId: 'key-agent-1', fingerprint: 'SHA256:duplicate', comment: 'duplicate', keyType: 'RSA' },
          { id: 'missing-secret', keyChainId: 'missing-secret', fingerprint: 'SHA256:missing', comment: 'missing', keyType: 'RSA' }
        ]
      },
      (keyChainId) => (keyChainId === 'key-agent-1' ? { privateKey } : {})
    )

    expect(auth).toMatchObject({ keyCount: 1, keyChainIds: ['key-agent-1'] })
    const identities = await getIdentities(auth!.agent)
    expect(identities).toHaveLength(1)
    expect(identities[0].isPrivateKey()).toBe(false)

    const data = Buffer.from('aiopsterm ssh agent signing')
    const signature = await signWithAgent(auth!.agent, identities[0], data)
    expect(identities[0].verify(data, signature, 'sha256')).toBe(true)
  })

  it('exposes a forwarding stream backed by the configured main-process agent', async () => {
    const privateKey = createPrivateKey()
    const auth = createConfiguredSshAgentAuth(
      {
        terminal: { sshAgentsStatus: true },
        sshAgentKeys: [{ id: 'agent-key-forward', keyChainId: 'key-agent-forward', fingerprint: 'SHA256:forward', comment: 'forward', keyType: 'RSA' }]
      },
      () => ({ privateKey })
    )
    const stream = await new Promise<DestroyableReadWriteStream>((resolve, reject) => {
      auth!.agent.getStream!((error, agentStream) => {
        if (error || !agentStream) reject(error || new Error('agent stream missing'))
        else resolve(agentStream as DestroyableReadWriteStream)
      })
    })
    const client = new AgentProtocol(true)
    client.pipe(stream).pipe(client)

    const identities = await new Promise<ParsedKey[]>((resolve, reject) => {
      client.getIdentities((error, keys) => {
        if (error) reject(error)
        else resolve(keys || [])
      })
    })
    const data = Buffer.from('aiopsterm forwarded ssh agent signing')
    const signature = await new Promise<Buffer>((resolve, reject) => {
      client.sign(identities[0], data, { hash: 'sha256' }, (error, signed) => {
        if (error || !signed) reject(error || new Error('forwarded signature missing'))
        else resolve(signed)
      })
    })

    expect(identities).toHaveLength(1)
    expect(identities[0].verify(data, signature, 'sha256')).toBe(true)
    client.destroy()
    stream.destroy?.()
  })

  it('applies configured agent auth and forwarding without overriding an existing agent', () => {
    const privateKey = createPrivateKey()
    const connectConfig: Pick<ConnectConfig, 'agent' | 'agentForward'> = {}
    const applied = applyConfiguredSshAgentAuth(
      connectConfig,
      {
        terminal: { sshAgentsStatus: true },
        sshAgentKeys: [{ id: 'agent-key-connect', keyChainId: 'key-agent-connect', fingerprint: 'SHA256:connect', comment: 'connect', keyType: 'RSA' }]
      },
      () => ({ privateKey }),
      { enableForward: true }
    )

    expect(applied?.keyChainIds).toEqual(['key-agent-connect'])
    expect(connectConfig.agent).toEqual(applied?.agent)
    expect(connectConfig.agentForward).toBe(true)

    const existingAgent = { existing: true }
    const unchanged = applyConfiguredSshAgentAuth(
      { agent: existingAgent as never },
      { terminal: { sshAgentsStatus: true }, sshAgentKeys: [{ id: 'next', keyChainId: 'next', fingerprint: 'SHA256:next', comment: 'next', keyType: 'RSA' }] },
      () => ({ privateKey }),
      { enableForward: true }
    )
    expect(unchanged).toBeNull()
  })
})
