import { createReadStream } from 'node:fs'
import { readdir, readFile, readlink, lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, relative, isAbsolute, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

export const digest = async (file) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export const run = (command, args, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} failed (${signal || code}).`)))
})
const inside = (root, path) => {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\')
}
export const treeInventory = async (root, platform = process.platform) => {
  const base = await realpath(root)
  const entries = Object.create(null)
  const walk = async (dir, prefix = '') => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (/[\\\r\n]/.test(entry.name)) throw new Error('Unsupported bundle filename.')
      const name = prefix + entry.name
      const file = join(dir, entry.name)
      const stat = await lstat(file)
      if (stat.isSymbolicLink()) {
        const link = await readlink(file)
        if (isAbsolute(link) || !inside(base, resolve(dirname(file), link)) || !inside(base, await realpath(file))) throw new Error(`Bundle link escapes payload: ${name}`)
        entries[name] = { link }
      } else if (stat.isDirectory()) {
        entries[name] = { directory: true }
        await walk(file, name + '/')
      } else if (stat.isFile()) entries[name] = { sha256: await digest(file), bytes: stat.size, executable: platform !== 'win32' && Boolean(stat.mode & 0o111) }
      else throw new Error(`Unsupported bundle entry: ${name}`)
    }
  }
  await walk(base)
  return entries
}
export const payloadName = (platform) => platform === 'darwin' ? 'aiopsterm.app' : platform === 'win32' ? 'win-unpacked' : (() => { throw new Error('Local signing supports macOS and Windows.') })()
export const verifyCompiledPayload = async (payload, manifest) => {
  const { extractFile, listPackage } = createRequire(import.meta.url)('@electron/asar')
  const archive = join(payload, ...(manifest.platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']), 'app.asar')
  const stamp = JSON.parse(extractFile(archive, join('out', 'build-provenance.json')).toString())
  if (stamp.schemaVersion !== 1 || stamp.commit !== manifest.commit || stamp.dirty !== false) throw new Error('Payload build provenance does not match the requested clean commit.')
  for (const name of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
    if (!stamp.files?.[name]) throw new Error('Missing compiled output provenance.')
  }
  for (const [name, expected] of Object.entries(stamp.files)) {
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid compiled output path.')
    const actual = createHash('sha256').update(extractFile(archive, join('out', ...name.split('/')))).digest('hex')
    if (actual !== expected) throw new Error(`Compiled output changed: ${name}`)
  }
  for (const path of listPackage(archive)) {
    const name = path.replace(/\\/g, '/').replace(/^\//, '')
    if (!name.startsWith('out/') || name === 'out/build-provenance.json' || Object.hasOwn(stamp.files, name.slice(4))) continue
    try { extractFile(archive, join(...name.split('/'))) } catch { continue }
    throw new Error(`Unattributed compiled output: ${name}`)
  }
  const pkg = JSON.parse(extractFile(archive, 'package.json').toString())
  if (pkg.name !== 'aiopsterm' || pkg.version !== manifest.version) throw new Error('Payload product/version does not match the bundle.')
}
export const verifySigningBundle = async (directory, expectedCommit, platform = process.platform) => {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) throw new Error('An explicit full --commit SHA is required.')
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.commit !== expectedCommit || !['darwin', 'win32'].includes(manifest.platform) || manifest.platform !== platform || !['arm64', 'x64'].includes(manifest.arch)) throw new Error('Signing bundle platform, architecture or commit mismatch.')
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version || '')) throw new Error('Invalid release version.')
  const actual = await treeInventory(join(directory, 'content'), manifest.platform)
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Signing bundle content has changed.')
  const payload = join(directory, 'content', 'payload', payloadName(platform))
  await verifyCompiledPayload(payload, manifest)
  return { manifest, payload }
}
