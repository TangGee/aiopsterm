import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { treeInventory, payloadName, run, digest, verifySigningBundle } from './local-signing-common.mjs'

const dist = resolve(process.argv[2] || 'dist')
await run(process.execPath, [resolve('scripts/release-test-gate.mjs'), dist, '--verify'])
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (process.platform === 'linux') {
  const provenance = JSON.parse(await readFile(join(dist, 'regression-provenance-linux.json'), 'utf8'))
  await writeFile(join(dist, 'SHA256SUMS-linux.txt'), provenance.artifacts.map((file) => `${file.sha256}  ${file.file}`).join('\n') + '\n')
} else {
  const stage = await mkdtemp(join(tmpdir(), 'aiopsterm-signing-bundle-'))
  try {
    const content = join(stage, 'content')
    const name = payloadName(process.platform)
    const source = process.platform === 'darwin' ? join(dist, process.arch === 'arm64' ? 'mac-arm64' : 'mac', name) : join(dist, name)
    await mkdir(join(content, 'payload'), { recursive: true })
    await cp(source, join(content, 'payload', name), { recursive: true, verbatimSymlinks: true })
    await mkdir(join(content, 'support'))
    for (const name of ['entitlements.mac.plist', 'icon.ico']) await cp(resolve('resources', name), join(content, 'support', name))
    await cp(resolve('package.json'), join(content, 'support', 'package.json'))
    await cp(resolve('package-lock.json'), join(content, 'support', 'package-lock.json'))
    await cp(join(dist, `regression-provenance-${process.platform}.json`), join(content, 'support', 'ci-provenance.json'))
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const require = createRequire(import.meta.url)
    const manifest = { schemaVersion: 1, commit, platform: process.platform, arch: process.arch, version: pkg.version,
      electronVersion: require('electron/package.json').version,
      tools: { builder: require('electron-builder/package.json').version, osxSign: require('@electron/osx-sign/package.json').version },
      runId: process.env.GITHUB_RUN_ID || null, repository: process.env.GITHUB_REPOSITORY || null, files: await treeInventory(content) }
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    await verifySigningBundle(stage, commit)
    const archive = join(dist, `aiopsterm-signing-${process.platform}-${process.arch}.tar.gz`)
    await run('tar', ['-czf', archive, '-C', stage, 'manifest.json', 'content'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    await writeFile(archive + '.sha256', `${await digest(archive)}  ${archive.split(/[\\/]/).at(-1)}\n`)
    console.log(`Prepared ${archive} from ${commit}.`)
  } finally { await rm(stage, { recursive: true, force: true }) }
}
