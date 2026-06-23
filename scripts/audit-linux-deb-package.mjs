import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const deb = join(resolve('dist'), `aiopsterm-${packageJson.version}-linux-amd64.deb`)

if (!existsSync(deb)) {
  throw new Error(`Deb package is missing: ${deb}`)
}

const extractDir = mkdtempSync(join(tmpdir(), 'aiopsterm-deb-audit-'))
try {
  execFileSync('dpkg-deb', ['-x', deb, extractDir], { stdio: 'pipe' })
  const desktopFile = join(extractDir, 'usr', 'share', 'applications', 'aiopsterm.desktop')
  const desktop = execFileSync('sed', ['-n', '1,120p', desktopFile], { encoding: 'utf8' })
  if (!desktop.includes('MimeType=x-scheme-handler/aiopsterm;')) {
    throw new Error('Deb desktop file is missing aiopsterm scheme registration')
  }
  if (!desktop.includes('Exec=/opt/aiopsterm/aiopsterm %U')) {
    throw new Error('Deb desktop file is missing %U URL argument handling')
  }
} finally {
  rmSync(extractDir, { recursive: true, force: true })
}

console.log('linux-deb-package-audit-ok')
console.log(deb)
