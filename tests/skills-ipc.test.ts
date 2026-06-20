import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { SkillMetadataConfig, SkillUserConfig } from '../src/shared/preload'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type SkillsIpcBackend = {
  registerSkillsIpc: (ipcMain: IpcMain, input: any) => void
}

const tempDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/skills'
  return (await import(modulePath)) as SkillsIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-skills-ipc-'))
  tempDirs.push(dir)
  return dir
}

const baseSkill = (overrides: Partial<SkillUserConfig> = {}): SkillUserConfig => ({
  name: 'incident-triage',
  description: 'Collect incident context',
  enabled: true,
  editable: true,
  content: '# Incident triage',
  path: '/tmp/aiopsterm-skills/incident-triage/SKILL.md',
  ...overrides
})

const createRegistrationInput = async () => {
  const root = await createTempDir()
  const skillsRoot = join(root, 'skills')
  const downloadsRoot = join(root, 'downloads')
  await mkdir(skillsRoot, { recursive: true })
  let skills: SkillUserConfig[] = [baseSkill({ path: join(skillsRoot, 'incident-triage', 'SKILL.md') })]

  const findSkillByName = vi.fn(async (skillName: string) => skills.find((skill) => skill.name === skillName) || null)
  const createSkillWriteResult = vi.fn(async (skill: SkillUserConfig, filePath = skill.path) => ({
    skill,
    filePath,
    bytes: Buffer.byteLength(skill.content || ''),
    size: Buffer.byteLength(skill.content || ''),
    mtimeMs: 1780490000000
  }))

  return {
    syncSkillsConfigFromDisk: vi.fn(async () => skills),
    loadSkillsFromDisk: vi.fn(async () => skills),
    saveSkillsSnapshot: vi.fn((nextSkills: SkillUserConfig[]) => {
      skills = nextSkills
    }),
    broadcastSkillsUpdate: vi.fn(),
    ensureSkillsDirectory: vi.fn(async () => skillsRoot),
    validateSkillMetadata: vi.fn((metadata: Partial<SkillMetadataConfig>) => {
      const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
      const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
      if (!name || !description) throw new Error('Skill metadata requires name and description')
      return { name, description }
    }),
    normalizeSkillNameForDirectory: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill'),
    buildSkillFile: vi.fn((metadata: SkillMetadataConfig, content: string) => `---\nname: ${metadata.name}\ndescription: ${metadata.description}\n---\n\n${content.trim()}\n`),
    startSkillsWatcher: vi.fn(async () => undefined),
    findSkillByName,
    createSkillWriteResult,
    isEditableSkill: vi.fn((skill: SkillUserConfig) => skill.editable),
    pathExists: vi.fn(async () => false),
    openPath: vi.fn(async () => ''),
    importSkillZip: vi.fn(async (zipPath: string, overwrite?: boolean) => ({
      success: true,
      skillName: 'imported-skill',
      skill: baseSkill({ name: 'imported-skill', description: 'Imported', path: join(skillsRoot, 'imported-skill', 'SKILL.md') }),
      importedPath: zipPath,
      bytes: 42,
      files: overwrite ? 2 : 1,
      importedAt: '2026-06-20T00:00:00.000Z'
    })),
    exportSkillZipBuffer: vi.fn(async (skillName: string) => ({ skill: baseSkill({ name: skillName }), zipBuffer: Buffer.from(`zip:${skillName}`) })),
    showSaveDialog: vi.fn(async (): Promise<{ canceled?: boolean; filePath?: string }> => {
      await mkdir(downloadsRoot, { recursive: true })
      return { canceled: false, filePath: join(downloadsRoot, 'incident-triage.zip') }
    }),
    now: vi.fn(() => new Date('2026-06-20T00:00:00.000Z')),
    getSkills: () => skills,
    setSkills: (nextSkills: SkillUserConfig[]) => {
      skills = nextSkills
    },
    paths: { root, skillsRoot, downloadsRoot }
  }
}

describe('skills IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('registers stable skills channels', async () => {
    const { registerSkillsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerSkillsIpc(ipcMain, await createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'skills:get-all',
      'skills:get-enabled',
      'skills:set-enabled',
      'skills:get-user-path',
      'skills:reload',
      'skills:create',
      'skills:delete',
      'skills:open-folder',
      'skills:import-zip',
      'skills:read-content',
      'skills:update',
      'skills:export-zip'
    ])
  })

  it('loads skills, toggles enabled state, and persists the next snapshot through injected config storage', async () => {
    const { registerSkillsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerSkillsIpc(ipcMain, input)

    await expect(handlers.get('skills:get-all')?.({})).resolves.toEqual(input.getSkills())
    await expect(handlers.get('skills:get-enabled')?.({})).resolves.toEqual([expect.objectContaining({ name: 'incident-triage', enabled: true })])

    await expect(handlers.get('skills:set-enabled')?.({}, 'incident-triage', false)).resolves.toEqual({
      skill: expect.objectContaining({ name: 'incident-triage', enabled: false }),
      skills: [expect.objectContaining({ name: 'incident-triage', enabled: false })],
      enabled: false,
      updatedAt: '2026-06-20T00:00:00.000Z'
    })
    expect(input.saveSkillsSnapshot).toHaveBeenCalledWith([expect.objectContaining({ name: 'incident-triage', enabled: false })])
    expect(input.broadcastSkillsUpdate).toHaveBeenCalledWith([expect.objectContaining({ name: 'incident-triage', enabled: false })])
  })

  it('creates, updates, reads, and deletes editable user skills with filesystem-backed SKILL.md content', async () => {
    const { registerSkillsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()

    registerSkillsIpc(ipcMain, input)

    const createdSkillPath = join(input.paths.skillsRoot, 'release-check', 'SKILL.md')
    const createdSkill = baseSkill({ name: 'release-check', description: 'Check release', content: 'run checks', path: createdSkillPath })
    input.findSkillByName.mockImplementation(async (skillName: string) => (skillName === 'release-check' ? createdSkill : input.getSkills().find((skill) => skill.name === skillName) || null))

    await expect(handlers.get('skills:create')?.({}, { name: 'release-check', description: 'Check release' }, 'run checks')).resolves.toEqual({
      skill: createdSkill,
      filePath: createdSkillPath,
      bytes: Buffer.byteLength('run checks'),
      size: Buffer.byteLength('run checks'),
      mtimeMs: 1780490000000
    })
    expect(await readFile(createdSkillPath, 'utf-8')).toBe('---\nname: release-check\ndescription: Check release\n---\n\nrun checks\n')
    expect(input.startSkillsWatcher).toHaveBeenCalled()

    await expect(handlers.get('skills:read-content')?.({}, 'release-check')).resolves.toEqual({
      metadata: { name: 'release-check', description: 'Check release' },
      content: 'run checks'
    })

    input.findSkillByName.mockImplementation(async (skillName: string) =>
      skillName === 'release-check'
        ? baseSkill({ name: 'release-check', description: 'Check release', content: 'updated checks', path: createdSkillPath })
        : input.getSkills().find((skill) => skill.name === skillName) || null
    )
    await expect(handlers.get('skills:update')?.({}, 'release-check', { name: 'ignored', description: 'Updated release' }, 'updated checks')).resolves.toMatchObject({
      skill: expect.objectContaining({ name: 'release-check' }),
      filePath: createdSkillPath
    })
    expect(await readFile(createdSkillPath, 'utf-8')).toBe('---\nname: release-check\ndescription: Updated release\n---\n\nupdated checks\n')

    input.setSkills([])
    input.findSkillByName.mockResolvedValueOnce(baseSkill({ name: 'release-check', path: createdSkillPath }))
    await expect(handlers.get('skills:delete')?.({}, 'release-check')).resolves.toEqual({
      skillName: 'release-check',
      deleted: true,
      deletedPath: dirname(createdSkillPath),
      remainingSkills: [],
      deletedAt: '2026-06-20T00:00:00.000Z'
    })
  })

  it('forwards open/import/export operations through injected platform adapters', async () => {
    const { registerSkillsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = await createRegistrationInput()
    const event = { sender: { id: 7 } }

    registerSkillsIpc(ipcMain, input)

    await expect(handlers.get('skills:get-user-path')?.({})).resolves.toBe(input.paths.skillsRoot)
    await expect(handlers.get('skills:reload')?.({})).resolves.toEqual(input.getSkills())
    await expect(handlers.get('skills:open-folder')?.({})).resolves.toEqual({ path: input.paths.skillsRoot })
    expect(input.openPath).toHaveBeenCalledWith(input.paths.skillsRoot)

    await expect(handlers.get('skills:import-zip')?.({}, '/tmp/imported-skill.zip', true)).resolves.toMatchObject({
      success: true,
      skillName: 'imported-skill',
      files: 2
    })
    expect(input.importSkillZip).toHaveBeenCalledWith('/tmp/imported-skill.zip', true)

    await expect(handlers.get('skills:export-zip')?.(event, 'incident-triage')).resolves.toEqual({
      success: true,
      skillName: 'incident-triage',
      filePath: join(input.paths.root, 'downloads', 'incident-triage.zip'),
      bytes: Buffer.byteLength('zip:incident-triage'),
      exportedAt: '2026-06-20T00:00:00.000Z'
    })
    expect(input.showSaveDialog).toHaveBeenCalledWith(event, {
      defaultPath: 'incident-triage.zip',
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })

    input.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    await expect(handlers.get('skills:export-zip')?.(event, 'incident-triage')).resolves.toEqual({ success: false, error: 'cancelled' })
  })
})
