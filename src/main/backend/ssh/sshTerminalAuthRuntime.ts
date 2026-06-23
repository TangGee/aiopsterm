import type { TerminalKeyboardInteractivePrompt } from '@shared/contracts/terminalSessions'
import { cleanText } from './sshTerminalRuntimeConfig'
import type { SshTerminalTarget } from './sshTerminalTypes'

export const keyboardInteractiveTimeoutMs = () => 180000

export const maxKeyboardInteractiveAttempts = () => 1

export const normalizeKeyboardInteractivePrompts = (prompts: TerminalKeyboardInteractivePrompt[] = []): TerminalKeyboardInteractivePrompt[] =>
  prompts
    .map((prompt) => ({
      prompt: cleanText(prompt?.prompt) || 'Verification code:',
      echo: prompt?.echo === true
    }))
    .filter((prompt) => prompt.prompt)

export const terminalAuthLabel = (target: Pick<SshTerminalTarget, 'username' | 'host' | 'port'>) => `${target.username}@${target.host}:${target.port}`

export const createPasswordPrompt = (target: SshTerminalTarget): TerminalKeyboardInteractivePrompt[] => [
  {
    prompt: `SSH password for ${terminalAuthLabel(target)}:`,
    echo: false
  }
]
