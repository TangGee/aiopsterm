import { defaultWorkspacePreferencesData } from './workspacePreferencesDefaults'
import { shouldUseWorkspacePreferencesSeedData as runtimeShouldUseWorkspacePreferencesSeedData } from './runtimeSwitches'

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
  showIpMode: false,
  recentAssetIds: ['asset-1', 'asset-2']
})

export const shouldUseWorkspacePreferencesSeedData = runtimeShouldUseWorkspacePreferencesSeedData

export { defaultWorkspacePreferencesData } from './workspacePreferencesDefaults'

export const defaultWorkspacePreferencesSeedData = () => cloneWorkspacePreferences(developmentSeedExpandedGroups)

export const defaultWorkspacePreferencesConfig = () =>
  shouldUseWorkspacePreferencesSeedData() ? defaultWorkspacePreferencesSeedData() : defaultWorkspacePreferencesData()
