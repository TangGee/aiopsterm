const viteRuntimeFlagNames = [
  'AIOPSTERM_THREADED_TERMINAL',
  'AIOPSTERM_TERMINAL_STRESS'
]

export const installRendererRuntimeEnv = () => {
  const globalProcess = (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process || {}
  const env = globalProcess.env || {}
  const runtimeEnv = (globalThis as {
    __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined>
  }).__AIOPSTERM_RUNTIME_ENV__ || {}
  viteRuntimeFlagNames.forEach((name) => {
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
