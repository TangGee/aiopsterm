import { ref, type Ref } from 'vue'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isSettingsPreferencesMutationData,
  isSettingsPreferencesSnapshot,
  isSettingsRuleDeleteData,
  malformedSettingsBackendResultMessage
} from '@/services/settingsBackendGuards'
import { settingsPreferencesClient } from '@/services/settingsPreferencesClient'
import { shortcutRuntime, type ShortcutActionHandler } from '@/services/shortcutRuntime'
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
  isValidShortcutForAction,
  mergeUserConfig,
  normalizeRulesConfig,
  normalizeShortcutsConfig,
  normalizeSkillsConfig
} from '@/services/workspaceConfigRuntime'
import type { SettingsPreferencesSnapshot, ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceSettingsRule = UserRuleConfig & { isEditing?: boolean; isDraft?: boolean }
export type WorkspaceSettingsSkill = SkillUserConfig
export type WorkspaceSettingsShortcut = ShortcutUserConfig
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

const cloneShortcutConfig = (shortcuts: WorkspaceSettingsShortcut[]): ShortcutUserConfig[] =>
  shortcuts.map((shortcut) => ({
    id: shortcut.id,
    action: shortcut.action,
    shortcut: shortcut.shortcut,
    ...(shortcut.suffix ? { suffix: shortcut.suffix } : {})
  }))

const cloneRuleConfig = (rules: WorkspaceSettingsRule[]): UserRuleConfig[] =>
  rules
    .filter((rule) => !rule.isDraft && rule.content.trim())
    .map((rule) => ({
      id: rule.id,
      content: rule.content.trim(),
      enabled: rule.enabled !== undefined ? rule.enabled : true
    }))

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

  const getShortcutsSnapshot = (): ShortcutUserConfig[] => cloneShortcutConfig(settingsShortcuts.value)

  const getRulesSnapshot = (): UserRuleConfig[] => cloneRuleConfig(settingsRules.value)

  const getSkillsSnapshot = (): SkillUserConfig[] => cloneSkillConfig(settingsSkills.value)

  const refreshShortcutRuntime = () => {
    shortcutRuntime.update(getShortcutsSnapshot(), shortcutHandlers)
  }

  const applySettingsPreferencesSnapshot = (snapshot: SettingsPreferencesSnapshot) => {
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(snapshot.shortcuts)
    const { normalized: normalizedRules } = normalizeRulesConfig(snapshot.rules)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    config.value = mergeUserConfig(config.value, {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      customInstructions: ''
    })
    refreshShortcutRuntime()
    return {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules
    }
  }

  const hydrateSettingsPreferences = async (savedConfig: UserConfig) => {
    let bridgeSettingsPreferences: SettingsPreferencesSnapshot = {
      shortcuts: normalizeShortcutsConfig(savedConfig.shortcuts).normalized,
      rules: normalizeRulesConfig(savedConfig.rules, savedConfig.customInstructions).normalized
    }
    try {
      const getSettingsPreferences = settingsPreferencesClient.getSettingsPreferences()
      const result = await getSettingsPreferences?.()
      if (result?.ok && isSettingsPreferencesSnapshot(result.data)) {
        bridgeSettingsPreferences = result.data
      } else if (result?.ok) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
      } else if (result && !result.ok) {
        setSettingsNotice(result.errorMessage || '设置偏好加载失败')
      }
    } catch {
      setSettingsNotice('设置偏好加载失败')
    }
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(bridgeSettingsPreferences.shortcuts)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    const { normalized: normalizedRules } = normalizeRulesConfig(bridgeSettingsPreferences.rules)
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    return {
      normalizedShortcuts,
      normalizedRules
    }
  }

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

  const addSettingsRule = () => {
    if (settingsRules.value.some((rule) => rule.isEditing)) return
    settingsRules.value.unshift({ id: 'rule-draft-new', content: '', enabled: true, isEditing: true, isDraft: true })
  }

  const editSettingsRule = (id: string) => {
    settingsRules.value.forEach((rule) => {
      rule.isEditing = rule.id === id
    })
  }

  const updateSettingsRuleDraft = (id: string, content: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (rule) rule.content = content
  }

  const saveSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    if (!rule.content.trim()) {
      if (rule.isDraft) {
        settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
        return false
      }
      return deleteSettingsRule(id)
    }
    const saveSettingsRuleBridge = settingsPreferencesClient.saveSettingsRule()
    if (!saveSettingsRuleBridge) {
      setSettingsNotice('规则保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        ...(rule.isDraft ? {} : { id }),
        content: rule.content,
        enabled: rule.enabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(result.data.message || '规则已保存')
      return true
    } catch {
      setSettingsNotice('规则保存失败')
      return false
    }
  }

  const cancelSettingsRuleEdit = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return
    }
    const savedRule = config.value.rules?.find((item) => item.id === id)
    if (savedRule) {
      rule.content = savedRule.content
      rule.enabled = savedRule.enabled
      rule.isDraft = false
    }
    rule.isEditing = false
  }

  const toggleSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    const nextEnabled = !rule.enabled
    const saveSettingsRuleBridge = settingsPreferencesClient.saveSettingsRule()
    if (!saveSettingsRuleBridge) {
      setSettingsNotice('规则更新服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        id,
        content: rule.content,
        enabled: nextEnabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则更新失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(`规则${nextEnabled ? '已启用' : '已禁用'}`)
      return true
    } catch {
      setSettingsNotice('规则更新失败')
      return false
    }
  }

  const deleteSettingsRule = async (id: string) => {
    const existing = settingsRules.value.find((item) => item.id === id)
    if (!existing) return false
    if (!existing.content.trim() && existing.isDraft) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return true
    }
    const deleteSettingsRuleBridge = settingsPreferencesClient.deleteSettingsRule()
    if (!deleteSettingsRuleBridge) {
      setSettingsNotice('规则删除服务不可用')
      return false
    }
    try {
      const result = await deleteSettingsRuleBridge(id)
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则删除失败')
        return false
      }
      if (!isSettingsRuleDeleteData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice('规则已删除')
      return true
    } catch {
      setSettingsNotice('规则删除失败')
      return false
    }
  }

  const startShortcutRecording = (actionId: string) => {
    shortcutRecording.value = { actionId, tempShortcut: '' }
    shortcutRuntime.setRecording(true)
  }

  const updateShortcutRecording = (shortcut: string) => {
    shortcutRecording.value.tempShortcut = shortcut
  }

  const saveShortcutRecording = async () => {
    const { actionId, tempShortcut } = shortcutRecording.value
    const nextShortcut = tempShortcut.trim()
    if (!actionId || !nextShortcut) return false
    const shortcut = settingsShortcuts.value.find((item) => item.id === actionId)
    if (!shortcut) return false
    if (!isValidShortcutForAction(actionId, nextShortcut)) {
      setSettingsNotice('快捷键格式无效')
      return false
    }
    const conflicted = settingsShortcuts.value.some((item) => item.id !== actionId && item.shortcut === nextShortcut)
    if (conflicted) {
      setSettingsNotice('快捷键已被占用')
      return false
    }
    const saveSettingsShortcutBridge = settingsPreferencesClient.saveSettingsShortcut()
    if (!saveSettingsShortcutBridge) {
      setSettingsNotice('快捷键保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsShortcutBridge({
        id: actionId,
        shortcut: nextShortcut
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已保存')
      return true
    } catch {
      setSettingsNotice('快捷键保存失败')
      return false
    }
  }

  const cancelShortcutRecording = () => {
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    shortcutRuntime.setRecording(false)
  }

  const resetAllShortcuts = async () => {
    const resetSettingsShortcutsBridge = settingsPreferencesClient.resetSettingsShortcuts()
    if (!resetSettingsShortcutsBridge) {
      setSettingsNotice('快捷键重置服务不可用')
      return false
    }
    try {
      const result = await resetSettingsShortcutsBridge()
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键重置失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已全部重置')
      return true
    } catch {
      setSettingsNotice('快捷键重置失败')
      return false
    }
  }

  const installShortcutRuntime = () => {
    shortcutRuntime.install(getShortcutsSnapshot(), shortcutHandlers)
  }

  const uninstallShortcutRuntime = () => {
    shortcutRuntime.destroy()
  }

  return {
    getShortcutsSnapshot,
    getRulesSnapshot,
    getSkillsSnapshot,
    refreshShortcutRuntime,
    applySettingsPreferencesSnapshot,
    hydrateSettingsPreferences,
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
    addSettingsRule,
    editSettingsRule,
    updateSettingsRuleDraft,
    saveSettingsRule,
    cancelSettingsRuleEdit,
    toggleSettingsRule,
    deleteSettingsRule,
    startShortcutRecording,
    updateShortcutRecording,
    saveShortcutRecording,
    cancelShortcutRecording,
    resetAllShortcuts,
    installShortcutRuntime,
    uninstallShortcutRuntime
  }
}
