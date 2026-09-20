import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
  importedTerminalFontFamily,
  MAX_TERMINAL_FONT_BYTES,
  TERMINAL_FONT_EXTENSIONS,
  TERMINAL_FONT_PROTOCOL,
  type ImportedTerminalFont
} from '@shared/terminalFonts'

export const terminalFontsDirectory = (userData: string) => join(userData, 'terminal-fonts')

export const resolveTerminalFontAsset = (directory: string, rawUrl: string) => {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${TERMINAL_FONT_PROTOCOL}:` || url.hostname !== 'local' || !/^\/[a-f0-9]{64}$/.test(url.pathname)) return ''
    return join(directory, `${url.pathname.slice(1)}.font`)
  } catch { return '' }
}

export const importTerminalFont = async (directory: string, source: string): Promise<ImportedTerminalFont> => {
  if (typeof source !== 'string' || !isAbsolute(source) || !TERMINAL_FONT_EXTENSIONS.includes(extname(source).slice(1).toLowerCase())) {
    throw new Error('Select a TTF, OTF, WOFF or WOFF2 font file.')
  }
  const handle = await open(source, 'r')
  let bytes: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 12 || info.size > MAX_TERMINAL_FONT_BYTES) throw new Error('Invalid font file size.')
    bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error('Font file changed while importing.')
      offset += bytesRead
    }
  } finally { await handle.close() }
  const signature = bytes.readUInt32BE(0)
  if (![0x00010000, 0x4f54544f, 0x774f4646, 0x774f4632, 0x74727565].includes(signature)) throw new Error('Invalid font file format.')
  const id = createHash('sha256').update(bytes).digest('hex')
  const font = { id, name: basename(source), family: importedTerminalFontFamily(id) }
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${id}.font`), bytes)
  await writeFile(join(directory, `${id}.json`), JSON.stringify(font))
  return font
}

export const listTerminalFonts = async (directory: string): Promise<ImportedTerminalFont[]> => {
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const fonts: ImportedTerminalFont[] = []
  for (const name of names.filter((value) => /^[a-f0-9]{64}\.json$/.test(value))) {
    try {
      const id = name.slice(0, -5)
      const metadata = JSON.parse(await readFile(join(directory, name), 'utf8')) as ImportedTerminalFont
      if (typeof metadata.name !== 'string' || !names.includes(`${id}.font`)) continue
      fonts.push({ id, name: basename(metadata.name), family: importedTerminalFontFamily(id) })
    } catch { /* Ignore incomplete imports. */ }
  }
  return fonts.sort((left, right) => left.name.localeCompare(right.name))
}
