/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    aiops: import('@shared/contracts/preloadApi').AiopsPreloadApi
    __AIOPSTERM_THREADED_TERMINAL_DEBUG__?: {
      stats: () => import('@/services/terminal/threadedTerminalRuntime').ThreadedTerminalDebugStats
    }
  }
}
