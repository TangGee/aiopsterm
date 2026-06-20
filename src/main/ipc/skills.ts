import type { IpcMain, IpcMainInvokeEvent, SaveDialogOptions } from 'electron'
import { access, mkdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportResult,
  SkillMetadataConfig,
  SkillUserConfig,
  SkillWriteResult
} from '@shared/contracts/skills'

type SaveDialogResult = { canceled?: boolean; filePath?: string }

type RegisterSkillsIpcInput = {
  syncSkillsConfigFromDisk: () => Promise<SkillUserConfig[]>
  loadSkillsFromDisk: () => Promise<SkillUserConfig[]>
  saveSkillsSnapshot: (skills: SkillUserConfig[]) => void
  broadcastSkillsUpdate: (skills: SkillUserConfig[]) => void
  ensureSkillsDirectory: () => Promise<string>
  validateSkillMetadata: (metadata: Partial<SkillMetadataConfig>) => SkillMetadataConfig
  normalizeSkillNameForDirectory: (name: string) => string
  buildSkillFile: (metadata: SkillMetadataConfig, content: string) => string
  startSkillsWatcher: () => Promise<void>
  findSkillByName: (skillName: string) => Promise<SkillUserConfig | null>
  createSkillWriteResult: (skill: SkillUserConfig, filePath?: string) => Promise<SkillWriteResult>
  isEditableSkill: (skill: SkillUserConfig) => boolean
  pathExists: (targetPath: string) => Promise<boolean>
  openPath: (targetPath: string) => Promise<string>
  importSkillZip: (zipPath: string, overwrite?: boolean) => Promise<SkillImportResult>
  exportSkillZipBuffer: (skillName: string) => Promise<{ skill: SkillUserConfig; zipBuffer: Buffer }>
  showSaveDialog: (event: IpcMainInvokeEvent, options: SaveDialogOptions) => Promise<SaveDialogResult>
  now?: () => Date
}

export const registerSkillsIpc = (ipcMain: IpcMain, input: RegisterSkillsIpcInput) => {
  ipcMain.handle('skills:get-all', async () => input.syncSkillsConfigFromDisk())
  ipcMain.handle('skills:get-enabled', async () => {
    const skills = await input.loadSkillsFromDisk()
    return skills.filter((skill) => skill.enabled)
  })
  ipcMain.handle('skills:set-enabled', async (_event, skillName: string, enabled: boolean) => {
    const skills = await input.loadSkillsFromDisk()
    const target = skills.find((skill) => skill.name === skillName)
    if (!target) throw new Error(`Skill not found: ${skillName}`)
    const nextSkills = skills.map((skill) => (skill.name === skillName ? { ...skill, enabled: Boolean(enabled) } : skill))
    input.saveSkillsSnapshot(nextSkills)
    input.broadcastSkillsUpdate(nextSkills)
    const updated = nextSkills.find((skill) => skill.name === skillName)
    if (!updated) throw new Error(`Failed to update skill state: ${skillName}`)
    const result: SkillEnabledResult = {
      skill: updated,
      skills: nextSkills,
      enabled: updated.enabled,
      updatedAt: (input.now || (() => new Date()))().toISOString()
    }
    return result
  })
  ipcMain.handle('skills:get-user-path', async () => input.ensureSkillsDirectory())
  ipcMain.handle('skills:reload', async () => input.syncSkillsConfigFromDisk())
  ipcMain.handle('skills:create', async (_event, metadata: SkillMetadataConfig, content: string) => {
    const normalized = input.validateSkillMetadata(metadata)
    if (!/^[a-z-]+$/.test(normalized.name)) {
      throw new Error('Skill name can only contain lowercase letters and hyphens')
    }
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) {
      throw new Error('Skill content is required')
    }
    const skillsPath = await input.ensureSkillsDirectory()
    const existing = await input.loadSkillsFromDisk()
    if (existing.some((skill) => skill.name === normalized.name)) {
      throw new Error(`Skill already exists: ${normalized.name}`)
    }
    const skillDir = join(skillsPath, input.normalizeSkillNameForDirectory(normalized.name))
    try {
      await access(skillDir)
      throw new Error(`Skill directory already exists: ${skillDir}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Skill directory already exists')) throw error
    }
    await mkdir(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    await writeFile(skillPath, input.buildSkillFile(normalized, skillContent), 'utf-8')
    await input.startSkillsWatcher()
    const created = await input.findSkillByName(normalized.name)
    if (!created) throw new Error(`Failed to create skill: ${normalized.name}`)
    return input.createSkillWriteResult(created, skillPath)
  })
  ipcMain.handle('skills:delete', async (_event, skillName: string) => {
    const skill = await input.findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!input.isEditableSkill(skill)) throw new Error('Can only delete user-created skills')
    const deletedPath = dirname(skill.path)
    await rm(deletedPath, { recursive: true, force: true })
    if (await input.pathExists(deletedPath)) throw new Error(`Failed to delete skill: ${skillName}`)
    await input.startSkillsWatcher()
    const remainingSkills = await input.loadSkillsFromDisk()
    if (remainingSkills.some((item) => item.name === skillName)) throw new Error(`Failed to delete skill: ${skillName}`)
    const result: SkillDeleteResult = {
      skillName,
      deleted: true,
      deletedPath,
      remainingSkills,
      deletedAt: (input.now || (() => new Date()))().toISOString()
    }
    return result
  })
  ipcMain.handle('skills:open-folder', async () => {
    const skillsPath = await input.ensureSkillsDirectory()
    const result = await input.openPath(skillsPath)
    if (result) throw new Error(result)
    return { path: skillsPath }
  })
  ipcMain.handle('skills:import-zip', async (_event, zipPath: string, overwrite?: boolean) => input.importSkillZip(zipPath, Boolean(overwrite)))
  ipcMain.handle('skills:read-content', async (_event, skillName: string) => {
    const skill = await input.findSkillByName(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    return {
      metadata: {
        name: skill.name,
        description: skill.description
      },
      content: skill.content
    }
  })
  ipcMain.handle('skills:update', async (_event, skillName: string, metadata: SkillMetadataConfig, content: string) => {
    const skill = await input.findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!input.isEditableSkill(skill)) throw new Error('Can only update user-created skills')
    const normalized = input.validateSkillMetadata({ ...metadata, name: skillName })
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) throw new Error('Skill content is required')
    await writeFile(skill.path, input.buildSkillFile(normalized, skillContent), 'utf-8')
    await input.startSkillsWatcher()
    const updated = await input.findSkillByName(skillName)
    if (!updated) throw new Error(`Failed to update skill: ${skillName}`)
    return input.createSkillWriteResult(updated, skill.path)
  })
  ipcMain.handle('skills:export-zip', async (event, skillName: string): Promise<SkillExportResult> => {
    const { skill, zipBuffer } = await input.exportSkillZipBuffer(skillName)
    const saveOptions = {
      defaultPath: `${skillName}.zip`,
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    }
    const result = await input.showSaveDialog(event, saveOptions)
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' }
    }
    await writeFile(result.filePath, zipBuffer)
    const metadata = await stat(result.filePath)
    return {
      success: true,
      skillName: skill.name,
      filePath: result.filePath,
      bytes: metadata.size,
      exportedAt: (input.now || (() => new Date()))().toISOString()
    }
  })
}
