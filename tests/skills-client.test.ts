import { afterEach, describe, expect, it, vi } from 'vitest'
import { skillsClient } from '@/services/settings/skillsClient'

const originalAiops = window.aiops

const skills = [
  {
    name: 'incident-triage',
    description: 'Triage production incidents',
    content: '# Incident triage',
    enabled: true,
    editable: true,
    path: '/tmp/skills/incident-triage/SKILL.md'
  }
]

const updatedAt = '2026-06-20T00:00:00.000Z'

const skillWriteResult = (skill: (typeof skills)[number]) => ({
  skill,
  filePath: skill.path!,
  bytes: skill.content.length,
  size: skill.content.length,
  mtimeMs: 1781913600000
})

afterEach(() => {
  window.aiops = originalAiops
})

describe('skillsClient', () => {
  it('returns undefined for unavailable bridge methods and binds Skills bridge methods', async () => {
    const unsubscribe = vi.fn()
    window.aiops = {
      ...originalAiops,
      getSkills: vi.fn(async () => skills),
      setSkillEnabled: vi.fn(async (skillName, enabled) => ({
        skill: { ...skills[0], name: skillName, enabled },
        skills: [{ ...skills[0], name: skillName, enabled }],
        enabled,
        updatedAt
      })),
      getSkillsUserPath: vi.fn(async () => '/tmp/skills'),
      reloadSkills: vi.fn(async () => skills),
      createSkill: vi.fn(async (metadata, content) =>
        skillWriteResult({
          ...skills[0],
          ...metadata,
          content,
          enabled: true,
          path: `/tmp/skills/${metadata.name}/SKILL.md`
        })
      ),
      deleteSkill: vi.fn(async (skillName) => ({
        skillName,
        deleted: true as const,
        deletedPath: `/tmp/skills/${skillName}`,
        remainingSkills: [],
        deletedAt: updatedAt
      })),
      openSkillsFolder: vi.fn(async () => ({
        path: '/tmp/skills'
      })),
      importSkillZip: vi.fn(async (zipPath, overwrite) => ({
        success: true,
        skillName: overwrite ? 'incident-triage' : zipPath.split('/').pop()?.replace(/\.zip$/, '')
      })),
      readSkillContent: vi.fn(async (skillName) => ({
        name: skillName,
        metadata: { name: skillName, description: 'Triage production incidents' },
        content: '# Incident triage'
      })),
      updateSkill: vi.fn(async (skillName, metadata, content) =>
        skillWriteResult({
          ...skills[0],
          name: skillName,
          ...metadata,
          content,
          path: `/tmp/skills/${skillName}/SKILL.md`
        })
      ),
      exportSkillZip: vi.fn(async (skillName) => ({
        success: true,
        skillName,
        filePath: `/tmp/${skillName}.zip`,
        bytes: 128,
        exportedAt: updatedAt
      })),
      onSkillsUpdate: vi.fn(() => unsubscribe)
    }

    await expect(skillsClient.getSkills()?.()).resolves.toEqual(skills)
    await expect(skillsClient.setSkillEnabled()?.('incident-triage', false)).resolves.toEqual(
      expect.objectContaining({
        enabled: false,
        skill: expect.objectContaining({ enabled: false }),
        skills: [expect.objectContaining({ enabled: false })]
      })
    )
    await expect(skillsClient.getSkillsUserPath()?.()).resolves.toBe('/tmp/skills')
    await expect(skillsClient.reloadSkills()?.()).resolves.toEqual(skills)
    await expect(skillsClient.createSkill()?.({ name: 'ops-audit', description: 'Audit ops changes' }, '# Ops audit')).resolves.toEqual(
      expect.objectContaining({
        skill: expect.objectContaining({ name: 'ops-audit', content: '# Ops audit' })
      })
    )
    await expect(skillsClient.deleteSkill()?.('incident-triage')).resolves.toEqual({
      skillName: 'incident-triage',
      deleted: true,
      deletedPath: '/tmp/skills/incident-triage',
      remainingSkills: [],
      deletedAt: updatedAt
    })
    await expect(skillsClient.openSkillsFolder()?.()).resolves.toEqual({ path: '/tmp/skills' })
    await expect(skillsClient.importSkillZip()?.('/tmp/incident-triage.zip', true)).resolves.toEqual({ success: true, skillName: 'incident-triage' })
    await expect(skillsClient.readSkillContent()?.('incident-triage')).resolves.toEqual(
      expect.objectContaining({
        name: 'incident-triage',
        content: '# Incident triage'
      })
    )
    await expect(skillsClient.updateSkill()?.('incident-triage', { name: 'incident-triage', description: 'Updated' }, '# Updated')).resolves.toEqual(
      expect.objectContaining({
        skill: expect.objectContaining({ description: 'Updated', content: '# Updated' })
      })
    )
    await expect(skillsClient.exportSkillZip()?.('incident-triage')).resolves.toEqual({
      success: true,
      skillName: 'incident-triage',
      filePath: '/tmp/incident-triage.zip',
      bytes: 128,
      exportedAt: updatedAt
    })

    const listener = vi.fn()
    expect(skillsClient.onSkillsUpdate()?.(listener)).toBe(unsubscribe)
    expect(window.aiops.setSkillEnabled).toHaveBeenCalledWith('incident-triage', false)
    expect(window.aiops.createSkill).toHaveBeenCalledWith({ name: 'ops-audit', description: 'Audit ops changes' }, '# Ops audit')
    expect(window.aiops.deleteSkill).toHaveBeenCalledWith('incident-triage')
    expect(window.aiops.importSkillZip).toHaveBeenCalledWith('/tmp/incident-triage.zip', true)
    expect(window.aiops.readSkillContent).toHaveBeenCalledWith('incident-triage')
    expect(window.aiops.updateSkill).toHaveBeenCalledWith('incident-triage', { name: 'incident-triage', description: 'Updated' }, '# Updated')
    expect(window.aiops.exportSkillZip).toHaveBeenCalledWith('incident-triage')
    expect(window.aiops.onSkillsUpdate).toHaveBeenCalledWith(listener)

    window.aiops = {
      ...originalAiops,
      getSkills: undefined as any,
      setSkillEnabled: undefined as any,
      getSkillsUserPath: undefined as any,
      reloadSkills: undefined as any,
      createSkill: undefined as any,
      deleteSkill: undefined as any,
      openSkillsFolder: undefined as any,
      importSkillZip: undefined as any,
      readSkillContent: undefined as any,
      updateSkill: undefined as any,
      exportSkillZip: undefined as any,
      onSkillsUpdate: undefined as any
    }
    expect(skillsClient.getSkills()).toBeUndefined()
    expect(skillsClient.setSkillEnabled()).toBeUndefined()
    expect(skillsClient.getSkillsUserPath()).toBeUndefined()
    expect(skillsClient.reloadSkills()).toBeUndefined()
    expect(skillsClient.createSkill()).toBeUndefined()
    expect(skillsClient.deleteSkill()).toBeUndefined()
    expect(skillsClient.openSkillsFolder()).toBeUndefined()
    expect(skillsClient.importSkillZip()).toBeUndefined()
    expect(skillsClient.readSkillContent()).toBeUndefined()
    expect(skillsClient.updateSkill()).toBeUndefined()
    expect(skillsClient.exportSkillZip()).toBeUndefined()
    expect(skillsClient.onSkillsUpdate()).toBeUndefined()
  })
})
