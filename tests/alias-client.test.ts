import { afterEach, describe, expect, it, vi } from 'vitest'
import { aliasClient } from '@/services/aliasClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('aliasClient', () => {
  it('returns undefined for unavailable bridge methods and binds Alias bridge methods', async () => {
    const command = {
      id: 'alias-1',
      alias: 'll',
      command: 'ls -la',
      createdAt: 1781884800000
    }

    window.aiops = {
      ...originalAiops,
      listAliasCommands: vi.fn(async () => ({ ok: true, data: [command] })),
      saveAliasCommand: vi.fn(async (input) => ({ ok: true, data: { command: { ...command, ...input, id: input.id || command.id }, commands: [command] } })),
      deleteAliasCommand: vi.fn(async () => ({ ok: true, data: { deleted: command, commands: [] } }))
    }

    await expect(aliasClient.listAliasCommands()?.('l')).resolves.toEqual({ ok: true, data: [command] })
    await expect(aliasClient.saveAliasCommand()?.({ alias: 'll', command: 'ls -la' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ command: expect.objectContaining({ alias: 'll' }) }) })
    )
    await expect(aliasClient.deleteAliasCommand()?.({ id: 'alias-1', alias: 'll' })).resolves.toEqual({ ok: true, data: { deleted: command, commands: [] } })

    expect(window.aiops.listAliasCommands).toHaveBeenCalledWith('l')
    expect(window.aiops.saveAliasCommand).toHaveBeenCalledWith({ alias: 'll', command: 'ls -la' })
    expect(window.aiops.deleteAliasCommand).toHaveBeenCalledWith({ id: 'alias-1', alias: 'll' })

    window.aiops = {
      ...originalAiops,
      listAliasCommands: undefined as any,
      saveAliasCommand: undefined as any,
      deleteAliasCommand: undefined as any
    }
    expect(aliasClient.listAliasCommands()).toBeUndefined()
    expect(aliasClient.saveAliasCommand()).toBeUndefined()
    expect(aliasClient.deleteAliasCommand()).toBeUndefined()
  })
})
