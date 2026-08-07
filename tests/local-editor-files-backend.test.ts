import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectLocalEditorFile,
  readLocalEditorFile,
  resetLocalEditorFilesRuntimeForTests,
  writeLocalEditorFile
} from '../src/main/backend/files/localEditorFiles'

const tempDirs: string[] = []

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-local-editor-'))
  tempDirs.push(dir)
  return dir
}

describe('local editor files backend', () => {
  afterEach(async () => {
    resetLocalEditorFilesRuntimeForTests()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('canonicalizes and reads existing text files', async () => {
    const dir = await createTempDir()
    const filePath = join(dir, 'note.txt')
    const linkPath = join(dir, 'note-link.txt')
    await writeFile(filePath, 'hello\n', 'utf8')
    await symlink(filePath, linkPath)
    const canonicalFilePath = await realpath(filePath)

    await expect(inspectLocalEditorFile(linkPath)).resolves.toEqual({
      ok: true,
      data: {
        filePath: canonicalFilePath,
        size: 6,
        mtimeMs: expect.any(Number)
      }
    })
    await expect(readLocalEditorFile(filePath)).resolves.toEqual({
      ok: true,
      data: {
        filePath: canonicalFilePath,
        content: 'hello\n',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: 6,
        mtimeMs: expect.any(Number)
      }
    })
  })

  it('rejects relative, missing, directory, binary, and oversized paths', async () => {
    const dir = await createTempDir()
    const binaryPath = join(dir, 'binary.dat')
    const largePath = join(dir, 'large.txt')
    await writeFile(binaryPath, Buffer.from([0x41, 0, 0x42]))
    await writeFile(largePath, Buffer.alloc(2 * 1024 * 1024 + 1, 0x41))

    await expect(inspectLocalEditorFile('relative.txt')).resolves.toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_PATH_INVALID' })
    await expect(inspectLocalEditorFile(join(dir, 'missing.txt'))).resolves.toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_NOT_FOUND' })
    await expect(inspectLocalEditorFile(dir)).resolves.toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_NOT_FILE' })
    await expect(inspectLocalEditorFile(binaryPath)).resolves.toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_BINARY' })
    await expect(inspectLocalEditorFile(largePath)).resolves.toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_TOO_LARGE' })
  })

  it('writes only when the expected disk revision still matches', async () => {
    const dir = await createTempDir()
    const filePath = join(dir, 'note.txt')
    await writeFile(filePath, 'before\n', 'utf8')
    const canonicalFilePath = await realpath(filePath)
    const initial = await readLocalEditorFile(filePath)
    expect(initial.ok).toBe(true)
    await writeFile(filePath, 'external\n', 'utf8')

    const conflict = await writeLocalEditorFile({
      filePath,
      content: 'editor\n',
      expectedMtimeMs: initial.data?.mtimeMs,
      expectedSize: initial.data?.size,
      expectedContentHash: initial.data?.contentHash
    })
    expect(conflict).toMatchObject({ ok: false, errorCode: 'LOCAL_EDITOR_FILE_CONFLICT' })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('external\n')

    const overwritten = await writeLocalEditorFile({
      filePath,
      content: 'editor\n',
      overwrite: true
    })
    expect(overwritten).toMatchObject({ ok: true, data: { filePath: canonicalFilePath, size: 7 } })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('editor\n')
  })
})
