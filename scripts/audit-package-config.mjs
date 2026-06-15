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
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const readPngHeader = (file) => {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size <= 0) return null
  const buffer = readFileSync(file)
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28]
  }
}

const iconSource = resolve('resources/app-icon-source.png')
const sourceHeader = readPngHeader(iconSource)
if (
  !sourceHeader ||
  sourceHeader.width !== sourceHeader.height ||
  sourceHeader.width < 512 ||
  sourceHeader.bitDepth !== 8 ||
  ![2, 6].includes(sourceHeader.colorType) ||
  sourceHeader.interlace !== 0
) {
  throw new Error('resources/app-icon-source.png must be an 8-bit non-interlaced square RGB/RGBA PNG at least 512x512.')
}

const missingIcons = iconSizes
  .map((size) => resolve('resources/icons', `${size}x${size}.png`))
  .filter((file, index) => {
    const header = readPngHeader(file)
    const size = iconSizes[index]
    return !header || header.width !== size || header.height !== size || header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0
  })
if (missingIcons.length) {
  throw new Error(`Missing or invalid required Linux app icons:\n${missingIcons.join('\n')}`)
}

console.log('package-config-audit-ok')
