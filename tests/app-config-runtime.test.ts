import { describe, expect, it } from 'vitest'

describe('main app config runtime', () => {
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
