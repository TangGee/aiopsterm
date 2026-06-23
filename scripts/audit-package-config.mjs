import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')

const packageScripts = packageJson.scripts || {}
const requiredScripts = [
  'build:codex',
  'audit:codex-runtime',
  'audit:packaged-app',
  'smoke:packaged',
  'build:mac',
  'build:mac:dir',
  'build:deb',
  'build:linux',
  'build:win',
  'build:win:dir'
]
const missingScripts = requiredScripts.filter((script) => typeof packageJson.scripts?.[script] !== 'string')
if (missingScripts.length) {
  throw new Error(`Missing package scripts: ${missingScripts.join(', ')}`)
}

const packageScriptRequirements = {
  'build:linux': ['npm run build:codex', 'electron-builder --linux'],
  'build:deb': ['npm run build:codex', 'electron-builder --linux deb'],
  'build:mac': ['npm run build:codex', 'electron-builder --mac'],
  'build:mac:dir': ['npm run build:codex', 'electron-builder --mac --dir'],
  'build:win': ['npm run build:codex', 'electron-builder --win'],
  'build:win:dir': ['npm run build:codex', 'electron-builder --win --dir']
}
const missingScriptRequirements = Object.entries(packageScriptRequirements).flatMap(([script, snippets]) =>
  snippets.filter((snippet) => !packageScripts[script].includes(snippet)).map((snippet) => `${script}: ${snippet}`)
)
if (missingScriptRequirements.length) {
  throw new Error(`Package scripts are missing required Codex/package steps:\n${missingScriptRequirements.join('\n')}`)
}

const mustContain = [
  '!external-reference/**',
  'linux:',
  '- deb',
  '- AppImage',
  'mac:',
  '- dmg',
  '- zip',
  'win:',
  '- nsis',
  'artifactName: ${name}-${version}-linux-${arch}.${ext}',
  'artifactName: ${name}-${version}-macos-${arch}.${ext}',
  'artifactName: ${name}-${version}-setup-${arch}.${ext}',
  'extraResources:',
  'from: resources/icons',
  'to: icons',
  'from: resources/codex-aiopsterm-mcp.js',
  'to: codex-aiopsterm-mcp.js',
  'from: resources/aiopsterm-external-codex-mcp.js',
  'to: aiopsterm-external-codex-mcp.js',
  'from: resources/aiopsterm-agent-hook.js',
  'to: aiopsterm-agent-hook.js',
  'afterPack: scripts/prune-packaged-native-modules.mjs',
  'schemes:',
  '- aiopsterm'
]

const missingConfig = mustContain.filter((text) => !builderConfig.includes(text))
if (missingConfig.length) {
  throw new Error(`electron-builder.yml is missing required packaging settings:\n${missingConfig.join('\n')}`)
}

const codexBuildEntrypoint = readFileSync(resolve('scripts/build-codex-cli.mjs'), 'utf8')
const codexBuildScript = readFileSync(resolve('scripts/build-codex-cli.sh'), 'utf8')
const codexDevBuildScript = readFileSync(resolve('scripts/build-codex-dev-package.sh'), 'utf8')
const buildAndStartScript = readFileSync(resolve('scripts/build-and-start.sh'), 'utf8')
const afterPackScript = readFileSync(resolve('scripts/prune-packaged-native-modules.mjs'), 'utf8')
const codexPackagingRequirements = [
  { label: 'build-codex node entrypoint', source: packageScripts['build:codex'], text: 'node scripts/build-codex-cli.mjs' },
  { label: 'packaged app audit entrypoint', source: packageScripts['audit:packaged-app'], text: 'node scripts/audit-packaged-app.mjs' },
  { label: 'packaged smoke node entrypoint', source: packageScripts['smoke:packaged'], text: 'node scripts/smoke-packaged-app.mjs' },
  { label: 'build-codex Windows package gate', source: codexBuildEntrypoint, text: "process.platform === 'win32'" },
  { label: 'build-codex Windows audit', source: codexBuildEntrypoint, text: 'audit-codex-runtime.mjs' },
  { label: 'build-codex POSIX shell delegation', source: codexBuildEntrypoint, text: 'build-codex-cli.sh' },
  { label: 'build-codex target triple', source: codexBuildScript, text: 'codexTargetTriple' },
  { label: 'build-codex package builder', source: codexBuildScript, text: 'build_codex_package.py' },
  { label: 'build-codex package output', source: codexBuildScript, text: '--package-dir "${package_dir}"' },
  { label: 'build-codex release profile', source: codexBuildScript, text: '--cargo-profile release' },
  { label: 'build-codex env override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_BIN' },
  { label: 'build-codex package env override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'build-codex bwrap override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_BWRAP_BIN' },
  { label: 'build-codex rg override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_RG_BIN' },
  { label: 'build-codex package output path', source: codexBuildScript, text: 'codexPackageDir' },
  { label: 'afterPack codex package copy', source: afterPackScript, text: 'copyCodexCliPackage' },
  { label: 'afterPack codex package path', source: afterPackScript, text: 'packagedCodexPackageDir' },
  { label: 'afterPack codex env override', source: afterPackScript, text: 'AIOPSTERM_CODEX_BIN' },
  { label: 'afterPack codex package env override', source: afterPackScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'afterPack codex platform output path', source: afterPackScript, text: 'codexPackageDir' },
  { label: 'dev-start codex package build', source: buildAndStartScript, text: 'build-codex-dev-package.sh' },
  { label: 'dev-start codex package env', source: buildAndStartScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'dev-codex target triple', source: codexDevBuildScript, text: 'codexDevTargetTriple' },
  { label: 'dev-codex corrupt cargo cleanup', source: codexDevBuildScript, text: 'aiopsterm_clean_corrupt_codex_cargo_profile' },
  { label: 'dev-codex package builder', source: codexDevBuildScript, text: 'build_codex_package.py' },
  { label: 'dev-codex v8 asset prep', source: codexDevBuildScript, text: 'prepare-codex-dev-assets.mjs' },
  { label: 'dev-codex mirror override', source: readFileSync(resolve('scripts/prepare-codex-dev-assets.mjs'), 'utf8'), text: 'AIOPSTERM_GITHUB_MIRROR' }
]
const missingCodexPackaging = codexPackagingRequirements.filter((item) => !item.source.includes(item.text)).map((item) => item.label)
if (missingCodexPackaging.length) {
  throw new Error(`Codex CLI packaging integration is incomplete:\n${missingCodexPackaging.join('\n')}`)
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
