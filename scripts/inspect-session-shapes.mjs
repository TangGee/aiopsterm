import { readdir, open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// Read-only inspection. Only field names and known structural discriminators leave memory.
const roots = process.argv.slice(2)
if (roots.includes('--help')) {
  console.log('Usage: npm run test:corpus:inspect -- [session directories]\nRead-only sample: up to 30 recent JSONL files per root, 512 KiB per file. Prints structure only, never message bodies. This is not an exhaustive parser coverage audit.')
  process.exit(0)
}
const directories = roots.length ? roots.map((root) => resolve(root)) : [
  join(homedir(), '.codex', 'sessions'), join(homedir(), '.claude', 'projects'), join(homedir(), '.kimi-code', 'sessions')
]
for (const root of directories) {
  let files = 0
  const shapes = new Map()
  async function walk(directory, depth = 0) {
    if (depth > 8 || files >= 30) return
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    const dated = await Promise.all(entries.filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.jsonl')))
      .map(async (entry) => ({ entry, mtime: (await stat(join(directory, entry.name)).catch(() => null))?.mtimeMs || 0 })))
    entries = dated.sort((a, b) => b.mtime - a.mtime || b.entry.name.localeCompare(a.entry.name)).map(({ entry }) => entry)
    for (const entry of entries) {
      if (files >= 30) break
      const target = join(directory, entry.name)
      if (entry.isDirectory()) await walk(target, depth + 1)
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      files++
      const handle = await open(target, 'r')
      try {
        const buffer = Buffer.alloc(512 * 1024)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
          let record
          try { record = JSON.parse(line) } catch { continue }
          if (!record || typeof record !== 'object' || Array.isArray(record)) continue
          const kind = [record?.type, record?.payload?.type, record?.event?.type]
            .map((value) => typeof value === 'string' && /^[a-z_.-]{1,64}$/i.test(value) ? value : '').join('/')
          const keys = (value) => value && typeof value === 'object' && !Array.isArray(value)
            ? Object.keys(value).filter((key) => /^[a-zA-Z_]{1,64}$/.test(key)).sort() : []
          const shape = { kind, keys: keys(record), payload: keys(record.payload), event: keys(record.event) }
          const fingerprint = JSON.stringify(shape)
          shapes.set(fingerprint, { ...shape, count: (shapes.get(fingerprint)?.count || 0) + 1 })
        }
      } finally { await handle.close() }
    }
  }
  await walk(root)
  console.log(JSON.stringify({ root, sampledFiles: files, limited: files >= 30, shapes: [...shapes.values()] }, null, 2))
}
