import type { McpServerUserConfig, McpToolStatesUserConfig } from './contracts/mcp'
import { shouldUseMcpSeedData as runtimeShouldUseMcpSeedData } from './runtimeSwitches'

export const shouldUseMcpSeedData = runtimeShouldUseMcpSeedData

export const mcpSeedServers = (): McpServerUserConfig[] => [
  {
    name: 'filesystem',
    status: 'connected',
    disabled: false,
    tools: [
      {
        name: 'read_file',
        description: 'Read a workspace file for agent context.',
        enabled: true,
        parameters: [
          { name: 'path', description: 'Absolute file path.', required: true },
          { name: 'encoding', description: 'Optional text encoding.' }
        ]
      },
      {
        name: 'list_directory',
        description: 'List files under a directory.',
        enabled: true,
        parameters: [{ name: 'path', description: 'Directory path.', required: true }]
      }
    ],
    resources: [{ name: 'workspace-root', description: 'Current aiopsterm workspace.', uri: 'file:///workspace' }]
  },
  {
    name: 'ops-inventory',
    status: 'error',
    disabled: false,
    error: 'Token expired',
    tools: [
      {
        name: 'lookup_asset',
        description: 'Find a host by name, tag, or IP.',
        enabled: false,
        parameters: [{ name: 'query', description: 'Asset search query.', required: true }]
      }
    ],
    resources: []
  }
]

export const mcpSeedToolStates = (): McpToolStatesUserConfig => ({
  'filesystem:read_file': true,
  'filesystem:list_directory': true,
  'ops-inventory:lookup_asset': false
})

export const defaultMcpServers = () => (shouldUseMcpSeedData() ? mcpSeedServers() : [])

export const defaultMcpToolStates = () => (shouldUseMcpSeedData() ? mcpSeedToolStates() : {})
