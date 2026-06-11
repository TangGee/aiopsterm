import { afterEach, describe, expect, it } from 'vitest'
import { defaultMcpServers, defaultMcpToolStates, shouldUseMcpSeedData } from '../src/shared/mcpSeed'

const originalMcpSeedEnv = process.env.AIOPSTERM_MCP_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('MCP default seed boundary', () => {
  afterEach(() => {
    if (originalMcpSeedEnv === undefined) {
      delete process.env.AIOPSTERM_MCP_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_MCP_ENABLE_SEED = originalMcpSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer MCP seed config from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_MCP_ENABLE_SEED

    expect(shouldUseMcpSeedData()).toBe(false)
    expect(defaultMcpServers()).toEqual([])
    expect(defaultMcpToolStates()).toEqual({})
  })

  it('loads MCP development seed config only when explicitly enabled', () => {
    process.env.NODE_ENV = 'production'
    process.env.AIOPSTERM_MCP_ENABLE_SEED = '1'

    expect(shouldUseMcpSeedData()).toBe(true)
    expect(defaultMcpServers().map((server) => server.name)).toEqual(['filesystem', 'ops-inventory'])
    expect(defaultMcpToolStates()).toEqual({
      'filesystem:read_file': true,
      'filesystem:list_directory': true,
      'ops-inventory:lookup_asset': false
    })
  })
})
