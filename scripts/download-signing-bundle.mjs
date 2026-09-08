import { parseArgs, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { digest, run, verifySigningBundle } from './local-signing-common.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  platform: { type: 'string', default: process.platform }, arch: { type: 'string', default: process.arch },
  output: { type: 'string' }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log('Usage: node scripts/download-signing-bundle.mjs <GitHub-run-id> --platform <darwin|win32> --arch <arm64|x64> --output <new-directory>')
  process.exit(0)
}
if (positionals.length !== 1 || !/^\d+$/.test(positionals[0]) || !['darwin', 'win32'].includes(values.platform) || !['arm64', 'x64'].includes(values.arch) || !values.output) throw new Error('A valid run ID, platform, architecture and new output directory are required.')
const capture = promisify(execFile)
const repo = 'TangGee/aiopsterm'
const result = await capture('gh', ['api', `repos/${repo}/actions/runs/${positionals[0]}`])
const job = JSON.parse(result.stdout)
if (job.status !== 'completed' || job.conclusion !== 'success' || job.path !== '.github/workflows/build-installers.yml' || job.head_repository?.full_name !== repo) throw new Error('Expected a successful installer workflow run from the project repository.')
const stage = await mkdtemp(join(tmpdir(), 'aiopsterm-signing-download-'))
const output = resolve(values.output)
try {
  const name = `signing-${values.platform === 'darwin' ? 'macOS' : 'Windows'}-${values.arch === 'arm64' ? 'ARM64' : 'X64'}`
  await run('gh', ['run', 'download', positionals[0], '--repo', repo, '--name', name, '--dir', stage])
  const archiveName = `aiopsterm-signing-${values.platform}-${values.arch}.tar.gz`
  const archive = join(stage, archiveName)
  const expected = (await readFile(archive + '.sha256', 'utf8')).trim()
  if (expected !== `${await digest(archive)}  ${archiveName}`) throw new Error('Downloaded archive checksum mismatch.')
  const listing = await capture('tar', ['-tzf', archive], { maxBuffer: 32 * 1024 * 1024 })
  for (const name of listing.stdout.trim().split('\n')) {
    if (!(name === 'manifest.json' || name.startsWith('content/')) || name.includes('\\') || name.split('/').includes('..')) throw new Error('Unexpected signing archive path.')
  }
  await mkdir(output)
  await run('tar', ['-xzf', archive, '-C', output])
  await verifySigningBundle(output, job.head_sha, values.platform)
  console.log(`Verified bundle: ${output}\nCommit: ${job.head_sha}\nRun local-sign-release.mjs with this full --commit SHA on the signing machine.`)
} finally { await rm(stage, { recursive: true, force: true }) }
