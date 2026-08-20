import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'

type ResumeTerminalPanel = Pick<TerminalPanel, 'sshSession' | 'title'> & {
  terminalLifecycle?: Pick<NonNullable<TerminalPanel['terminalLifecycle']>, 'kind' | 'shell'>
}

const shellName = (value: string | undefined) => {
  const normalized = String(value || '').replace(/\\/g, '/').split('/').pop() || ''
  return normalized.toLowerCase().replace(/\.exe$/, '')
}

const powershellShellNames = new Set(['powershell', 'pwsh'])

const isCmdShell = (shell: string) => shell === 'cmd' || shell === 'command'

const isPowerShellShell = (shell: string) => powershellShellNames.has(shell)

const posixResumePrefix = /^(\s*cd\s+)'((?:[^']|'\\'')*)'\s+&&\s+([\s\S]+)$/

const decodePosixSingleQuoted = (value: string) => value.replace(/'\\''/g, "'")

const powerShellSingleQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

const powerShellResumeCommand = (command: string) => {
  const match = command.match(posixResumePrefix)
  if (!match) return command.replace(' && ', '; ')
  const cwd = decodePosixSingleQuoted(match[2])
  const rest = match[3].replace(/'\\''/g, "''")
  return `Set-Location -LiteralPath ${powerShellSingleQuote(cwd)}; ${rest}`
}

const encodePowerShellUtf16 = (command: string) => {
  const bytes = new Uint8Array(command.length * 2)
  for (let index = 0; index < command.length; index += 1) {
    const code = command.charCodeAt(index)
    bytes[index * 2] = code & 0xff
    bytes[index * 2 + 1] = code >> 8
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export const resumeCommandForTerminal = (panel: ResumeTerminalPanel, command: string) => {
  if (panel.sshSession || panel.terminalLifecycle?.kind === 'ssh') return command
  const shell = shellName(panel.terminalLifecycle?.shell || panel.title)
  if (isPowerShellShell(shell)) return powerShellResumeCommand(command)
  if (isCmdShell(shell)) {
    const encoded = encodePowerShellUtf16(powerShellResumeCommand(command))
    return `powershell.exe -NoLogo -NoProfile -EncodedCommand ${encoded}`
  }
  return command
}
