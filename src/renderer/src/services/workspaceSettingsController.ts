import { ref, type Ref } from 'vue'
import { localFilesClient } from '@/services/localFilesClient'
import { type ShortcutActionHandler } from '@/services/shortcutRuntime'
import {
  isSkillContentResultData,
  isSkillDeleteResultForRequest,
  isSkillEnabledResultForRequest,
  isSkillExportResultData,
  isSkillImportResultData,
  isSkillsSnapshotData,
  isSkillWriteResultForRequest,
  malformedSkillsBackendResultMessage,
  snapshotContainsSkill
} from '@/services/skillsBackendGuards'
import { skillsClient } from '@/services/skillsClient'
import {
  createWorkspaceSettingsPreferencesController,
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut
} from '@/services/workspaceSettingsPreferencesController'
import {
  mergeUserConfig,
  normalizeSkillsConfig
} from '@/services/workspaceConfigRuntime'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceSettingsSkill = SkillUserConfig
export type { WorkspaceSettingsRule, WorkspaceSettingsShortcut } from '@/services/workspaceSettingsPreferencesController'
export type WorkspaceSkillModalState = {
  mode: 'create' | 'edit' | null
  name: string
  description: string
  content: string
}

type WorkspaceSettingsControllerState = {
  config: Ref<UserConfig>
  settingsSkills: Ref<WorkspaceSettingsSkill[]>
  skillsUserPath: Ref<string>
  skillModal: Ref<WorkspaceSkillModalState>
  settingsRules: Ref<WorkspaceSettingsRule[]>
  settingsShortcuts: Ref<WorkspaceSettingsShortcut[]>
  shortcutRecording: Ref<{ actionId: string | null; tempShortcut: string }>
}

type WorkspaceSettingsControllerDeps = {
  setSettingsNotice: (message: string) => void
  shortcutHandlers: Record<string, ShortcutActionHandler>
}

const cloneSkillConfig = (skills: WorkspaceSettingsSkill[]): SkillUserConfig[] =>
  skills
    .filter((skill) => skill.name.trim() && skill.description.trim() && skill.content.trim())
    .map((skill) => ({
      name: skill.name.trim(),
      description: skill.description.trim(),
      enabled: skill.enabled !== undefined ? skill.enabled : true,
      editable: skill.editable !== undefined ? skill.editable : true,
      content: skill.content.trim(),
      ...(skill.path ? { path: skill.path } : {})
    }))

export const createWorkspaceSettingsController = (state: WorkspaceSettingsControllerState, deps: WorkspaceSettingsControllerDeps) => {
  const {
    config,
    settingsSkills,
    skillsUserPath,
    skillModal,
    settingsRules,
    settingsShortcuts,
    shortcutRecording
  } = state
  const { setSettingsNotice, shortcutHandlers } = deps

  const pendingSkillImportOverwritePath = ref('')
  let removeSkillsUpdateListener: (() => void) | null = null

  const getSkillsSnapshot = (): SkillUserConfig[] => cloneSkillConfig(settingsSkills.value)

  const preferencesController = createWorkspaceSettingsPreferencesController(
    {
      config,
      settingsRules,
      settingsShortcuts,
      shortcutRecording
    },
    {
      setSettingsNotice,
      shortcutHandlers
    }
  )

  const applySkillsList = (skills: SkillUserConfig[]) => {
    const { normalized } = normalizeSkillsConfig(skills)
    settingsSkills.value = normalized.map((skill) => ({ ...skill }))
    config.value = mergeUserConfig(config.value, { skills: normalized })
    return normalized
  }

  const installSkillsUpdateListener = () => {
    const onSkillsUpdate = skillsClient.onSkillsUpdate()
    if (removeSkillsUpdateListener || !onSkillsUpdate) return
    removeSkillsUpdateListener = onSkillsUpdate((skills) => {
      if (!isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      applySkillsList(skills)
    })
  }

  const readSkillsSnapshotFromBridge = async () => {
    const getSkills = skillsClient.getSkills()
    if (!getSkills) return false
    try {
      installSkillsUpdateListener()
      const getSkillsUserPath = skillsClient.getSkillsUserPath()
      const [path, skills] = await Promise.all([
        getSkillsUserPath ? getSkillsUserPath() : Promise.resolve(skillsUserPath.value),
        getSkills()
      ])
      if (typeof path !== 'string' || !isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return null
      }
      skillsUserPath.value = path
      return skills
    } catch {
      setSettingsNotice('Skills 加载失败')
      return null
    }
  }

  const hydrateSkills = async (savedSkills: unknown) => {
    const savedSkillsSnapshot = normalizeSkillsConfig(savedSkills)
    const bridgeSkills = await readSkillsSnapshotFromBridge()
    const {
      normalized: normalizedSkills,
      changed: rawSkillsChanged
    } = normalizeSkillsConfig(bridgeSkills || savedSkills)
    const skillsChanged = bridgeSkills ? savedSkillsSnapshot.changed : rawSkillsChanged
    settingsSkills.value = normalizedSkills.map((skill) => ({ ...skill }))
    return {
      normalizedSkills,
      skillsChanged
    }
  }

  const loadSkillsFromBridge = async (options: { expect?: (skills: SkillUserConfig[]) => boolean; malformedMessage?: string } = {}) => {
    const skills = await readSkillsSnapshotFromBridge()
    if (!skills) return false
    if (options.expect && !options.expect(skills)) {
      setSettingsNotice(options.malformedMessage || malformedSkillsBackendResultMessage)
      return false
    }
    applySkillsList(skills)
    return true
  }

  const refreshSkillsAfterMutation = async (expect: (skills: SkillUserConfig[]) => boolean) => {
    return loadSkillsFromBridge({ expect, malformedMessage: malformedSkillsBackendResultMessage })
  }

  const refreshSkillsFromBridge = () => loadSkillsFromBridge()

  const reloadSkills = async () => {
    const reloadSkillsBridge = skillsClient.reloadSkills()
    if (!reloadSkillsBridge) {
      setSettingsNotice('Skills 重新加载服务不可用')
      return false
    }
    try {
      const skills = await reloadSkillsBridge()
      if (!isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      applySkillsList(skills)
      setSettingsNotice('Skills 已重新加载')
      return true
    } catch {
      setSettingsNotice('Skills 重新加载失败')
      return false
    }
  }

  const openSkillsFolder = async () => {
    const openSkillsFolderBridge = skillsClient.openSkillsFolder()
    if (!openSkillsFolderBridge) {
      setSettingsNotice('Skills 文件夹打开服务不可用')
      return false
    }
    try {
      const result = await openSkillsFolderBridge()
      if (!result || typeof result.path !== 'string' || !result.path.trim()) {
        setSettingsNotice('Skills 文件夹打开失败')
        return false
      }
      setSettingsNotice('Skills 文件夹已打开')
      return true
    } catch {
      setSettingsNotice('Skills 文件夹打开失败')
      return false
    }
  }

  const openSkillModal = async (mode: 'create' | 'edit', skillName?: string) => {
    if (mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === skillName)
      if (!skill) return
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return
      }
      const readSkillContent = skillsClient.readSkillContent()
      if (!readSkillContent) {
        setSettingsNotice('Skill 内容读取服务不可用')
        return
      }
      try {
        const result = await readSkillContent(skill.name)
        if (!isSkillContentResultData(result, skill.name)) {
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return
        }
        skillModal.value = {
          mode,
          name: skill.name,
          description: typeof result.metadata.description === 'string' ? result.metadata.description : skill.description,
          content: result.content || skill.content
        }
      } catch {
        setSettingsNotice(`${skill.name} 读取失败`)
      }
      return
    }
    skillModal.value = { mode, name: '', description: '', content: '' }
  }

  const closeSkillModal = () => {
    skillModal.value = { mode: null, name: '', description: '', content: '' }
  }

  const saveSkillModal = async () => {
    const name = skillModal.value.name.trim()
    const description = skillModal.value.description.trim()
    const content = skillModal.value.content.trim()
    if (!name || !description || !content) {
      setSettingsNotice('Skill 名称、描述和内容不能为空')
      return false
    }
    if (skillModal.value.mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === name)
      if (!skill) return false
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return false
      }
      const updateSkill = skillsClient.updateSkill()
      if (!updateSkill) {
        setSettingsNotice('Skill 保存服务不可用')
        return false
      }
      try {
        const result = await updateSkill(name, { name, description }, content)
        if (!isSkillWriteResultForRequest(result, { name, description, content })) {
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return false
        }
        const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, description, content }))
        if (!refreshed) return false
        setSettingsNotice(`${name} 已保存`)
        closeSkillModal()
        return true
      } catch {
        setSettingsNotice(`${name} 保存失败`)
        return false
      }
    }
    const created = await createSkill({ name, description, content }, { closeModal: true })
    return Boolean(created)
  }

  const createSkill = async (
    skill: { name: string; description: string; content: string },
    options: { closeModal?: boolean; duplicateNotice?: boolean; successNotice?: string | false } = {}
  ) => {
    const name = skill.name.trim()
    const description = skill.description.trim()
    const content = skill.content.trim()
    if (!/^[a-z-]+$/.test(name)) {
      setSettingsNotice('Skill 名称只能包含小写字母和连字符')
      return null
    }
    if (settingsSkills.value.some((item) => item.name === name)) {
      if (options.duplicateNotice !== false) setSettingsNotice('Skill 已存在')
      return null
    }
    const createSkillBridge = skillsClient.createSkill()
    if (!createSkillBridge) {
      setSettingsNotice('Skill 创建服务不可用')
      return null
    }
    try {
      const created = await createSkillBridge({ name, description }, content)
      if (!isSkillWriteResultForRequest(created, { name, description, content, enabled: true })) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return null
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, description, content }))
      if (!refreshed) return null
      if (options.successNotice !== false) setSettingsNotice(options.successNotice || `${name} 已创建`)
      if (options.closeModal) closeSkillModal()
      return created.skill
    } catch {
      setSettingsNotice(`${name} 创建失败`)
      return null
    }
  }

  const toggleSkillEnabled = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    const setSkillEnabled = skillsClient.setSkillEnabled()
    if (!setSkillEnabled) {
      setSettingsNotice('Skill 状态服务不可用')
      return
    }
    const previous = skill.enabled
    const nextEnabled = !skill.enabled
    try {
      const result = await setSkillEnabled(name, nextEnabled)
      if (!isSkillEnabledResultForRequest(result, { name, enabled: nextEnabled })) {
        skill.enabled = previous
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, enabled: nextEnabled }))
      if (!refreshed) {
        skill.enabled = previous
        return
      }
      setSettingsNotice(`${name} ${nextEnabled ? '已启用' : '已禁用'}`)
    } catch {
      skill.enabled = previous
      setSettingsNotice(`${name} 状态更新失败`)
    }
  }

  const deleteSkill = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    if (!skill.editable) {
      setSettingsNotice('只能删除用户创建的 Skill')
      return
    }
    const deleteSkillBridge = skillsClient.deleteSkill()
    if (!deleteSkillBridge) {
      setSettingsNotice('Skill 删除服务不可用')
      return
    }
    try {
      const result = await deleteSkillBridge(name)
      if (!isSkillDeleteResultForRequest(result, name)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => !skills.some((item) => item.name === name))
      if (!refreshed) return
      setSettingsNotice(`${name} 已删除`)
    } catch {
      setSettingsNotice(`${name} 删除失败`)
    }
  }

  const showSkillImportError = (errorCode?: string) => {
    const errorMap: Record<string, string> = {
      INVALID_ZIP: 'Skill ZIP 无效',
      NO_SKILL_MD: 'ZIP 中未找到 SKILL.md',
      INVALID_METADATA: 'SKILL.md 元数据无效',
      EXTRACT_FAILED: 'Skill ZIP 解压失败'
    }
    setSettingsNotice(errorMap[errorCode || ''] || 'Skill ZIP 导入失败')
  }

  const importSkillZip = async () => {
    const importSkillZipBridge = skillsClient.importSkillZip()
    if (!importSkillZipBridge) {
      setSettingsNotice('Skill ZIP 导入服务不可用')
      return false
    }
    try {
      if (pendingSkillImportOverwritePath.value) {
        const overwritePath = pendingSkillImportOverwritePath.value
        const overwriteResult = await importSkillZipBridge(overwritePath, true)
        if (!isSkillImportResultData(overwriteResult)) {
          pendingSkillImportOverwritePath.value = ''
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return false
        }
        if (overwriteResult.success) {
          pendingSkillImportOverwritePath.value = ''
          const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name: overwriteResult.skillName! }))
          if (!refreshed) return false
          setSettingsNotice(`${overwriteResult.skillName || 'Skill'} 已覆盖导入`)
          return true
        }
        if (overwriteResult.errorCode === 'DIR_EXISTS') {
          setSettingsNotice('Skill 已存在，再次点击 Import 覆盖')
          return false
        }
        pendingSkillImportOverwritePath.value = ''
        showSkillImportError(overwriteResult.errorCode)
        return false
      }
      const showOpenDialog = localFilesClient.showOpenDialog()
      if (!showOpenDialog) {
        setSettingsNotice('Skill ZIP 选择服务不可用')
        return false
      }
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return false
      const importResult = await importSkillZipBridge(result.filePaths[0])
      if (!isSkillImportResultData(importResult)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      if (importResult.success) {
        const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name: importResult.skillName! }))
        if (!refreshed) return false
        setSettingsNotice(`${importResult.skillName || 'Skill'} 已导入`)
        return true
      }
      if (importResult.errorCode === 'DIR_EXISTS') {
        pendingSkillImportOverwritePath.value = result.filePaths[0]
        setSettingsNotice('Skill 已存在，再次点击 Import 覆盖')
        return false
      }
      showSkillImportError(importResult.errorCode)
      return false
    } catch {
      pendingSkillImportOverwritePath.value = ''
      setSettingsNotice('Skill ZIP 导入失败')
      return false
    }
  }

  const exportSkillZip = async (name: string) => {
    const exportSkillZipBridge = skillsClient.exportSkillZip()
    if (!exportSkillZipBridge) {
      setSettingsNotice(`${name} ZIP 导出服务不可用`)
      return false
    }
    try {
      const result = await exportSkillZipBridge(name)
      if (!isSkillExportResultData(result) || (result.success && result.skillName !== name)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      if (result.success) {
        setSettingsNotice(`${name} 已导出为 ZIP`)
        return true
      } else if (result.error !== 'cancelled') {
        setSettingsNotice(`${name} ZIP 导出失败`)
      }
      return false
    } catch {
      setSettingsNotice(`${name} ZIP 导出失败`)
      return false
    }
  }

  return {
    getShortcutsSnapshot: preferencesController.getShortcutsSnapshot,
    getRulesSnapshot: preferencesController.getRulesSnapshot,
    getSkillsSnapshot,
    refreshShortcutRuntime: preferencesController.refreshShortcutRuntime,
    applySettingsPreferencesSnapshot: preferencesController.applySettingsPreferencesSnapshot,
    hydrateSettingsPreferences: preferencesController.hydrateSettingsPreferences,
    applySkillsList,
    readSkillsSnapshotFromBridge,
    hydrateSkills,
    loadSkillsFromBridge,
    refreshSkillsAfterMutation,
    refreshSkillsFromBridge,
    reloadSkills,
    openSkillsFolder,
    openSkillModal,
    closeSkillModal,
    saveSkillModal,
    createSkill,
    toggleSkillEnabled,
    deleteSkill,
    importSkillZip,
    exportSkillZip,
    addSettingsRule: preferencesController.addSettingsRule,
    editSettingsRule: preferencesController.editSettingsRule,
    updateSettingsRuleDraft: preferencesController.updateSettingsRuleDraft,
    saveSettingsRule: preferencesController.saveSettingsRule,
    cancelSettingsRuleEdit: preferencesController.cancelSettingsRuleEdit,
    toggleSettingsRule: preferencesController.toggleSettingsRule,
    deleteSettingsRule: preferencesController.deleteSettingsRule,
    startShortcutRecording: preferencesController.startShortcutRecording,
    updateShortcutRecording: preferencesController.updateShortcutRecording,
    saveShortcutRecording: preferencesController.saveShortcutRecording,
    cancelShortcutRecording: preferencesController.cancelShortcutRecording,
    resetAllShortcuts: preferencesController.resetAllShortcuts,
    installShortcutRuntime: preferencesController.installShortcutRuntime,
    uninstallShortcutRuntime: preferencesController.uninstallShortcutRuntime
  }
}
