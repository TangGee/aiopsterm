import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceAliasController,
  type WorkspaceAliasCommand
} from '@/services/workspaceAliasController'
import { defaultConfig } from '@/services/workspaceConfigRuntime'
import type { AliasCommandConfig, AliasCommandDeleteInput, AliasCommandSaveInput } from '@shared/contracts/aliases'
import type { UserConfig } from '@shared/contracts/userConfig'

const cloneConfig = (): UserConfig => JSON.parse(JSON.stringify(defaultConfig)) as UserConfig

const createAlias = (patch: Partial<AliasCommandConfig> = {}): AliasCommandConfig => ({
  id: 'alias-ll',
  alias: 'll',
  command: 'ls -la',
  createdAt: 1,
  ...patch
})

const createController = (options: {
  commands?: AliasCommandConfig[]
  listAliasCommands?: ReturnType<typeof vi.fn>
  saveAliasCommand?: ReturnType<typeof vi.fn>
  deleteAliasCommand?: ReturnType<typeof vi.fn>
} = {}) => {
  const backendCommands = options.commands ?? [
    createAlias(),
    createAlias({ id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 2 })
  ]
  const state = {
    config: ref(cloneConfig()),
    aliasCommands: ref<WorkspaceAliasCommand[]>([]),
    aliasSearchQuery: ref('')
  }
  const notices: string[] = []
  const listAliasCommands = options.listAliasCommands ?? vi.fn(async () => ({ ok: true, data: backendCommands }))
  const saveAliasCommand = options.saveAliasCommand ?? vi.fn(async (input: AliasCommandSaveInput) => {
    const saved = createAlias({
      id: input.id || `alias-${input.alias}`,
      alias: input.alias,
      command: input.command,
      createdAt: input.createdAt || 3
    })
    return { ok: true, data: { command: saved, commands: [saved, ...backendCommands.filter((item) => item.id !== saved.id)] } }
  })
  const deleteAliasCommand = options.deleteAliasCommand ?? vi.fn(async (input: AliasCommandDeleteInput) => {
    const deleted = backendCommands.find((item) => item.id === input.id) || createAlias({ id: input.id, alias: input.alias })
    return { ok: true, data: { deleted, commands: backendCommands.filter((item) => item.id !== input.id) } }
  })
  const controller = createWorkspaceAliasController(
    state,
    {
      client: {
        listAliasCommands: () => listAliasCommands,
        saveAliasCommand: () => saveAliasCommand,
        deleteAliasCommand: () => deleteAliasCommand
      },
      setExtensionNotice: (message) => notices.push(message)
    }
  )
  return {
    backendCommands,
    controller,
    deleteAliasCommand,
    listAliasCommands,
    notices,
    saveAliasCommand,
    state
  }
}

describe('workspaceAliasController', () => {
  it('hydrates, filters, snapshots, and refreshes backend-owned aliases', async () => {
    const { controller, listAliasCommands, state } = createController()

    await expect(controller.hydrateAliasCommands()).resolves.toEqual({
      normalizedAliasCommands: [
        createAlias(),
        createAlias({ id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 2 })
      ],
      aliasCommandsLoadedFromBridge: true
    })
    expect(listAliasCommands).toHaveBeenCalledTimes(1)
    expect(state.aliasCommands.value.every((alias) => alias.edit === false)).toBe(true)

    state.aliasSearchQuery.value = 'git'
    expect(controller.filteredAliasCommands.value.map((alias) => alias.alias)).toEqual(['gst'])

    state.aliasCommands.value[0].alias = ' ll '
    state.aliasCommands.value[0].command = ' ls -lah '
    expect(controller.getAliasCommandsSnapshot()[0]).toMatchObject({ alias: 'll', command: 'ls -lah' })

    await expect(controller.refreshAliasCommands()).resolves.toBe(true)
    expect(state.config.value.aliasCommands).toEqual([
      createAlias(),
      createAlias({ id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 2 })
    ])
  })

  it('owns create, edit, cancel, save, duplicate, and delete workflows', async () => {
    const { controller, deleteAliasCommand, notices, saveAliasCommand, state } = createController()
    await controller.refreshAliasCommands()

    controller.createAliasCommand()
    controller.createAliasCommand()
    expect(state.aliasCommands.value.filter((alias) => alias.id === 'new')).toHaveLength(1)
    expect(state.aliasSearchQuery.value).toBe('')

    controller.updateAliasDraft('new', { alias: 'ports', command: 'ss -tulpn' })
    await expect(controller.saveAliasCommand('new')).resolves.toEqual({ ok: true, reason: 'saved' })
    expect(saveAliasCommand).toHaveBeenCalledWith({
      id: undefined,
      previousAlias: undefined,
      alias: 'ports',
      command: 'ss -tulpn',
      createdAt: undefined
    })
    expect(notices).toContain('Alias 已保存')
    expect(state.aliasCommands.value[0]).toMatchObject({ alias: 'ports', command: 'ss -tulpn', edit: false })

    controller.startAliasEdit('alias-ports')
    controller.updateAliasDraft('alias-ports', { alias: 'ports2', command: 'netstat -tunlp' })
    controller.cancelAliasEdit('alias-ports')
    expect(state.aliasCommands.value.find((alias) => alias.id === 'alias-ports')).toMatchObject({ alias: 'ports', command: 'ss -tulpn', edit: false })

    saveAliasCommand.mockResolvedValueOnce({ ok: false, errorCode: 'ALIAS_DUPLICATE', errorMessage: 'duplicate' })
    controller.startAliasEdit('alias-ports')
    controller.updateAliasDraft('alias-ports', { alias: 'll' })
    await expect(controller.saveAliasCommand('alias-ports')).resolves.toEqual({ ok: false, reason: 'duplicate' })
    expect(notices).toContain('Alias 已存在')

    await expect(controller.deleteAliasCommand('alias-ports')).resolves.toEqual({ ok: true, reason: 'deleted' })
    expect(deleteAliasCommand).toHaveBeenCalledWith({ id: 'alias-ports', alias: 'll' })
    expect(notices).toContain('Alias 已删除')
  })

  it('fails closed on missing bridges and malformed backend payloads', async () => {
    const missingBridge = createWorkspaceAliasController(
      {
        config: ref(cloneConfig()),
        aliasCommands: ref<WorkspaceAliasCommand[]>([createAlias()]),
        aliasSearchQuery: ref('')
      },
      {
        client: {
          listAliasCommands: () => undefined,
          saveAliasCommand: () => undefined,
          deleteAliasCommand: () => undefined
        },
        setExtensionNotice: vi.fn()
      }
    )
    await expect(missingBridge.refreshAliasCommands()).resolves.toBe(false)
    await expect(missingBridge.saveAliasCommand('alias-ll')).resolves.toEqual({ ok: false, reason: 'backend' })
    await expect(missingBridge.deleteAliasCommand('alias-ll')).resolves.toEqual({ ok: false, reason: 'backend' })

    const malformedList = createController({
      listAliasCommands: vi.fn(async () => ({ ok: true, data: [{ id: '', alias: '', command: '' }] }))
    })
    await expect(malformedList.controller.refreshAliasCommands()).resolves.toBe(false)
    expect(malformedList.notices).toContain('Alias 服务返回数据无效')

    const malformedSave = createController({
      saveAliasCommand: vi.fn(async () => ({ ok: true, data: { command: createAlias(), commands: [{ id: '', alias: '', command: '' }] } }))
    })
    malformedSave.state.aliasCommands.value = [{ id: 'new', alias: 'bad', command: 'echo bad', edit: true }]
    await expect(malformedSave.controller.saveAliasCommand('new')).resolves.toEqual({ ok: false, reason: 'backend' })
    expect(malformedSave.notices).toContain('Alias 服务返回数据无效')
  })
})
