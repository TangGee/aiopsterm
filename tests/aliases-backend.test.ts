import { beforeAll, describe, expect, it } from 'vitest'

let listAliasCommands: (query?: string) => any
let saveAliasCommand: (input: { id?: string; previousAlias?: string; alias: string; command: string; createdAt?: number }) => any
let deleteAliasCommand: (input: { id?: string; alias?: string }) => any

beforeAll(async () => {
  const modulePath = '../src/main/backend/aliases'
  const backend = await import(modulePath)
  listAliasCommands = backend.listAliasCommands
  saveAliasCommand = backend.saveAliasCommand
  deleteAliasCommand = backend.deleteAliasCommand
})

describe('alias command backend boundary', () => {
  it('lists and searches alias commands through the backend store', () => {
    const all = listAliasCommands()
    expect(all.ok).toBe(true)
    expect(all.data.some((item: any) => item.alias === 'll')).toBe(true)

    const result = listAliasCommands('git')
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ alias: 'gst', command: 'git status' })]))
  })

  it('rejects duplicate aliases behind the backend boundary', () => {
    const result = saveAliasCommand({ alias: 'll', command: 'ls' })

    expect(result).toEqual({
      ok: false,
      errorCode: 'ALIAS_DUPLICATE',
      errorMessage: 'Alias already exists.'
    })
  })

  it('creates, renames, and deletes aliases with returned snapshots', () => {
    const created = saveAliasCommand({ alias: 'ports-test', command: 'ss -tulpn' })
    expect(created.ok).toBe(true)
    expect(created.data.command).toMatchObject({ alias: 'ports-test', command: 'ss -tulpn' })
    expect(created.data.commands.some((item: any) => item.alias === 'ports-test')).toBe(true)

    const renamed = saveAliasCommand({
      id: created.data.command.id,
      previousAlias: 'ports-test',
      alias: 'ports-renamed-test',
      command: 'netstat -tunlp'
    })
    expect(renamed.ok).toBe(true)
    expect(renamed.data.commands.some((item: any) => item.alias === 'ports-test')).toBe(false)
    expect(renamed.data.commands.some((item: any) => item.alias === 'ports-renamed-test')).toBe(true)

    const deleted = deleteAliasCommand({ id: created.data.command.id })
    expect(deleted.ok).toBe(true)
    expect(deleted.data.deleted.alias).toBe('ports-renamed-test')
    expect(deleted.data.commands.some((item: any) => item.alias === 'ports-renamed-test')).toBe(false)
  })
})
