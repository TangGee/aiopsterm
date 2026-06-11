import { afterEach, describe, expect, it } from 'vitest'
import { defaultSkillSeedData, defaultSkillsConfig, shouldUseSkillSeedData } from '@shared/skillsSeed'

const originalSkillsSeedEnv = process.env.AIOPSTERM_SKILLS_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('skills seed config', () => {
  afterEach(() => {
    if (originalSkillsSeedEnv === undefined) {
      delete process.env.AIOPSTERM_SKILLS_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_SKILLS_ENABLE_SEED = originalSkillsSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer skill seed config from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_SKILLS_ENABLE_SEED

    expect(shouldUseSkillSeedData()).toBe(false)
    expect(defaultSkillsConfig()).toEqual([])
  })

  it('loads skill seed config only when explicitly enabled', () => {
    process.env.AIOPSTERM_SKILLS_ENABLE_SEED = '1'

    const skills = defaultSkillsConfig()

    expect(shouldUseSkillSeedData()).toBe(true)
    expect(skills.map((skill) => skill.name)).toEqual(['incident-triage', 'k8s-rollout'])
    expect(skills).toEqual(defaultSkillSeedData())
  })

  it('returns cloned seed skill rows', () => {
    process.env.AIOPSTERM_SKILLS_ENABLE_SEED = '1'

    const first = defaultSkillsConfig()
    const second = defaultSkillsConfig()
    first[0].name = 'mutated'

    expect(second[0].name).toBe('incident-triage')
  })
})
