import type { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { shouldRunMcpDiscovery } from '@shared/runtimeSwitches'
import { broadcastWindowEvent } from '@shared/windowEvents'
import type { KeywordHighlightUserConfig, SecurityUserConfig } from '@shared/contracts/appRuntime'
import type {
  McpConfigFile,
  McpConfigWriteResult,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallInput,
  McpToolCallResult,
  McpToolStatesUserConfig
} from '@shared/contracts/mcp'
import type { UserConfig } from '@shared/contracts/userConfig'
import { callMcpTool, clearMcpRuntimeClientCache, discoverMcpServerSnapshot, readMcpResource } from './mcpRuntime'

type SettingsConfigRuntimeOptions = {
  userDataPath: () => string
  getConfig: () => UserConfig
  saveConfig: (config: UserConfig) => void
  mergeConfig: (base: UserConfig, patch?: Partial<UserConfig>) => UserConfig
  normalizeSecurityConfig: (source?: unknown) => SecurityUserConfig
  normalizeKeywordHighlightConfig: (source?: unknown) => KeywordHighlightUserConfig
  normalizeMcpConfigFile: (source?: unknown) => McpConfigFile
  mcpConfigFromUserConfig: (config: UserConfig) => McpConfigFile
  cloneMcpServers: (servers?: McpServerUserConfig[]) => McpServerUserConfig[] | undefined
  cloneMcpToolStates: (states?: McpToolStatesUserConfig) => McpToolStatesUserConfig | undefined
  defaultSecurityConfig: SecurityUserConfig
  defaultKeywordHighlightConfig: KeywordHighlightUserConfig
  appVersion: () => string
  getWindows: () => BrowserWindow[]
}

type McpConfigSnapshot = NonNullable<McpConfigWriteResult['data']>

export const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

const mcpConfigWriteSuccess = (data: McpConfigSnapshot): McpConfigWriteResult => ({ ok: true, data })

export const createSettingsConfigRuntime = (options: SettingsConfigRuntimeOptions) => {
  const getSecurityConfigPath = () => join(options.userDataPath(), 'security-config.json')
  const getKeywordHighlightConfigPath = () => join(options.userDataPath(), 'keyword-highlight.json')
  const getMcpConfigPath = () => join(options.userDataPath(), 'setting', 'mcp_settings.json')

  let securityConfigWatcher: FSWatcher | null = null
  let keywordHighlightConfigWatcher: FSWatcher | null = null
  let mcpConfigWatcher: FSWatcher | null = null

  const defaultSecurityConfigContent = () => `// aiopsterm AI security configuration
// Edit this file to control command approval, block lists, allow lists, and command length limits.

${JSON.stringify(options.defaultSecurityConfig, null, 2)}
`

  const defaultKeywordHighlightConfigContent = () => JSON.stringify(options.defaultKeywordHighlightConfig, null, 2)

  const ensureSecurityConfigFile = async () => {
    const configPath = getSecurityConfigPath()
    await mkdir(dirname(configPath), { recursive: true })
    try {
      await access(configPath)
    } catch {
      await writeFile(configPath, defaultSecurityConfigContent(), 'utf-8')
    }
    return configPath
  }

  const ensureKeywordHighlightConfigFile = async () => {
    const configPath = getKeywordHighlightConfigPath()
    await mkdir(dirname(configPath), { recursive: true })
    try {
      await access(configPath)
    } catch {
      await writeFile(configPath, defaultKeywordHighlightConfigContent(), 'utf-8')
    }
    return configPath
  }

  const ensureMcpConfigFile = async () => {
    const configPath = getMcpConfigPath()
    await mkdir(dirname(configPath), { recursive: true })
    try {
      await access(configPath)
    } catch {
      await writeFile(configPath, JSON.stringify(options.mcpConfigFromUserConfig(options.getConfig()), null, 2), 'utf-8')
    }
    return configPath
  }

  const saveConfigPatch = (patch: Partial<UserConfig>) => {
    const next = options.mergeConfig(options.getConfig(), patch)
    options.saveConfig(next)
    return next
  }

  const applyMcpConfigFileSnapshot = async (parsed: McpConfigFile) => {
    await clearMcpRuntimeClientCache()
    const current = options.getConfig()
    const snapshot = await discoverMcpServerSnapshot(parsed, {
      existingServers: current.mcpServers || [],
      toolStates: current.mcpToolStates || {},
      clientName: 'aiopsterm',
      clientVersion: options.appVersion(),
      runDiscovery: shouldRunMcpDiscovery()
    })
    const next = options.mergeConfig(current, { mcpServers: snapshot.mcpServers, mcpToolStates: snapshot.mcpToolStates })
    options.saveConfig(next)
    return {
      mcpConfig: parsed,
      mcpServers: options.cloneMcpServers(next.mcpServers) || [],
      mcpToolStates: options.cloneMcpToolStates(next.mcpToolStates) || {}
    }
  }

  const syncMcpConfigFromContent = async (content: string) => {
    if (!content.trim()) return
    return applyMcpConfigFileSnapshot(options.normalizeMcpConfigFile(JSON.parse(content)))
  }

  const loadCurrentMcpConfigFile = async () => {
    const configPath = await ensureMcpConfigFile()
    return options.normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
  }

  const setMcpToolState = async (serverName: string, toolName: string, enabled: boolean) => {
    const normalizedServerName = serverName.trim()
    const normalizedToolName = toolName.trim()
    if (!normalizedServerName || !normalizedToolName) {
      throw new Error('MCP server and tool names are required')
    }
    const current = options.getConfig()
    const servers = options.cloneMcpServers(current.mcpServers) || []
    const server = servers.find((item) => item.name === normalizedServerName)
    if (!server) {
      throw new Error(`MCP server not found: ${normalizedServerName}`)
    }
    const tool = server.tools.find((item) => item.name === normalizedToolName)
    if (!tool) {
      throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
    }
    tool.enabled = enabled
    options.saveConfig(
      options.mergeConfig(current, {
        mcpServers: servers,
        mcpToolStates: {
          ...(current.mcpToolStates || {}),
          [`${normalizedServerName}:${normalizedToolName}`]: enabled
        }
      })
    )
    const parsed = options.normalizeMcpConfigFile(JSON.parse(await readFile(await ensureMcpConfigFile(), 'utf-8')))
    const snapshot = await applyMcpConfigFileSnapshot(parsed)
    return mcpConfigWriteSuccess(snapshot)
  }

  const setMcpToolAutoApprove = async (serverName: string, toolName: string, autoApprove: boolean) => {
    const normalizedServerName = serverName.trim()
    const normalizedToolName = toolName.trim()
    if (!normalizedServerName || !normalizedToolName) {
      throw new Error('MCP server and tool names are required')
    }
    const current = options.getConfig()
    const existingServer = current.mcpServers?.find((server) => server.name === normalizedServerName)
    if (!existingServer) {
      throw new Error(`MCP server not found: ${normalizedServerName}`)
    }
    if (!existingServer.tools.some((tool) => tool.name === normalizedToolName)) {
      throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
    }

    const configPath = await ensureMcpConfigFile()
    const parsed = options.normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
    const server = parsed.mcpServers[normalizedServerName]
    if (!server) {
      throw new Error(`MCP server config not found: ${normalizedServerName}`)
    }

    const approved = new Set((server.autoApprove || []).filter(Boolean))
    if (autoApprove) {
      approved.add(normalizedToolName)
    } else {
      approved.delete(normalizedToolName)
    }
    const nextAutoApprove = [...approved]
    if (nextAutoApprove.length) {
      server.autoApprove = nextAutoApprove
    } else {
      delete server.autoApprove
    }

    const nextContent = JSON.stringify(parsed, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    const snapshot = await applyMcpConfigFileSnapshot(parsed)
    broadcastMcpConfigChanged(nextContent)
    return mcpConfigWriteSuccess(snapshot)
  }

  const callCurrentMcpTool = async (input: McpToolCallInput): Promise<McpToolCallResult> => {
    const current = options.getConfig()
    return callMcpTool(await loadCurrentMcpConfigFile(), input, {
      servers: current.mcpServers || [],
      toolStates: current.mcpToolStates || {},
      clientName: 'aiopsterm',
      clientVersion: options.appVersion()
    })
  }

  const readCurrentMcpResource = async (input: McpResourceReadInput): Promise<McpResourceReadResult> => {
    const current = options.getConfig()
    return readMcpResource(await loadCurrentMcpConfigFile(), input, {
      servers: current.mcpServers || [],
      clientName: 'aiopsterm',
      clientVersion: options.appVersion()
    })
  }

  const broadcastMcpConfigChanged = (content: string) => {
    broadcastWindowEvent(options.getWindows(), 'mcp-config:changed', content)
  }

  const syncKeywordHighlightConfigFromContent = (content: string) => {
    if (!content.trim()) return
    const parsed = JSON.parse(content) as Partial<UserConfig>
    if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) return
    return saveConfigPatch({ keywordHighlight: options.normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed) }).keywordHighlight
  }

  const broadcastKeywordHighlightConfigChanged = (content: string) => {
    broadcastWindowEvent(options.getWindows(), 'keyword-highlight-config:changed', content)
  }

  const syncSecurityConfigFromContent = (content: string) => {
    const cleaned = removeJsonComments(content)
    if (!cleaned) return
    const parsed = JSON.parse(cleaned) as Partial<UserConfig>
    if (!parsed.securityConfig && !('security' in parsed)) return
    return saveConfigPatch({ securityConfig: options.normalizeSecurityConfig(parsed.securityConfig || parsed) }).securityConfig
  }

  const broadcastSecurityConfigChanged = (content: string) => {
    broadcastWindowEvent(options.getWindows(), 'security-config:changed', content)
  }

  const startSecurityConfigWatcher = async () => {
    const configPath = await ensureSecurityConfigFile()
    securityConfigWatcher?.close()
    securityConfigWatcher = watch(configPath, async () => {
      try {
        const content = await readFile(configPath, 'utf-8')
        syncSecurityConfigFromContent(content)
        broadcastSecurityConfigChanged(content)
      } catch {
        // External editors can briefly replace the file; the next watch event or read call will recover.
      }
    })
  }

  const startKeywordHighlightConfigWatcher = async () => {
    const configPath = await ensureKeywordHighlightConfigFile()
    keywordHighlightConfigWatcher?.close()
    keywordHighlightConfigWatcher = watch(configPath, async () => {
      try {
        const content = await readFile(configPath, 'utf-8')
        syncKeywordHighlightConfigFromContent(content)
        broadcastKeywordHighlightConfigChanged(content)
      } catch {
        // External editors can briefly replace the file; the next watch event or read call will recover.
      }
    })
  }

  const startMcpConfigWatcher = async () => {
    const configPath = await ensureMcpConfigFile()
    mcpConfigWatcher?.close()
    mcpConfigWatcher = watch(configPath, async () => {
      try {
        const content = await readFile(configPath, 'utf-8')
        await syncMcpConfigFromContent(content)
        broadcastMcpConfigChanged(content)
      } catch {
        // External editors can briefly replace the file; the next watch event or read call will recover.
      }
    })
  }

  const stopConfigWatchers = () => {
    securityConfigWatcher?.close()
    securityConfigWatcher = null
    keywordHighlightConfigWatcher?.close()
    keywordHighlightConfigWatcher = null
    mcpConfigWatcher?.close()
    mcpConfigWatcher = null
    void clearMcpRuntimeClientCache()
  }

  return {
    ensureSecurityConfigFile,
    ensureKeywordHighlightConfigFile,
    ensureMcpConfigFile,
    removeJsonComments,
    applyMcpConfigFileSnapshot,
    syncMcpConfigFromContent,
    loadCurrentMcpConfigFile,
    setMcpToolState,
    setMcpToolAutoApprove,
    callCurrentMcpTool,
    readCurrentMcpResource,
    broadcastSecurityConfigChanged,
    broadcastKeywordHighlightConfigChanged,
    broadcastMcpConfigChanged,
    startSecurityConfigWatcher,
    startKeywordHighlightConfigWatcher,
    startMcpConfigWatcher,
    stopConfigWatchers,
    getMcpServers: () => options.cloneMcpServers(options.getConfig().mcpServers) || []
  }
}
