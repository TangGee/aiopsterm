import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Renderer adapters named "backend" still need the window/preload environment.
const rendererAdapters = new Set(['database-catalog-connection-backend.test.ts', 'database-sql-data-backend.test.ts'])
const backendSuites = readdirSync(resolve('tests')).filter((name) => /(?:-backend|-ipc)\.test\.ts$/.test(name) && !rendererAdapters.has(name))

// These suites exercise real backend/file contracts without renderer globals.
export const nodeSuites = [
  'tests/regression/**/*.test.ts',
  ...backendSuites.map((name) => `tests/${name}`),
  'tests/product-session-registry.test.ts',
  'tests/database-sqlite-runtime.test.ts',
  'tests/database-sqlite-worker-cancel.test.ts',
  'tests/control-socket-system-runtime.test.ts',
  'tests/agent-session-content-runtime.test.ts',
  'tests/agent-session-parser-registry.test.ts',
  'tests/export-mcp-token-runtime.test.ts',
  'tests/mcp-runtime-normalization.test.ts',
  'tests/theme-runtime.test.ts',
  'tests/theme-tokens-frame.test.ts'
]
