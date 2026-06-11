import type { SkillUserConfig } from './preload'

const defaultSkillSeeds: SkillUserConfig[] = [
  {
    name: 'incident-triage',
    description: 'Collect symptoms, recent changes, and affected services.',
    enabled: true,
    editable: true,
    content: 'When incident triage is requested, collect scope, blast radius, and recent deployments first.'
  },
  {
    name: 'k8s-rollout',
    description: 'Guide Kubernetes rollout inspection and rollback planning.',
    enabled: true,
    editable: true,
    content: 'Prefer kubectl describe, events, image pull checks, and rollback safety checks.'
  }
]

const cloneSkill = (skill: SkillUserConfig): SkillUserConfig => ({ ...skill })

export const defaultSkillSeedData = () => defaultSkillSeeds.map(cloneSkill)

const isExplicitSkillSeedEnabled = () => {
  try {
    return typeof process !== 'undefined' && String(process.env?.AIOPSTERM_SKILLS_ENABLE_SEED || '').trim() === '1'
  } catch {
    return false
  }
}

export const shouldUseSkillSeedData = () => isExplicitSkillSeedEnabled()

export const defaultSkillsConfig = () => (shouldUseSkillSeedData() ? defaultSkillSeedData() : [])
