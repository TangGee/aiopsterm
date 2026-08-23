const viteRuntimeFlagNames = [
  'AIOPSTERM_TERMINAL_STRESS',
  'AIOPSTERM_TERMINAL_DEBUG_LOGS',
  'AIOPSTERM_TERMINAL_RENDER_BACKEND'
]

export const setRendererDebugLogsEnabled = (enabled: boolean) => {
  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process || {}
  const env = globalProcess.env || {}
  const runtimeEnv = (globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ || {}
  const value = enabled ? '1' : '0'
  env.AIOPSTERM_TERMINAL_DEBUG_LOGS = value
  runtimeEnv.AIOPSTERM_TERMINAL_DEBUG_LOGS = value
  globalProcess.env = env
  ;(globalThis as { process?: { env?: Record<string, string | undefined> } }).process = globalProcess
  ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = runtimeEnv
}

export const installRendererRuntimeEnv = () => {
  const globalProcess = (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process || {}
  const env = globalProcess.env || {}
  const runtimeEnv = (globalThis as {
    __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined>
  }).__AIOPSTERM_RUNTIME_ENV__ || {}
  const preloadEnv =
    typeof window !== 'undefined' && typeof window.aiops?.runtimeEnv === 'function'
      ? window.aiops.runtimeEnv()
      : {}
  viteRuntimeFlagNames.forEach((name) => {
    const preloadValue = preloadEnv[name]
    if (preloadValue !== undefined) {
      env[name] = String(preloadValue)
      runtimeEnv[name] = String(preloadValue)
    }
    const viteValue = import.meta.env[`VITE_${name}`]
    if (viteValue !== undefined) {
      env[name] = String(viteValue)
      runtimeEnv[name] = String(viteValue)
    }
  })
  globalProcess.env = env
  ;(globalThis as { process?: { env?: Record<string, string | undefined> } }).process = globalProcess
  ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = runtimeEnv
}
