import { afterEach, describe, expect, it, vi } from 'vitest'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import type {
  QuickCommandMacroEntryInput,
  QuickCommandScriptPlan,
  QuickCommandSnippetConfig,
  QuickCommandsUserConfig
} from '@shared/contracts/quickCommands'

const originalAiops = window.aiops

const snippet: QuickCommandSnippetConfig = {
  id: 10,
  uuid: 'snippet-10',
  snippet_name: 'Restart service',
  snippet_content: 'systemctl restart app',
  group_uuid: 'group-1'
}

const snapshot: QuickCommandsUserConfig = {
  groups: [
    {
      id: 1,
      uuid: 'group-1',
      group_name: 'Ops'
    }
  ],
  snippets: [snippet]
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('quickCommandsClient', () => {
  it('returns undefined for unavailable bridge methods and binds Quick Commands bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      getQuickCommands: vi.fn(async () => snapshot),
      saveQuickCommandGroup: vi.fn(async (input) => ({
        ok: true,
        data: {
          ...snapshot,
          group: { id: 2, uuid: input.uuid || 'group-2', group_name: input.group_name }
        }
      })),
      deleteQuickCommandGroup: vi.fn(async (groupUuid) => ({ ok: true, data: { ...snapshot, groupUuid } })),
      saveQuickCommandSnippet: vi.fn(async (input) => ({
        ok: true,
        data: {
          ...snapshot,
          snippet: {
            id: input.id || 11,
            uuid: input.uuid || 'snippet-11',
            snippet_name: input.snippet_name,
            snippet_content: input.snippet_content,
            group_uuid: input.group_uuid
          }
        }
      })),
      saveQuickCommandMacro: vi.fn(async (input) => ({
        ok: true,
        data: {
          ...snapshot,
          snippet: {
            id: 12,
            uuid: 'snippet-12',
            snippet_name: input.snippet_name || 'Macro',
            snippet_content: input.entries.map((entry: QuickCommandMacroEntryInput) => entry.command).join('\n'),
            group_uuid: input.group_uuid
          }
        }
      })),
      deleteQuickCommandSnippet: vi.fn(async (id) => ({ ok: true, data: { ...snapshot, id } })),
      reorderQuickCommands: vi.fn(async () => ({ ok: true, data: snapshot })),
      planQuickCommandScript: vi.fn(
        async (input): Promise<{ ok: true; data: QuickCommandScriptPlan }> => ({
          ok: true,
          data: {
            snippetId: input.snippetId ?? null,
            snippetName: 'Restart service',
            autoExecute: input.autoExecute === true,
            shellText: 'systemctl restart app',
            securityCommand: 'systemctl restart app',
            commands: ['systemctl restart app'],
            source: 'snippet',
            segments: [{ text: 'systemctl restart app', delayBeforeMs: 0 }]
          }
        })
      )
    }

    await expect(quickCommandsClient.getQuickCommands()?.()).resolves.toEqual(snapshot)
    await expect(quickCommandsClient.saveQuickCommandGroup()?.({ group_name: 'Deploy' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ group: expect.objectContaining({ group_name: 'Deploy' }) }) })
    )
    await expect(quickCommandsClient.deleteQuickCommandGroup()?.('group-1')).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ groupUuid: 'group-1' }) })
    )
    await expect(
      quickCommandsClient.saveQuickCommandSnippet()?.({
        snippet_name: 'Tail logs',
        snippet_content: 'tail -f /var/log/app.log',
        group_uuid: 'group-1'
      })
    ).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ snippet: expect.objectContaining({ snippet_name: 'Tail logs' }) }) }))
    await expect(
      quickCommandsClient.saveQuickCommandMacro()?.({
        snippet_name: 'Macro',
        group_uuid: 'group-1',
        entries: [{ command: 'date', timestamp: 1781913600000 }],
        sleepThresholdMs: 500
      })
    ).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ snippet: expect.objectContaining({ snippet_name: 'Macro' }) }) }))
    await expect(quickCommandsClient.deleteQuickCommandSnippet()?.(10)).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ id: 10 }) })
    )
    await expect(quickCommandsClient.reorderQuickCommands()?.({ orderedIds: [10, 11], groupUuid: 'group-1' })).resolves.toEqual(
      expect.objectContaining({ data: snapshot })
    )
    await expect(quickCommandsClient.planQuickCommandScript()?.({ snippetId: 10, autoExecute: true })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ snippetId: 10, autoExecute: true }) })
    )

    expect(window.aiops.saveQuickCommandGroup).toHaveBeenCalledWith({ group_name: 'Deploy' })
    expect(window.aiops.deleteQuickCommandGroup).toHaveBeenCalledWith('group-1')
    expect(window.aiops.saveQuickCommandSnippet).toHaveBeenCalledWith({
      snippet_name: 'Tail logs',
      snippet_content: 'tail -f /var/log/app.log',
      group_uuid: 'group-1'
    })
    expect(window.aiops.saveQuickCommandMacro).toHaveBeenCalledWith({
      snippet_name: 'Macro',
      group_uuid: 'group-1',
      entries: [{ command: 'date', timestamp: 1781913600000 }],
      sleepThresholdMs: 500
    })
    expect(window.aiops.deleteQuickCommandSnippet).toHaveBeenCalledWith(10)
    expect(window.aiops.reorderQuickCommands).toHaveBeenCalledWith({ orderedIds: [10, 11], groupUuid: 'group-1' })
    expect(window.aiops.planQuickCommandScript).toHaveBeenCalledWith({ snippetId: 10, autoExecute: true })

    window.aiops = {
      ...originalAiops,
      getQuickCommands: undefined as any,
      saveQuickCommandGroup: undefined as any,
      deleteQuickCommandGroup: undefined as any,
      saveQuickCommandSnippet: undefined as any,
      saveQuickCommandMacro: undefined as any,
      deleteQuickCommandSnippet: undefined as any,
      reorderQuickCommands: undefined as any,
      planQuickCommandScript: undefined as any
    }
    expect(quickCommandsClient.getQuickCommands()).toBeUndefined()
    expect(quickCommandsClient.saveQuickCommandGroup()).toBeUndefined()
    expect(quickCommandsClient.deleteQuickCommandGroup()).toBeUndefined()
    expect(quickCommandsClient.saveQuickCommandSnippet()).toBeUndefined()
    expect(quickCommandsClient.saveQuickCommandMacro()).toBeUndefined()
    expect(quickCommandsClient.deleteQuickCommandSnippet()).toBeUndefined()
    expect(quickCommandsClient.reorderQuickCommands()).toBeUndefined()
    expect(quickCommandsClient.planQuickCommandScript()).toBeUndefined()
  })
})
