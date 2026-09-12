import { parseArgs } from 'node:util'
import { mkdir, cp, readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { verifySigningBundle, verifyCompiledPayload, treeInventory, run, digest, payloadName } from './local-signing-common.mjs'
import { findSignTool, isWindowsSigningTarget, signWindowsFile, verifyWindowsFile } from './sign-windows-file.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  commit: { type: 'string' }, identity: { type: 'string' }, output: { type: 'string' },
  'notary-profile': { type: 'string', default: 'aiopsterm-notary' }, check: { type: 'boolean' }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log('Usage: node scripts/local-sign-release.mjs <extracted-bundle> --commit <full-sha> --identity <Developer-ID-name-or-Windows-thumbprint> [--output <new-directory>] [--notary-profile aiopsterm-notary] [--check]')
  console.log('Run from the project checkout with npm ci dependencies matching the CI lockfile. No source compilation is performed.\n--check validates the bundle and local tools without signing. The output directory must not exist.\nmacOS requires an unlocked Developer ID Application key and a notarytool Keychain profile.\nWindows requires the certificate in CurrentUser/My, Windows SDK SignTool and an unlocked signing provider such as SimplySign. Run as that signed-in user.\nThe signing flow runs packaged application tests before writing signed-release.json and SHA256SUMS.txt. It does not publish releases.\nStart the Build installers for local signing workflow in GitHub Actions first. Linux artifacts require no local signing.')
  process.exit(0)
}
if (positionals.length !== 1 || !values.identity) throw new Error('Bundle directory, --commit and --identity are required; see --help.')
const directory = resolve(positionals[0])
const { manifest, payload } = await verifySigningBundle(directory, values.commit)
const require = createRequire(import.meta.url)
const tools = { builder: require('electron-builder/package.json').version, osxSign: require('@electron/osx-sign/package.json').version }
if (JSON.stringify(tools) !== JSON.stringify(manifest.tools)) throw new Error('Local packaging tools differ from CI; install dependencies from the same commit lockfile.')
const capture = promisify(execFile)
let windows
if (process.platform === 'darwin') {
  const identities = await capture('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (!values.identity.startsWith('Developer ID Application:') || !identities.stdout.includes(`"${values.identity}"`)) throw new Error('The selected Developer ID Application identity is unavailable.')
  await run('xcrun', ['notarytool', 'history', '--keychain-profile', values['notary-profile'], '--output-format', 'json'], { stdio: 'ignore' })
} else {
  windows = { identity: values.identity, tool: await findSignTool() }
  if (!/^[a-f0-9]{40}$/i.test(windows.identity)) throw new Error('Invalid Windows certificate thumbprint.')
  const script = '$ErrorActionPreference="Stop"; $c=Get-Item ("Cert:\\CurrentUser\\My\\"+$env:AIOPSTERM_VERIFY_IDENTITY); if (-not $c.HasPrivateKey -or $c.NotAfter -lt (Get-Date)) { throw "Signing certificate unavailable or expired" }; if (-not ($c.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3")) { throw "Certificate is not for code signing" }'
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, AIOPSTERM_VERIFY_IDENTITY: windows.identity } })
  await run(windows.tool, ['/?'], { stdio: 'ignore' })
}
console.log(`Verified ${manifest.platform}/${manifest.arch} input from ${manifest.commit}; local signing tools are ready.`)
if (values.check) process.exit(0)
const output = resolve(values.output || `dist/signed-${manifest.platform}-${manifest.arch}-${manifest.commit.slice(0, 12)}`)
// Never replace an earlier release or mutate the downloaded CI payload.
await mkdir(output)
const work = await mkdtemp(join(tmpdir(), 'aiopsterm-local-sign-'))
try {
  const app = join(output, payloadName(process.platform))
  await cp(payload, app, { recursive: true, verbatimSymlinks: true })
  const packageMetadata = JSON.parse(await readFile(join(directory, 'content', 'support', 'package.json'), 'utf8'))
  await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'aiopsterm', version: manifest.version, description: packageMetadata.description, author: packageMetadata.author, main: packageMetadata.main, license: packageMetadata.license }))
  const config = { appId: 'app.aiopsterm.desktop', productName: 'aiopsterm', electronVersion: manifest.electronVersion,
    directories: { output }, publish: null, npmRebuild: false,
    protocols: [{ name: 'aiopsterm', schemes: ['aiopsterm'] }] }
  const { build, Platform, Arch } = require('electron-builder')
  const arch = Arch[manifest.arch]
  if (process.platform === 'darwin') {
    const { signAsync } = require('@electron/osx-sign')
    await signAsync({ app, identity: values.identity, platform: 'darwin', type: 'distribution',
      preAutoEntitlements: false, preEmbedProvisioningProfile: false, gatekeeperAssess: false,
      optionsForFile: () => ({ hardenedRuntime: true, entitlements: join(directory, 'content', 'support', 'entitlements.mac.plist') }) })
    await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
    const { notarize } = require('@electron/notarize')
    await notarize({ appPath: app, keychainProfile: values['notary-profile'] })
    await run('xcrun', ['stapler', 'validate', app])
    await run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
    await build({ projectDir: work, prepackaged: app, targets: Platform.MAC.createTarget(['dmg', 'zip'], arch), publish: 'never',
      config: { ...config, mac: { identity: null, notarize: false, artifactName: '${name}-${version}-macos-${arch}.${ext}' }, dmg: { sign: false } } })
    const dmg = join(output, `aiopsterm-${manifest.version}-macos-${manifest.arch}.dmg`)
    await run('codesign', ['--force', '--sign', values.identity, '--timestamp', dmg])
    const result = await capture('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', values['notary-profile'], '--wait', '--output-format', 'json'], { maxBuffer: 4 * 1024 * 1024 })
    const submission = JSON.parse(result.stdout)
    if (submission.status !== 'Accepted') throw new Error(`DMG notarization failed: ${submission.status}; submission ${submission.id}`)
    await run('xcrun', ['stapler', 'staple', dmg])
    await run('xcrun', ['stapler', 'validate', dmg])
    await run('codesign', ['--verify', '--verbose=2', dmg])
    await run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg])
  } else {
    const files = await treeInventory(app)
    for (const name of Object.keys(files).filter((name) => files[name].sha256 && /\.(exe|dll|node)$/i.test(name))) {
      const file = join(app, name)
      if (await isWindowsSigningTarget(file)) await signWindowsFile(file, windows)
      else console.log(`Preserving non-Windows native module: ${name}`)
    }
    await build({ projectDir: work, prepackaged: app, targets: Platform.WINDOWS.createTarget(['nsis'], arch), publish: 'never',
      config: { ...config, forceCodeSigning: true, win: { icon: join(directory, 'content', 'support', 'icon.ico'), artifactName: '${name}-${version}-setup-${arch}.${ext}',
        signtoolOptions: { signingHashAlgorithms: ['sha256'], sign: async (context) => signWindowsFile(context.path, windows) } } } })
    await verifyWindowsFile(join(output, `aiopsterm-${manifest.version}-setup-${manifest.arch}.exe`), windows)
  }
  await verifyCompiledPayload(app, manifest)
  const signedPayload = await treeInventory(app)
  const executable = process.platform === 'darwin' ? join(app, 'Contents', 'MacOS', 'aiopsterm') : join(app, 'aiopsterm.exe')
  await run(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.packaged.config.ts'], {
    env: { ...process.env, AIOPSTERM_PACKAGED_APP: executable }
  })
  if (JSON.stringify(await treeInventory(app)) !== JSON.stringify(signedPayload)) throw new Error('Signed payload changed during application tests.')
  const artifacts = []
  // Builder generates update hashes before DMG signing/stapling changes the file.
  // This flow publishes standalone installers with final SHA-256 checksums.
  for (const name of await readdir(output)) {
    if (name.endsWith('.blockmap') || /^latest.*\.ya?ml$/.test(name)) await rm(join(output, name))
  }
  for (const name of (await readdir(output)).sort()) {
    if (/\.(dmg|zip|exe)$/.test(name)) artifacts.push({ file: name, sha256: await digest(join(output, name)) })
  }
  if (artifacts.length !== (process.platform === 'darwin' ? 2 : 1)) throw new Error('Unexpected signed artifact set.')
  await writeFile(join(output, 'SHA256SUMS.txt'), artifacts.map((item) => `${item.sha256}  ${item.file}`).join('\n') + '\n')
  await writeFile(join(output, 'signed-release.json'), JSON.stringify({ schemaVersion: 1, commit: manifest.commit, platform: manifest.platform, arch: manifest.arch, version: manifest.version,
    inputManifestSha256: await digest(join(directory, 'manifest.json')), identity: values.identity, notarized: process.platform === 'darwin', artifacts, payload: signedPayload }, null, 2) + '\n')
  console.log(`Signed release verified: ${output}`)
} finally { await rm(work, { recursive: true, force: true }) }
