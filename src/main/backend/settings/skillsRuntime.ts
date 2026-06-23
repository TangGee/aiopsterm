import { watch, type FSWatcher } from 'fs'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import AdmZip from 'adm-zip'
import { defaultSkillSeedData, shouldUseSkillSeedData } from '@shared/skillsSeed'
import { broadcastWindowEvent } from '@shared/windowEvents'
import type { SkillImportResult, SkillMetadataConfig, SkillUserConfig, SkillWriteResult } from '@shared/contracts/skills'

type SkillsRuntimeOptions = {
  userDataPath: () => string
  getSkillsSnapshot: () => SkillUserConfig[]
  saveSkillsSnapshot: (skills: SkillUserConfig[]) => void
  broadcastWindows: () => Parameters<typeof broadcastWindowEvent>[0]
}

export const normalizeSkillNameForDirectory = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'skill'

const parseSkillYamlValue = (value: string): string => {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseSkillFrontmatter = (content: string): { metadata: Partial<SkillMetadataConfig>; body: string } => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/)
  if (!match) {
    const heading = normalized.match(/^#\s+(.+)$/m)
    const paragraph = normalized.match(/^#.+\n+([^#\n][^\n]+)/m)
    return {
      metadata: {
        ...(heading ? { name: heading[1].trim() } : {}),
        ...(paragraph ? { description: paragraph[1].trim() } : {})
      },
      body: normalized.trim()
    }
  }
  const metadata: Partial<SkillMetadataConfig> = {}
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return
    const key = line.slice(0, colonIndex).trim()
    const value = parseSkillYamlValue(line.slice(colonIndex + 1))
    if (key === 'name' || key === 'description') {
      metadata[key] = value
    }
  })
  return {
    metadata,
    body: match[2].trim()
  }
}

export const validateSkillMetadata = (metadata: Partial<SkillMetadataConfig>) => {
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  if (!name || !description) {
    throw new Error('Skill metadata requires name and description')
  }
  return { name, description }
}

export const buildSkillFile = (metadata: SkillMetadataConfig, content: string) => {
  const safeDescription = metadata.description.replace(/\r?\n/g, ' ')
  return `---\nname: ${metadata.name}\ndescription: ${safeDescription}\n---\n\n${content.trim()}\n`
}

export const createSkillsRuntime = (options: SkillsRuntimeOptions) => {
  const getSkillsUserPath = () => join(options.userDataPath(), 'skills')
  const getSkillsInitMarkerPath = () => join(getSkillsUserPath(), '.aiopsterm-skills-initialized')
  const getSkillFilePath = (skillDirName: string) => join(getSkillsUserPath(), skillDirName, 'SKILL.md')

  let skillsWatchers: FSWatcher[] = []
  let skillsWatcherDebounce: NodeJS.Timeout | null = null

  const isEditableSkill = (skill: SkillUserConfig) => {
    if (!skill.path) return skill.editable
    const userRoot = resolve(getSkillsUserPath())
    const skillPath = resolve(skill.path)
    return skillPath === userRoot || skillPath.startsWith(`${userRoot}${sep}`)
  }

  const pathExists = async (targetPath: string) => {
    try {
      await access(targetPath)
      return true
    } catch {
      return false
    }
  }

  const parseSkillFile = async (filePath: string): Promise<SkillUserConfig | null> => {
    const content = await readFile(filePath, 'utf-8')
    const parsed = parseSkillFrontmatter(content)
    try {
      const metadata = validateSkillMetadata(parsed.metadata)
      return {
        name: metadata.name,
        description: metadata.description,
        enabled: true,
        editable: isEditableSkill({ name: metadata.name, description: metadata.description, enabled: true, editable: true, content: parsed.body, path: filePath }),
        content: parsed.body,
        path: filePath
      }
    } catch {
      return null
    }
  }

  const hasAnySkillFile = async (dirPath: string) => {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name === 'SKILL.md') return true
        if (entry.isDirectory()) {
          try {
            await access(join(dirPath, entry.name, 'SKILL.md'))
            return true
          } catch {
            // Ignore directories that are not skill folders.
          }
        }
      }
    } catch {
      return false
    }
    return false
  }

  const seedSkillsFromConfig = async (skills: SkillUserConfig[]) => {
    for (const skill of skills) {
      const name = skill.name?.trim()
      const description = skill.description?.trim()
      const content = skill.content?.trim()
      if (!name || !description || !content) continue
      const skillFilePath = getSkillFilePath(normalizeSkillNameForDirectory(name))
      try {
        await access(skillFilePath)
        continue
      } catch {
        await mkdir(dirname(skillFilePath), { recursive: true })
        await writeFile(skillFilePath, buildSkillFile({ name, description }, content), 'utf-8')
      }
    }
  }

  const ensureSkillsDirectory = async () => {
    const skillsPath = getSkillsUserPath()
    await mkdir(skillsPath, { recursive: true })
    try {
      await access(getSkillsInitMarkerPath())
    } catch {
      if (shouldUseSkillSeedData() && !(await hasAnySkillFile(skillsPath))) {
        await seedSkillsFromConfig(defaultSkillSeedData())
      }
      await writeFile(getSkillsInitMarkerPath(), 'initialized\n', 'utf-8')
    }
    return skillsPath
  }

  const loadSkillsFromDisk = async (): Promise<SkillUserConfig[]> => {
    const skillsPath = await ensureSkillsDirectory()
    const savedStates = new Map(options.getSkillsSnapshot().map((skill) => [skill.name, skill.enabled]))
    const entries = await readdir(skillsPath, { withFileTypes: true })
    const skillsByName = new Map<string, SkillUserConfig>()

    for (const entry of entries) {
      const filePath = entry.isDirectory() ? join(skillsPath, entry.name, 'SKILL.md') : entry.isFile() && entry.name === 'SKILL.md' ? join(skillsPath, entry.name) : ''
      if (!filePath) continue
      try {
        const skill = await parseSkillFile(filePath)
        if (!skill || skillsByName.has(skill.name)) continue
        skill.enabled = savedStates.has(skill.name) ? Boolean(savedStates.get(skill.name)) : true
        skillsByName.set(skill.name, skill)
      } catch {
        // Invalid or temporarily unavailable SKILL.md files are skipped until the next reload.
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  const broadcastSkillsUpdate = (skills: SkillUserConfig[]) => {
    broadcastWindowEvent(options.broadcastWindows(), 'skills:update', skills)
  }

  const syncSkillsConfigFromDisk = async () => {
    const skills = await loadSkillsFromDisk()
    options.saveSkillsSnapshot(skills)
    broadcastSkillsUpdate(skills)
    return skills
  }

  const createSkillWriteResult = async (skill: SkillUserConfig, filePath = skill.path): Promise<SkillWriteResult> => {
    if (!filePath) {
      throw new Error(`Skill file path missing: ${skill.name}`)
    }
    const [metadata, content] = await Promise.all([stat(filePath), readFile(filePath)])
    return {
      skill,
      filePath,
      bytes: Buffer.byteLength(content),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs
    }
  }

  const closeSkillsWatchers = () => {
    skillsWatchers.forEach((watcher) => watcher.close())
    skillsWatchers = []
  }

  const scheduleSkillsReload = () => {
    if (skillsWatcherDebounce) {
      clearTimeout(skillsWatcherDebounce)
    }
    skillsWatcherDebounce = setTimeout(() => {
      skillsWatcherDebounce = null
      syncSkillsConfigFromDisk()
        .then(() => startSkillsWatcher())
        .catch(() => {
          // External edits can briefly remove files or folders; the next event or manual reload will recover.
        })
    }, 100)
  }

  const startSkillsWatcher = async () => {
    const skillsPath = await ensureSkillsDirectory()
    closeSkillsWatchers()
    skillsWatchers.push(watch(skillsPath, scheduleSkillsReload))
    const entries = await readdir(skillsPath, { withFileTypes: true })
    entries
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        try {
          skillsWatchers.push(
            watch(join(skillsPath, entry.name), (_eventType, filename) => {
              if (!filename || filename.toString() === 'SKILL.md') {
                scheduleSkillsReload()
              }
            })
          )
        } catch {
          // A skill directory can be removed between readdir and watch.
        }
      })
    await syncSkillsConfigFromDisk()
  }

  const stopSkillsWatcher = () => {
    closeSkillsWatchers()
    if (skillsWatcherDebounce) {
      clearTimeout(skillsWatcherDebounce)
      skillsWatcherDebounce = null
    }
  }

  const findSkillByName = async (skillName: string) => {
    const skills = await loadSkillsFromDisk()
    return skills.find((skill) => skill.name === skillName) || null
  }

  const ignoredSkillExportEntries = new Set(['.DS_Store', 'Thumbs.db', '.git', '.gitignore', 'node_modules', '__pycache__', '.vscode', '.idea'])

  const normalizeZipEntryName = (entryName: string) => entryName.replace(/\\/g, '/')

  const isUnsafeZipEntryName = (entryName: string) => {
    const normalized = normalizeZipEntryName(entryName)
    return normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')
  }

  const importSkillZip = async (zipPath: string, overwrite = false): Promise<SkillImportResult> => {
    let zip: AdmZip
    try {
      zip = new AdmZip(zipPath)
    } catch {
      return { success: false, error: 'Invalid or corrupted ZIP file', errorCode: 'INVALID_ZIP' }
    }

    const entries = zip.getEntries()
    if (!entries.length) {
      return { success: false, error: 'ZIP file is empty', errorCode: 'INVALID_ZIP' }
    }

    let skillMdEntry: AdmZip.IZipEntry | null = null
    let skillMdBasePath = ''

    for (const entry of entries) {
      const entryName = normalizeZipEntryName(entry.entryName)
      if (isUnsafeZipEntryName(entryName)) {
        return { success: false, error: 'ZIP file contains invalid paths', errorCode: 'INVALID_ZIP' }
      }
      if (entryName === 'SKILL.md') {
        skillMdEntry = entry
        skillMdBasePath = ''
        break
      }
      if (entryName.endsWith('/SKILL.md')) {
        const parts = entryName.split('/')
        if (parts.length === 2) {
          skillMdEntry = entry
          skillMdBasePath = `${parts[0]}/`
          break
        }
      }
    }

    if (!skillMdEntry) {
      return { success: false, error: 'No SKILL.md file found in ZIP', errorCode: 'NO_SKILL_MD' }
    }

    let metadata: SkillMetadataConfig
    try {
      metadata = validateSkillMetadata(parseSkillFrontmatter(skillMdEntry.getData().toString('utf-8')).metadata)
    } catch {
      return { success: false, error: 'Invalid SKILL.md metadata', errorCode: 'INVALID_METADATA' }
    }

    const userSkillsPath = await ensureSkillsDirectory()
    const skillDirName = normalizeSkillNameForDirectory(metadata.name)
    const targetDir = join(userSkillsPath, skillDirName)
    if (await pathExists(targetDir)) {
      if (!overwrite) {
        return {
          success: false,
          skillName: metadata.name,
          error: `Skill "${metadata.name}" already exists`,
          errorCode: 'DIR_EXISTS'
        }
      }
      await rm(targetDir, { recursive: true, force: true })
      if (await pathExists(targetDir)) {
        return { success: false, skillName: metadata.name, error: 'Failed to replace existing skill directory', errorCode: 'EXTRACT_FAILED' }
      }
    }

    try {
      await mkdir(targetDir, { recursive: true })
      let writtenFiles = 0
      let writtenBytes = 0
      for (const entry of entries) {
        const entryName = normalizeZipEntryName(entry.entryName)
        if (isUnsafeZipEntryName(entryName)) {
          throw new Error(`Invalid ZIP entry path: ${entryName}`)
        }
        if (skillMdBasePath && !entryName.startsWith(skillMdBasePath)) {
          continue
        }
        if (entry.isDirectory) {
          continue
        }
        const relativePath = skillMdBasePath ? entryName.slice(skillMdBasePath.length) : entryName
        if (!relativePath) {
          continue
        }
        const targetPath = resolve(targetDir, relativePath)
        const targetRoot = `${resolve(targetDir)}${sep}`
        if (!targetPath.startsWith(targetRoot)) {
          throw new Error(`Invalid ZIP entry path: ${entryName}`)
        }
        await mkdir(dirname(targetPath), { recursive: true })
        const data = entry.getData()
        await writeFile(targetPath, data)
        writtenFiles += 1
        writtenBytes += data.byteLength
      }
      await startSkillsWatcher()
      const imported = await findSkillByName(metadata.name)
      if (!imported?.path) throw new Error(`Imported skill not found: ${metadata.name}`)
      return {
        success: true,
        skillName: metadata.name,
        skill: imported,
        importedPath: imported.path,
        bytes: writtenBytes,
        files: writtenFiles,
        importedAt: new Date().toISOString()
      }
    } catch {
      await rm(targetDir, { recursive: true, force: true })
      return { success: false, skillName: metadata.name, error: 'Failed to extract skill files', errorCode: 'EXTRACT_FAILED' }
    }
  }

  const addSkillDirectoryToZip = async (zip: AdmZip, rootDir: string, currentDir: string) => {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (ignoredSkillExportEntries.has(entry.name)) {
        continue
      }
      const fullPath = join(currentDir, entry.name)
      const relativePath = relative(rootDir, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        await addSkillDirectoryToZip(zip, rootDir, fullPath)
        continue
      }
      zip.addFile(relativePath, await readFile(fullPath))
    }
  }

  const exportSkillZipBuffer = async (skillName: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill?.path) {
      throw new Error(`Skill not found: ${skillName}`)
    }
    const skillDir = dirname(skill.path)
    const metadata = await stat(skillDir)
    if (!metadata.isDirectory()) {
      throw new Error(`Skill directory not found: ${skillDir}`)
    }
    const zip = new AdmZip()
    await addSkillDirectoryToZip(zip, skillDir, skillDir)
    return { skill, zipBuffer: zip.toBuffer() }
  }

  return {
    syncSkillsConfigFromDisk,
    loadSkillsFromDisk,
    saveSkillsSnapshot: options.saveSkillsSnapshot,
    broadcastSkillsUpdate,
    ensureSkillsDirectory,
    validateSkillMetadata,
    normalizeSkillNameForDirectory,
    buildSkillFile,
    startSkillsWatcher,
    stopSkillsWatcher,
    findSkillByName,
    createSkillWriteResult,
    isEditableSkill,
    pathExists,
    importSkillZip,
    exportSkillZipBuffer
  }
}
