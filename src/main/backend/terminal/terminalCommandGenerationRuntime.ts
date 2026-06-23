import { randomUUID } from 'crypto'
import type { TerminalCommandGenerationInput, TerminalCommandGenerationResult } from '@shared/contracts/terminalTools'
import type { ModelProviderCheckKey } from '@shared/contracts/appRuntime'
import {
  createProviderTextRequest,
  fetchProviderText,
  resolveModelProvider,
  type AiProviderResolvedConfig,
  type AiProviderTextRequest
} from '../ai/modelProviderText'
import { isValidTerminalCommandForHistory, normalizeText, type TerminalSuggestionRuntimeConfig } from './terminalSuggestionCommon'

export type TerminalCommandGenerationRuntime = {
  generate(input: TerminalCommandGenerationInput): Promise<TerminalCommandGenerationResult>
}

const defaultCommandGenerationTimeoutMs = 8000

function createCommandGenerationPrompt(instruction: string, context: TerminalCommandGenerationInput['context']): string {
  return [
    `Instruction: ${instruction}`,
    'Context:',
    `Host: ${context.host || 'local'}`,
    `Username: ${context.username || 'local'}`,
    `Working directory: ${context.cwd || '~'}`,
    `Shell: ${context.shell || 'bash'}`,
    `Connection: ${context.connectionType}`,
    '',
    'Generate exactly one executable terminal command.',
    'Return only the command text. Do not include markdown, labels, commentary, or explanations.',
    'Prefer safe, commonly used commands. Return NONE if a safe command cannot be generated.'
  ].join('\n')
}

function createCommandGenerationRequest(
  input: AiProviderResolvedConfig,
  instruction: string,
  context: TerminalCommandGenerationInput['context']
): AiProviderTextRequest | null {
  return createProviderTextRequest(
    input,
    'You generate precise terminal commands from operator instructions.',
    createCommandGenerationPrompt(instruction, context),
    160
  )
}

export function extractGeneratedTerminalCommand(response: string): string {
  let command = normalizeText(response)
  if (!command || command.toUpperCase() === 'NONE') return ''
  const cmdMatch = command.match(/^CMD:\s*(.+)$/im)
  if (cmdMatch) command = normalizeText(cmdMatch[1])
  command = command.replace(/^```(?:bash|sh|shell|zsh|fish)?\s*\n?/i, '')
  command = command.replace(/\n?```\s*$/i, '')
  command = command.replace(/^(?:Command|Output|Result):\s*/i, '')
  const firstLine = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^EXP:\s*/i.test(line))
  const normalized = normalizeText(firstLine || '')
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1).trim()
  }
  return normalized
}

async function fetchGeneratedCommand(
  request: AiProviderTextRequest,
  fetchConfig: Pick<TerminalSuggestionRuntimeConfig, 'fetch'>
): Promise<{ ok: true; command: string } | { ok: false; errorCode: string; errorMessage: string }> {
  const response = await fetchProviderText(request, {
    fetch: fetchConfig.fetch,
    timeoutMs: defaultCommandGenerationTimeoutMs,
    errorCodePrefix: 'TERMINAL_COMMAND_PROVIDER'
  })
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage
    }
  }
  const command = extractGeneratedTerminalCommand(response.text)
  if (!command) {
    return {
      ok: false,
      errorCode: 'TERMINAL_COMMAND_GENERATION_FAILED',
      errorMessage: 'Command generation failed'
    }
  }
  if (!isValidTerminalCommandForHistory(command)) {
    return {
      ok: false,
      errorCode: 'TERMINAL_COMMAND_UNSAFE',
      errorMessage: 'Generated command did not pass terminal safety validation'
    }
  }
  return { ok: true, command }
}

export const inferGeneratedTerminalCommand = (instruction: string, cwd = '~') => {
  const text = instruction.trim().toLowerCase()
  if (!text) return ''
  if (/(disk|磁盘|空间|df)/i.test(text)) return 'df -h'
  if (/(memory|内存|mem|free)/i.test(text)) return 'free -h'
  if (/(cpu|load|负载|uptime)/i.test(text)) return 'uptime'
  if (/(process|进程|top|ps)/i.test(text)) return 'ps aux --sort=-%mem | head -n 12'
  if (/(port|端口|listen|监听)/i.test(text)) return 'ss -tulpn'
  if (/(log|日志|journal)/i.test(text)) return 'journalctl -n 120 --no-pager'
  if (/(network|网络|route|ip)/i.test(text)) return 'ip addr && ip route'
  if (/(k8s|kubernetes|pod)/i.test(text)) return 'kubectl get pods -A'
  if (/(docker|container|容器)/i.test(text)) return 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"'
  if (/(file|目录|list|ls)/i.test(text)) return `ls -la ${cwd && cwd !== '~' ? cwd : '.'}`
  return `echo ${JSON.stringify(instruction.trim())}`
}

export function createTerminalCommandGenerationRuntime(getConfig: () => TerminalSuggestionRuntimeConfig): TerminalCommandGenerationRuntime {
  return {
    async generate(input) {
      try {
        const instruction = normalizeText(input.instruction)
        if (!instruction) {
          return {
            ok: false,
            errorCode: 'TERMINAL_COMMAND_EMPTY',
            errorMessage: 'Command instruction is required'
          }
        }

        let command = ''
        let provider: 'aiopsterm-local' | ModelProviderCheckKey = 'aiopsterm-local'
        const modelName = normalizeText(input.modelName) || 'aiopsterm-local-agent'
        const config = getConfig().getConfig?.()
        const providerConfig = config ? resolveModelProvider(config, modelName) : null
        if (providerConfig) {
          const request = createCommandGenerationRequest(providerConfig, instruction, input.context)
          if (!request) {
            return {
              ok: false,
              errorCode: 'TERMINAL_COMMAND_PROVIDER_UNAVAILABLE',
              errorMessage: 'Command generation provider is unavailable'
            }
          }
          const generated = await fetchGeneratedCommand(request, getConfig())
          if (!generated.ok) {
            return {
              ok: false,
              errorCode: generated.errorCode,
              errorMessage: generated.errorMessage
            }
          }
          command = generated.command
          provider = providerConfig.provider
        } else if (modelName !== 'aiopsterm-local-agent') {
          return {
            ok: false,
            errorCode: 'TERMINAL_COMMAND_PROVIDER_UNAVAILABLE',
            errorMessage: 'Command generation provider is unavailable'
          }
        } else {
          command = inferGeneratedTerminalCommand(instruction, input.context.cwd)
        }

        if (!command) {
          return {
            ok: false,
            errorCode: 'TERMINAL_COMMAND_GENERATION_FAILED',
            errorMessage: 'Command generation failed'
          }
        }

        return {
          ok: true,
          data: {
            id: `terminal-command-${randomUUID()}`,
            panelId: input.panelId,
            instruction,
            command,
            modelName,
            context: input.context,
            status: 'done',
            createdAt: Date.now(),
            provider
          }
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: 'TERMINAL_COMMAND_BACKEND_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}
