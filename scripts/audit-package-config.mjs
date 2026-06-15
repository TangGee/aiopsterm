import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')

const requiredScripts = ['build:mac', 'build:mac:dir', 'build:deb', 'build:linux']
const missingScripts = requiredScripts.filter((script) => typeof packageJson.scripts?.[script] !== 'string')
if (missingScripts.length) {
  throw new Error(`Missing package scripts: ${missingScripts.join(', ')}`)
}

const mustContain = [
  '!external-reference/**',
  'linux:',
  '- deb',
  '- AppImage',
  'mac:',
  '- dmg',
  '- zip',
  'artifactName: ${name}-${version}-linux-${arch}.${ext}',
  'artifactName: ${name}-${version}-macos-${arch}.${ext}',
  'extraResources:',
  'from: resources/icons',
  'to: icons',
  'schemes:',
  '- aiopsterm'
]

const missingConfig = mustContain.filter((text) => !builderConfig.includes(text))
if (missingConfig.length) {
  throw new Error(`electron-builder.yml is missing required packaging settings:\n${missingConfig.join('\n')}`)
}

const iconSizes = [16, 32, 48, 64, 128, 256, 512]
const missingIcons = iconSizes
  .map((size) => resolve('resources/icons', `${size}x${size}.png`))
  .filter((file) => !existsSync(file) || !statSync(file).isFile() || statSync(file).size <= 0)
if (missingIcons.length) {
  throw new Error(`Missing required Linux app icons:\n${missingIcons.join('\n')}`)
}

console.log('package-config-audit-ok')
