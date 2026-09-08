const { readdir, readFile, lstat, readlink } = require('node:fs/promises')
const { join } = require('node:path')
const { createHash } = require('node:crypto')

const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
async function compareInstalledPayload(expected, actual, platform = process.platform, prefix = '') {
  const entries = await readdir(expected, { withFileTypes: true })
  const names = new Set(entries.map((entry) => entry.name))
  for (const entry of await readdir(actual, { withFileTypes: true })) {
    const generatedUninstaller = platform === 'win32' && !prefix && entry.isFile() && /^Uninstall aiopsterm\.exe$/i.test(entry.name)
    if (!names.has(entry.name) && !generatedUninstaller) throw new Error(`Unexpected installed payload: ${prefix}${entry.name}`)
  }
  for (const entry of entries) {
    const left = join(expected, entry.name), right = join(actual, entry.name)
    const target = await lstat(right)
    if (entry.isSymbolicLink()) {
      if (!target.isSymbolicLink() || await readlink(left) !== await readlink(right)) throw new Error(`Installed link differs: ${prefix}${entry.name}`)
    } else if (entry.isDirectory()) {
      if (!target.isDirectory()) throw new Error(`Installed directory differs: ${prefix}${entry.name}`)
      await compareInstalledPayload(left, right, platform, `${prefix}${entry.name}/`)
    } else if (entry.isFile()) {
      if (!target.isFile() || await hash(left) !== await hash(right)) throw new Error(`Installed payload differs: ${prefix}${entry.name}`)
    } else throw new Error(`Unsupported installed file: ${prefix}${entry.name}`)
  }
}
module.exports = { compareInstalledPayload }
