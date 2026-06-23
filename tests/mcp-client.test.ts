import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpClient } from '@/services/settings/mcpClient'

const originalAiops = window.aiops

const mcpServers = [
  {
    name: 'filesystem',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem'],
    env: {},
    disabled: false,
    status: 'connected' as const,
    tools: [
      {
        name: 'read_file',
        description: 'Read file',
        enabled: true,
        autoApprove: false,
        parameters: []
      }
    ],
    resources: [
      {
        uri: 'file:///workspace',
        name: 'workspace',
        description: 'Workspace root',
        mimeType: 'text/plain'
      }
    ]
  }
]

const mcpConfig = {
  mcpServers: {
    filesystem: {
      type: 'stdio' as const,
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem']
    }
  }
}

const mcpConfigWriteResult = {
  ok: true,
  data: {
    mcpConfig,
    mcpServers,
    mcpToolStates: {
      'filesystem:read_file': true
    }
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('mcpClient', () => {
  it('returns undefined for unavailable bridge methods and binds MCP bridge methods', async () => {
    const unsubscribe = vi.fn()
    window.aiops = {
      ...originalAiops,
      getMcpConfigPath: vi.fn(async () => '/tmp/mcp_settings.json'),
      getMcpServers: vi.fn(async () => mcpServers),
      readMcpConfig: vi.fn(async () => JSON.stringify(mcpConfig)),
      writeMcpConfig: vi.fn(async () => mcpConfigWriteResult),
      toggleMcpServer: vi.fn(async () => mcpConfigWriteResult),
      deleteMcpServer: vi.fn(async () => mcpConfigWriteResult),
      setMcpToolState: vi.fn(async () => mcpConfigWriteResult),
      setMcpToolAutoApprove: vi.fn(async () => mcpConfigWriteResult),
      callMcpTool: vi.fn(async () => ({
        ok: true,
        data: {
          serverName: 'filesystem',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'done' }],
          isError: false,
          durationMs: 12
        }
      })),
      readMcpResource: vi.fn(async () => ({
        ok: true,
        data: {
          serverName: 'filesystem',
          uri: 'file:///workspace',
          contents: [{ uri: 'file:///workspace', text: 'workspace' }],
          durationMs: 8
        }
      })),
      onMcpConfigFileChanged: vi.fn(() => unsubscribe)
    }

    await expect(mcpClient.getMcpConfigPath()?.()).resolves.toBe('/tmp/mcp_settings.json')
    await expect(mcpClient.getMcpServers()?.()).resolves.toEqual(mcpServers)
    await expect(mcpClient.readMcpConfig()?.()).resolves.toBe(JSON.stringify(mcpConfig))
    await expect(mcpClient.writeMcpConfig()?.('{"mcpServers":{}}')).resolves.toEqual(mcpConfigWriteResult)
    await expect(mcpClient.toggleMcpServer()?.('filesystem', true)).resolves.toEqual(mcpConfigWriteResult)
    await expect(mcpClient.deleteMcpServer()?.('filesystem')).resolves.toEqual(mcpConfigWriteResult)
    await expect(mcpClient.setMcpToolState()?.('filesystem', 'read_file', false)).resolves.toEqual(mcpConfigWriteResult)
    await expect(mcpClient.setMcpToolAutoApprove()?.('filesystem', 'read_file', true)).resolves.toEqual(mcpConfigWriteResult)
    await expect(mcpClient.callMcpTool()?.('filesystem', 'read_file', { path: '/tmp/readme.md' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ toolName: 'read_file' })
      })
    )
    await expect(mcpClient.readMcpResource()?.('filesystem', 'file:///workspace')).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ uri: 'file:///workspace' })
      })
    )

    const listener = vi.fn()
    expect(mcpClient.onMcpConfigFileChanged()?.(listener)).toBe(unsubscribe)
    expect(window.aiops.writeMcpConfig).toHaveBeenCalledWith('{"mcpServers":{}}')
    expect(window.aiops.toggleMcpServer).toHaveBeenCalledWith('filesystem', true)
    expect(window.aiops.deleteMcpServer).toHaveBeenCalledWith('filesystem')
    expect(window.aiops.setMcpToolState).toHaveBeenCalledWith('filesystem', 'read_file', false)
    expect(window.aiops.setMcpToolAutoApprove).toHaveBeenCalledWith('filesystem', 'read_file', true)
    expect(window.aiops.callMcpTool).toHaveBeenCalledWith('filesystem', 'read_file', { path: '/tmp/readme.md' })
    expect(window.aiops.readMcpResource).toHaveBeenCalledWith('filesystem', 'file:///workspace')
    expect(window.aiops.onMcpConfigFileChanged).toHaveBeenCalledWith(listener)

    window.aiops = {
      ...originalAiops,
      getMcpConfigPath: undefined as any,
      getMcpServers: undefined as any,
      readMcpConfig: undefined as any,
      writeMcpConfig: undefined as any,
      toggleMcpServer: undefined as any,
      deleteMcpServer: undefined as any,
      setMcpToolState: undefined as any,
      setMcpToolAutoApprove: undefined as any,
      callMcpTool: undefined as any,
      readMcpResource: undefined as any,
      onMcpConfigFileChanged: undefined as any
    }
    expect(mcpClient.getMcpConfigPath()).toBeUndefined()
    expect(mcpClient.getMcpServers()).toBeUndefined()
    expect(mcpClient.readMcpConfig()).toBeUndefined()
    expect(mcpClient.writeMcpConfig()).toBeUndefined()
    expect(mcpClient.toggleMcpServer()).toBeUndefined()
    expect(mcpClient.deleteMcpServer()).toBeUndefined()
    expect(mcpClient.setMcpToolState()).toBeUndefined()
    expect(mcpClient.setMcpToolAutoApprove()).toBeUndefined()
    expect(mcpClient.callMcpTool()).toBeUndefined()
    expect(mcpClient.readMcpResource()).toBeUndefined()
    expect(mcpClient.onMcpConfigFileChanged()).toBeUndefined()
  })
})
