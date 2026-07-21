import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { codexBinaryName, codexPackageDir } from './codex-runtime-paths.mjs'

const packageDirFromBinary = (binaryPath) => {
  const binDir = dirname(binaryPath)
  const packageDir = dirname(binDir)
  if (basename(binDir) !== 'bin') return ''
  return existsSync(join(packageDir, 'codex-package.json')) ? packageDir : ''
}

const explicitPath = process.env.AIOPSTERM_CODEX_BIN || process.argv[2]
const expectedTargetIndex = process.argv.indexOf('--expected-target')
const expectedTarget = expectedTargetIndex >= 0 ? String(process.argv[expectedTargetIndex + 1] || '') : ''
const packageDir = resolve(process.env.AIOPSTERM_CODEX_PACKAGE_DIR || codexPackageDir())
const binary = resolve(explicitPath || join(packageDir, 'bin', codexBinaryName()))
const detectedPackageDir = packageDirFromBinary(binary) || (!explicitPath && packageDir)

if (!existsSync(binary)) {
  throw new Error(`Codex runtime binary is missing: ${binary}`)
}

if (!detectedPackageDir || basename(dirname(binary)) !== 'bin' || basename(binary) !== codexBinaryName()) {
  throw new Error(`Codex runtime must be a package entrypoint at <package>/bin/${codexBinaryName()}: ${binary}`)
}

const requiredPackageFiles = [
  join(detectedPackageDir, 'codex-package.json'),
  join(detectedPackageDir, 'codex-path', process.platform === 'win32' ? 'rg.exe' : 'rg')
]
if (process.platform === 'linux') {
  requiredPackageFiles.push(join(detectedPackageDir, 'codex-resources', 'bwrap'))
}
if (process.platform === 'win32') {
  requiredPackageFiles.push(
    join(detectedPackageDir, 'codex-resources', 'codex-command-runner.exe'),
    join(detectedPackageDir, 'codex-resources', 'codex-windows-sandbox-setup.exe')
  )
}
const missingPackageFiles = requiredPackageFiles.filter((file) => !existsSync(file))
if (missingPackageFiles.length) {
  throw new Error(`Codex runtime package is incomplete:\n${missingPackageFiles.join('\n')}`)
}

const packageMetadata = JSON.parse(readFileSync(join(detectedPackageDir, 'codex-package.json'), 'utf8'))
if (expectedTarget && packageMetadata.target !== expectedTarget) {
  throw new Error(`Codex runtime package target mismatch: expected ${expectedTarget}, found ${packageMetadata.target || 'missing'}`)
}

const mode = statSync(binary).mode
if (process.platform !== 'win32' && (mode & 0o111) === 0) {
  throw new Error(`Codex runtime binary is not executable: ${binary}`)
}

const version = execFileSync(binary, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10000
}).trim()
if (!/^codex-cli\s+\S+/.test(version)) {
  throw new Error(`Codex runtime --version returned an unexpected value: ${version}`)
}

if (process.platform === 'linux') {
  const lddResult = spawnSync('ldd', [binary], { encoding: 'utf8' })
  const ldd = `${lddResult.stdout || ''}${lddResult.stderr || ''}`
  if (/\bnot found\b/.test(ldd)) {
    throw new Error(`Codex runtime has unresolved dynamic dependencies:\n${ldd}`)
  }
  if (/\blibssl\.so\.1\.1\b|\blibcrypto\.so\.1\.1\b/.test(ldd)) {
    throw new Error(`Codex runtime must not depend on OpenSSL 1.1 dynamic libraries:\n${ldd}`)
  }
}

console.log('codex-runtime-audit-ok')
console.log(`package: ${detectedPackageDir}`)
console.log(`codex: ${binary}`)
console.log(`version: ${version}`)
console.log(`target: ${packageMetadata.target || 'unknown'}`)
