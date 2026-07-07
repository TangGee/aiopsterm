import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        external: ['node-pty', 'better-sqlite3', 'ssh2']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [vue()],
    build: {
      commonjsOptions: {
        include: [/node_modules/, /vendor\/xterm/]
      },
      rollupOptions: {
        output: {
          // 兜底拆分大依赖，防止被意外并入首屏 index chunk；monaco 主体依赖动态导入拆分
          manualChunks(id: string) {
            if (id.includes('node_modules/monaco-editor/')) return 'monaco'
            if (id.includes('node_modules/mermaid/')) return 'mermaid'
            if (id.includes('node_modules/highlight.js/')) return 'hljs'
            if (id.includes('node_modules/@xterm/') || id.includes('vendor/xterm/')) return 'xterm'
            return undefined
          }
        }
      }
    },
    worker: {
      format: 'es'
    }
  }
})
