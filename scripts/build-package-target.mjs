import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanPackageTargetOutput, isPackageTargetName, packageTargetNames, packageTargets, runNpmScript } from './package-targets.mjs'

const targetName = process.argv[2] || ''

if (!isPackageTargetName(targetName)) {
  console.error(`Usage: node scripts/build-package-target.mjs <${packageTargetNames.join('|')}>`)
  process.exit(2)
}

const target = packageTargets[targetName]
if (target.platform !== process.platform) {
  console.error(`[aiopsterm] ${targetName} must be built on ${target.platform}; current platform is ${process.platform}.`)
  process.exit(1)
}

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
cleanPackageTargetOutput(targetName, packageJson.version)

const result = runNpmScript(target.buildScript)
process.exit(result.status ?? 1)
