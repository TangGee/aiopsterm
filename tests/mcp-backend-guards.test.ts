import { describe, expect, it } from 'vitest'
import {
  createMcpOperationKey,
  formatMcpResourceReadContent,
  formatMcpToolCallContent,
  isMcpResourceReadResultData,
  isMcpToolCallContentList,
  isMcpToolCallResultData,
  malformedMcpResourceResultMessage,
  malformedMcpToolResultMessage
} from '@/services/mcpBackendGuards'

describe('mcpBackendGuards', () => {
  it('validates MCP tool call content and request-bound result data', () => {
    const content = [
      { type: 'text', text: 'MCP tool output' },
      { type: 'image', data: 'base64-data', mimeType: 'image/png' },
      { type: 'json', payload: { ok: true } }
    ]
    expect(isMcpToolCallContentList(content)).toBe(true)
    expect(isMcpToolCallContentList([{ type: 'text', text: 1 }])).toBe(false)
    expect(
      isMcpToolCallResultData(
        {
          serverName: 'filesystem',
          toolName: 'read_file',
          content,
          isError: false,
          durationMs: 8
        },
        'filesystem',
        'read_file'
      )
    ).toBe(true)
    expect(
      isMcpToolCallResultData(
        {
          serverName: 'other',
          toolName: 'read_file',
          content,
          isError: false,
          durationMs: 8
        },
        'filesystem',
        'read_file'
      )
    ).toBe(false)
  })

  it('validates MCP resource read data and formats mixed payloads', () => {
    const contents = [
      { uri: 'file:///workspace/readme.md', text: 'README' },
      { uri: 'file:///workspace/blob.bin', blob: '0102', mimeType: 'application/octet-stream' },
      { uri: 'file:///workspace/meta.json', extra: { size: 1 } }
    ]
    expect(isMcpResourceReadResultData({ serverName: 'filesystem', uri: 'file:///workspace/readme.md', contents, durationMs: 3 }, 'filesystem', 'file:///workspace/readme.md')).toBe(true)
    expect(isMcpResourceReadResultData({ serverName: 'filesystem', uri: 'file:///other', contents, durationMs: 3 }, 'filesystem', 'file:///workspace/readme.md')).toBe(false)
    expect(formatMcpToolCallContent([{ type: 'text', text: 'hello' }, { type: 'bytes', data: '0102' }, { type: 'json', value: 1 }])).toContain('hello')
    expect(formatMcpResourceReadContent(contents)).toContain('README')
    expect(formatMcpResourceReadContent([])).toBe('[]')
  })

  it('keeps operation keys and malformed messages stable', () => {
    expect(createMcpOperationKey('tool', 'filesystem', 'read_file')).toBe(JSON.stringify(['tool', 'filesystem', 'read_file']))
    expect(createMcpOperationKey('resource', 'filesystem', 'file:///workspace')).toBe(JSON.stringify(['resource', 'filesystem', 'file:///workspace']))
    expect(malformedMcpToolResultMessage).toBe('MCP Tool 服务返回数据无效')
    expect(malformedMcpResourceResultMessage).toBe('MCP Resource 服务返回数据无效')
  })
})
