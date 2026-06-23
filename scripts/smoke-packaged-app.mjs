import { _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const defaultExecutablePath = () => {
  if (process.platform === 'win32') return 'dist/win-unpacked/aiopsterm.exe'
  if (process.platform === 'darwin') return 'dist/mac/aiopsterm.app/Contents/MacOS/aiopsterm'
  return 'dist/linux-unpacked/aiopsterm'
}

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.AIOPSTERM_PACKAGED_SMOKE_UNDER_XVFB) {
  const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' })
  if (probe.error?.code !== 'ENOENT') {
    const child = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, AIOPSTERM_PACKAGED_SMOKE_UNDER_XVFB: '1' }
    })
    process.exit(child.status ?? 1)
  }
}

const executablePath = resolve(process.argv[2] || defaultExecutablePath())
const userDataDir = join(tmpdir(), `aiopsterm-packaged-smoke-${Date.now()}`)

if (!existsSync(executablePath)) {
  throw new Error(`Packaged app executable is missing: ${executablePath}`)
}

await mkdir(userDataDir, { recursive: true })

const app = await electron.launch({
  executablePath,
  args: process.platform === 'linux' ? ['--no-sandbox'] : [],
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
