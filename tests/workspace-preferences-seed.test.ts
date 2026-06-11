import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultWorkspacePreferencesConfig,
  defaultWorkspacePreferencesData,
  defaultWorkspacePreferencesSeedData,
  shouldUseWorkspacePreferencesSeedData
} from '@shared/workspacePreferencesSeed'

const originalWorkspacePreferencesSeedEnv = process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('workspace preferences seed config', () => {
  afterEach(() => {
    if (originalWorkspacePreferencesSeedEnv === undefined) {
      delete process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED = originalWorkspacePreferencesSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer development expanded groups from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED

    expect(shouldUseWorkspacePreferencesSeedData()).toBe(false)
    expect(defaultWorkspacePreferencesConfig()).toEqual({
      expandedGroups: ['recent_connections', 'local_connections'],
      showIpMode: false
    })
    expect(defaultWorkspacePreferencesConfig()).toEqual(defaultWorkspacePreferencesData())
  })

  it('loads development expanded groups only when explicitly enabled', () => {
    process.env.NODE_ENV = 'production'
    process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED = '1'

    expect(shouldUseWorkspacePreferencesSeedData()).toBe(true)
    expect(defaultWorkspacePreferencesConfig()).toEqual({
      expandedGroups: ['recent_connections', 'group-生产', 'group-预发', 'local_connections', 'org-1', 'custom-folder-a'],
      showIpMode: false
    })
    expect(defaultWorkspacePreferencesConfig()).toEqual(defaultWorkspacePreferencesSeedData())
  })

  it('returns cloned workspace preferences snapshots', () => {
    process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED = '1'

    const first = defaultWorkspacePreferencesConfig()
    const second = defaultWorkspacePreferencesConfig()
    first.expandedGroups.push('mutated')

    expect(second.expandedGroups).not.toContain('mutated')
  })
})
