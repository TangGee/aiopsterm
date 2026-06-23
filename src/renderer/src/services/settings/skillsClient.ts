import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

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

const bridgeMethod = createBridgeMethod<SkillsBridge>()

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
