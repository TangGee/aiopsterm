import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('AI context catalog backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('builds host, chat, and default contexts from backend-owned catalogs', async () => {
    const backend = await loadBackend()
    const result = backend.listAiContextCatalog()

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
})
