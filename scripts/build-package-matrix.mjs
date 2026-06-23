import { packageTargetNames, packageTargets, runNpmScript } from './package-targets.mjs'

const requestedTargets = process.argv.slice(2).filter(Boolean)
const targets = requestedTargets.length ? requestedTargets : packageTargetNames.filter((name) => packageTargets[name].platform === process.platform)
const unknown = targets.filter((name) => !packageTargets[name])

if (unknown.length) {
  console.error(`[aiopsterm] Unknown package target(s): ${unknown.join(', ')}`)
  console.error(`Known targets: ${packageTargetNames.join(', ')}`)
  process.exit(2)
}

for (const targetName of targets) {
  const target = packageTargets[targetName]
  if (target.platform !== process.platform) {
    console.error(`[aiopsterm] ${targetName} must be built on ${target.platform}; current platform is ${process.platform}.`)
    process.exit(1)
  }
  const result = runNpmScript(target.buildScript)
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}
