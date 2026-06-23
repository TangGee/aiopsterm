import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBaseEntry } from '../src/shared/contracts/knowledgeBase'

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/ai/aiCommands'
  return import(modulePath)
}

describe('AI command catalog backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('builds slash commands from knowledge base commands files only', async () => {
    const backend = await loadBackend()
    const entries: KnowledgeBaseEntry[] = [
      { name: 'nested', relPath: 'commands/nested', type: 'dir', mtimeMs: 1717200000000 },
      { name: 'rollback-plan.md', relPath: 'commands/rollback-plan.md', type: 'file', size: 128, mtimeMs: 1717200000000 },
      { name: 'diagnose.md', relPath: 'commands/diagnose.md', type: 'file', size: 96, mtimeMs: 1717200000000 },
      { name: 'no-extension', relPath: 'commands/no-extension', type: 'file', size: 64, mtimeMs: 1717200000000 }
    ]
    const listKnowledgeDir = vi.fn(async () => entries)
    backend.configureAiCommandBackendRuntime({ listKnowledgeDir })

    const result = await backend.listAiCommandCatalog()

    expect(result.ok).toBe(true)
    expect(listKnowledgeDir).toHaveBeenCalledWith('commands')
    expect(result.data?.commands).toEqual([
      {
        id: 'commands/diagnose.md',
        label: '/diagnose',
        name: 'diagnose',
        path: 'commands/diagnose.md',
        command: '/diagnose'
      },
      {
        id: 'commands/no-extension',
        label: '/no-extension',
        name: 'no-extension',
        path: 'commands/no-extension',
        command: '/no-extension'
      },
      {
        id: 'commands/rollback-plan.md',
        label: '/rollback-plan',
        name: 'rollback-plan',
        path: 'commands/rollback-plan.md',
        command: '/rollback-plan'
      }
    ])
  })

  it('returns an empty catalog when the commands source is unavailable', async () => {
    const backend = await loadBackend()

    const result = await backend.listAiCommandCatalog()

    expect(result.ok).toBe(true)
    expect(result.data?.commands).toEqual([])
  })

  it('returns an empty catalog on knowledge backend errors instead of fabricating commands', async () => {
    const backend = await loadBackend()
    backend.configureAiCommandBackendRuntime({
      listKnowledgeDir: () => {
        throw new Error('knowledge unavailable')
      }
    })

    const result = await backend.listAiCommandCatalog()

    expect(result.ok).toBe(true)
    expect(result.data?.commands).toEqual([])
  })
})
