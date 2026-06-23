import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isPackageTargetName, packageTargetNames, packageTargets, runNpmScript } from './package-targets.mjs'

const targetName = process.argv[2] || ''
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const version = packageJson.version
const arch = process.arch === 'x64' ? (targetName === 'linux-deb' ? 'amd64' : 'x86_64') : process.arch

const expandArtifact = (pattern) => pattern.replace('${version}', version).replace('${arch}', arch)

if (!isPackageTargetName(targetName)) {
  console.error(`Usage: node scripts/verify-package-target.mjs <${packageTargetNames.join('|')}>`)
  process.exit(2)
}

const target = packageTargets[targetName]
if (target.platform !== process.platform) {
  console.error(`[aiopsterm] ${targetName} verification must run on ${target.platform}; current platform is ${process.platform}.`)
  process.exit(1)
}

for (const script of ['audit:package-config', 'audit:packaged-app', 'smoke:packaged']) {
  const result = runNpmScript(script)
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

const targetAuditScript = targetName === 'linux-deb' ? 'audit:linux-deb' : targetName === 'linux-appimage' ? 'audit:linux-appimage' : ''
if (targetAuditScript) {
  const result = runNpmScript(targetAuditScript)
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

const missing = target.artifacts.map(expandArtifact).map((file) => resolve(file)).filter((file) => !existsSync(file))
if (missing.length) {
  throw new Error(`Missing expected ${targetName} artifact(s):\n${missing.join('\n')}`)
}

console.log(`package-target-verify-ok ${targetName}`)
target.artifacts.map(expandArtifact).forEach((artifact) => console.log(join(process.cwd(), artifact)))
