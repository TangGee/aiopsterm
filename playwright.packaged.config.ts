import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/packaged-e2e',
  outputDir: 'test-results/packaged',
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/packaged', open: 'never' }], ['junit', { outputFile: 'test-results/packaged.xml' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
