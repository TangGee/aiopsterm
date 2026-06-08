import { _electron as electron } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executablePath = resolve(process.argv[2] || 'dist/linux-unpacked/aiopsterm')
const userDataDir = join(tmpdir(), `aiopsterm-packaged-smoke-${Date.now()}`)

await mkdir(userDataDir, { recursive: true })

const app = await electron.launch({
  executablePath,
  args: ['--no-sandbox'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    AIOPSTERM_USER_DATA_DIR: userDataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
  }
})

try {
  const page = await app.firstWindow({ timeout: 15_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.terminal-tab').filter({ hasText: 'local shell' }).waitFor({ timeout: 15_000 })
  await page.locator('.terminal-output-mirror').first().waitFor({ timeout: 15_000 })
  console.log(`packaged-smoke-ok ${executablePath}`)
} finally {
  await app.close()
}
