import type { KnowledgeBaseUserConfig, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { QuickCommandGroupConfig, QuickCommandSnippetConfig, QuickCommandsUserConfig } from '@shared/contracts/quickCommands'
import type { ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { SkillUserConfig } from '@shared/contracts/skills'
import {
  defaultKnowledgeBase,
  defaultMcpServers,
  defaultMcpToolStates,
  defaultQuickCommands,
  defaultRules,
  defaultShortcuts,
  defaultSkills,
  mcpStatusValues,
  shortcutDefaultsById,
  shortcutModifierTokens
} from './workspaceConfigDefaults'
import { integerInRange, isRecord, numberInRange, stringFromOptions } from './workspaceConfigPrimitives'

export const createKbRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

export const knowledgeNodeSize = (node: KnowledgeNode): number => (node.size || 0) + (node.children?.reduce((total, child) => total + knowledgeNodeSize(child), 0) || 0)

export const knowledgeTreeSize = (nodes: KnowledgeNode[]) => nodes.reduce((total, node) => total + knowledgeNodeSize(node), 0)

export const defaultMcpConfigFile = (): McpConfigFile => ({
  mcpServers: Object.fromEntries(
    defaultMcpServers.map((server) => {
      const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
      return [
        server.name,
        {
          type: 'stdio' as const,
          disabled: server.disabled,
          ...(autoApprove.length ? { autoApprove } : {}),
          command: server.name === 'filesystem' ? 'npx' : server.name,
          args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', '~'] : [],
          timeout: 60
        }
      ]
    })
  )
})

const normalizeMcpTransportType = (server: Record<string, unknown>): McpConfigFile['mcpServers'][string]['type'] => {
  const rawType = typeof server.type === 'string' ? server.type.trim() : ''
  if (rawType === 'sse') return 'sse'
  if (rawType === 'streamableHttp' || rawType === 'http' || rawType === 'streamable_http' || rawType === 'streamable-http') return 'streamableHttp'
  if (rawType === 'stdio') return 'stdio'

  const hasCommand = typeof server.command === 'string' && server.command.trim().length > 0
  const hasUrl = typeof server.url === 'string' && server.url.trim().length > 0
  return !hasCommand && hasUrl ? 'streamableHttp' : 'stdio'
}

export const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = normalizeMcpTransportType(value)
    const autoApprove = Array.isArray(value.autoApprove)
      ? value.autoApprove.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : undefined
    const args = Array.isArray(value.args)
      ? value.args
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined
    const stringRecord = (record: unknown) =>
      isRecord(record) ? Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
    mcpServers[name.trim()] = {
      type,
      ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      ...(autoApprove?.length ? { autoApprove } : {}),
      ...(typeof value.timeout === 'number' && value.timeout > 0 ? { timeout: value.timeout } : {}),
      ...(typeof value.command === 'string' && value.command.trim() ? { command: value.command.trim() } : {}),
      ...(args?.length ? { args } : {}),
      ...(typeof value.cwd === 'string' && value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
      ...(stringRecord(value.env) ? { env: stringRecord(value.env) } : {}),
      ...(typeof value.url === 'string' && value.url.trim() ? { url: value.url.trim() } : {}),
      ...(stringRecord(value.headers) ? { headers: stringRecord(value.headers) } : {})
    }
  })
  return { mcpServers }
}

export const mcpConfigFilesMatch = (left: McpConfigFile, right: McpConfigFile) =>
  JSON.stringify(normalizeMcpConfigFile(left)) === JSON.stringify(normalizeMcpConfigFile(right))

export const normalizeQuickCommandsConfig = (source?: Partial<QuickCommandsUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  const groupUuids = new Set<string>()
  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()

  const groups = rawGroups
    .map((item, index): QuickCommandGroupConfig | null => {
      if (!isRecord(item)) return null
      const groupName = typeof item.group_name === 'string' ? item.group_name.trim() : ''
      if (!groupName) return null
      const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
      if (!uuid) return null
      if (groupUuids.has(uuid)) return null
      groupUuids.add(uuid)
      return {
        id: integerInRange(item.id, index + 1, 1),
        uuid,
        group_name: groupName
      }
    })
    .filter(Boolean) as QuickCommandGroupConfig[]

  const normalizedSnippets: QuickCommandSnippetConfig[] = []
  rawSnippets.forEach((item, index) => {
    if (!isRecord(item)) return
    const snippetName = typeof item.snippet_name === 'string' ? item.snippet_name.trim() : ''
    const snippetContent = typeof item.snippet_content === 'string' ? item.snippet_content : ''
    if (!snippetName || !snippetContent) return

    let id = integerInRange(item.id, index + 1, 1)
    while (snippetIds.has(id)) id += 1
    snippetIds.add(id)

    const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
    if (!uuid) return
    if (snippetUuids.has(uuid)) return
    snippetUuids.add(uuid)

    const groupUuid = typeof item.group_uuid === 'string' && groupUuids.has(item.group_uuid) ? item.group_uuid : null
    const snippet: QuickCommandSnippetConfig = {
      id,
      uuid,
      snippet_name: snippetName,
      snippet_content: snippetContent,
      group_uuid: groupUuid
    }
    if (typeof item.create_at === 'string') snippet.create_at = item.create_at
    if (typeof item.update_at === 'string') snippet.update_at = item.update_at
    normalizedSnippets.push(snippet)
  })

  const normalized: QuickCommandsUserConfig = {
    groups,
    snippets: normalizedSnippets
  }
  const comparable = {
    groups: Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups,
    snippets: Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.groups) ||
    !Array.isArray(incoming.snippets) ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const normalizeKnowledgeNodes = (source: unknown, parentRelDir = '', seen = new Set<string>()): KnowledgeNode[] => {
  const rawNodes = Array.isArray(source) ? source : []
  const nodes: KnowledgeNode[] = []
  rawNodes.forEach((item, index) => {
    if (!isRecord(item)) return
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
    if (!rawTitle) return
    const type = item.type === 'dir' || item.type === 'file' ? item.type : 'file'
    const fallbackRelPath = createKbRelPath(parentRelDir, rawTitle)
    const relPath = typeof item.relPath === 'string' && item.relPath.trim() ? item.relPath.trim() : fallbackRelPath
    if (!relPath || seen.has(relPath)) return
    seen.add(relPath)
    const node: KnowledgeNode = {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || index}`,
      key: relPath,
      relPath,
      title: rawTitle,
      type
    }
    if (type === 'file') {
      node.size = numberInRange(item.size, 0, 0)
    } else {
      node.children = normalizeKnowledgeNodes(item.children, relPath, seen)
    }
    nodes.push(node)
  })
  return nodes
}

export const normalizeKnowledgeBaseConfig = (source?: Partial<KnowledgeBaseUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalizedTree = normalizeKnowledgeNodes(Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree)
  const normalized: KnowledgeBaseUserConfig = {
    tree: normalizedTree,
    usedBytes: numberInRange(incoming.usedBytes, defaultKnowledgeBase.usedBytes, 0),
    totalBytes: numberInRange(incoming.totalBytes, defaultKnowledgeBase.totalBytes, 1)
  }
  if (normalized.usedBytes === 0 && normalizedTree.length > 0 && incoming.usedBytes === undefined) {
    normalized.usedBytes = knowledgeTreeSize(normalizedTree)
  }
  const comparable = {
    tree: Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree,
    usedBytes: typeof incoming.usedBytes === 'number' ? incoming.usedBytes : defaultKnowledgeBase.usedBytes,
    totalBytes: typeof incoming.totalBytes === 'number' ? incoming.totalBytes : defaultKnowledgeBase.totalBytes
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.tree) ||
    typeof incoming.usedBytes !== 'number' ||
    typeof incoming.totalBytes !== 'number' ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const getShortcutParts = (shortcut: string) =>
  shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

const normalizeShortcutText = (shortcut: string) => shortcut.replace(/\s+/g, '').toLowerCase()

export const isValidShortcutForAction = (actionId: string, shortcut: string) => {
  const parts = getShortcutParts(shortcut)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true

  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokens.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

export const normalizeShortcutsConfig = (source?: unknown) => {
  const shortcutsById = new Map<string, ShortcutUserConfig>()
  let changed = !Array.isArray(source)

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) {
        changed = true
        return
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const action = typeof item.action === 'string' && item.action.trim() ? item.action.trim() : id
      const shortcut = typeof item.shortcut === 'string' ? item.shortcut.trim() : ''
      if (!id || !action || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      const normalizedShortcut: ShortcutUserConfig = {
        id,
        action,
        shortcut,
        ...(typeof item.suffix === 'string' && item.suffix.trim() ? { suffix: item.suffix.trim() } : {})
      }
      shortcutsById.set(id, normalizedShortcut)
      const allowedKeys = new Set(['id', 'action', 'shortcut', 'suffix'])
      if (
        item.id !== id ||
        item.shortcut !== shortcut ||
        item.action !== action ||
        item.suffix !== normalizedShortcut.suffix ||
        Object.keys(item).some((key) => !allowedKeys.has(key))
      ) {
        changed = true
      }
    })
  } else if (isRecord(source)) {
    Object.entries(source).forEach(([id, value]) => {
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = typeof value === 'string' ? value.trim() : ''
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      shortcutsById.set(id, { ...defaultShortcut, shortcut })
      if (value !== shortcut) changed = true
    })
  }

  const recentPanels = shortcutsById.get('recentPanels')
  if (recentPanels && normalizeShortcutText(recentPanels.shortcut) === 'ctrl+e') {
    const ctrlTabTaken = Array.from(shortcutsById.entries()).some(
      ([id, shortcut]) => id !== 'recentPanels' && normalizeShortcutText(shortcut.shortcut) === 'ctrl+tab'
    )
    shortcutsById.set('recentPanels', {
      ...recentPanels,
      shortcut: ctrlTabTaken ? 'Ctrl+Shift+E' : 'Ctrl+Tab'
    })
    changed = true
  }

  const normalized = Array.from(shortcutsById.values())

  return {
    normalized,
    changed
  }
}

export const normalizeRulesConfig = (source?: unknown, customInstructions?: unknown) => {
  const rawRules = Array.isArray(source) ? source : defaultRules
  const seenIds = new Set<string>()
  const normalized: UserRuleConfig[] = []
  let changed = !Array.isArray(source)

  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) {
      changed = true
      return
    }
    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) {
      changed = true
      return
    }
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    const rule = {
      id,
      content,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true
    }
    normalized.push(rule)
    const allowedKeys = new Set(['id', 'content', 'enabled'])
    if (
      item.id !== rule.id ||
      item.content !== rule.content ||
      item.enabled !== rule.enabled ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const migratedInstruction = typeof customInstructions === 'string' ? customInstructions.trim() : ''
  if (migratedInstruction) {
    let id = 'rule-custom-instructions'
    let suffix = 1
    while (seenIds.has(id)) {
      suffix += 1
      id = `rule-custom-instructions-${suffix}`
    }
    normalized.unshift({
      id,
      content: migratedInstruction,
      enabled: true
    })
    changed = true
  }

  return {
    normalized,
    changed
  }
}

export const normalizeSkillsConfig = (source?: unknown) => {
  const rawSkills = Array.isArray(source) ? source : defaultSkills
  const seenNames = new Set<string>()
  const normalized: SkillUserConfig[] = []
  let changed = !Array.isArray(source)

  rawSkills.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!name || !description || !content || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const skill: SkillUserConfig = {
      name,
      description,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      editable: item.editable !== undefined ? Boolean(item.editable) : true,
      content
    }
    if (typeof item.path === 'string' && item.path.trim()) {
      skill.path = item.path.trim()
    }
    normalized.push(skill)
    const allowedKeys = new Set(['name', 'description', 'enabled', 'editable', 'content', 'path'])
    if (
      item.name !== skill.name ||
      item.description !== skill.description ||
      item.enabled !== skill.enabled ||
      item.editable !== skill.editable ||
      item.content !== skill.content ||
      item.path !== skill.path ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const normalizeMcpToolStatesConfig = (source?: unknown): McpToolStatesUserConfig => {
  if (!isRecord(source)) return { ...defaultMcpToolStates }
  const normalized: McpToolStatesUserConfig = {}
  Object.entries(source).forEach(([key, value]) => {
    if (typeof key === 'string' && key.includes(':') && typeof value === 'boolean') {
      normalized[key] = value
    }
  })
  return normalized
}

export const normalizeMcpServersConfig = (source?: unknown, toolStatesSource?: unknown) => {
  const rawServers = Array.isArray(source) ? source : defaultMcpServers
  const toolStates = normalizeMcpToolStatesConfig(toolStatesSource)
  const seenServers = new Set<string>()
  let changed = !Array.isArray(source)

  const normalized: McpServerUserConfig[] = []
  rawServers.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || seenServers.has(name)) {
      changed = true
      return
    }
    seenServers.add(name)
    const disabled = typeof item.disabled === 'boolean' ? item.disabled : false
    const status = disabled ? 'disabled' : stringFromOptions(item.status, mcpStatusValues, 'disconnected')
    const seenTools = new Set<string>()
    const tools = (Array.isArray(item.tools) ? item.tools : [])
      .map((tool): McpServerUserConfig['tools'][number] | null => {
        if (!isRecord(tool)) {
          changed = true
          return null
        }
        const toolName = typeof tool.name === 'string' ? tool.name.trim() : ''
        if (!toolName || seenTools.has(toolName)) {
          changed = true
          return null
        }
        seenTools.add(toolName)
        const stateKey = `${name}:${toolName}`
        const enabled = typeof toolStates[stateKey] === 'boolean' ? toolStates[stateKey] : typeof tool.enabled === 'boolean' ? tool.enabled : true
        const parameters = (Array.isArray(tool.parameters) ? tool.parameters : [])
          .map((parameter): McpServerUserConfig['tools'][number]['parameters'][number] | null => {
            if (!isRecord(parameter)) {
              changed = true
              return null
            }
            const parameterName = typeof parameter.name === 'string' ? parameter.name.trim() : ''
            if (!parameterName) {
              changed = true
              return null
            }
            return {
              name: parameterName,
              description: typeof parameter.description === 'string' ? parameter.description : '',
              ...(parameter.required !== undefined ? { required: Boolean(parameter.required) } : {})
            }
          })
          .filter(Boolean) as McpServerUserConfig['tools'][number]['parameters']
        const normalizedTool = {
          name: toolName,
          description: typeof tool.description === 'string' ? tool.description : '',
          enabled,
          ...(tool.autoApprove === true ? { autoApprove: true } : {}),
          parameters
        }
        if (
          tool.name !== normalizedTool.name ||
          tool.description !== normalizedTool.description ||
          tool.enabled !== normalizedTool.enabled ||
          Boolean(tool.autoApprove) !== Boolean(normalizedTool.autoApprove)
        ) {
          changed = true
        }
        return normalizedTool
      })
      .filter(Boolean) as McpServerUserConfig['tools']

    const seenResources = new Set<string>()
    const resources = (Array.isArray(item.resources) ? item.resources : [])
      .map((resource): McpServerUserConfig['resources'][number] | null => {
        if (!isRecord(resource)) {
          changed = true
          return null
        }
        const uri = typeof resource.uri === 'string' ? resource.uri.trim() : ''
        const resourceName = typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : uri
        if (!uri || !resourceName || seenResources.has(uri)) {
          changed = true
          return null
        }
        seenResources.add(uri)
        return {
          name: resourceName,
          description: typeof resource.description === 'string' ? resource.description : '',
          uri
        }
      })
      .filter(Boolean) as McpServerUserConfig['resources']

    const server: McpServerUserConfig = {
      name,
      status,
      disabled,
      ...(typeof item.error === 'string' && item.error.trim() ? { error: item.error.trim() } : {}),
      tools,
      resources
    }
    normalized.push(server)
    const allowedKeys = new Set(['name', 'status', 'disabled', 'error', 'tools', 'resources'])
    if (
      item.name !== server.name ||
      item.status !== server.status ||
      item.disabled !== server.disabled ||
      item.error !== server.error ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalizedToolStates: McpToolStatesUserConfig = {}
  normalized.forEach((server) => {
    server.tools.forEach((tool) => {
      normalizedToolStates[`${server.name}:${tool.name}`] = tool.enabled
    })
  })

  if (JSON.stringify(toolStates) !== JSON.stringify(normalizedToolStates)) {
    changed = true
  }

  return {
    normalized,
    toolStates: normalizedToolStates,
    changed
  }
}

export type McpServersConfigNormalization = ReturnType<typeof normalizeMcpServersConfig>
