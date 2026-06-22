import { describe, expect, it, vi } from 'vitest'
import type { AiChatResponseInput, AiChatResponseResult } from '../src/shared/contracts/aiChat'
import type { UserConfig } from '../src/shared/contracts/userConfig'
import type { McpToolCallInput, McpToolCallResult } from '../src/shared/contracts/mcp'

type ActionRuntimeRequest = {
  input: AiChatResponseInput
  text: string
  config?: UserConfig
  modelName: string
  startedAt: number
  control: { requestId?: string; assistantMessageId?: string }
  now: () => number
  contextUsageForResponse: (
    input: AiChatResponseInput,
    control: { requestId?: string; assistantMessageId?: string },
    modelName: string,
    text?: string
  ) => NonNullable<AiChatResponseResult['data']>['contextUsage']
  callMcpTool?: (input: McpToolCallInput) => Promise<McpToolCallResult>
}

type AiChatActionRuntime = {
  formatMcpResourceReadContent: (contents: Array<Record<string, unknown> & { uri: string }>) => string
  isReadOnlyAiChatCommand: (command: string) => boolean
  parseCommandModeSuggestion: (input: AiChatResponseInput, text: string) => null | {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  parseExecuteCommandBlock: (text: string) => null | { invalid?: true; errorCode?: string; command?: string; requiresApproval?: boolean }
  parseMcpToolUseBlock: (text: string) => null | McpToolCallInput
  parseMcpResourceAccessBlock: (text: string) => null | { serverName: string; uri: string }
  resolveCommandExecutionResponse: (request: ActionRuntimeRequest) => AiChatResponseResult | null
  resolveMcpToolResponse: (request: ActionRuntimeRequest) => Promise<AiChatResponseResult | null>
  resolveMcpResourceAccessResponse: (request: ActionRuntimeRequest) => Promise<AiChatResponseResult | null>
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/aiChatActionRuntime'
  return (await import(modulePath)) as AiChatActionRuntime
}

const baseInput = (overrides: Partial<AiChatResponseInput> = {}): AiChatResponseInput => ({
  requestId: 'request-1',
  assistantMessageId: 'request-1-assistant',
  prompt: '检查 nginx',
  model: 'ops-chat',
  mode: 'command',
  ...overrides
})

const baseConfig = (overrides: Partial<UserConfig> = {}): UserConfig =>
  ({
    modelName: 'ops-chat',
    mcpServers: [
      {
        name: 'filesystem',
        status: 'connected',
        disabled: false,
        tools: [{ name: 'read_file', description: 'Read file', enabled: true, autoApprove: false, parameters: [] }],
        resources: [{ name: 'workspace', description: 'Workspace', uri: 'file:///workspace' }]
      }
    ],
    mcpToolStates: { 'filesystem:read_file': true },
    ...overrides
  }) as UserConfig

const actionRequest = (overrides: Partial<ActionRuntimeRequest> = {}): ActionRuntimeRequest => {
  const input = overrides.input || baseInput()
  const control = overrides.control || {
    requestId: input.requestId,
    assistantMessageId: input.assistantMessageId
  }
  return {
    input,
    text: overrides.text || '',
    config: overrides.config,
    modelName: overrides.modelName || 'ops-chat',
    startedAt: overrides.startedAt || 1000,
    control,
    now: overrides.now || (() => 1042),
    contextUsageForResponse:
      overrides.contextUsageForResponse ||
      ((responseInput, responseControl, _modelName, text = '') => ({
        used: text.length,
        contextWindow: 128000,
        percent: 1,
        tokensIn: 1,
        tokensOut: text.length,
        source: 'backend',
        requestId: responseControl.requestId || responseInput.requestId,
        assistantMessageId: responseControl.assistantMessageId || responseInput.assistantMessageId
      })),
    callMcpTool: overrides.callMcpTool
  }
}

describe('aiChatActionRuntime', () => {
  it('parses command-mode suggestions and keeps risky commands approval-gated', async () => {
    const runtime = await loadRuntime()

    expect(runtime.isReadOnlyAiChatCommand('ps aux | grep nginx')).toBe(true)
    expect(runtime.isReadOnlyAiChatCommand('systemctl restart nginx')).toBe(false)
    expect(
      runtime.parseCommandModeSuggestion(
        baseInput({ contexts: [{ id: 'host-prod', kind: 'hosts', label: 'prod-1', detail: 'production' }] }),
        '可以先查询进程：\n\n```bash\nps aux | grep nginx\n```'
      )
    ).toEqual({
      ip: 'prod-1',
      command: 'ps aux | grep nginx',
      requiresApproval: false,
      interactive: false
    })

    const result = runtime.resolveCommandExecutionResponse(
      actionRequest({
        text: 'Command: systemctl restart nginx'
      })
    )
    expect(result).toMatchObject({
      ok: true,
      data: {
        text: '请求执行 Command local: systemctl restart nginx。',
        message: {
          id: 'request-1-assistant',
          ask: 'command',
          commandExecution: {
            command: 'systemctl restart nginx',
            requiresApproval: true,
            interactive: false
          }
        }
      }
    })
  })

  it('rejects CDATA execute_command blocks and decodes escaped shell text', async () => {
    const runtime = await loadRuntime()

    expect(
      runtime.parseExecuteCommandBlock(
        '<execute_command><ip>10.0.0.1</ip><command>journalctl -n 20 --no-pager &amp;&amp; uptime</command><requires_approval>false</requires_approval><interactive>false</interactive></execute_command>'
      )
    ).toMatchObject({
      command: 'journalctl -n 20 --no-pager && uptime',
      requiresApproval: false
    })
    expect(
      runtime.resolveCommandExecutionResponse(
        actionRequest({
          text: '<execute_command><ip>10.0.0.1</ip><command><![CDATA[uptime]]></command><requires_approval>false</requires_approval><interactive>false</interactive></execute_command>'
        })
      )
    ).toMatchObject({
      ok: false,
      errorCode: 'AI_COMMAND_CONTRACT_INVALID'
    })
  })

  it('parses MCP tool/resource blocks and validates tool argument JSON objects', async () => {
    const runtime = await loadRuntime()

    expect(
      runtime.parseMcpToolUseBlock(
        '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>{"path":"/tmp/readme.md"}</arguments></use_mcp_tool>'
      )
    ).toEqual({
      serverName: 'filesystem',
      toolName: 'read_file',
      arguments: { path: '/tmp/readme.md' }
    })
    expect(() =>
      runtime.parseMcpToolUseBlock(
        '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>[1]</arguments></use_mcp_tool>'
      )
    ).toThrow('MCP tool arguments must be a JSON object.')
    expect(
      runtime.parseMcpResourceAccessBlock(
        '<access_mcp_resource><server_name>filesystem</server_name><uri>file:///workspace</uri></access_mcp_resource>'
      )
    ).toEqual({ serverName: 'filesystem', uri: 'file:///workspace' })
  })

  it('returns approval messages for non-auto-approved MCP tool and resource requests', async () => {
    const runtime = await loadRuntime()
    const callMcpTool = vi.fn(async (): Promise<McpToolCallResult> => {
      throw new Error('should not auto execute')
    })

    const toolResult = await runtime.resolveMcpToolResponse(
      actionRequest({
        config: baseConfig(),
        text: '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>{"path":"/tmp/readme.md"}</arguments></use_mcp_tool>',
        callMcpTool
      })
    )
    expect(callMcpTool).not.toHaveBeenCalled()
    expect(toolResult).toMatchObject({
      ok: true,
      data: {
        text: '请求执行 MCP Tool filesystem/read_file。',
        message: {
          id: 'request-1-assistant',
          ask: 'mcp_tool_call',
          mcpToolCall: {
            serverName: 'filesystem',
            toolName: 'read_file',
            arguments: { path: '/tmp/readme.md' }
          }
        }
      }
    })

    const resourceResult = await runtime.resolveMcpResourceAccessResponse(
      actionRequest({
        config: baseConfig(),
        text: '<access_mcp_resource><server_name>filesystem</server_name><uri>file:///workspace</uri></access_mcp_resource>'
      })
    )
    expect(resourceResult).toMatchObject({
      ok: true,
      data: {
        text: '请求访问 MCP Resource filesystem:file:///workspace。',
        message: {
          id: 'request-1-assistant',
          ask: 'mcp_resource_access',
          mcpResourceAccess: {
            serverName: 'filesystem',
            uri: 'file:///workspace'
          }
        }
      }
    })
  })

  it('auto-executes configured MCP tools and formats resource read content', async () => {
    const runtime = await loadRuntime()
    const callMcpTool = vi.fn(async (input: McpToolCallInput): Promise<McpToolCallResult> => ({
      ok: true,
      data: {
        serverName: input.serverName,
        toolName: input.toolName,
        arguments: input.arguments,
        content: [{ type: 'text', text: 'README contents' }],
        isError: false,
        durationMs: 2
      }
    }))

    const result = await runtime.resolveMcpToolResponse(
      actionRequest({
        config: baseConfig({
          mcpServers: [
            {
              name: 'filesystem',
              status: 'connected',
              disabled: false,
              tools: [{ name: 'read_file', description: 'Read file', enabled: true, autoApprove: true, parameters: [] }],
              resources: []
            }
          ],
          mcpToolStates: { 'filesystem:read_file': true }
        }),
        text: '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>{"path":"/tmp/readme.md"}</arguments></use_mcp_tool>',
        callMcpTool
      })
    )

    expect(callMcpTool).toHaveBeenCalledWith({
      serverName: 'filesystem',
      toolName: 'read_file',
      arguments: { path: '/tmp/readme.md' }
    })
    expect(result).toMatchObject({
      ok: true,
      data: {
        text: 'README contents',
        message: {
          say: 'command_output',
          action: 'approved',
          state: 'done',
          text: 'README contents'
        }
      }
    })
    expect(
      runtime.formatMcpResourceReadContent([
        { uri: 'file:///workspace/readme.md', text: 'README' },
        { uri: 'file:///workspace/blob.bin', blob: '0102', mimeType: 'application/octet-stream' }
      ])
    ).toContain('[Binary data: application/octet-stream]')
  })
})
