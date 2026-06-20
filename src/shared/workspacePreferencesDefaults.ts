import type { WorkspaceUserConfig } from './contracts/appRuntime'

const defaultExpandedGroups = ['recent_connections', 'local_connections']

const cloneWorkspacePreferences = (expandedGroups: string[]): WorkspaceUserConfig => ({
  expandedGroups: [...expandedGroups],
  showIpMode: false,
  recentAssetIds: []
})

export const defaultWorkspacePreferencesData = () => cloneWorkspacePreferences(defaultExpandedGroups)
