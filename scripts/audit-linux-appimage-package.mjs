import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const appImage = join(resolve('dist'), `aiopsterm-${packageJson.version}-linux-x86_64.AppImage`)

if (!existsSync(appImage)) {
  throw new Error(`AppImage package is missing: ${appImage}`)
}

if ((statSync(appImage).mode & 0o111) === 0) {
  throw new Error(`AppImage package is not executable: ${appImage}`)
}

const runtimeProbe = Buffer.alloc(1024 * 1024)
const appImageFd = openSync(appImage, 'r')
let runtimeBytes
try {
  runtimeBytes = readSync(appImageFd, runtimeProbe, 0, runtimeProbe.length, 0)
} finally {
  closeSync(appImageFd)
}
if (runtimeProbe.subarray(0, runtimeBytes).includes(Buffer.from('libfuse.so.2'))) {
  throw new Error(`AppImage package still uses the legacy FUSE 2 runtime: ${appImage}`)
}

console.log('linux-appimage-package-audit-ok')
console.log(appImage)
