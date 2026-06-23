import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const appImage = join(resolve('dist'), `aiopsterm-${packageJson.version}-linux-x86_64.AppImage`)

if (!existsSync(appImage)) {
  throw new Error(`AppImage package is missing: ${appImage}`)
}

if ((statSync(appImage).mode & 0o111) === 0) {
  throw new Error(`AppImage package is not executable: ${appImage}`)
}

console.log('linux-appimage-package-audit-ok')
console.log(appImage)
