import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type SkillsBridge = Pick<
  AiopsPreloadApi,
  | 'getSkills'
  | 'setSkillEnabled'
  | 'getSkillsUserPath'
  | 'reloadSkills'
  | 'createSkill'
  | 'deleteSkill'
  | 'openSkillsFolder'
  | 'importSkillZip'
  | 'readSkillContent'
  | 'updateSkill'
  | 'exportSkillZip'
  | 'onSkillsUpdate'
>

const bridgeMethod = <Name extends keyof SkillsBridge>(name: Name): SkillsBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as SkillsBridge[Name]) : undefined
}

export const skillsClient = {
  getSkills: () => bridgeMethod('getSkills'),
  setSkillEnabled: () => bridgeMethod('setSkillEnabled'),
  getSkillsUserPath: () => bridgeMethod('getSkillsUserPath'),
  reloadSkills: () => bridgeMethod('reloadSkills'),
  createSkill: () => bridgeMethod('createSkill'),
  deleteSkill: () => bridgeMethod('deleteSkill'),
  openSkillsFolder: () => bridgeMethod('openSkillsFolder'),
  importSkillZip: () => bridgeMethod('importSkillZip'),
  readSkillContent: () => bridgeMethod('readSkillContent'),
  updateSkill: () => bridgeMethod('updateSkill'),
  exportSkillZip: () => bridgeMethod('exportSkillZip'),
  onSkillsUpdate: () => bridgeMethod('onSkillsUpdate')
}
