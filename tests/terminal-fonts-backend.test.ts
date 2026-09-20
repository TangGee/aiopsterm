import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const setup = async () => {
  const modulePath = '../src/main/backend/files/terminalFonts'
  const backend = await import(modulePath)
  const root = await mkdtemp(join(tmpdir(), 'aiopsterm-fonts-'))
  directories.push(root)
  return { ...backend, root, directory: join(root, 'library') }
}

describe('imported terminal font storage', () => {
  it('copies and deduplicates imported fonts independently of the source file', async () => {
    const { importTerminalFont, listTerminalFonts, resolveTerminalFontAsset, root, directory } = await setup()
    const bytes = await readFile(resolve('src/renderer/src/assets/fonts/SymbolsNerdFontMono-Regular.ttf'))
    const source = join(root, 'My Font.ttf')
    await writeFile(source, bytes)
    const font = await importTerminalFont(directory, source)
    expect(await importTerminalFont(directory, source)).toEqual(font)
    await rm(source)
    expect(await listTerminalFonts(directory)).toEqual([font])
    expect(await readFile(resolveTerminalFontAsset(directory, `aiopsterm-font://local/${font.id}`))).toEqual(bytes)
  })

  it('rejects unsupported files, false font signatures and paths outside the font library', async () => {
    const { importTerminalFont, listTerminalFonts, resolveTerminalFontAsset, root, directory } = await setup()
    const source = join(root, 'broken.ttf')
    await writeFile(source, 'this is not a font file')
    await expect(importTerminalFont(directory, source)).rejects.toThrow('Invalid font file format')
    await expect(importTerminalFont(directory, 'relative.ttf')).rejects.toThrow()
    await expect(importTerminalFont(directory, join(root, 'script.js'))).rejects.toThrow()
    expect(await listTerminalFonts(directory)).toEqual([])
    for (const url of ['file:///etc/passwd', 'aiopsterm-font://local/../../secret', 'aiopsterm-font://other/' + 'a'.repeat(64), 'aiopsterm-font://local/%2e%2e%2fsecret']) {
      expect(resolveTerminalFontAsset(directory, url)).toBe('')
    }
  })
})
