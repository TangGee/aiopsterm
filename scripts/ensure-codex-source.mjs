import { existsSync, mkdirSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = resolve(projectRoot, 'codex-source.json')
const codexRoot = resolve(projectRoot, 'codex')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))

const expected = String(lock.commit || '').trim()
if (!lock.repository || !expected) throw new Error('codex-source.json must define repository and commit')

if (!existsSync(resolve(codexRoot, '.git'))) {
  mkdirSync(resolve(codexRoot, '..'), { recursive: true })
  execFileSync('git', ['clone', '--no-checkout', lock.repository, codexRoot], { cwd: projectRoot, stdio: 'inherit' })
  execFileSync('git', ['checkout', '--detach', expected], { cwd: codexRoot, stdio: 'inherit' })
}

const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: codexRoot, encoding: 'utf8' }).trim()
if (!actual.startsWith(expected)) {
  throw new Error(`Codex source commit mismatch: expected ${expected}, found ${actual}. Update codex-source.json or checkout the locked commit.`)
}

for (const requiredPath of ['codex-rs/Cargo.toml', 'scripts/build_codex_package.py']) {
  if (!existsSync(resolve(codexRoot, requiredPath))) throw new Error(`Codex source is incomplete: ${requiredPath}`)
}

console.log(`[aiopsterm] Codex source verified at ${actual} (${lock.repository})`)
