import { spawnSync, execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const { extractFile, listPackage } = createRequire(import.meta.url)('@electron/asar')

const root = resolve(process.argv[2] || 'dist')
const signatures = process.argv.includes('--require-signatures')
const verify = process.argv.includes('--verify')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
if (dirty) throw new Error('Source changes are uncommitted; a release cannot be attributed to HEAD. Put artifacts in an ignored output directory.')
const command = (binary, args, env = process.env) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) throw new Error(`${binary} verification failed: ${result.error || result.stderr || result.stdout}`)
}
const digest = async (file) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const extensions = process.platform === 'win32' ? /\.exe$/i : process.platform === 'darwin' ? /\.(dmg|zip)$/i : /\.(AppImage|deb)$/i
const files = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && extensions.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
if (!files.length) throw new Error('No platform release artifacts found; refusing an empty successful audit.')
const artifacts = []
for (const entry of files) {
  const file = join(root, entry.name)
  if (signatures && process.platform === 'win32') {
    command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$s = Get-AuthenticodeSignature -LiteralPath $env:AIOPSTERM_SIGNATURE_FILE; if ($s.Status -ne "Valid") { throw $s.Status }; if (-not $s.TimeStamperCertificate) { throw "Missing trusted timestamp" }'],
    { ...process.env, AIOPSTERM_SIGNATURE_FILE: file })
  }
  if (signatures && process.platform === 'darwin' && file.endsWith('.dmg')) {
    command('codesign', ['--verify', '--verbose=2', file])
    command('xcrun', ['stapler', 'validate', file])
    command('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', file])
  }
  artifacts.push({ file: basename(file), sha256: await digest(file) })
}
const unpackedRoot = join(root, process.platform === 'win32' ? 'win-unpacked'
  : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac') : 'linux-unpacked')
const archive = join(unpackedRoot, ...(process.platform === 'darwin' ? ['aiopsterm.app', 'Contents', 'Resources'] : ['resources']), 'app.asar')
const built = JSON.parse(extractFile(archive, 'out/build-provenance.json').toString())
if (built.schemaVersion !== 1 || built.commit !== sha || built.dirty !== false) throw new Error('Packaged build is dirty or was compiled from a different commit.')
const packagedOutputs = listPackage(archive).map((name) => name.replace(/\\/g, '/').replace(/^\//, ''))
  .filter((name) => name.startsWith('out/') && name !== 'out/build-provenance.json')
for (const [name, expected] of Object.entries(built.files || {})) {
  if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid compiled output path.')
  const actual = createHash('sha256').update(extractFile(archive, `out/${name}`)).digest('hex')
  if (actual !== expected) throw new Error(`Packaged compiled output changed: ${name}`)
}
if (!built.files?.['main/index.js'] || !built.files?.['preload/index.js'] || !built.files?.['renderer/index.html']) throw new Error('Missing compiled output provenance.')
// ASAR listings include directories; any extra file must also be attributed.
for (const name of packagedOutputs) {
  if (Object.hasOwn(built.files, name.slice(4))) continue
  try { extractFile(archive, name) } catch { continue }
  throw new Error(`Unattributed compiled output: ${name}`)
}
const treeHash = createHash('sha256')
const hashTree = async (directory, prefix = '') => {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) await hashTree(join(directory, entry.name), `${name}/`)
    else if (entry.isFile()) treeHash.update(`${name}\0${await digest(join(directory, entry.name))}\n`)
    else if (entry.isSymbolicLink()) treeHash.update(`${name}\0link:${await readlink(join(directory, entry.name))}\n`)
  }
}
// Bind the executable/resources used by E2E to the same provenance as the installer.
await hashTree(unpackedRoot)
const unpackedSha256 = treeHash.digest('hex')
if (signatures && process.platform === 'darwin') {
  const app = join(root, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'aiopsterm.app')
  command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  command('spctl', ['--assess', '--type', 'execute', app])
  command('xcrun', ['stapler', 'validate', app])
}
if (signatures && process.platform === 'win32') {
  command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$s = Get-AuthenticodeSignature -LiteralPath $env:AIOPSTERM_SIGNATURE_FILE; if ($s.Status -ne "Valid") { throw $s.Status }'],
  { ...process.env, AIOPSTERM_SIGNATURE_FILE: join(root, 'win-unpacked', 'aiopsterm.exe') })
}
const manifestPath = join(root, `regression-provenance-${process.platform}.json`)
if (verify) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.commit !== sha || manifest.unpackedSha256 !== unpackedSha256 || JSON.stringify(manifest.artifacts) !== JSON.stringify(artifacts)) throw new Error('Release commit or artifact hashes do not match the build provenance.')
} else {
  await writeFile(manifestPath, JSON.stringify({ commit: sha, platform: process.platform, artifacts, unpackedSha256 }, null, 2) + '\n')
}
console.log(JSON.stringify({ commit: sha, artifacts, unpackedSha256, signatureAudit: signatures ? (process.platform === 'linux' ? 'not-applicable' : 'passed') : 'not-requested' }, null, 2))
