import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // app-shell.test.ts 单文件上百个重 DOM 测试,负载稍高就会越过 5s 默认线;
    // 15s 仍能兜住真正的挂死,同时消除负载抖动带来的偶发超时。
    testTimeout: 15000
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  }
})
