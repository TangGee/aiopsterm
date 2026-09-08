import { mkdir } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(process.argv[2] || 'dist/previous-release')
const headers = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
const response = await fetch('https://api.github.com/repos/TangGee/aiopsterm/releases/latest', { headers, signal: AbortSignal.timeout(30000) })
if (!response.ok) throw new Error(`Previous release lookup failed: ${response.status}`)
const release = await response.json()
const extension = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.deb'
const matches = release.assets.filter((asset) => asset.name.endsWith(extension) && (process.arch === 'arm64' ? /arm64|aarch64/i.test(asset.name) : !/arm64|aarch64/i.test(asset.name)))
if (matches.length !== 1) throw new Error(`Expected one previous ${process.platform}/${process.arch} installer, found ${matches.length}.`)
const asset = matches[0]
if (basename(asset.name) !== asset.name || /[\\\r\n]/.test(asset.name)) throw new Error('Invalid release asset filename.')
await mkdir(root, { recursive: true })
const downloaded = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000) })
if (!downloaded.ok || !downloaded.body) throw new Error(`Installer download failed: ${downloaded.status}`)
const path = join(root, asset.name)
await pipeline(Readable.fromWeb(downloaded.body), createWriteStream(path, { flags: 'wx' }))
const hash = createHash('sha256')
for await (const chunk of createReadStream(path)) hash.update(chunk)
const digest = `sha256:${hash.digest('hex')}`
if (asset.digest && asset.digest !== digest) throw new Error('Previous installer checksum differs from GitHub release metadata.')
console.log(`Previous release ${release.tag_name}: ${digest}`)
console.log(path)
if (process.env.GITHUB_ENV) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(process.env.GITHUB_ENV, `AIOPSTERM_PREVIOUS_INSTALLER=${path}\n`)
}
