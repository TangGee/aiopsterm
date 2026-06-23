import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiCatalogClient } from '@/services/ai/aiCatalogClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('aiCatalogClient', () => {
  it('returns undefined for unavailable bridge methods and binds AI catalog methods', async () => {
    window.aiops = {
      ...originalAiops,
      listAiContextCatalog: vi.fn(async () => ({
        ok: true,
        data: {
          categories: [{ id: 'hosts' as const, label: 'Hosts', options: [{ id: 'host-1', kind: 'hosts' as const, label: 'prod-1' }] }],
          openedHosts: [{ id: 'host-1', kind: 'hosts' as const, label: 'prod-1' }],
          selectedDefaults: []
        }
      })),
      listAiCommandCatalog: vi.fn(async () => ({
        ok: true,
        data: {
          commands: [{ id: 'cmd-1', label: 'Check pods', name: 'kubectl get pods', path: 'Kubernetes/Pods', command: 'kubectl get pods' }]
        }
      })),
      listAiTodoSnapshot: vi.fn(async () => ({
        ok: true,
        data: {
          todos: [{ id: 'todo-1', content: 'Inspect incident', status: 'pending' as const }],
          focusedTodoId: null,
          totalTodos: 1,
          completedTodos: 0,
          source: 'backend' as const,
          updatedAt: '2026-06-20T00:00:00.000Z'
        }
      }))
    }

    await expect(aiCatalogClient.listAiContextCatalog()?.()).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ categories: expect.any(Array) }) })
    )
    await expect(aiCatalogClient.listAiCommandCatalog()?.()).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ commands: expect.any(Array) }) })
    )
    await expect(aiCatalogClient.listAiTodoSnapshot()?.()).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ todos: expect.any(Array) }) })
    )

    expect(window.aiops.listAiContextCatalog).toHaveBeenCalledTimes(1)
    expect(window.aiops.listAiCommandCatalog).toHaveBeenCalledTimes(1)
    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalledTimes(1)

    window.aiops = {
      ...originalAiops,
      listAiContextCatalog: undefined as any,
      listAiCommandCatalog: undefined as any,
      listAiTodoSnapshot: undefined as any
    }
    expect(aiCatalogClient.listAiContextCatalog()).toBeUndefined()
    expect(aiCatalogClient.listAiCommandCatalog()).toBeUndefined()
    expect(aiCatalogClient.listAiTodoSnapshot()).toBeUndefined()
  })
})
