import type {
  SkillContentResult,
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportErrorCode,
  SkillImportResult,
  SkillUserConfig,
  SkillWriteResult
} from '@shared/contracts/skills'

export const malformedSkillsBackendResultMessage = 'Skills 服务返回数据无效'

const skillImportErrorCodes = new Set<SkillImportErrorCode>(['INVALID_ZIP', 'NO_SKILL_MD', 'INVALID_METADATA', 'DIR_EXISTS', 'EXTRACT_FAILED', 'UNKNOWN'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string'

const isNonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export const isSkillUserConfigData = (value: unknown): value is SkillUserConfig => {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.description) &&
    typeof value.enabled === 'boolean' &&
    typeof value.editable === 'boolean' &&
    isNonEmptyString(value.content) &&
    isOptionalString(value.path)
  )
}

export const isSkillsSnapshotData = (value: unknown): value is SkillUserConfig[] => {
  if (!Array.isArray(value) || !value.every(isSkillUserConfigData)) return false
  const names = new Set<string>()
  for (const skill of value) {
    const name = skill.name.trim()
    if (names.has(name)) return false
    names.add(name)
  }
  return true
}

export const skillMatchesExpected = (skill: SkillUserConfig, expected: { name: string; description?: string; content?: string; enabled?: boolean }) => {
  if (skill.name !== expected.name) return false
  if (expected.description !== undefined && skill.description !== expected.description) return false
  if (expected.content !== undefined && skill.content !== expected.content) return false
  if (expected.enabled !== undefined && skill.enabled !== expected.enabled) return false
  return true
}

export const snapshotContainsSkill = (skills: SkillUserConfig[], expected: { name: string; description?: string; content?: string; enabled?: boolean }) =>
  skills.some((skill) => skillMatchesExpected(skill, expected))

export const isSkillContentResultData = (value: unknown, expectedName: string): value is SkillContentResult => {
  if (!isRecord(value) || !isRecord(value.metadata) || !isNonEmptyString(value.content)) return false
  const metadata = value.metadata
  if (metadata.name !== undefined && metadata.name !== expectedName) return false
  if (metadata.description !== undefined && typeof metadata.description !== 'string') return false
  return true
}

const isIsoDateString = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
}

export const isSkillWriteResultForRequest = (
  value: unknown,
  expected: { name: string; description?: string; content?: string; enabled?: boolean }
): value is SkillWriteResult => {
  if (!isRecord(value)) return false
  return (
    isSkillUserConfigData(value.skill) &&
    skillMatchesExpected(value.skill, expected) &&
    isNonEmptyString(value.filePath) &&
    value.filePath === value.skill.path &&
    isNonNegativeNumber(value.bytes) &&
    value.bytes > 0 &&
    isNonNegativeNumber(value.size) &&
    value.size >= value.bytes &&
    isNonNegativeNumber(value.mtimeMs)
  )
}

export const isSkillEnabledResultForRequest = (value: unknown, expected: { name: string; enabled: boolean }): value is SkillEnabledResult => {
  if (!isRecord(value)) return false
  return (
    isSkillUserConfigData(value.skill) &&
    value.skill.name === expected.name &&
    value.skill.enabled === expected.enabled &&
    value.enabled === expected.enabled &&
    isSkillsSnapshotData(value.skills) &&
    snapshotContainsSkill(value.skills, expected) &&
    isIsoDateString(value.updatedAt)
  )
}

export const isSkillDeleteResultForRequest = (value: unknown, expectedName: string): value is SkillDeleteResult => {
  if (!isRecord(value)) return false
  return (
    value.skillName === expectedName &&
    value.deleted === true &&
    isNonEmptyString(value.deletedPath) &&
    isSkillsSnapshotData(value.remainingSkills) &&
    !value.remainingSkills.some((skill) => skill.name === expectedName) &&
    isIsoDateString(value.deletedAt)
  )
}

export const isSkillImportResultData = (value: unknown): value is SkillImportResult => {
  if (!isRecord(value) || typeof value.success !== 'boolean') return false
  if (value.skillName !== undefined && !isNonEmptyString(value.skillName)) return false
  if (value.skill !== undefined && !isSkillUserConfigData(value.skill)) return false
  if (value.importedPath !== undefined && !isNonEmptyString(value.importedPath)) return false
  if (value.bytes !== undefined && !isNonNegativeNumber(value.bytes)) return false
  if (value.files !== undefined) {
    if (typeof value.files !== 'number' || !Number.isInteger(value.files) || value.files < 0) return false
  }
  if (value.importedAt !== undefined && !isIsoDateString(value.importedAt)) return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !skillImportErrorCodes.has(value.errorCode as SkillImportErrorCode))) return false
  if (value.success) {
    return (
      isNonEmptyString(value.skillName) &&
      isSkillUserConfigData(value.skill) &&
      value.skill.name === value.skillName &&
      isNonEmptyString(value.importedPath) &&
      value.importedPath === value.skill.path &&
      isNonNegativeNumber(value.bytes) &&
      value.bytes > 0 &&
      typeof value.files === 'number' &&
      Number.isInteger(value.files) &&
      value.files > 0 &&
      isIsoDateString(value.importedAt)
    )
  }
  return true
}

export const isSkillExportResultData = (value: unknown): value is SkillExportResult => {
  if (!isRecord(value) || typeof value.success !== 'boolean') return false
  if (value.skillName !== undefined && !isNonEmptyString(value.skillName)) return false
  if (value.bytes !== undefined && !isNonNegativeNumber(value.bytes)) return false
  if (value.exportedAt !== undefined && !isIsoDateString(value.exportedAt)) return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.success) {
    return isNonEmptyString(value.skillName) && isNonEmptyString(value.filePath) && isNonNegativeNumber(value.bytes) && value.bytes > 0 && isIsoDateString(value.exportedAt)
  }
  return value.filePath === undefined || typeof value.filePath === 'string'
}
