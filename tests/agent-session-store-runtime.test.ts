import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import type {
  AgentHibernationConfig,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot
} from '../src/shared/contracts/managedAiSessions'

type LoadedAgentSessionStore = {
  sessions: Map<string, ManagedAiSessionRecord>
  agentHibernationConfig: AgentHibernationConfig
}

type AgentSessionStoreRuntime = {
  configure: (userDataPath: string) => Promise<void>
  loadStoreIfNeeded: () => Promise<void>
  persistSnapshot: () => void
  flush: () => Promise<void>
  storePathFor: (userDataPath: string) => string
}

type CreateAgentSessionStoreRuntime = (options: {
  storeVersion: number
  getSnapshot: () => ManagedAiSessionSnapshot
  getAgentHibernationConfig: () => AgentHibernationConfig
  applyLoadedStore: (loaded: LoadedAgentSessionStore) => void
}) => AgentSessionStoreRuntime

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionStoreRuntime'
  return (await import(modulePath)) as { createAgentSessionStoreRuntime: CreateAgentSessionStoreRuntime }
}

const sessionRecord = (overrides: Partial<ManagedAiSessionRecord> = {}): ManagedAiSessionRecord => ({
  id: overrides.id || 'session-1',
  source: overrides.source || 'codex',
  title: overrides.title || 'Codex',
  summary: overrides.summary || '',
  state: overrides.state || 'idle',
  lastEvent: overrides.lastEvent || 'stop',
  lastActivityAt: overrides.lastActivityAt || 200,
  createdAt: overrides.createdAt || 100,
  updatedAt: overrides.updatedAt || 200,
  requestKind: overrides.requestKind || 'telemetry',
  decisionMode: overrides.decisionMode || 'telemetry',
  events: overrides.events || [],
  decisions: overrides.decisions || [],
  ...overrides
})

const defaultHibernationConfig: AgentHibernationConfig = {
  enabled: false,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}

describe('agentSessionStoreRuntime', () => {
  it('loads persisted sessions and hibernation config, then persists snapshots through its write queue', async () => {
    const { createAgentSessionStoreRuntime } = await loadRuntime()
    let loadedStore: LoadedAgentSessionStore | null = null
    let snapshot: ManagedAiSessionSnapshot = { sessions: [sessionRecord({ id: 'session-written', title: 'Written' })] }
    let hibernationConfig: AgentHibernationConfig = {
      enabled: true,
      idleSeconds: 120,
      maxLiveTerminals: 4,
      confirmationSeconds: 30
    }
    const applyLoadedStore = vi.fn((loaded: LoadedAgentSessionStore) => {
      loadedStore = loaded
    })
    const runtime = createAgentSessionStoreRuntime({
      storeVersion: 7,
      getSnapshot: () => snapshot,
      getAgentHibernationConfig: () => hibernationConfig,
      applyLoadedStore
    })
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-store-runtime-'))
    const storePath = runtime.storePathFor(userDataPath)
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(
      storePath,
      `${JSON.stringify(
        {
          version: 1,
          agentHibernation: { enabled: true, idleSeconds: 45, maxLiveTerminals: 3, confirmationSeconds: 15 },
          sessions: [sessionRecord({ id: 'session-loaded', title: 'Loaded' })]
        },
        null,
        2
      )}\n`,
      'utf-8'
    )

    await runtime.configure(userDataPath)

    expect(applyLoadedStore).toHaveBeenCalledTimes(2)
    const loadedAfterConfigure = applyLoadedStore.mock.calls.at(-1)![0]
    expect(loadedAfterConfigure.agentHibernationConfig).toEqual({
      enabled: true,
      idleSeconds: 45,
      maxLiveTerminals: 3,
      confirmationSeconds: 15
    })
    expect([...loadedAfterConfigure.sessions.values()]).toEqual([expect.objectContaining({ id: 'session-loaded', title: 'Loaded' })])
    expect(loadedStore).toBe(loadedAfterConfigure)

    snapshot = { sessions: [sessionRecord({ id: 'session-written-2', title: 'Written 2' })] }
    hibernationConfig = { enabled: false, idleSeconds: 90, maxLiveTerminals: 5, confirmationSeconds: 25 }
    runtime.persistSnapshot()
    await runtime.flush()

    const persisted = JSON.parse(String(await readFile(storePath, 'utf-8'))) as Record<string, unknown>
    expect(persisted).toEqual(
      expect.objectContaining({
        version: 7,
        agentHibernation: hibernationConfig,
        sessions: [expect.objectContaining({ id: 'session-written-2', title: 'Written 2' })]
      })
    )
  })

  it('resets to an empty default store when the persisted file is invalid', async () => {
    const { createAgentSessionStoreRuntime } = await loadRuntime()
    const applyLoadedStore = vi.fn()
    const runtime = createAgentSessionStoreRuntime({
      storeVersion: 1,
      getSnapshot: () => ({ sessions: [] }),
      getAgentHibernationConfig: () => defaultHibernationConfig,
      applyLoadedStore
    })
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-store-invalid-'))
    const storePath = runtime.storePathFor(userDataPath)
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(storePath, '{not valid json', 'utf-8')

    await runtime.configure(userDataPath)

    const loadedAfterConfigure = applyLoadedStore.mock.calls.at(-1)![0] as LoadedAgentSessionStore
    expect(loadedAfterConfigure.agentHibernationConfig).toEqual(defaultHibernationConfig)
    expect([...loadedAfterConfigure.sessions.values()]).toEqual([])
  })
})
