import type { IpcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type {
  KeywordHighlightConfigWriteResult,
  KeywordHighlightUserConfig,
  McpConfigFile,
  McpConfigWriteResult,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallInput,
  McpToolCallResult,
  SecurityConfigWriteResult,
  SecurityUserConfig,
  UserConfig
} from '@shared/preload'

type McpConfigSnapshot = NonNullable<McpConfigWriteResult['data']>

type RegisterMcpConfigIpcInput = {
  ensureSecurityConfigFile: () => Promise<string>
  ensureKeywordHighlightConfigFile: () => Promise<string>
  ensureMcpConfigFile: () => Promise<string>
  removeJsonComments: (content: string) => string
  normalizeSecurityConfig: (source?: unknown) => SecurityUserConfig
  normalizeKeywordHighlightConfig: (source?: unknown) => KeywordHighlightUserConfig
  normalizeMcpConfigFile: (source?: unknown) => McpConfigFile
  saveConfigPatch: (patch: Partial<UserConfig>) => UserConfig
  getMcpServers: () => McpServerUserConfig[]
  applyMcpConfigFileSnapshot: (parsed: McpConfigFile) => Promise<McpConfigSnapshot>
  syncMcpConfigFromContent: (content: string) => Promise<unknown>
  setMcpToolState: (serverName: string, toolName: string, enabled: boolean) => Promise<McpConfigWriteResult>
  setMcpToolAutoApprove: (serverName: string, toolName: string, autoApprove: boolean) => Promise<McpConfigWriteResult>
  callMcpTool: (input: McpToolCallInput) => Promise<McpToolCallResult>
  readMcpResource: (input: McpResourceReadInput) => Promise<McpResourceReadResult>
  broadcastSecurityConfigChanged: (content: string) => void
  broadcastKeywordHighlightConfigChanged: (content: string) => void
  broadcastMcpConfigChanged: (content: string) => void
}

const mcpConfigWriteSuccess = (data: McpConfigSnapshot): McpConfigWriteResult => ({ ok: true, data })

const mcpConfigWriteError = (error: unknown, fallbackCode: string, fallbackMessage: string): McpConfigWriteResult => ({
  ok: false,
  errorCode: fallbackCode,
  errorMessage: error instanceof Error ? error.message : fallbackMessage
})

export const registerMcpConfigIpc = (ipcMain: IpcMain, input: RegisterMcpConfigIpcInput) => {
  ipcMain.handle('security-config:path', async () => input.ensureSecurityConfigFile())
  ipcMain.handle('security-config:read', async () => {
    const configPath = await input.ensureSecurityConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('security-config:write', async (_event, content: string): Promise<SecurityConfigWriteResult> => {
    const configPath = await input.ensureSecurityConfigFile()
    const parsed = JSON.parse(input.removeJsonComments(content)) as Partial<UserConfig>
    if (!parsed.securityConfig && !('security' in parsed)) {
      return { ok: false, errorCode: 'SECURITY_CONFIG_INVALID', errorMessage: 'Security config content is missing the security root.' }
    }
    const securityConfig = input.normalizeSecurityConfig(parsed.securityConfig || parsed)
    await writeFile(configPath, content, 'utf-8')
    input.saveConfigPatch({ securityConfig })
    input.broadcastSecurityConfigChanged(content)
    return { ok: true, data: { securityConfig } }
  })

  ipcMain.handle('keyword-highlight-config:path', async () => input.ensureKeywordHighlightConfigFile())
  ipcMain.handle('keyword-highlight-config:read', async () => {
    const configPath = await input.ensureKeywordHighlightConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('keyword-highlight-config:write', async (_event, content: string): Promise<KeywordHighlightConfigWriteResult> => {
    const configPath = await input.ensureKeywordHighlightConfigFile()
    const parsed = JSON.parse(content) as Partial<UserConfig>
    if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) {
      return { ok: false, errorCode: 'KEYWORD_HIGHLIGHT_CONFIG_INVALID', errorMessage: 'Keyword highlight config content is missing the keyword-highlight root.' }
    }
    const keywordHighlight = input.normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed)
    await writeFile(configPath, content, 'utf-8')
    input.saveConfigPatch({ keywordHighlight })
    input.broadcastKeywordHighlightConfigChanged(content)
    return { ok: true, data: { keywordHighlight } }
  })

  ipcMain.handle('mcp-config:path', async () => input.ensureMcpConfigFile())
  ipcMain.handle('mcp:get-servers', async () => {
    const configPath = await input.ensureMcpConfigFile()
    await input.syncMcpConfigFromContent(await readFile(configPath, 'utf-8'))
    return input.getMcpServers()
  })
  ipcMain.handle('mcp-config:read', async () => {
    const configPath = await input.ensureMcpConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('mcp-config:write', async (_event, content: string): Promise<McpConfigWriteResult> => {
    const configPath = await input.ensureMcpConfigFile()
    const normalized = input.normalizeMcpConfigFile(JSON.parse(content))
    const nextContent = JSON.stringify(normalized, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    const snapshot = await input.applyMcpConfigFileSnapshot(normalized)
    input.broadcastMcpConfigChanged(nextContent)
    return mcpConfigWriteSuccess(snapshot)
  })
  ipcMain.handle('mcp-config:toggle-server', async (_event, serverName: string, disabled: boolean): Promise<McpConfigWriteResult> => {
    try {
      const normalizedServerName = String(serverName || '').trim()
      if (!normalizedServerName) throw new Error('MCP server name is required')
      const configPath = await input.ensureMcpConfigFile()
      const parsed = input.normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
      if (!parsed.mcpServers[normalizedServerName]) throw new Error(`MCP server not found: ${normalizedServerName}`)
      parsed.mcpServers[normalizedServerName].disabled = disabled
      const nextContent = JSON.stringify(parsed, null, 2)
      await writeFile(configPath, nextContent, 'utf-8')
      const snapshot = await input.applyMcpConfigFileSnapshot(parsed)
      input.broadcastMcpConfigChanged(nextContent)
      return mcpConfigWriteSuccess(snapshot)
    } catch (error) {
      return mcpConfigWriteError(error, 'MCP_SERVER_TOGGLE_FAILED', 'MCP server toggle failed.')
    }
  })
  ipcMain.handle('mcp-config:delete-server', async (_event, serverName: string): Promise<McpConfigWriteResult> => {
    try {
      const normalizedServerName = String(serverName || '').trim()
      if (!normalizedServerName) throw new Error('MCP server name is required')
      const configPath = await input.ensureMcpConfigFile()
      const parsed = input.normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
      if (!parsed.mcpServers[normalizedServerName]) throw new Error(`MCP server not found: ${normalizedServerName}`)
      delete parsed.mcpServers[normalizedServerName]
      const nextContent = JSON.stringify(parsed, null, 2)
      await writeFile(configPath, nextContent, 'utf-8')
      const snapshot = await input.applyMcpConfigFileSnapshot(parsed)
      input.broadcastMcpConfigChanged(nextContent)
      return mcpConfigWriteSuccess(snapshot)
    } catch (error) {
      return mcpConfigWriteError(error, 'MCP_SERVER_DELETE_FAILED', 'MCP server delete failed.')
    }
  })
  ipcMain.handle('mcp:set-tool-state', async (_event, serverName: string, toolName: string, enabled: boolean) => {
    try {
      return await input.setMcpToolState(serverName, toolName, Boolean(enabled))
    } catch (error) {
      return mcpConfigWriteError(error, 'MCP_TOOL_STATE_FAILED', 'MCP tool state update failed.')
    }
  })
  ipcMain.handle('mcp:set-tool-auto-approve', async (_event, serverName: string, toolName: string, autoApprove: boolean): Promise<McpConfigWriteResult> => {
    try {
      return await input.setMcpToolAutoApprove(serverName, toolName, Boolean(autoApprove))
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_TOOL_AUTO_APPROVE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'MCP tool auto approve update failed.'
      }
    }
  })
  ipcMain.handle('mcp:tool-call', async (_event, toolInput: McpToolCallInput): Promise<McpToolCallResult> => {
    try {
      return await input.callMcpTool(toolInput)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_CONFIG_INVALID',
        errorMessage: error instanceof Error ? error.message : 'MCP config could not be read.'
      }
    }
  })
  ipcMain.handle('mcp:resource-read', async (_event, resourceInput: McpResourceReadInput): Promise<McpResourceReadResult> => {
    try {
      return await input.readMcpResource(resourceInput)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'MCP_CONFIG_INVALID',
        errorMessage: error instanceof Error ? error.message : 'MCP config could not be read.'
      }
    }
  })
}
