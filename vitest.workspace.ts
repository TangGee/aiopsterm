import { defineWorkspace } from 'vitest/config'
import { resolve } from 'node:path'
import { nodeSuites } from './tests/node-project'

export default defineWorkspace([
  {
    test: { name: 'node', environment: 'node', globals: true, include: nodeSuites, testTimeout: 15_000 },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } }
  },
  { extends: './vitest.config.ts', test: { name: 'renderer', exclude: nodeSuites } }
])
