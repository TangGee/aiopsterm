import type { McpResourceReadContent, McpResourceReadResult, McpToolCallContent, McpToolCallResult } from '@shared/contracts/mcp'

export type McpToolCallResultData = NonNullable<McpToolCallResult['data']>
export type McpResourceReadResultData = NonNullable<McpResourceReadResult['data']>

export const malformedMcpToolResultMessage = 'MCP Tool 服务返回数据无效'
export const malformedMcpResourceResultMessage = 'MCP Resource 服务返回数据无效'

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createMcpOperationKey = (kind: 'tool' | 'resource', serverName: string, operationName: string) =>
  JSON.stringify([kind, serverName, operationName])

export const isMcpToolCallContentList = (value: unknown): value is McpToolCallContent[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.type === 'string' &&
      (item.text === undefined || typeof item.text === 'string') &&
      (item.data === undefined || typeof item.data === 'string') &&
      (item.mimeType === undefined || typeof item.mimeType === 'string')
  )

export const isMcpResourceReadContentList = (value: unknown): value is McpResourceReadContent[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.uri === 'string' &&
      (item.text === undefined || typeof item.text === 'string') &&
      (item.blob === undefined || typeof item.blob === 'string') &&
      (item.mimeType === undefined || typeof item.mimeType === 'string')
  )

export const isMcpToolCallResultData = (value: unknown, serverName: string, toolName: string): value is McpToolCallResultData =>
  isRecord(value) &&
  value.serverName === serverName &&
  value.toolName === toolName &&
  isMcpToolCallContentList(value.content) &&
  typeof value.isError === 'boolean' &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs)

export const isMcpResourceReadResultData = (value: unknown, serverName: string, uri: string): value is McpResourceReadResultData =>
  isRecord(value) &&
  value.serverName === serverName &&
  value.uri === uri &&
  isMcpResourceReadContentList(value.contents) &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs)

export const stringifyMcpPayload = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const formatMcpToolCallContent = (content: McpToolCallContent[]) => {
  if (!content.length) return '[]'
  return content
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.data === 'string') return item.data
      return stringifyMcpPayload(item)
    })
    .join('\n\n')
}

export const formatMcpResourceReadContent = (contents: McpResourceReadContent[]) => {
  if (!contents.length) return '[]'
  return contents
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.blob === 'string') return item.blob
      return stringifyMcpPayload(item)
    })
    .join('\n\n')
}
