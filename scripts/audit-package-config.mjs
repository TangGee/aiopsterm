import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')
const clineNodeRuntimePackages = [
  'node-linux-x64',
  'node-linux-arm64',
  'node-darwin-x64',
  'node-bin-darwin-arm64',
  'node-win-x64',
  'node-win-arm64'
]
const clineNodeRuntimeIntegrities = {
  'node-linux-x64': 'sha512-CWyKqAkT1fUBr1IDD/JhDAYpUrBraNmSM9ndREbhAp14QmgBqq8CmgWHITSK1YXzJj+hWTEC1+F6gOgVFLIaSg==',
  'node-linux-arm64': 'sha512-eVexvODYds5ya11f+1D0r33WVf6BGvoSvofyVYQFMFMytblCCwlgJStpOb4IdomSnfVQWLAt0tNgYE5iXxSRuA==',
  'node-darwin-x64': 'sha512-N/X9n9cQYrQb43cVeEWw3uUwTBAVYO1/RKcfzQmwUSmDJxnYvcBu9eHwwLhfpuhHFZ/1ed1HMAOtQYgpSfSalg==',
  'node-bin-darwin-arm64': 'sha512-3tuBY31BRdJlTmVSqCYBj/05j0LK8Ca/MW+VKzkdhO9KBQESNeVAemtpwMt1qVP/chGHvtlvHkguM1xNopPkcg==',
  'node-win-x64': 'sha512-XhYJs77nWcwBDQy6JaCaguvT31j2aUw3M/mGsI0CgGvsGFpYKC9cGdzLkCnAJyj1AD6pNlDYmL29xIjYe+iAbg==',
  'node-win-arm64': 'sha512-6HvEyE3kqKw7HwIo5GEAnyhbF170pJ0LztRSk/D8LSgctnsU+hYrq6/+jeYObeFVehyBsAobZ6KYExjdA8whrA=='
}

const packageScripts = packageJson.scripts || {}
const requiredScripts = [
  'build:codex',
  'build:cline-sidecar',
  'audit:codex-runtime',
  'audit:cline-sidecar',
  'audit:packaged-app',
  'audit:linux-appimage',
  'audit:linux-deb',
  'smoke:packaged',
  'test:e2e:packaged',
  'package:build',
  'package:build:matrix',
  'package:verify',
  'native:ensure:node',
  'native:ensure:electron',
  'rebuild:native:node',
  'rebuild:native:electron',
  'build:linux:appimage',
  'build:mac',
  'build:mac:dir',
  'build:mac:one-click',
  'build:deb',
  'build:linux',
  'build:linux:one-click',
  'build:win',
  'build:win:dir'
]
const missingScripts = requiredScripts.filter((script) => typeof packageJson.scripts?.[script] !== 'string')
if (missingScripts.length) {
  throw new Error(`Missing package scripts: ${missingScripts.join(', ')}`)
}

const packageScriptRequirements = {
  'build:linux:appimage': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --linux AppImage'],
  'build:linux': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --linux'],
  'build:deb': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --linux deb'],
  'build:mac': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --mac'],
  'build:mac:dir': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --mac --dir'],
  'build:win': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --win'],
  'build:win:dir': ['npm run build:codex', 'npm run build:cline-sidecar', 'npm run rebuild:native', 'electron-builder --win --dir']
}
const missingScriptRequirements = Object.entries(packageScriptRequirements).flatMap(([script, snippets]) =>
  snippets.filter((snippet) => !packageScripts[script].includes(snippet)).map((snippet) => `${script}: ${snippet}`)
)
if (missingScriptRequirements.length) {
  throw new Error(`Package scripts are missing required Codex/package steps:\n${missingScriptRequirements.join('\n')}`)
}

const mustContain = [
  '!external-reference/**',
  '!src/**',
  '!node_modules/@cline/**',
  '!node_modules/node-linux-*/**',
  '!node_modules/node-darwin-*/**',
  '!node_modules/node-bin-darwin-*/**',
  '!node_modules/node-win-*/**',
  '!node_modules/@fig/autocomplete-helpers/node_modules/typescript/**',
  'linux:',
  '- deb',
  '- AppImage',
  'toolsets:',
  'appimage: "1.0.3"',
  'appImage:',
  'compression: zstd',
  'mac:',
  'hardenedRuntime: true',
  'notarize: true',
  'entitlements: resources/entitlements.mac.plist',
  'entitlementsInherit: resources/entitlements.mac.plist',
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
  'from: resources/builtin-plugins',
  'to: builtin-plugins',
  'from: build/cline-sidecar',
  'to: cline-sidecar',
  'from: docs',
  'to: docs',
  'afterPack: scripts/prune-packaged-native-modules.mjs',
  'schemes:',
  '- aiopsterm'
]

const missingConfig = mustContain.filter((text) => !builderConfig.includes(text))
if (missingConfig.length) {
  throw new Error(`electron-builder.yml is missing required packaging settings:\n${missingConfig.join('\n')}`)
}

if (packageJson.dependencies?.['@cline/sdk']) {
  throw new Error('@cline/sdk must not be a production dependency; it is compiled into the sidecar at build time.')
}
if (packageJson.devDependencies?.['@cline/sdk'] !== '0.0.59') {
  throw new Error('@cline/sdk must stay exact-pinned to the audited 0.0.59 release.')
}
if (packageJson.devDependencies?.bun !== '1.3.13' || packageJson.devDependencies?.['@types/bun'] !== '1.3.13') {
  throw new Error('Bun and @types/bun must stay exact-pinned to 1.3.13 for the Cline sidecar build.')
}
if (packageJson.devDependencies?.node) {
  throw new Error('The script-installing node wrapper package must not be used for the Cline sidecar runtime.')
}
const invalidNodeRuntimePackages = clineNodeRuntimePackages.filter((name) => {
  const locked = packageLock.packages?.[`node_modules/${name}`]
  return packageJson.optionalDependencies?.[name] !== '22.20.0' ||
    locked?.version !== '22.20.0' ||
    locked?.optional !== true ||
    locked?.integrity !== clineNodeRuntimeIntegrities[name]
})
if (invalidNodeRuntimePackages.length) {
  throw new Error(`Cline sidecar Node runtime packages are not exact/integrity locked: ${invalidNodeRuntimePackages.join(', ')}`)
}

const clinePackagingFiles = [
  'scripts/build-cline-sidecar.mjs',
  'scripts/bundle-cline-sidecar.mjs',
  'scripts/audit-cline-sidecar-runtime.mjs',
  'resources/licenses/cline/LICENSE',
  'resources/licenses/cline/ATTRIBUTION.txt',
  'resources/licenses/cline-sidecar/PROVENANCE.md',
  'resources/licenses/cline-sidecar/opencode-LICENSE',
  'resources/licenses/cline-sidecar/simple-git-LICENSE',
  'resources/licenses/cline-sidecar/node-22.20.0-LICENSE'
]
const missingClinePackagingFiles = clinePackagingFiles.filter((file) => !existsSync(resolve(file)) || !statSync(resolve(file)).isFile())
if (missingClinePackagingFiles.length) {
  throw new Error(`Cline sidecar packaging files are missing:\n${missingClinePackagingFiles.join('\n')}`)
}

const codexBuildEntrypoint = readFileSync(resolve('scripts/build-codex-cli.mjs'), 'utf8')
const clineBuildEntrypoint = readFileSync(resolve('scripts/build-cline-sidecar.mjs'), 'utf8')
const clineBundleEntrypoint = readFileSync(resolve('scripts/bundle-cline-sidecar.mjs'), 'utf8')
const clineAuditEntrypoint = readFileSync(resolve('scripts/audit-cline-sidecar-runtime.mjs'), 'utf8')
const codexBuildScript = readFileSync(resolve('scripts/build-codex-cli.sh'), 'utf8')
const codexDevBuildScript = readFileSync(resolve('scripts/build-codex-dev-package.sh'), 'utf8')
const buildAndStartScript = readFileSync(resolve('scripts/build-and-start.sh'), 'utf8')
const nativeRuntimeScript = readFileSync(resolve('scripts/ensure-native-runtime.mjs'), 'utf8')
const nativeBinaryIntegrityScript = readFileSync(resolve('scripts/native-binary-integrity.mjs'), 'utf8')
const nativeRuntimeHelpersScript = readFileSync(resolve('scripts/native-runtime-helpers.mjs'), 'utf8')
const afterPackScript = readFileSync(resolve('scripts/prune-packaged-native-modules.mjs'), 'utf8')
const packageTargetsScript = readFileSync(resolve('scripts/package-targets.mjs'), 'utf8')
const packagedAppAuditScript = readFileSync(resolve('scripts/audit-packaged-app.mjs'), 'utf8')
const packagedSmokeScript = readFileSync(resolve('scripts/smoke-packaged-app.mjs'), 'utf8')
const packagedE2eSpec = readFileSync(resolve('tests/packaged-e2e/packaged-app.spec.ts'), 'utf8')
const codexPackagingRequirements = [
  { label: 'Cline sidecar build entrypoint', source: packageScripts['build:cline-sidecar'], text: 'node scripts/build-cline-sidecar.mjs' },
  { label: 'Cline sidecar audit entrypoint', source: packageScripts['audit:cline-sidecar'], text: 'node scripts/audit-cline-sidecar-runtime.mjs' },
  { label: 'Cline sidecar Node runtime', source: clineBuildEntrypoint, text: "const NODE_VERSION = '22.20.0'" },
  { label: 'Cline sidecar independent bundle', source: clineBuildEntrypoint, text: "const bundleName = 'cline-agent-sidecar.cjs'" },
  { label: 'Cline sidecar CJS main definition', source: clineBundleEntrypoint, text: "define: { 'import.meta.main': 'true' }" },
  { label: 'Cline sidecar SBOM', source: clineBuildEntrypoint, text: "'sbom.cdx.json'" },
  { label: 'Cline sidecar third-party notices', source: clineBuildEntrypoint, text: "'THIRD-PARTY-NOTICES.txt'" },
  { label: 'Cline sidecar Claude provider exclusion', source: clineBundleEntrypoint, text: "'ai-sdk-provider-claude-code'" },
  { label: 'Cline sidecar SAP provider exclusion', source: clineBundleEntrypoint, text: "'@jerome-benoit/sap-ai-provider'" },
  { label: 'Cline sidecar restricted package audit', source: clineAuditEntrypoint, text: 'restrictedPackagePatterns' },
  { label: 'Cline sidecar provider initialization audit', source: clineAuditEntrypoint, text: 'providerConfigs' },
  { label: 'build-codex node entrypoint', source: packageScripts['build:codex'], text: 'node scripts/build-codex-cli.mjs' },
  { label: 'packaged app audit entrypoint', source: packageScripts['audit:packaged-app'], text: 'node scripts/audit-packaged-app.mjs' },
  { label: 'packaged app Cline Node runtime audit', source: packagedAppAuditScript, text: "clineManifest.nodeVersion !== '22.20.0'" },
  { label: 'packaged app Cline bundle audit', source: packagedAppAuditScript, text: "join(clineSidecar, 'cline-agent-sidecar.cjs')" },
  { label: 'packaged app Cline SBOM audit', source: packagedAppAuditScript, text: "join(clineSidecar, 'sbom.cdx.json')" },
  { label: 'packaged app Cline hash audit', source: packagedAppAuditScript, text: 'Packaged Cline sidecar hashes do not match its manifest.' },
  { label: 'packaged settings documentation audit', source: packagedAppAuditScript, text: "join(resourcesDir, 'docs', 'usage', 'settings', 'zh-CN', 'general.md')" },
  { label: 'packaged settings documentation smoke', source: packagedSmokeScript, text: "openSettingsDocumentation({ page: 'general', locale: 'zh-CN' })" },
  { label: 'packaged app Cline Linux dynamic-link audit', source: packagedAppAuditScript, text: "execFileSync('ldd', [clineNode]" },
  { label: 'linux appimage audit entrypoint', source: packageScripts['audit:linux-appimage'], text: 'node scripts/audit-linux-appimage-package.mjs' },
  { label: 'linux deb audit entrypoint', source: packageScripts['audit:linux-deb'], text: 'node scripts/audit-linux-deb-package.mjs' },
  { label: 'packaged smoke node entrypoint', source: packageScripts['smoke:packaged'], text: 'node scripts/smoke-packaged-app.mjs' },
  { label: 'packaged e2e entrypoint', source: packageScripts['test:e2e:packaged'], text: 'playwright test -c playwright.packaged.config.ts' },
  { label: 'Node test native ABI guard', source: packageScripts.test, text: 'npm run native:ensure:node' },
  { label: 'live SSH test native ABI guard', source: packageScripts['test:live:ssh'], text: 'npm run native:ensure:node' },
  { label: 'Electron dev native ABI guard', source: packageScripts.dev, text: 'npm run native:ensure:electron' },
  { label: 'Electron preview native ABI guard', source: packageScripts.start, text: 'npm run native:ensure:electron' },
  { label: 'Electron e2e native ABI guard', source: packageScripts['test:e2e'], text: 'npm run native:ensure:electron' },
  { label: 'Electron quick e2e native ABI guard', source: packageScripts['test:e2e:quick'], text: 'npm run native:ensure:electron' },
  { label: 'native ABI better-sqlite3 probe', source: nativeRuntimeScript, text: "require('better-sqlite3')" },
  { label: 'native ABI node-pty probe', source: nativeRuntimeScript, text: "require('node-pty')" },
  { label: 'native ABI Electron probe', source: nativeRuntimeScript, text: "env.ELECTRON_RUN_AS_NODE = '1'" },
  { label: 'native ABI Electron rebuild', source: nativeRuntimeScript, text: "resolvePackageBin('@electron/rebuild', 'electron-rebuild')" },
  { label: 'native ABI-keyed binding path', source: nativeRuntimeScript, text: "`node-v${info.modules}-${info.platform}-${info.arch}`" },
  { label: 'native ABI manifest', source: nativeRuntimeScript, text: "'aiopsterm-native-manifest.json'" },
  { label: 'native ABI preparation lock', source: nativeRuntimeScript, text: "'prepare.lock'" },
  { label: 'native ABI Node-only preparation', source: nativeRuntimeScript, text: "target === 'electron' ? ['node', 'electron'] : ['node']" },
  { label: 'native ABI owned lock token', source: nativeRuntimeScript, text: 'ownerToken: randomUUID()' },
  { label: 'native ABI owned lock release', source: nativeRuntimeScript, text: 'lockOwnedBy(contents, owner.ownerToken)' },
  { label: 'native ABI dead lock recovery', source: nativeRuntimeScript, text: 'shouldRecoverLock({' },
  { label: 'native ABI shadow binding cleanup', source: nativeRuntimeScript, text: 'removeShadowBindings()' },
  { label: 'native ABI generated build tree cleanup', source: nativeRuntimeScript, text: "['build', 'out', 'Debug', 'Release', 'compiled', 'addon-build']" },
  { label: 'native ABI cross-build environment cleanup', source: nativeRuntimeScript, text: 'sanitizeNativeRebuildEnvironment(process.env)' },
  { label: 'native ABI complete bindings shadow list', source: nativeRuntimeHelpersScript, text: "resolve(sqliteRoot, 'addon-build', 'default', 'install-root', bindingName)" },
  { label: 'native ABI malformed manifest recovery', source: nativeRuntimeHelpersScript, text: 'parseNativeManifest' },
  { label: 'native ABI preserved secondary runtime record', source: nativeRuntimeHelpersScript, text: 'mergeNativeManifest' },
  { label: 'native binary Mach-O signature normalization', source: nativeBinaryIntegrityScript, text: 'LC_CODE_SIGNATURE' },
  { label: 'native binary Mach-O linkedit normalization', source: nativeBinaryIntegrityScript, text: "segmentName === '__LINKEDIT'" },
  { label: 'native ABI signature-stable hash', source: nativeRuntimeScript, text: 'nativeBinarySha256(bindingPathFor(runtime))' },
  { label: 'packaged SQLite pruning gate', source: afterPackScript, text: 'prunePackagedSqlite(context)' },
  { label: 'packaged SQLite Node ABI removal', source: afterPackScript, text: 'delete packagedManifest.node' },
  { label: 'packaged native build-noise pruning', source: afterPackScript, text: 'prunePackagedNativeBuildNoise(context)' },
  { label: 'macOS local ad-hoc signing fallback', source: afterPackScript, text: 'signMacAppForLocalUse(context)' },
  { label: 'macOS forced local ad-hoc signing', source: afterPackScript, text: "AIOPSTERM_MAC_FORCE_ADHOC_SIGN === '1'" },
  { label: 'packaged SQLite manifest requirement', source: packagedAppAuditScript, text: "'aiopsterm-native-manifest.json'" },
  { label: 'packaged SQLite unique Electron binding gate', source: packagedAppAuditScript, text: 'must contain only its Electron ABI binding' },
  { label: 'packaged SQLite Electron runtime probe', source: packagedAppAuditScript, text: 'Packaged Electron better-sqlite3 probe failed' },
  { label: 'packaged SQLite in-memory query', source: packagedAppAuditScript, text: "new Database(':memory:')" },
  { label: 'package build target entrypoint', source: packageScripts['package:build'], text: 'node scripts/build-package-target.mjs' },
  { label: 'Linux one-click build entrypoint', source: packageScripts['build:linux:one-click'], text: 'scripts/build-linux.sh' },
  { label: 'macOS one-click build entrypoint', source: packageScripts['build:mac:one-click'], text: 'scripts/build-macos.sh' },
  { label: 'package build matrix entrypoint', source: packageScripts['package:build:matrix'], text: 'node scripts/build-package-matrix.mjs' },
  { label: 'package verify target entrypoint', source: packageScripts['package:verify'], text: 'node scripts/verify-package-target.mjs' },
  { label: 'build-codex Windows source build gate', source: codexBuildEntrypoint, text: "process.platform === 'win32'" },
  { label: 'build-codex Windows package builder', source: codexBuildEntrypoint, text: 'build_codex_package.py' },
  { label: 'build-codex Windows command runner', source: codexBuildEntrypoint, text: 'codex-command-runner' },
  { label: 'build-codex Windows sandbox setup', source: codexBuildEntrypoint, text: 'codex-windows-sandbox-setup' },
  { label: 'build-codex Windows command runner override', source: codexBuildEntrypoint, text: 'AIOPSTERM_CODEX_COMMAND_RUNNER_BIN' },
  { label: 'build-codex Windows sandbox setup override', source: codexBuildEntrypoint, text: 'AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN' },
  { label: 'build-codex Windows msvc target', source: readFileSync(resolve('scripts/codex-runtime-paths.mjs'), 'utf8'), text: 'x86_64-pc-windows-msvc' },
  { label: 'build-codex Windows audit', source: codexBuildEntrypoint, text: 'audit-codex-runtime.mjs' },
  { label: 'build-codex Windows release symbol stripping', source: codexBuildEntrypoint, text: 'CARGO_PROFILE_RELEASE_STRIP' },
  { label: 'build-codex POSIX shell delegation', source: codexBuildEntrypoint, text: 'build-codex-cli.sh' },
  { label: 'package target linux appimage', source: packageTargetsScript, text: "'linux-appimage'" },
  { label: 'package target linux deb', source: packageTargetsScript, text: "'linux-deb'" },
  { label: 'package target macos', source: packageTargetsScript, text: 'macos' },
  { label: 'package target windows', source: packageTargetsScript, text: 'windows' },
  { label: 'packaged e2e control notification', source: packagedE2eSpec, text: 'notification.create' },
  { label: 'packaged e2e windows named pipe', source: packagedE2eSpec, text: '\\\\\\\\.\\\\pipe\\\\aiopsterm-control-' },
  { label: 'build-codex target triple', source: codexBuildScript, text: 'codexTargetTriple' },
  { label: 'build-codex package builder', source: codexBuildScript, text: 'build_codex_package.py' },
  { label: 'build-codex package output', source: codexBuildScript, text: '--package-dir "${package_dir}"' },
  { label: 'build-codex release profile', source: codexBuildScript, text: '--cargo-profile release' },
  { label: 'build-codex release symbol stripping', source: codexBuildScript, text: 'CARGO_PROFILE_RELEASE_STRIP' },
  { label: 'build-codex env override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_BIN' },
  { label: 'build-codex package env override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'build-codex bwrap override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_BWRAP_BIN' },
  { label: 'build-codex rg override', source: codexBuildScript, text: 'AIOPSTERM_CODEX_RG_BIN' },
  { label: 'build-codex package output path', source: codexBuildScript, text: 'codexPackageDir' },
  { label: 'codex runtime Windows command runner audit', source: readFileSync(resolve('scripts/audit-codex-runtime.mjs'), 'utf8'), text: 'codex-command-runner.exe' },
  { label: 'codex runtime Windows sandbox setup audit', source: readFileSync(resolve('scripts/audit-codex-runtime.mjs'), 'utf8'), text: 'codex-windows-sandbox-setup.exe' },
  { label: 'packaged app Windows command runner audit', source: packagedAppAuditScript, text: 'codex-command-runner.exe' },
  { label: 'packaged app Windows sandbox setup audit', source: packagedAppAuditScript, text: 'codex-windows-sandbox-setup.exe' },
  { label: 'afterPack codex package copy', source: afterPackScript, text: 'copyCodexCliPackage' },
  { label: 'afterPack codex package path', source: afterPackScript, text: 'packagedCodexPackageDir' },
  { label: 'afterPack codex env override', source: afterPackScript, text: 'AIOPSTERM_CODEX_BIN' },
  { label: 'afterPack codex package env override', source: afterPackScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'afterPack codex platform output path', source: afterPackScript, text: 'codexPackageDir' },
  { label: 'dev-start codex package build', source: buildAndStartScript, text: 'build-codex-dev-package.sh' },
  { label: 'dev-start codex package env', source: buildAndStartScript, text: 'AIOPSTERM_CODEX_PACKAGE_DIR' },
  { label: 'dev-start native ABI guard', source: buildAndStartScript, text: 'npm run native:ensure:electron' },
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
