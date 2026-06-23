import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type UserAccountAvatarRuntimeModule = {
  createUserAccountAvatarRuntime(getConfig: () => { stateFilePath: string }): {
    prepare(input: { filePath: string }): Promise<any>
    resolveAssetPath(avatarImageUrl: string): string
    assetExists(avatarImageUrl: string): boolean
  }
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('userAccountAvatarRuntime', () => {
  it('prepares image assets behind a backend-owned avatar URL', async () => {
    const modulePath = '../src/main/backend/user/userAccountAvatarRuntime'
    const { createUserAccountAvatarRuntime } = (await import(modulePath)) as UserAccountAvatarRuntimeModule
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-avatar-runtime-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'avatar.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
    await writeFile(filePath, bytes)

    const runtime = createUserAccountAvatarRuntime(() => ({ stateFilePath: join(dir, 'user-account.json') }))
    const data = (await runtime.prepare({ filePath })).data

    expect(data).toMatchObject({
      filePath,
      name: 'avatar.png',
      mimeType: 'image/png',
      size: bytes.byteLength,
      avatarImageUrl: expect.stringMatching(/^aiopsterm-user-avatar:\/\/[a-f0-9]{64}\.png$/),
      assetFileName: expect.stringMatching(/^[a-f0-9]{64}\.png$/),
      message: '头像图片已读取'
    })
    expect(data.dataUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
    expect(runtime.assetExists(data.avatarImageUrl)).toBe(true)
    await expect(readFile(runtime.resolveAssetPath(data.avatarImageUrl))).resolves.toEqual(bytes)
  })

  it('rejects non-images and unsafe avatar asset urls', async () => {
    const modulePath = '../src/main/backend/user/userAccountAvatarRuntime'
    const { createUserAccountAvatarRuntime } = (await import(modulePath)) as UserAccountAvatarRuntimeModule
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-avatar-runtime-invalid-'))
    tempDirs.push(dir)
    const runtime = createUserAccountAvatarRuntime(() => ({ stateFilePath: join(dir, 'user-account.json') }))

    await expect(runtime.prepare({ filePath: '' })).resolves.toEqual({
      ok: false,
      errorCode: 'USER_AVATAR_PATH_REQUIRED',
      errorMessage: '请选择头像图片'
    })

    const textPath = join(dir, 'avatar.txt')
    await writeFile(textPath, 'not an image')
    await expect(runtime.prepare({ filePath: textPath })).resolves.toEqual({
      ok: false,
      errorCode: 'USER_AVATAR_INVALID_IMAGE',
      errorMessage: '请选择图片文件'
    })

    expect(runtime.resolveAssetPath('data:image/png;base64,avatar')).toBe('')
    expect(runtime.resolveAssetPath('aiopsterm-user-avatar://../avatar.png')).toBe('')
    expect(runtime.assetExists('aiopsterm-user-avatar://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')).toBe(false)
  })
})
