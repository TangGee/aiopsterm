import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiContextCategoryInfo } from '../src/shared/preload'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/aiContext'
  return import(modulePath)
}

const originalChatHistorySeedEnv = process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED
const originalAssetsSeedEnv = process.env.AIOPSTERM_ASSETS_ENABLE_SEED

describe('AI context catalog backend boundary', () => {
  beforeEach(() => {
    delete process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED
    delete process.env.AIOPSTERM_ASSETS_ENABLE_SEED
    vi.resetModules()
  })

  afterEach(() => {
    if (originalChatHistorySeedEnv === undefined) {
      delete process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED = originalChatHistorySeedEnv
    }
    if (originalAssetsSeedEnv === undefined) {
      delete process.env.AIOPSTERM_ASSETS_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_ASSETS_ENABLE_SEED = originalAssetsSeedEnv
    }
  })

  it('builds host, chat, and default contexts from backend-owned catalogs', async () => {
    process.env.AIOPSTERM_CHAT_HISTORY_ENABLE_SEED = '1'
    process.env.AIOPSTERM_ASSETS_ENABLE_SEED = '1'
    const backend = await loadBackend()
    const result = await backend.listAiContextCatalog()

    expect(result.ok).toBe(true)
    expect(result.data?.openedHosts).toEqual([
      expect.objectContaining({ id: 'opened-local', kind: 'hosts', label: '127.0.0.1' }),
      expect.objectContaining({ id: 'asset-1', kind: 'hosts', label: '10.24.8.12', detail: 'prod-bastion' }),
      expect.objectContaining({ id: 'asset-3', kind: 'hosts', label: '10.32.6.9', detail: 'mysql-primary' }),
      expect.objectContaining({ id: 'asset-2', kind: 'hosts', label: '10.24.12.44', detail: 'staging-api' })
    ])
    expect(result.data?.selectedDefaults).toEqual([
      expect.objectContaining({ id: 'opened-local', label: '127.0.0.1' }),
      expect.objectContaining({ id: 'asset-1', label: '10.24.8.12' })
    ])
    expect(result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'hosts')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-1', label: '10.24.8.12' }),
        expect.objectContaining({ id: 'asset-3', label: '10.32.6.9' })
      ])
    )
    expect(result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'hosts')?.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'local-127-1' })])
    )
    expect(result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'chats')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'chat:conv-1', label: '生产巡检' }),
        expect.objectContaining({ id: 'chat:conv-2', label: 'K8s 发布失败' })
      ])
    )
  })

  it('builds docs and skills from configured backend sources without hardcoded skill fallbacks', async () => {
    const backend = await loadBackend()
    backend.configureAiContextBackendRuntime({
      listKnowledgeTree: () => [
        {
          id: 'kb-dir-runbooks',
          key: 'Runbooks',
          title: 'Runbooks',
          type: 'dir',
          relPath: 'Runbooks',
          children: [
            {
              id: 'kb-file-prod',
              key: 'Runbooks/Prod.md',
              title: 'Prod.md',
              type: 'file',
              relPath: 'Runbooks/Prod.md',
              size: 128
            }
          ]
        }
      ],
      listSkills: () => [
        {
          name: 'incident-triage',
          description: 'Collect symptoms',
          enabled: true,
          editable: true,
          content: 'Collect scope first.',
          path: '/tmp/skills/incident-triage/SKILL.md'
        },
        {
          name: 'disabled-skill',
          description: 'Should not appear',
          enabled: false,
          editable: true,
          content: 'hidden',
          path: '/tmp/skills/disabled-skill/SKILL.md'
        }
      ]
    })

    const result = await backend.listAiContextCatalog()
    const docs = result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'docs')?.options || []
    const skills = result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'skills')?.options || []

    expect(docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'kb-dir:Runbooks', label: 'Runbooks', contextType: 'dir', parentRelPath: '' }),
        expect.objectContaining({ id: 'kb-doc:Runbooks/Prod.md', label: 'Prod.md', contextType: 'doc', parentRelPath: 'Runbooks' })
      ])
    )
    expect(skills).toEqual([expect.objectContaining({ id: 'skill:incident-triage', label: 'incident-triage', detail: 'Collect symptoms' })])
    expect(skills).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'skill:audit-readonly' })]))
    expect(skills).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'skill:disabled-skill' })]))
  })

  it('returns empty docs and skills when backend sources are unavailable instead of fabricating options', async () => {
    const backend = await loadBackend()
    backend.configureAiContextBackendRuntime({
      listKnowledgeTree: () => {
        throw new Error('knowledge unavailable')
      },
      listSkills: () => {
        throw new Error('skills unavailable')
      }
    })

    const result = await backend.listAiContextCatalog()
    expect(result.ok).toBe(true)
    expect(result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'docs')?.options).toEqual([])
    expect(result.data?.categories.find((category: AiContextCategoryInfo) => category.id === 'skills')?.options).toEqual([])
  })
})
