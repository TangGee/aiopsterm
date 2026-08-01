import { describe, expect, it } from 'vitest'

describe('main app config runtime', () => {
  it('persists normalized workspace idle cleanup settings', async () => {
    const modulePath = '../src/main/appConfigRuntime'
    const { defaultConfig, mergeConfig } = await import(modulePath)

    expect(defaultConfig.workspaceIdleCleanup).toEqual({ enabled: false, timeoutMinutes: 20 })
    expect(mergeConfig(defaultConfig, { workspaceIdleCleanup: { enabled: true, timeoutMinutes: 0 } }).workspaceIdleCleanup).toEqual({
      enabled: true,
      timeoutMinutes: 1
    })
    expect(mergeConfig(defaultConfig, { workspaceIdleCleanup: { enabled: false, timeoutMinutes: 2000 } }).workspaceIdleCleanup).toEqual({
      enabled: false,
      timeoutMinutes: 1440
    })
  })

  it('migrates Export MCP database reads as disabled and preserves explicit capability patches', async () => {
    const modulePath = '../src/main/appConfigRuntime'
    const { defaultConfig, mergeConfig } = await import(modulePath)
    expect(defaultConfig.exportMcp).toEqual({
      allowAgentSshAuthSubmit: false,
      allowDatabaseRead: false
    })

    const legacy = mergeConfig(
      { ...defaultConfig, exportMcp: { allowAgentSshAuthSubmit: true } as any },
      {}
    )
    expect(legacy.exportMcp).toEqual({
      allowAgentSshAuthSubmit: true,
      allowDatabaseRead: false
    })

    const enabled = mergeConfig(defaultConfig, {
      exportMcp: {
        allowAgentSshAuthSubmit: false,
        allowDatabaseRead: true
      }
    })
    expect(enabled.exportMcp).toEqual({
      allowAgentSshAuthSubmit: false,
      allowDatabaseRead: true
    })
  })
})
