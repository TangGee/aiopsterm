import type { WorkspaceUserConfig } from './preload'

const defaultExpandedGroups = ['recent_connections', 'local_connections']

const cloneWorkspacePreferences = (expandedGroups: string[]): WorkspaceUserConfig => ({
  expandedGroups: [...expandedGroups],
  showIpMode: false
})

export const defaultWorkspacePreferencesData = () => cloneWorkspacePreferences(defaultExpandedGroups)
