import { _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const defaultExecutablePath = () => {
  if (process.platform === 'win32') return 'dist/win-unpacked/aiopsterm.exe'
  if (process.platform === 'darwin') {
    return `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/aiopsterm.app/Contents/MacOS/aiopsterm`
  }
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
const testTempDir = process.platform === 'darwin' ? '/tmp' : tmpdir()
const userDataDir = join(testTempDir, `aiops-smoke-${Date.now()}`)
const gitRevisionBase = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: resolve('.'), encoding: 'utf8' }).stdout?.trim() || 'unknown'
const gitDirty = Boolean(spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: resolve('.'), encoding: 'utf8' }).stdout?.trim())
const gitRevision = `${gitRevisionBase}${gitDirty ? '-dirty' : ''}`

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
  await page.locator('button[data-module-key="settings"]').click({ timeout: 15_000 })
  const packagedDocumentation = await page.evaluate(async () =>
    window.aiops.openSettingsDocumentation({ page: 'general', locale: 'zh-CN' })
  )
  const packagedDocumentationPath = packagedDocumentation.path.replaceAll('\\', '/').toLowerCase()
  if (!packagedDocumentationPath.includes('/resources/docs/') || !packagedDocumentation.content.includes('# 通用设置')) {
    throw new Error(`Packaged settings documentation is invalid: ${JSON.stringify(packagedDocumentation)}`)
  }
  const backgroundTile = page.locator('.settings-bg-tile.preset').first()
  await backgroundTile.waitFor({ state: 'visible', timeout: 15_000 })
  const backgroundPreview = await backgroundTile.evaluate(async (element) => {
    const style = getComputedStyle(element)
    const source = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || ''
    const image = new Image()
    const loaded = await new Promise((resolveLoad) => {
      image.onload = () => resolveLoad(image.naturalWidth > 0 && image.naturalHeight > 0)
      image.onerror = () => resolveLoad(false)
      image.src = source
    })
    return {
      loaded,
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize
    }
  })
  if (!backgroundPreview.loaded || backgroundPreview.backgroundSize !== 'cover' || backgroundPreview.backgroundPosition !== '50% 50%') {
    throw new Error(`Packaged background preview is invalid: ${JSON.stringify(backgroundPreview)}`)
  }
  await page.locator('button[data-module-key="workspace"]').click({ timeout: 15_000 })
  await page.getByText('127.0.0.1', { exact: true }).dblclick({ timeout: 15_000 })
  await page.locator('.terminal-tab').first().waitFor({ timeout: 15_000 })
  await page.locator('.terminal-output-mirror').first().waitFor({ timeout: 15_000 })
  console.log(`packaged-smoke-ok ${executablePath} revision=${gitRevision}`)
} finally {
  await app.close()
}
