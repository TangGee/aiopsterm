import { defineConfig } from '@playwright/test'

const phase = process.env.AIOPSTERM_INSTALL_PHASE || 'invalid'
if (!['seed-old', 'verify-upgrade', 'verify-reinstall'].includes(phase)) throw new Error('Invalid installed release test phase.')
export default defineConfig({
  testDir: 'tests/installed-e2e', timeout: 90000, workers: 1, retries: 0, forbidOnly: Boolean(process.env.CI),
  outputDir: `test-results/installed-${phase}`,
  reporter: [['list'], ['junit', { outputFile: `test-results/installed-${phase}.xml` }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
