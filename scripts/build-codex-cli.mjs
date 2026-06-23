import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBinaryName, codexPackageDir } from './codex-runtime-paths.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')

const packageDirFromBinary = (binaryPath) => {
  const binDir = dirname(binaryPath)
  const packageDir = dirname(binDir)
  if (basename(binDir) !== 'bin') return ''
  return existsSync(join(packageDir, 'codex-package.json')) ? packageDir : ''
}

const assertCodexPackage = () => {
  const packageDir = resolve(process.env.AIOPSTERM_CODEX_PACKAGE_DIR || codexPackageDir(appRoot))
  const explicitBinary = process.env.AIOPSTERM_CODEX_BIN ? resolve(process.env.AIOPSTERM_CODEX_BIN) : ''
  const binaryPath = explicitBinary || join(packageDir, 'bin', codexBinaryName())
  const detectedPackageDir = explicitBinary ? packageDirFromBinary(binaryPath) : packageDir
  if (!detectedPackageDir || !existsSync(join(detectedPackageDir, 'codex-package.json'))) {
    throw new Error(`Codex package metadata is missing: ${detectedPackageDir || packageDir}`)
  }
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    throw new Error(`Codex CLI binary is missing: ${binaryPath}`)
  }
  console.log(`[aiopsterm] using Codex package: ${detectedPackageDir}`)
  console.log(`[aiopsterm] using Codex CLI binary: ${binaryPath}`)
}

if (process.platform === 'win32') {
  assertCodexPackage()
  const audit = spawnSync(process.execPath, [join(appRoot, 'scripts', 'audit-codex-runtime.mjs')], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env
  })
  process.exit(audit.status ?? 1)
}

const build = spawnSync('bash', [join(appRoot, 'scripts', 'build-codex-cli.sh')], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env
})
process.exit(build.status ?? 1)
