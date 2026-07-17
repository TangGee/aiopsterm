// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
var __electron_vite_injected_dirname = "/sessions/cool-serene-feynman/mnt/aiopsterm";
var electron_vite_config_default = defineConfig({
  main: {
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/main/index.ts"),
        external: ["node-pty", "better-sqlite3", "ssh2"]
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared"),
        "@": resolve(__electron_vite_injected_dirname, "src/renderer/src")
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
          manualChunks(id) {
            if (id.includes("node_modules/monaco-editor/")) return "monaco";
            if (id.includes("node_modules/mermaid/")) return "mermaid";
            if (id.includes("node_modules/highlight.js/")) return "hljs";
            if (id.includes("node_modules/@xterm/") || id.includes("vendor/xterm/")) return "xterm";
            return void 0;
          }
        }
      }
    },
    worker: {
      format: "es"
    }
  }
});
export {
  electron_vite_config_default as default
};
