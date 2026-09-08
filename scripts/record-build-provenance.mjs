import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const output = resolve(process.argv[2] || 'out')
const files = {}
const walk = async (directory, prefix = '') => {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${prefix}${entry.name}`
    if (name === 'build-provenance.json') continue
    if (entry.isDirectory()) await walk(join(directory, entry.name), `${name}/`)
    else if (entry.isFile()) files[name] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')
  }
}
await walk(output)
if (!files['main/index.js'] || !files['preload/index.js'] || !files['renderer/index.html']) throw new Error('Incomplete desktop build.')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
await writeFile(join(output, 'build-provenance.json'), JSON.stringify({ schemaVersion: 1, commit, dirty, files }, null, 2) + '\n')
console.log(`Recorded compiled output provenance for ${commit}; dirty=${dirty}`)
