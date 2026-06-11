import type { SkillContentResult, SkillExportResult, SkillImportErrorCode, SkillImportResult, SkillUserConfig } from '@shared/preload'

export const malformedSkillsBackendResultMessage = 'Skills 服务返回数据无效'

const skillImportErrorCodes = new Set<SkillImportErrorCode>(['INVALID_ZIP', 'NO_SKILL_MD', 'INVALID_METADATA', 'DIR_EXISTS', 'EXTRACT_FAILED', 'UNKNOWN'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string'

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

export const isSkillImportResultData = (value: unknown): value is SkillImportResult => {
  if (!isRecord(value) || typeof value.success !== 'boolean') return false
  if (value.skillName !== undefined && !isNonEmptyString(value.skillName)) return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !skillImportErrorCodes.has(value.errorCode as SkillImportErrorCode))) return false
  if (value.success) return isNonEmptyString(value.skillName)
  return true
}

export const isSkillExportResultData = (value: unknown): value is SkillExportResult => {
  if (!isRecord(value) || typeof value.success !== 'boolean') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.success) return isNonEmptyString(value.filePath)
  return value.filePath === undefined || typeof value.filePath === 'string'
}
