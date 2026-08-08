type PlatformInputRuntimeInput = {
  platform: NodeJS.Platform
  setUserDefault: (key: string, type: 'boolean', value: boolean) => void
}

export const configurePlatformInputRuntime = (input: PlatformInputRuntimeInput) => {
  if (input.platform !== 'darwin') return false
  try {
    input.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false)
    return true
  } catch {
    return false
  }
}
