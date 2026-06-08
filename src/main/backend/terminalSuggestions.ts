import { randomUUID } from 'crypto'
import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext
} from '@shared/preload'

const baseSuggestions: TerminalCommandSuggestion[] = [
  { command: 'df -h', source: 'base', explanation: 'base command' },
  { command: 'systemctl status nginx', source: 'base', explanation: 'base command' },
  { command: 'kubectl get pods -A', source: 'base', explanation: 'base command' },
  { command: 'journalctl -u docker --since "30 minutes ago"', source: 'base', explanation: 'base command' },
  { command: 'top -o %CPU', source: 'base', explanation: 'base command' }
]

export const getTerminalCommandSuggestions = (
  query: string,
  context?: TerminalCommandSuggestionContext
): TerminalCommandSuggestion[] => {
  const trimmed = String(query || '').trim()
  const normalized = trimmed.toLowerCase()
  if (!normalized) return []
  if (context?.mode === 'ai') {
    return [{ command: `${trimmed} --help`, source: 'ai', explanation: 'AI suggestion' }]
  }
  return baseSuggestions.filter((item) => item.command.toLowerCase().includes(normalized)).slice(0, 8).map((item) => ({ ...item }))
}

const inferGeneratedCommand = (instruction: string, cwd = '~') => {
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

export const generateTerminalCommand = (input: TerminalCommandGenerationInput): TerminalCommandGenerationResult => {
  try {
    const instruction = String(input.instruction || '').trim()
    if (!instruction) {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_EMPTY',
        errorMessage: 'Command instruction is required'
      }
    }

    const command = inferGeneratedCommand(instruction, input.context.cwd)
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
        modelName: input.modelName || 'aiopsterm-local-agent',
        context: input.context,
        status: 'done',
        createdAt: Date.now(),
        provider: 'aiopsterm-local'
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
