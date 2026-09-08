import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const profile = process.argv[2] || 'core'
const profiles = ['core', 'full', 'visual', 'stress', 'lifecycle', 'faults', 'packaged']
if (profile === '--help') {
  console.log('Usage: npm run test:regression -- <core|full|visual|stress|lifecycle|faults|packaged>\n'
    + 'core: isolated Electron focus, sessions, local AI and MCP.\n'
    + 'full: all deterministic scenarios, all themes and legacy desktop flows.\n'
    + 'visual: all theme screenshots and restart comparisons. Set AIOPSTERM_VISUAL_BASELINES=1 for approved golden checks.\n'
    + 'stress: 20-minute terminal load, memory and teardown budgets.\n'
    + 'lifecycle: 10-minute AI, session viewer and MCP lifecycle, including external process trees and OS handles.\n'
    + 'faults: scoped filesystem errors, SQLite locks and process crashes during session publication.\n'
    + 'packaged: run against AIOPSTERM_PACKAGED_APP or the platform dist directory.\n'
    + 'full and packaged require Claude Code 2.1.220 and Kimi Code 0.29.1 on PATH; CI installs these isolated test clients.\n'
    + 'Set AIOPSTERM_REQUIRE_SIGNATURES=1 to require signed release provenance before package tests.\n'
    + 'Signed release acceptance uses release-signing-windows-latest and release-signing-macos-latest GitHub environments; missing certificates fail closed.\n'
    + 'Native IME candidate windows, cross-monitor transitions and security prompts still require an interactive desktop acceptance run.\n'
    + 'Real external SSH, Kubernetes and paid-model compatibility are separate opt-in test:live commands.')
  process.exit(0)
}
if (!profiles.includes(profile)) throw new Error(`Expected profile: ${profiles.join(', ')}`)
const env = { ...process.env }
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run through npm run test:regression -- <profile>.')
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const npm = (...args) => run(process.execPath, [npmCli, 'run', ...args])
const playwright = (...args) => {
  const invocation = [resolve('node_modules/@playwright/test/cli.js'), 'test', ...args]
  if (process.platform === 'linux' && !process.env.DISPLAY) run('xvfb-run', ['-a', process.execPath, ...invocation])
  else run(process.execPath, invocation)
}
if (profile !== 'packaged') {
  if (profile === 'full') npm('build:codex')
  if (profile !== 'stress') npm('build:cline-sidecar')
  npm('build')
  npm('native:ensure:electron')
}
if (profile === 'core') playwright('-c', 'playwright.regression.config.ts', '--grep', '@core')
if (profile === 'full') {
  env.AIOPSTERM_FULL_VISUAL = '1'
  playwright('-c', 'playwright.regression.config.ts', '--grep-invert', '@lifecycle')
  // Live CLI hooks are a separate opt-in lane, not counted as offline coverage.
  playwright('--grep-invert', 'threaded terminal renderer|managed AI session notifications')
}
if (profile === 'visual') {
  env.AIOPSTERM_FULL_VISUAL = '1'
  playwright('-c', 'playwright.regression.config.ts', '--grep', '@visual')
}
if (profile === 'stress') {
  env.AIOPSTERM_TERMINAL_STRESS = '1'
  env.AIOPSTERM_TERMINAL_STRESS_DURATION_MS ||= String(20 * 60 * 1000)
  playwright('-c', 'playwright.stress.config.ts')
}
if (profile === 'lifecycle') playwright('-c', 'playwright.regression.config.ts', '--grep', '@lifecycle')
if (profile === 'faults') playwright('-c', 'playwright.regression.config.ts', '--grep', '@faults')
if (profile === 'packaged') {
  const dist = resolve(env.AIOPSTERM_DIST_DIR || 'dist')
  const executable = resolve(dist, process.platform === 'win32' ? 'win-unpacked/aiopsterm.exe'
    : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/aiopsterm.app/Contents/MacOS/aiopsterm`
      : 'linux-unpacked/aiopsterm')
  env.AIOPSTERM_PACKAGED_APP ||= executable
  if (env.AIOPSTERM_REQUIRE_SIGNATURES === '1') {
    if (resolve(env.AIOPSTERM_PACKAGED_APP) !== executable) throw new Error('Signed gate requires the executable from the audited package directory.')
    npm('test:release:gate', '--', dist, '--verify', '--require-signatures')
  }
  if (!existsSync(env.AIOPSTERM_PACKAGED_APP)) throw new Error(`Package not found: ${env.AIOPSTERM_PACKAGED_APP}`)
  playwright('-c', 'playwright.packaged.config.ts')
  playwright('-c', 'playwright.regression.config.ts', '--grep-invert', '@lifecycle')
}
