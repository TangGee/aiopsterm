const envFlagEnabled = (name: string) => {
  try {
    return typeof process !== 'undefined' && String(process.env?.[name] || '').trim() === '1'
  } catch {
    return false
  }
}

export const shouldUseE2eDialogFixtures = () => envFlagEnabled('AIOPSTERM_E2E_DIALOG_FIXTURES')

export const shouldRunMcpDiscovery = () => !envFlagEnabled('AIOPSTERM_MCP_DISCOVERY_DISABLE')

export const shouldUseUserExternalOpenBackendDouble = () => envFlagEnabled('AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE')
