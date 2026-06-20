export type SkillUserConfig = {
  name: string
  description: string
  enabled: boolean
  editable: boolean
  content: string
  path?: string
}

export type SkillMetadataConfig = {
  name: string
  description: string
}

export type SkillContentResult = {
  metadata: Partial<SkillMetadataConfig>
  content: string
}

export type SkillWriteResult = {
  skill: SkillUserConfig
  filePath: string
  bytes: number
  size: number
  mtimeMs: number
}

export type SkillEnabledResult = {
  skill: SkillUserConfig
  skills: SkillUserConfig[]
  enabled: boolean
  updatedAt: string
}

export type SkillDeleteResult = {
  skillName: string
  deleted: true
  deletedPath: string
  remainingSkills: SkillUserConfig[]
  deletedAt: string
}

export type SkillImportErrorCode = 'INVALID_ZIP' | 'NO_SKILL_MD' | 'INVALID_METADATA' | 'DIR_EXISTS' | 'EXTRACT_FAILED' | 'UNKNOWN'

export type SkillImportResult = {
  success: boolean
  skillName?: string
  skill?: SkillUserConfig
  importedPath?: string
  bytes?: number
  files?: number
  importedAt?: string
  error?: string
  errorCode?: SkillImportErrorCode
}

export type SkillExportResult = {
  success: boolean
  filePath?: string
  skillName?: string
  bytes?: number
  exportedAt?: string
  error?: string
}
