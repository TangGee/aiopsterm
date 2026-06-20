/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    aiops: import('@shared/contracts/preloadApi').AiopsPreloadApi
  }
}
