import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import AdmZip from 'adm-zip'

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

const validate = (directory) => {
  const manifestPath = join(directory, 'aiopsterm.plugin.json')
  if (!existsSync(manifestPath)) throw new Error('aiopsterm.plugin.json was not found')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.manifestVersion !== 1 && manifest.manifestVersion !== 2) throw new Error('manifestVersion must be 1 or 2')
  if (!String(manifest.id || '').trim()) throw new Error('id is required')
  if (!String(manifest.displayName || '').trim()) throw new Error('displayName is required')
  if (!String(manifest.version || '').trim()) throw new Error('version is required')
  if (!String(manifest.engines?.aiopsterm || '').trim()) throw new Error('engines.aiopsterm is required')
  if (manifest.manifestVersion === 2) {
    const main = String(manifest.main || '').trim()
    if (!main || main.startsWith('/') || main.split(/[\\/]/).includes('..')) throw new Error('main must be a safe relative path')
    if (!existsSync(join(directory, main)) || !statSync(join(directory, main)).isFile()) throw new Error(`main entry was not found: ${main}`)
  }
  return manifest
}

const command = process.argv[2]
const source = resolve(process.argv[3] || '.')

try {
  const manifest = validate(source)
  if (command === 'check') {
    process.stdout.write(`${manifest.id} ${manifest.version} is valid\n`)
  } else if (command === 'pack') {
    const output = resolve(process.argv[4] || `${basename(source)}-${manifest.version}.aiopsterm-plugin`)
    const zip = new AdmZip()
    zip.addLocalFolder(source)
    writeFileSync(output, zip.toBuffer())
    process.stdout.write(`${output}\n`)
  } else {
    fail('Usage: plugin-cli.mjs check <directory> or plugin-cli.mjs pack <directory> [output]')
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
