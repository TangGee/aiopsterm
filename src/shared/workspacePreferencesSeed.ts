import { defaultWorkspacePreferencesData } from './workspacePreferencesDefaults'

const developmentSeedExpandedGroups = [
  'recent_connections',
  'group-生产',
  'group-预发',
  'local_connections',
  'org-1',
  'custom-folder-a'
]

const cloneWorkspacePreferences = (expandedGroups: string[]) => ({
  expandedGroups: [...expandedGroups],
  showIpMode: false
})

const isExplicitWorkspacePreferencesSeedEnabled = () => {
  try {
    return typeof process !== 'undefined' && String(process.env?.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED || '').trim() === '1'
  } catch {
    return false
  }
}

export const shouldUseWorkspacePreferencesSeedData = () => isExplicitWorkspacePreferencesSeedEnabled()

export { defaultWorkspacePreferencesData } from './workspacePreferencesDefaults'

export const defaultWorkspacePreferencesSeedData = () => cloneWorkspacePreferences(developmentSeedExpandedGroups)

export const defaultWorkspacePreferencesConfig = () =>
  shouldUseWorkspacePreferencesSeedData() ? defaultWorkspacePreferencesSeedData() : defaultWorkspacePreferencesData()
