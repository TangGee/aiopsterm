import { existsSync } from 'node:fs'
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
  return [join(root, 'lib', 'index.js'), join(root, 'lib', 'unixTerminal.js'), pty]
}
