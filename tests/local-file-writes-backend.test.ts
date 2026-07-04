import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomBackgroundSaveResult, CustomNotificationSoundSaveResult } from '../src/shared/contracts/appRuntime'
import type { LocalFileWriteResult } from '../src/shared/contracts/localFiles'

type LocalFileWritesBackend = {
  saveCustomBackgroundFile: (
    srcAbsPath: string,
    runtime: {
      backgroundDir: string
      maxBytes?: number
      allowedExtensions?: Set<string>
      copyFile?: (source: string, target: string) => Promise<void>
      now?: () => Date
    }
  ) => Promise<CustomBackgroundSaveResult>
  saveCustomNotificationSoundFile: (
    srcAbsPath: string,
    runtime: {
      soundDir: string
      maxBytes?: number
      allowedExtensions?: Set<string>
      copyFile?: (source: string, target: string) => Promise<void>
      now?: () => Date
    }
  ) => Promise<CustomNotificationSoundSaveResult>
  writeLocalTextFile: (
    filePath: string,
    content: string,
    runtime?: {
      writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<void>
    }
  ) => Promise<LocalFileWriteResult>
}

const tempDirs: string[] = []

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/files/localFileWrites'
  return (await import(modulePath)) as LocalFileWritesBackend
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-local-writes-'))
  tempDirs.push(dir)
  return dir
}

describe('local file write backend boundary', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('writes local text files and confirms the final file metadata', async () => {
    const { writeLocalTextFile } = await loadBackend()
    const dir = await createTempDir()
    const outputFile = join(dir, 'nested', 'query.sql')
    const content = 'select * from 生产表;\n'

    const result = await writeLocalTextFile(outputFile, content)

    const expectedBytes = Buffer.byteLength(content, 'utf-8')
    expect(result).toEqual({
      ok: true,
      data: {
        filePath: outputFile,
        bytes: expectedBytes,
        size: expectedBytes,
        mtimeMs: expect.any(Number)
      }
    })
    expect(await readFile(outputFile, 'utf-8')).toBe(content)
    await expect(stat(outputFile)).resolves.toMatchObject({ size: expectedBytes })
  })

  it('rejects non-absolute local write paths and writers that cannot be verified', async () => {
    const { writeLocalTextFile } = await loadBackend()
    const dir = await createTempDir()
    const outputFile = join(dir, 'query.sql')

    await expect(writeLocalTextFile('relative/query.sql', 'select 1;')).resolves.toMatchObject({
      ok: false,
      errorCode: 'LOCAL_FILE_WRITE_PATH_INVALID'
    })

    await expect(
      writeLocalTextFile(outputFile, 'select 1;', {
        writeFile: async (filePath) => {
          await writeFile(filePath, 'different content', 'utf-8')
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'LOCAL_FILE_WRITE_CONFIRMATION_INVALID'
    })
  })

  it('copies custom backgrounds into the owned directory and confirms final size', async () => {
    const { saveCustomBackgroundFile } = await loadBackend()
    const dir = await createTempDir()
    const source = join(dir, 'settings custom 背景.webp')
    const backgroundDir = join(dir, 'backgrounds')
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03])
    await writeFile(source, bytes)

    const result = await saveCustomBackgroundFile(source, {
      backgroundDir,
      now: () => new Date('2026-06-12T10:00:00.000Z')
    })
    const expectedPath = join(backgroundDir, 'settings-custom.webp')

    expect(result).toEqual({
      filePath: expectedPath,
      url: `file://${expectedPath}`,
      name: 'settings-custom.webp',
      size: bytes.byteLength,
      bytes: bytes.byteLength,
      mtimeMs: expect.any(Number)
    })
    await expect(readFile(result.filePath)).resolves.toEqual(bytes)
  })

  it('rejects unsupported background sources and mismatched copied files', async () => {
    const { saveCustomBackgroundFile } = await loadBackend()
    const dir = await createTempDir()
    const source = join(dir, 'background.png')
    const backgroundDir = join(dir, 'backgrounds')
    await writeFile(source, Buffer.from([1, 2, 3, 4]))

    await expect(saveCustomBackgroundFile('relative.png', { backgroundDir })).rejects.toThrow('srcAbsPath must be absolute')
    await expect(saveCustomBackgroundFile(source, { backgroundDir, maxBytes: 2 })).rejects.toThrow('Background file too large')
    await expect(saveCustomBackgroundFile(source, { backgroundDir, allowedExtensions: new Set(['.jpg']) })).rejects.toThrow('Background file type not allowed')
    await expect(
      saveCustomBackgroundFile(source, {
        backgroundDir,
        copyFile: async (_source, target) => {
          await writeFile(target, Buffer.from([1, 2]))
        }
      })
    ).rejects.toThrow('Saved background size does not match the source file.')
  })

  it('copies custom notification sounds into the owned directory and rejects unsupported sources', async () => {
    const { saveCustomNotificationSoundFile } = await loadBackend()
    const dir = await createTempDir()
    const source = join(dir, 'approval 声音.wav')
    const soundDir = join(dir, 'notification-sounds')
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x05, 0x06, 0x07])
    await writeFile(source, bytes)

    const result = await saveCustomNotificationSoundFile(source, {
      soundDir,
      now: () => new Date('2026-06-12T10:00:00.000Z')
    })
    const expectedPath = join(soundDir, 'approval.wav')

    expect(result).toEqual({
      filePath: expectedPath,
      url: `file://${expectedPath}`,
      name: 'approval.wav',
      size: bytes.byteLength,
      bytes: bytes.byteLength,
      mtimeMs: expect.any(Number)
    })
    await expect(readFile(result.filePath)).resolves.toEqual(bytes)

    await expect(saveCustomNotificationSoundFile('relative.wav', { soundDir })).rejects.toThrow('srcAbsPath must be absolute')
    await expect(saveCustomNotificationSoundFile(source, { soundDir, maxBytes: 2 })).rejects.toThrow('Notification sound file too large')
    await expect(saveCustomNotificationSoundFile(source, { soundDir, allowedExtensions: new Set(['.mp3']) })).rejects.toThrow('Notification sound file type not allowed')
  })
})
