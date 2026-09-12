import { chmodSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const packagedPtyFiles = (root, platform, arch) => {
  const directories = ['build/Release', 'build/Debug', `prebuilds/${platform}-${arch}`]
  // Match node-pty's loader order; do not accept another architecture's files.
  const resolveModule = (name) => {
    const directory = directories.find((entry) => existsSync(join(root, entry, `${name}.node`))) || directories[0]
    return join(root, directory, `${name}.node`)
  }
  const pty = resolveModule('pty')
  if (platform === 'win32') {
    return [
      join(root, 'lib', 'index.js'), join(root, 'lib', 'windowsTerminal.js'),
      pty, resolveModule('conpty'), resolveModule('conpty_console_list'),
      join(pty, '..', 'winpty.dll'), join(pty, '..', 'winpty-agent.exe')
    ]
  }
  return [join(root, 'lib', 'index.js'), join(root, 'lib', 'unixTerminal.js'), pty,
    ...(platform === 'darwin' ? [join(pty, '..', 'spawn-helper')] : [])]
}

export const preparePackagedPtyHelper = (root, platform, arch) => {
  if (platform !== 'darwin') return
  const helper = packagedPtyFiles(root, platform, arch).at(-1)
  // npm's prebuilt macOS helper is distributed without executable permission.
  // Repair it before signing so terminals can launch from the installed app.
  const mode = statSync(helper).mode
  chmodSync(helper, (mode & 0o777) | 0o111)
}
