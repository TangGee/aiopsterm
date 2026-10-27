// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractVoiceArchive } from '../src/main/backend/ai/voiceArchiveExtraction'

// Fixed USTAR fixtures containing package/tokens.txt and a nested model file.
// Tests do not require bzip2, Python or another archive creation utility.
const bzip = Buffer.from('QlpoOTFBWSZTWdPh3BkAAKX9gMqQQABAA/3AQAFvr95AGAggAJIJUaiaeI1PUGmmQZMano1BJIUemkBkGI2oDNQfvlNg9hqmABtCSEb7czgVhCGskREIYDDF69+tWFO8TkVgpDAic3iLIc+rnNi8gNaTdE43oC5ERDncXdfkjxEYxua0axxnGJYPmsroSTtuPIdPZ42bVib0U6KhDg6uYxIXilB/F3JFOFCQ0+HcGQ==', 'base64')
const gzip = Buffer.from('H4sIAAAAAAACA+3UQQqDQAyF4Vn3FL2AOlPF9jqDpkVsR9EIHt+pFAqui1D8v01CNlmEl95XrX9Ipl0rYUx1VvNzNiqLYq3Rtlrr8m//njuXX0tztmYH06h+iOvNMa13T2qv/mRwPP0n/0FGlTqTUHW1DGkT9JZ2Icz75L/c5L+wl5z87+EVz/1M7s2s0yC8AAAAAAAAAAAAAAAAgL+zACs6s3YAKAAA', 'base64')
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
const fixture = async (data = bzip, extension = '.tar.bz2') => {
  root = await mkdtemp(join(tmpdir(), 'voice archive '))
  const archive = join(root, `model${extension}`)
  const output = join(root, 'output directory')
  await writeFile(archive, data)
  await mkdir(output)
  return { archive, output }
}

describe('voice archive extraction without a Windows bzip2 executable', () => {
  it.each([false, true])('extracts bzip2 model files with strip=%s and removes the decoded tar', async strip => {
    const { archive, output } = await fixture()
    await extractVoiceArchive(archive, output, strip, new AbortController().signal, 'win32')
    const base = strip ? output : join(output, 'package')
    expect(await readFile(join(base, 'tokens.txt'), 'utf8')).toBe('token-data\n')
    expect(await readFile(join(base, 'nested', 'encoder.int8.onnx'), 'utf8')).toBe('model-fixture\n')
    expect((await readdir(output)).some(name => name.startsWith('.voice-unpacked-'))).toBe(false)
    expect(await readFile(archive)).toEqual(bzip)
  })

  it('keeps gzip runtime package extraction working', async () => {
    const { archive, output } = await fixture(gzip, '.tgz')
    await extractVoiceArchive(archive, output, true, new AbortController().signal, 'win32')
    expect(await readFile(join(output, 'tokens.txt'), 'utf8')).toBe('token-data\n')
    expect((await readdir(output)).sort()).toEqual(['nested', 'tokens.txt'])
  })

  it.each(['truncated', 'corrupt', 'invalid tar'] as const)('rejects %s data and cleans up before retry', async kind => {
    const data = kind === 'truncated' ? bzip.subarray(0, -8) : kind === 'corrupt' ? Buffer.from('invalid compressed data')
      : Buffer.from('QlpoOTFBWSZTWRSf3x8AAAURgEAAKmGVACAAIgaBkIBppoJAEBXunmXLxdyRThQkBSf3x8A=', 'base64')
    const { archive, output } = await fixture(data)
    await expect(extractVoiceArchive(archive, output, false, new AbortController().signal, 'win32')).rejects.toThrow('Voice extraction failed')
    expect(await readdir(output)).toEqual([])
    await writeFile(archive, bzip)
    await extractVoiceArchive(archive, output, false, new AbortController().signal, 'win32')
    expect(await readFile(join(output, 'package', 'tokens.txt'), 'utf8')).toBe('token-data\n')
  })

  it.each(['before start', 'while decoding'])('honors user cancellation %s and leaves no temporary archive', async when => {
    const { archive, output } = await fixture()
    const controller = new AbortController()
    const reason = new Error('User cancelled installation')
    if (when === 'before start') controller.abort(reason)
    const pending = extractVoiceArchive(archive, output, false, controller.signal, 'win32')
    const rejection = expect(pending).rejects.toBe(reason)
    if (when === 'while decoding') controller.abort(reason)
    await rejection
    expect(await readdir(output)).toEqual([])
    expect(await readFile(archive)).toEqual(bzip)
  })
})
