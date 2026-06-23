import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import {
  defaultAgentHibernationConfig,
  normalizeAgentHibernationConfig,
  normalizeStoredSession,
  sessionKey
} from './agentSessionNormalization'
import type {
  AgentHibernationConfig,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot
} from '@shared/contracts/managedAiSessions'

type PersistedManagedAiSessionSnapshot = ManagedAiSessionSnapshot & {
  version?: number
  agentHibernation?: AgentHibernationConfig
}

type LoadedAgentSessionStore = {
  sessions: Map<string, ManagedAiSessionRecord>
  agentHibernationConfig: AgentHibernationConfig
}

type AgentSessionStoreRuntimeOptions = {
  storeVersion: number
  getSnapshot: () => ManagedAiSessionSnapshot
  getAgentHibernationConfig: () => AgentHibernationConfig
  applyLoadedStore: (loaded: LoadedAgentSessionStore) => void
}

export type AgentSessionStoreRuntime = {
  configure: (userDataPath: string) => Promise<void>
  loadStoreIfNeeded: () => Promise<void>
  persistSnapshot: () => void
  flush: () => Promise<void>
  storePathFor: (userDataPath: string) => string
}

const emptyLoadedStore = (): LoadedAgentSessionStore => ({
  sessions: new Map(),
  agentHibernationConfig: { ...defaultAgentHibernationConfig }
})

export const createAgentSessionStoreRuntime = ({
  storeVersion,
  getSnapshot,
  getAgentHibernationConfig,
  applyLoadedStore
}: AgentSessionStoreRuntimeOptions): AgentSessionStoreRuntime => {
  let storePath = ''
  let loadedStore = false
  let writeQueue: Promise<void> = Promise.resolve()

  const storePathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.json')

  const loadStoreIfNeeded = async () => {
    if (loadedStore || !storePath) return
    loadedStore = true
    if (!existsSync(storePath)) return
    try {
      const raw = String(await readFile(storePath, 'utf-8'))
      const parsed = JSON.parse(raw) as PersistedManagedAiSessionSnapshot
      const agentHibernationConfig = normalizeAgentHibernationConfig(parsed.agentHibernation, defaultAgentHibernationConfig)
      const loaded = Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeStoredSession).filter(Boolean) : []
      applyLoadedStore({
        sessions: new Map((loaded as ManagedAiSessionRecord[]).map((session) => [sessionKey(session.source, session.id), session])),
        agentHibernationConfig
      })
    } catch {
      applyLoadedStore(emptyLoadedStore())
    }
  }

  return {
    configure: async (userDataPath) => {
      const nextStorePath = storePathFor(userDataPath)
      if (storePath !== nextStorePath) {
        storePath = nextStorePath
        loadedStore = false
        applyLoadedStore(emptyLoadedStore())
      }
      await mkdir(join(userDataPath, 'agent-sessions'), { recursive: true })
      await loadStoreIfNeeded()
    },
    loadStoreIfNeeded,
    persistSnapshot: () => {
      if (!storePath) return
      const targetStorePath = storePath
      const payload: PersistedManagedAiSessionSnapshot = {
        version: storeVersion,
        agentHibernation: getAgentHibernationConfig(),
        ...getSnapshot()
      }
      writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
          await mkdir(dirname(targetStorePath), { recursive: true })
          await writeFile(targetStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
        })
    },
    flush: async () => {
      await writeQueue
    },
    storePathFor
  }
}
