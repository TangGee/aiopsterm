import { afterEach, describe, expect, it } from 'vitest'
import { shouldRunMcpDiscovery, shouldUseE2eDialogFixtures } from '../src/shared/runtimeSwitches'

const originalNodeEnv = process.env.NODE_ENV
const originalDialogFixtures = process.env.AIOPSTERM_E2E_DIALOG_FIXTURES
const originalMcpDiscoveryDisable = process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE

describe('runtime switch boundaries', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalDialogFixtures === undefined) {
      delete process.env.AIOPSTERM_E2E_DIALOG_FIXTURES
    } else {
      process.env.AIOPSTERM_E2E_DIALOG_FIXTURES = originalDialogFixtures
    }
    if (originalMcpDiscoveryDisable === undefined) {
      delete process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE
    } else {
      process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE = originalMcpDiscoveryDisable
    }
  })

  it('does not infer E2E dialog fixtures from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_E2E_DIALOG_FIXTURES

    expect(shouldUseE2eDialogFixtures()).toBe(false)

    process.env.AIOPSTERM_E2E_DIALOG_FIXTURES = '1'
    expect(shouldUseE2eDialogFixtures()).toBe(true)
  })

  it('runs MCP discovery by default in NODE_ENV=test unless explicitly disabled', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE

    expect(shouldRunMcpDiscovery()).toBe(true)

    process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE = '1'
    expect(shouldRunMcpDiscovery()).toBe(false)
  })
})
