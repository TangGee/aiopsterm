import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPackageTargetName, packageTargetArtifactPaths, packageTargetNames, packageTargets, runNpmScript } from './package-targets.mjs'

const targetName = process.argv[2] || ''
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const version = packageJson.version

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

const missing = packageTargetArtifactPaths(targetName, version).filter((file) => !existsSync(file))
if (missing.length) {
  throw new Error(`Missing expected ${targetName} artifact(s):\n${missing.join('\n')}`)
}

console.log(`package-target-verify-ok ${targetName}`)
packageTargetArtifactPaths(targetName, version).forEach((artifact) => console.log(artifact))
