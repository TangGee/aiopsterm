import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { it, expect } from 'vitest'

const { compareInstalledPayload } = createRequire(import.meta.url)('../../scripts/regression-installed-payload.cjs')
it('rejects stale installed files and mismatches while allowing only the generated Windows uninstaller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-payload-'))
  const expected = join(root, 'expected'), actual = join(root, 'actual')
  try {
    for (const directory of [expected, actual]) {
      await mkdir(join(directory, 'resources'), { recursive: true })
      await writeFile(join(directory, 'resources', 'app'), 'current')
    }
    await compareInstalledPayload(expected, actual)
    await writeFile(join(actual, 'resources', 'old-plugin.js'), 'stale')
    await expect(compareInstalledPayload(expected, actual)).rejects.toThrow('Unexpected installed payload: resources/old-plugin.js')
    await rm(join(actual, 'resources', 'old-plugin.js'))
    await writeFile(join(actual, 'resources', 'app'), 'changed')
    await expect(compareInstalledPayload(expected, actual)).rejects.toThrow('Installed payload differs')
    await writeFile(join(actual, 'resources', 'app'), 'current')
    await writeFile(join(actual, 'Uninstall aiopsterm.exe'), 'installer-generated')
    await compareInstalledPayload(expected, actual, 'win32')
    await expect(compareInstalledPayload(expected, actual, 'linux')).rejects.toThrow('Unexpected installed payload')
    await mkdir(join(actual, 'old-version'))
    await expect(compareInstalledPayload(expected, actual, 'win32')).rejects.toThrow('old-version')
  } finally { await rm(root, { recursive: true, force: true }) }
})
