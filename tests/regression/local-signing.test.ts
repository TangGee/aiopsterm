import { it, expect, describe } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'

const modulePath = '../../scripts/local-signing-common.mjs'
const { treeInventory, verifySigningBundle, verifyCompiledPayload, digest } = await import(modulePath)
const { createPackage } = createRequire(import.meta.url)('@electron/asar')
const commit = 'a'.repeat(40)
const fixture = async (run: (root: string, manifest: any, compiled: string, pack: () => Promise<void>) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), 'aiopsterm-signing-test-'))
  const payload = join(root, 'content', 'payload', 'aiopsterm.app')
  const compiled = join(root, 'compiled')
  const manifest: any = { schemaVersion: 1, commit, platform: 'darwin', arch: 'arm64', version: '0.1.0' }
  try {
    const files: Record<string, string> = {}
    for (const name of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
      await mkdir(join(compiled, 'out', name.split('/')[0]), { recursive: true })
      await writeFile(join(compiled, 'out', name), 'fixture')
      files[name] = createHash('sha256').update('fixture').digest('hex')
    }
    await writeFile(join(compiled, 'package.json'), JSON.stringify({ name: 'aiopsterm', version: '0.1.0' }))
    await writeFile(join(compiled, 'out/build-provenance.json'), JSON.stringify({ schemaVersion: 1, commit, dirty: false, files }))
    await mkdir(join(payload, 'Contents/Resources'), { recursive: true })
    const pack = async () => {
      await createPackage(compiled, join(payload, 'Contents/Resources/app.asar'))
      manifest.files = await treeInventory(join(root, 'content'))
      await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    }
    await pack()
    await run(root, manifest, compiled, pack)
  } finally { await rm(root, { recursive: true, force: true }) }
}

describe('CI to local signing provenance', () => {
  it('accepts an intact bundle and rejects a different commit or signing platform', async () => fixture(async (root) => {
    expect((await verifySigningBundle(root, commit, 'darwin')).manifest.version).toBe('0.1.0')
    await expect(verifySigningBundle(root, 'b'.repeat(40), 'darwin')).rejects.toThrow('mismatch')
    await expect(verifySigningBundle(root, commit, 'win32')).rejects.toThrow('mismatch')
    await expect(verifySigningBundle(root, '', 'darwin')).rejects.toThrow('full --commit')
  }))
  it('rejects added, removed and modified payload files', async () => fixture(async (root) => {
    const file = join(root, 'content', 'extra')
    await writeFile(file, 'added')
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow('content has changed')
    await rm(file)
    const archive = join(root, 'content/payload/aiopsterm.app/Contents/Resources/app.asar')
    const original = await readFile(archive)
    await writeFile(archive, 'changed')
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow('content has changed')
    await writeFile(archive, original)
    await rm(archive)
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow('content has changed')
  }))
  it('still rejects compiled tampering after the outer manifest is recalculated', async () => fixture(async (root, _manifest, compiled, pack) => {
    await writeFile(join(compiled, 'out/main/index.js'), 'tampered')
    await pack()
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow('Compiled output changed')
  }))
  it.each(['dirty', 'commit', 'product', 'extra'])('rejects %s provenance violations inside ASAR', async (kind) => fixture(async (root, _manifest, compiled, pack) => {
    const path = join(compiled, 'out/build-provenance.json')
    const stamp = JSON.parse(await readFile(path, 'utf8'))
    if (kind === 'dirty') stamp.dirty = true
    if (kind === 'commit') stamp.commit = 'b'.repeat(40)
    if (kind === 'product') await writeFile(join(compiled, 'package.json'), '{"name":"other","version":"0.1.0"}')
    if (kind === 'extra') await writeFile(join(compiled, 'out/main/unattributed.js'), 'extra')
    await writeFile(path, JSON.stringify(stamp)); await pack()
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow()
  }))
  it.each(['arch', 'version', 'schemaVersion'])('rejects invalid %s before signing', async (field) => fixture(async (root, manifest) => {
    manifest[field] = field === 'version' ? '../../escaped' : 'invalid'
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow()
  }))
  it.skipIf(process.platform === 'win32')('preserves executable mode and internal links, rejecting escaping links', async () => fixture(async (root, manifest) => {
    const content = join(root, 'content')
    await writeFile(join(content, 'executable'), 'fixture')
    await chmod(join(content, 'executable'), 0o755)
    await symlink('executable', join(content, 'internal'))
    manifest.files = await treeInventory(content)
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await verifySigningBundle(root, commit, 'darwin')
    await chmod(join(content, 'executable'), 0o644)
    await expect(verifySigningBundle(root, commit, 'darwin')).rejects.toThrow('content has changed')
    await symlink('../manifest.json', join(content, 'escape'))
    await expect(treeInventory(content)).rejects.toThrow('escapes')
  }))
  it('verifies a signing copy without mutating the downloaded bundle', async () => fixture(async (root, manifest) => {
    const source = join(root, 'content/payload/aiopsterm.app')
    const before = await digest(join(root, 'manifest.json'))
    const copy = join(root, 'signed-copy.app')
    await cp(source, copy, { recursive: true })
    await writeFile(join(copy, 'signature-fixture'), 'simulated signature envelope')
    await verifyCompiledPayload(copy, manifest)
    expect(await digest(join(root, 'manifest.json'))).toBe(before)
    await verifySigningBundle(root, commit, 'darwin')
  }))
  it('survives a tar download round trip without changing the payload inventory', async () => fixture(async (root) => {
    const archive = join(root, 'fixture.tar.gz')
    const output = join(root, 'extracted directory')
    await mkdir(output)
    const packed = spawnSync('tar', ['-czf', archive, '-C', root, 'manifest.json', 'content'], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } })
    expect(packed.status, packed.stderr).toBe(0)
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', output], { encoding: 'utf8' })
    expect(extracted.status, extracted.stderr).toBe(0)
    expect((await verifySigningBundle(output, commit, 'darwin')).manifest.commit).toBe(commit)
  }))
  it('fails closed when no input or signing identity is provided', () => {
    const result = spawnSync(process.execPath, ['scripts/local-sign-release.mjs'], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('required')
    expect(spawnSync(process.execPath, ['scripts/local-sign-release.mjs', '--help']).status).toBe(0)
  })
  it('exports signing inputs only after package tests and never requests CI signing secrets', async () => {
    const source = await readFile(resolve('.github/workflows/build-installers.yml'), 'utf8')
    const workflow = parse(source)
    expect(workflow.on.workflow_dispatch.inputs.platform.options).toEqual(['all', 'linux', 'windows', 'macos'])
    expect(workflow.permissions.contents).toBe('read')
    expect(source).not.toContain('secrets.')
    const steps = workflow.jobs.installers.steps
    const test = steps.findIndex((step: any) => step.run === 'npm run test:regression -- packaged')
    const prepare = steps.findIndex((step: any) => step.run === 'node scripts/prepare-local-signing.mjs dist')
    const upload = steps.findIndex((step: any) => step.name === 'Upload local signing bundle')
    expect(test).toBeGreaterThan(-1); expect(prepare).toBeGreaterThan(test); expect(upload).toBeGreaterThan(prepare)
    expect(steps[upload].if).not.toContain('always')
    expect(steps[upload].with['if-no-files-found']).toBe('error')
  })
})
