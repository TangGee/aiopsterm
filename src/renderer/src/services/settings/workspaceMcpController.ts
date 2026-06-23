import { type Ref } from 'vue'
import {
  createMcpOperationKey,
  formatMcpResourceReadContent,
  formatMcpToolCallContent,
  isMcpResourceReadResultData,
  isMcpToolCallResultData,
  malformedMcpResourceResultMessage,
  malformedMcpToolResultMessage
} from '@/services/settings/mcpBackendGuards'
import { mcpClient } from '@/services/settings/mcpClient'
import {
  mcpConfigFilesMatch,
  mergeUserConfig,
  normalizeMcpConfigFile,
  normalizeMcpServersConfig
} from '@/services/settings/workspaceConfigRuntime'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceMcpServer = McpServerUserConfig
export type WorkspaceMcpSnapshot = ReturnType<typeof normalizeMcpServersConfig>
export type WorkspaceMcpOperationStatus = 'idle' | 'running' | 'success' | 'error'
export type WorkspaceMcpOperationRecord = {
  status: WorkspaceMcpOperationStatus
  output: string
  error: string
  durationMs?: number
  isError?: boolean
}

type WorkspaceMcpControllerState = {
  config: Ref<UserConfig>
  mcpServers: Ref<WorkspaceMcpServer[]>
  expandedMcpServerNames: Ref<string[]>
  activeMcpServerTab: Ref<Record<string, 'tools' | 'resources'>>
  mcpToolArgumentDrafts: Ref<Record<string, string>>
  mcpOperationResults: Ref<Record<string, WorkspaceMcpOperationRecord>>
  mcpConfigEditorOpen: Ref<boolean>
  mcpConfigEditorContent: Ref<string>
  mcpConfigEditorError: Ref<string>
  mcpConfigEditorLastSaved: Ref<boolean>
  mcpConfigPath: Ref<string>
}

type WorkspaceMcpControllerDeps = {
  setSettingsNotice: (message: string) => void
  closeKeywordHighlightEditor: () => void
  closeSecurityConfigEditor: () => void
}

type McpConfigMutationResult = Awaited<ReturnType<NonNullable<AiopsPreloadApi['writeMcpConfig']>>>

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseMcpEditorContent = (content: string) => JSON.parse(content)

const cloneMcpServerConfig = (servers: WorkspaceMcpServer[]): McpServerUserConfig[] =>
  servers.map((server) => ({
    name: server.name,
    status: server.status,
    disabled: server.disabled,
    ...(server.error ? { error: server.error } : {}),
    tools: server.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      ...(tool.autoApprove ? { autoApprove: true } : {}),
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

export const createWorkspaceMcpController = (state: WorkspaceMcpControllerState, deps: WorkspaceMcpControllerDeps) => {
  const {
    config,
    mcpServers,
    expandedMcpServerNames,
    activeMcpServerTab,
    mcpToolArgumentDrafts,
    mcpOperationResults,
    mcpConfigEditorOpen,
    mcpConfigEditorContent,
    mcpConfigEditorError,
    mcpConfigEditorLastSaved,
    mcpConfigPath
  } = state
  const { setSettingsNotice, closeKeywordHighlightEditor, closeSecurityConfigEditor } = deps

  let mcpConfigSaveTimer: number | null = null
  let removeMcpConfigFileListener: (() => void) | null = null
  let mcpConfigLoadRequest = 0

  const getMcpSnapshot = () => {
    const servers = cloneMcpServerConfig(mcpServers.value)
    const toolStates: McpToolStatesUserConfig = {}
    servers.forEach((server) => {
      server.tools.forEach((tool) => {
        toolStates[`${server.name}:${tool.name}`] = tool.enabled
      })
    })
    return { servers, toolStates }
  }

  const applyMcpServersSnapshot = (snapshot: WorkspaceMcpSnapshot) => {
    mcpServers.value = snapshot.normalized.map((server) => ({
      ...server,
      tools: server.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })),
      resources: server.resources.map((resource) => ({ ...resource }))
    }))
    const expandedNames = expandedMcpServerNames.value.filter((name) => mcpServers.value.some((server) => server.name === name))
    expandedMcpServerNames.value = expandedNames.length || !mcpServers.value[0] ? expandedNames : [mcpServers.value[0].name]
    config.value = mergeUserConfig(config.value, {
      mcpServers: snapshot.normalized,
      mcpToolStates: snapshot.toolStates
    })
  }

  const restoreMcpServersSnapshot = (snapshot: ReturnType<typeof getMcpSnapshot>) => {
    applyMcpServersSnapshot(normalizeMcpServersConfig(snapshot.servers, snapshot.toolStates))
  }

  const mcpServerDisabledMatches = (serverName: string, disabled: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.disabled === disabled)

  const mcpServerDeletedMatches = (serverName: string) => !mcpServers.value.some((server) => server.name === serverName)

  const mcpToolEnabledMatches = (serverName: string, toolName: string, enabled: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.tools.some((tool) => tool.name === toolName && tool.enabled === enabled))

  const mcpToolAutoApproveMatches = (serverName: string, toolName: string, autoApprove: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.tools.some((tool) => tool.name === toolName && Boolean(tool.autoApprove) === autoApprove))

  const failMcpMutationRefresh = (snapshot: ReturnType<typeof getMcpSnapshot>, message: string) => {
    restoreMcpServersSnapshot(snapshot)
    if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = false
    setSettingsNotice(message)
    return false
  }

  const readMcpServersSnapshotFromBridge = async () => {
    const getMcpServers = mcpClient.getMcpServers()
    if (!getMcpServers) {
      setSettingsNotice('MCP 列表加载服务不可用')
      return null
    }
    try {
      const servers = await getMcpServers()
      if (!Array.isArray(servers)) {
        setSettingsNotice('MCP 配置服务返回数据无效')
        return null
      }
      return normalizeMcpServersConfig(servers)
    } catch {
      setSettingsNotice('MCP 配置加载失败')
      return null
    }
  }

  const readMcpConfigMutationSnapshot = (result: McpConfigMutationResult, errorPrefix: string, invalidMessage = 'MCP 配置服务返回数据无效') => {
    if (!result?.ok || !result.data || !isRecord(result.data.mcpConfig) || !Array.isArray(result.data.mcpServers) || !isRecord(result.data.mcpToolStates)) {
      const message = result?.errorMessage || invalidMessage
      mcpConfigEditorError.value = `${errorPrefix}: ${message}`
      if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = false
      setSettingsNotice(message)
      return null
    }
    const savedConfig = normalizeMcpConfigFile(result.data.mcpConfig)
    const snapshot = normalizeMcpServersConfig(result.data.mcpServers, result.data.mcpToolStates)
    return { savedConfig, snapshot }
  }

  const applySavedMcpConfig = (result: McpConfigMutationResult, expected: McpConfigFile) => {
    const saved = readMcpConfigMutationSnapshot(result, 'Save failed', 'MCP config write did not return saved settings')
    if (!saved) {
      return false
    }
    if (!mcpConfigFilesMatch(saved.savedConfig, expected)) {
      mcpConfigEditorError.value = 'Save failed: MCP config write returned different settings'
      mcpConfigEditorLastSaved.value = false
      return false
    }
    applyMcpServersSnapshot(saved.snapshot)
    mcpConfigEditorContent.value = JSON.stringify(saved.savedConfig, null, 2)
    mcpConfigEditorError.value = ''
    mcpConfigEditorLastSaved.value = true
    return true
  }

  const applyMcpConfigMutationResult = (result: McpConfigMutationResult, errorPrefix: string) => {
    const saved = readMcpConfigMutationSnapshot(result, errorPrefix)
    if (!saved) return false
    applyMcpServersSnapshot(saved.snapshot)
    mcpConfigEditorContent.value = JSON.stringify(saved.savedConfig, null, 2)
    mcpConfigEditorError.value = ''
    if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = true
    return true
  }

  const applyMcpMutationSnapshotForRequest = (
    result: McpConfigMutationResult,
    previousSnapshot: ReturnType<typeof getMcpSnapshot>,
    errorPrefix: string,
    mismatchMessage: string,
    matches: () => boolean
  ) => {
    if (!applyMcpConfigMutationResult(result, errorPrefix)) {
      restoreMcpServersSnapshot(previousSnapshot)
      return false
    }
    if (!matches()) {
      mcpConfigEditorError.value = `${errorPrefix}: ${mismatchMessage}`
      return failMcpMutationRefresh(previousSnapshot, mismatchMessage)
    }
    return true
  }

  const refreshMcpServersFromBridge = async () => {
    const snapshot = await readMcpServersSnapshotFromBridge()
    if (!snapshot) return false
    applyMcpServersSnapshot(snapshot)
    return true
  }

  const applyMcpConfigFileContent = (content: string, markSaved = true, snapshot?: WorkspaceMcpSnapshot | null) => {
    const editorContent = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
    mcpConfigEditorContent.value = editorContent
    try {
      normalizeMcpConfigFile(parseMcpEditorContent(editorContent))
      if (snapshot) applyMcpServersSnapshot(snapshot)
      mcpConfigEditorError.value = ''
      mcpConfigEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const installMcpConfigFileListener = () => {
    const onMcpConfigFileChanged = mcpClient.onMcpConfigFileChanged()
    if (removeMcpConfigFileListener || !onMcpConfigFileChanged) return
    removeMcpConfigFileListener = onMcpConfigFileChanged((content) => {
      void (async () => {
        const snapshot = await readMcpServersSnapshotFromBridge()
        if (!snapshot) {
          mcpConfigEditorContent.value = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
          mcpConfigEditorLastSaved.value = false
          return
        }
        applyMcpConfigFileContent(content, true, snapshot)
      })()
    })
  }

  const openMcpConfigEditor = async () => {
    closeKeywordHighlightEditor()
    closeSecurityConfigEditor()
    const requestId = ++mcpConfigLoadRequest
    mcpConfigEditorOpen.value = true
    mcpConfigEditorContent.value = ''
    mcpConfigEditorError.value = ''
    mcpConfigEditorLastSaved.value = false
    installMcpConfigFileListener()
    const getMcpConfigPath = mcpClient.getMcpConfigPath()
    const readMcpConfig = mcpClient.readMcpConfig()
    if (!getMcpConfigPath || !readMcpConfig) {
      mcpConfigEditorError.value = 'Failed to read MCP config: MCP 配置读取服务不可用'
      setSettingsNotice('MCP 配置读取服务不可用')
      return
    }
    try {
      const [bridgeSnapshot, path, content] = await Promise.all([readMcpServersSnapshotFromBridge(), getMcpConfigPath(), readMcpConfig()])
      if (requestId !== mcpConfigLoadRequest) return
      mcpConfigPath.value = path
      applyMcpConfigFileContent(content, false, bridgeSnapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Failed to read MCP config: ${message}`
    }
  }

  const closeMcpConfigEditor = () => {
    mcpConfigLoadRequest += 1
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    if (removeMcpConfigFileListener) {
      removeMcpConfigFileListener()
      removeMcpConfigFileListener = null
    }
    mcpConfigEditorOpen.value = false
  }

  const updateMcpConfigEditorContent = (content: string) => {
    mcpConfigEditorContent.value = content
    mcpConfigEditorLastSaved.value = false
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    try {
      parseMcpEditorContent(content)
      mcpConfigEditorError.value = ''
      mcpConfigSaveTimer = window.setTimeout(() => {
        void saveMcpConfigEditor()
        mcpConfigSaveTimer = null
      }, 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveMcpConfigEditor = async (format = false) => {
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    let normalized: McpConfigFile
    try {
      normalized = normalizeMcpConfigFile(parseMcpEditorContent(mcpConfigEditorContent.value))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const content = format ? JSON.stringify(normalized, null, 2) : mcpConfigEditorContent.value
    const writeMcpConfig = mcpClient.writeMcpConfig()
    if (!writeMcpConfig) {
      mcpConfigEditorError.value = 'Save failed: MCP 配置保存服务不可用'
      mcpConfigEditorLastSaved.value = false
      setSettingsNotice('MCP 配置保存服务不可用')
      return false
    }
    try {
      const result = await writeMcpConfig(content)
      if (!applySavedMcpConfig(result, normalized)) return false
      setSettingsNotice('MCP 配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Save failed: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const toggleMcpServerExpanded = (name: string) => {
    expandedMcpServerNames.value = expandedMcpServerNames.value.includes(name)
      ? expandedMcpServerNames.value.filter((item) => item !== name)
      : [...expandedMcpServerNames.value, name]
  }

  const setMcpServerTab = (name: string, tab: 'tools' | 'resources') => {
    activeMcpServerTab.value = { ...activeMcpServerTab.value, [name]: tab }
  }

  const toggleMcpServerDisabled = async (name: string) => {
    const server = mcpServers.value.find((item) => item.name === name)
    if (!server) return false
    const toggleMcpServer = mcpClient.toggleMcpServer()
    if (!toggleMcpServer) {
      setSettingsNotice('MCP 状态服务不可用')
      return false
    }
    const nextDisabled = !server.disabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await toggleMcpServer(name, nextDisabled)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP 状态更新失败', `MCP ${name} 状态更新结果不匹配`, () =>
          mcpServerDisabledMatches(name, nextDisabled)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `MCP ${name} 状态更新后刷新失败`)
      }
      if (!mcpServerDisabledMatches(name, nextDisabled)) {
        return failMcpMutationRefresh(previousSnapshot, `MCP ${name} 状态更新后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`MCP ${name} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${name} ${nextDisabled ? '已禁用' : '已启用'}`)
    return true
  }

  const deleteMcpServer = async (name: string) => {
    const deleteMcpServerBridge = mcpClient.deleteMcpServer()
    if (!deleteMcpServerBridge) {
      setSettingsNotice('MCP 删除服务不可用')
      return false
    }
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await deleteMcpServerBridge(name)
      if (!applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP 删除失败', `${name} 删除结果不匹配`, () => mcpServerDeletedMatches(name))) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `${name} 删除后刷新失败`)
      }
      if (!mcpServerDeletedMatches(name)) {
        return failMcpMutationRefresh(previousSnapshot, `${name} 删除后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${name} 删除失败`)
      return false
    }
    setSettingsNotice(`${name} 已删除`)
    return true
  }

  const toggleMcpTool = async (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return false
    const setMcpToolState = mcpClient.setMcpToolState()
    if (!setMcpToolState) {
      setSettingsNotice('MCP Tool 状态服务不可用')
      return false
    }
    const nextEnabled = !tool.enabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await setMcpToolState(serverName, toolName, nextEnabled)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP Tool 状态更新失败', `${toolName} 状态更新结果不匹配`, () =>
          mcpToolEnabledMatches(serverName, toolName, nextEnabled)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `${toolName} 状态更新后刷新失败`)
      }
      if (!mcpToolEnabledMatches(serverName, toolName, nextEnabled)) {
        return failMcpMutationRefresh(previousSnapshot, `${toolName} 状态更新后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${toolName} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${toolName} ${nextEnabled ? '已启用' : '已禁用'}`)
    return true
  }

  const toggleMcpToolAutoApprove = async (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return false
    const setMcpToolAutoApprove = mcpClient.setMcpToolAutoApprove()
    if (!setMcpToolAutoApprove) {
      setSettingsNotice('MCP Auto Approve 服务不可用')
      return false
    }
    const nextAutoApprove = !tool.autoApprove
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await setMcpToolAutoApprove(serverName, toolName, nextAutoApprove)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'Auto Approve failed', 'MCP Auto Approve 更新结果不匹配', () =>
          mcpToolAutoApproveMatches(serverName, toolName, nextAutoApprove)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, 'MCP Auto Approve 更新后刷新失败')
      }
      if (!mcpToolAutoApproveMatches(serverName, toolName, nextAutoApprove)) {
        mcpConfigEditorError.value = 'Auto Approve failed: MCP Auto Approve 更新后刷新结果不匹配'
        return failMcpMutationRefresh(previousSnapshot, 'MCP Auto Approve 更新后刷新结果不匹配')
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${toolName} Auto Approve 更新失败`)
      return false
    }
    setSettingsNotice(`${toolName} Auto Approve ${nextAutoApprove ? '已启用' : '已关闭'}`)
    return true
  }

  const getMcpToolOperationKey = (serverName: string, toolName: string) => createMcpOperationKey('tool', serverName, toolName)

  const getMcpResourceOperationKey = (serverName: string, uri: string) => createMcpOperationKey('resource', serverName, uri)

  const getMcpToolArgumentDraft = (serverName: string, toolName: string) => mcpToolArgumentDrafts.value[getMcpToolOperationKey(serverName, toolName)] || ''

  const updateMcpToolArgumentDraft = (serverName: string, toolName: string, content: string) => {
    mcpToolArgumentDrafts.value = {
      ...mcpToolArgumentDrafts.value,
      [getMcpToolOperationKey(serverName, toolName)]: content
    }
  }

  const setMcpOperationResult = (key: string, record: WorkspaceMcpOperationRecord) => {
    mcpOperationResults.value = {
      ...mcpOperationResults.value,
      [key]: record
    }
  }

  const restoreMcpOperationResult = (key: string, record: WorkspaceMcpOperationRecord | undefined) => {
    const next = { ...mcpOperationResults.value }
    if (record) next[key] = record
    else delete next[key]
    mcpOperationResults.value = next
  }

  const parseMcpToolArguments = (serverName: string, toolName: string) => {
    const draft = getMcpToolArgumentDraft(serverName, toolName).trim()
    if (!draft) return { ok: true as const, arguments: {} as Record<string, unknown> }
    try {
      const parsed = JSON.parse(draft)
      if (!isRecord(parsed)) {
        return { ok: false as const, message: 'MCP Tool 参数必须是 JSON object' }
      }
      return { ok: true as const, arguments: parsed }
    } catch (error) {
      return {
        ok: false as const,
        message: `MCP Tool 参数 JSON 无效：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  const runMcpTool = async (serverName: string, toolName: string) => {
    const key = getMcpToolOperationKey(serverName, toolName)
    const server = mcpServers.value.find((item) => item.name === serverName)
    const tool = server?.tools.find((item) => item.name === toolName)
    if (!server || !tool) return false
    if (server.disabled || server.status !== 'connected') {
      const message = server.disabled ? `MCP ${serverName} 已禁用` : `MCP ${serverName} 未连接`
      setSettingsNotice(message)
      return false
    }
    if (!tool.enabled) {
      const message = `MCP Tool ${toolName} 已禁用`
      setSettingsNotice(message)
      return false
    }
    const callMcpTool = mcpClient.callMcpTool()
    if (!callMcpTool) {
      const message = 'MCP Tool 调用服务不可用'
      setSettingsNotice(message)
      return false
    }
    const parsed = parseMcpToolArguments(serverName, toolName)
    if (!parsed.ok) {
      setSettingsNotice(parsed.message)
      return false
    }
    const previousRecord = mcpOperationResults.value[key] ? { ...mcpOperationResults.value[key] } : undefined
    setMcpOperationResult(key, { status: 'running', output: '', error: '' })
    try {
      const result = await callMcpTool(serverName, toolName, parsed.arguments)
      if (!result?.ok) {
        const message = result?.errorMessage || `${toolName} 调用失败`
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(message)
        return false
      }
      if (!isMcpToolCallResultData(result.data, serverName, toolName)) {
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(malformedMcpToolResultMessage)
        return false
      }
      setMcpOperationResult(key, {
        status: result.data.isError ? 'error' : 'success',
        output: formatMcpToolCallContent(result.data.content),
        error: result.data.isError ? formatMcpToolCallContent(result.data.content) : '',
        durationMs: result.data.durationMs,
        isError: result.data.isError
      })
      setSettingsNotice(result.data.isError ? `${toolName} 返回错误` : `${toolName} 调用完成`)
      return !result.data.isError
    } catch (error) {
      const message = error instanceof Error ? error.message : `${toolName} 调用失败`
      restoreMcpOperationResult(key, previousRecord)
      setSettingsNotice(message)
      return false
    }
  }

  const readMcpResource = async (serverName: string, uri: string) => {
    const key = getMcpResourceOperationKey(serverName, uri)
    const server = mcpServers.value.find((item) => item.name === serverName)
    const resource = server?.resources.find((item) => item.uri === uri)
    if (!server || !resource) return false
    if (server.disabled || server.status !== 'connected') {
      const message = server.disabled ? `MCP ${serverName} 已禁用` : `MCP ${serverName} 未连接`
      setSettingsNotice(message)
      return false
    }
    const readMcpResourceBridge = mcpClient.readMcpResource()
    if (!readMcpResourceBridge) {
      const message = 'MCP Resource 读取服务不可用'
      setSettingsNotice(message)
      return false
    }
    const previousRecord = mcpOperationResults.value[key] ? { ...mcpOperationResults.value[key] } : undefined
    setMcpOperationResult(key, { status: 'running', output: '', error: '' })
    try {
      const result = await readMcpResourceBridge(serverName, uri)
      if (!result?.ok) {
        const message = result?.errorMessage || `${resource.name} 读取失败`
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(message)
        return false
      }
      if (!isMcpResourceReadResultData(result.data, serverName, uri)) {
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(malformedMcpResourceResultMessage)
        return false
      }
      setMcpOperationResult(key, {
        status: 'success',
        output: formatMcpResourceReadContent(result.data.contents),
        error: '',
        durationMs: result.data.durationMs
      })
      setSettingsNotice(`${resource.name} 读取完成`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : `${resource.name} 读取失败`
      restoreMcpOperationResult(key, previousRecord)
      setSettingsNotice(message)
      return false
    }
  }

  return {
    readMcpServersSnapshotFromBridge,
    applyMcpServersSnapshot,
    refreshMcpServersFromBridge,
    openMcpConfigEditor,
    closeMcpConfigEditor,
    updateMcpConfigEditorContent,
    saveMcpConfigEditor,
    toggleMcpServerExpanded,
    setMcpServerTab,
    toggleMcpServerDisabled,
    deleteMcpServer,
    toggleMcpTool,
    toggleMcpToolAutoApprove,
    getMcpToolOperationKey,
    getMcpResourceOperationKey,
    getMcpToolArgumentDraft,
    updateMcpToolArgumentDraft,
    runMcpTool,
    readMcpResource
  }
}
