import { StringDecoder } from 'node:string_decoder'

export const validRecoveryCwd = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && value.length <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(value)

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

// A PTY exec starts the shell itself; no command is typed into a possibly busy terminal.
// Bash reads this transient descriptor as its rcfile. Nothing is installed on the host.
export const sshRecoveryShellCommand = (cwd?: string) => {
  const startup = [
    '[ -r ~/.bashrc ] && . ~/.bashrc',
    ...(validRecoveryCwd(cwd) ? [`builtin cd -- ${quote(cwd)} || printf '%s\\n' '[aiopsterm] Previous directory is unavailable.' >&2`] : []),
    "__aiopsterm_cwd() { printf '\\033]1337;CurrentDir=%s\\007' \"$PWD\"; }",
    'if declare -p PROMPT_COMMAND 2>/dev/null | grep -q "declare -a"; then',
    '  PROMPT_COMMAND+=(__aiopsterm_cwd)',
    'else',
    '  PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__aiopsterm_cwd"',
    'fi'
  ].join('\n')
  return [
    'case "${SHELL##*/}" in',
    'bash)',
    "exec \"$SHELL\" --rcfile /dev/fd/3 -i 3<<'AIOPSTERM_SHELL_RECOVERY_RC'",
    startup,
    'AIOPSTERM_SHELL_RECOVERY_RC',
    ';;',
    '*) exec "${SHELL:-/bin/sh}" -l ;;',
    'esac'
  ].join('\n')
}

export const createSshCwdTracker = (onCwd: (cwd: string) => void) => {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  return (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    // Scan only OSC sequences and keep at most one bounded partial sequence.
    let input = pending + text
    pending = ''
    while (input.length) {
      const start = input.indexOf('\x1b]')
      if (start < 0) {
        if (input.endsWith('\x1b')) pending = '\x1b'
        return
      }
      input = input.slice(start + 2)
      const end = /\x07|\x1b\\/.exec(input)
      if (!end) {
        if (input.length <= 8192) pending = '\x1b]' + input
        return
      }
      const payload = input.slice(0, end.index)
      let cwd: string | undefined
      if (payload.startsWith('1337;CurrentDir=')) cwd = payload.slice(16)
      // OSC 7 hostnames may refer to nested SSH sessions. Only our own shell
      // integration's CurrentDir reports are used for remote recovery.
      if (validRecoveryCwd(cwd)) onCwd(cwd)
      input = input.slice(end.index + end[0].length)
    }
  }
}
