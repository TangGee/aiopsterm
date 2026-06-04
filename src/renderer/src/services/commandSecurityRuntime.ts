import type { SecurityUserConfig } from '@shared/preload'

export type CommandSecurityResult = {
  isAllowed: boolean
  reason?: string
  category?: 'blacklist' | 'whitelist' | 'dangerous' | 'permission'
  severity?: 'low' | 'medium' | 'high' | 'critical'
  action?: 'block' | 'ask' | 'allow'
  requiresApproval?: boolean
}

type ParsedCommand = {
  executable: string
  args: string[]
  isCompound: boolean
  compounds?: ParsedCommand[]
}

const criticalCommands = ['rm', 'del', 'format', 'shutdown', 'reboot', 'halt', 'poweroff', 'dd', 'mkfs', 'fdisk']
const highCommands = ['killall', 'pkill', 'systemctl', 'service', 'chmod', 'chown', 'mount', 'umount']
const mediumCommands = ['iptables', 'ufw', 'firewall-cmd', 'sudo', 'su']

const isInsideQuotes = (text: string, position: number) => {
  let inQuotes = false
  let quoteChar = ''
  for (let index = 0; index < position; index += 1) {
    const char = text[index]
    if ((char === '"' || char === "'") && (index === 0 || text[index - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true
        quoteChar = char
      } else if (char === quoteChar) {
        inQuotes = false
      }
    }
  }
  return inQuotes
}

const hasCompoundSeparator = (command: string) => {
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]
    if (!isInsideQuotes(command, index) && ((char === '&' && next === '&') || (char === '|' && next === '|') || char === ';')) {
      return true
    }
  }
  return false
}

const tokenizeCommand = (command: string) => {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  let quoteChar = ''

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if ((char === '"' || char === "'") && (index === 0 || command[index - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true
        quoteChar = char
      } else if (char === quoteChar) {
        inQuotes = false
      } else {
        current += char
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

const parseCommand = (command: string): ParsedCommand => {
  const trimmed = command.trim()
  if (!hasCompoundSeparator(trimmed)) {
    const tokens = tokenizeCommand(trimmed)
    return {
      executable: tokens[0] || '',
      args: tokens.slice(1),
      isCompound: false
    }
  }

  const compounds: ParsedCommand[] = []
  let currentStart = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    const next = trimmed[index + 1]
    if (!isInsideQuotes(trimmed, index) && ((char === '&' && next === '&') || (char === '|' && next === '|') || char === ';')) {
      const segment = trimmed.slice(currentStart, index).trim()
      if (segment) compounds.push(parseCommand(segment))
      currentStart = char === ';' ? index + 1 : index + 2
      if (char !== ';') index += 1
    }
  }

  const tail = trimmed.slice(currentStart).trim()
  if (tail) compounds.push(parseCommand(tail))
  return {
    executable: compounds[0]?.executable || '',
    args: [],
    isCompound: true,
    compounds
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isRootDirectoryPattern = (pattern: string) => pattern.endsWith(' /') || pattern.endsWith(' / ')

const matchesPattern = (command: string, pattern: string) => {
  if (pattern.includes('*')) {
    const regexPattern = escapeRegExp(pattern).replace(/\\\*/g, '.*')
    return new RegExp(`^${regexPattern}$`, 'i').test(command)
  }

  const escapedPattern = escapeRegExp(pattern)
  if (isRootDirectoryPattern(pattern)) {
    return new RegExp(`^${escapedPattern}(\\s|$)`, 'i').test(command)
  }
  return new RegExp(`(^|\\s)${escapedPattern}(\\s|$)`, 'i').test(command)
}

const dangerousSeverity = (command: string): NonNullable<CommandSecurityResult['severity']> => {
  const lower = command.toLowerCase()
  if (criticalCommands.includes(lower)) return 'critical'
  if (highCommands.includes(lower)) return 'high'
  if (mediumCommands.includes(lower)) return 'medium'
  return 'low'
}

const shouldAskForSeverity = (config: SecurityUserConfig['security'], severity: NonNullable<CommandSecurityResult['severity']>) => {
  if (severity === 'critical' || severity === 'low') return true
  if (severity === 'high') return config.securityPolicy.askForHigh
  return config.securityPolicy.askForMedium
}

const commandText = (parsed: ParsedCommand) => `${parsed.executable} ${parsed.args.join(' ')}`.trim()

const checkBlacklist = (config: SecurityUserConfig['security'], parsed: ParsedCommand): CommandSecurityResult | null => {
  if (parsed.isCompound && parsed.compounds) {
    for (const compound of parsed.compounds) {
      const result = checkBlacklist(config, compound)
      if (result) return result
    }
    return null
  }

  const lowerCommand = commandText(parsed).toLowerCase()
  for (const pattern of config.blacklistPatterns) {
    if (matchesPattern(lowerCommand, pattern.toLowerCase())) {
      const shouldAsk = config.securityPolicy.askForBlacklist
      return {
        isAllowed: shouldAsk,
        reason: `Matched blacklist pattern: ${pattern}`,
        category: 'blacklist',
        severity: 'high',
        action: shouldAsk ? 'ask' : 'block',
        requiresApproval: shouldAsk
      }
    }
  }
  return null
}

const checkDangerous = (config: SecurityUserConfig['security'], parsed: ParsedCommand): CommandSecurityResult | null => {
  if (parsed.isCompound && parsed.compounds) {
    for (const compound of parsed.compounds) {
      const result = checkDangerous(config, compound)
      if (result) return result
    }
    return null
  }

  const executable = parsed.executable.toLowerCase()
  const match = config.dangerousCommands.find((command) => executable === command.toLowerCase())
  if (!match) return null

  const severity = dangerousSeverity(match)
  const shouldAsk = shouldAskForSeverity(config, severity)
  return {
    isAllowed: shouldAsk,
    reason: `Dangerous command detected: ${match}`,
    category: 'dangerous',
    severity,
    action: shouldAsk ? 'ask' : 'block',
    requiresApproval: shouldAsk
  }
}

export const validateCommandSecurity = (securityConfig: SecurityUserConfig, command: string): CommandSecurityResult => {
  const config = securityConfig.security
  if (!config.enableCommandSecurity) return { isAllowed: true, action: 'allow' }

  const trimmed = command.trim()
  if (!trimmed) return { isAllowed: true, action: 'allow' }
  if (trimmed.length > config.maxCommandLength) {
    return {
      isAllowed: false,
      reason: `Command exceeds max length ${config.maxCommandLength}`,
      category: 'permission',
      severity: 'medium',
      action: 'block',
      requiresApproval: false
    }
  }

  const parsed = parseCommand(trimmed)
  const blacklist = checkBlacklist(config, parsed)
  if (blacklist) return blacklist

  const dangerous = checkDangerous(config, parsed)
  if (dangerous) return dangerous

  if (config.enableStrictMode) {
    const lowerCommand = commandText(parsed).toLowerCase()
    const allowed = config.whitelistPatterns.some((pattern) => matchesPattern(lowerCommand, pattern.toLowerCase()))
    if (!allowed) {
      return {
        isAllowed: false,
        reason: 'Command is not in whitelist',
        category: 'whitelist',
        severity: 'medium',
        action: 'block',
        requiresApproval: false
      }
    }
  }

  return { isAllowed: true, action: 'allow' }
}
