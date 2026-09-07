import { defineConfig } from '@playwright/test'
import desktop from './playwright.config'

export default defineConfig(desktop, {
  testMatch: '**/terminal-stress.spec.ts',
  outputDir: 'test-results/terminal-stress/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/terminal-stress', open: 'never' }],
    ['junit', { outputFile: 'test-results/terminal-stress.xml' }]]
})
