import { defineConfig } from '@playwright/test'

const reportName = process.env.AIOPSTERM_REGRESSION_REPORT || (process.env.AIOPSTERM_PACKAGED_APP ? 'regression-packaged' : 'regression')
if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error('Invalid regression report directory name.')

export default defineConfig({
  testDir: 'tests/regression',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: `test-results/${reportName}`,
  snapshotPathTemplate: '{testDir}/snapshots/{platform}/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: `playwright-report/${reportName}`, open: 'never' }], ['junit', { outputFile: `test-results/${reportName}.xml` }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
