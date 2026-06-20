import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { sanitizeChatExportFileName } from '../src/shared/chatExport'
import type { AiChatExportInput, AiChatExportResult } from '../src/shared/contracts/aiChat'

type ChatExportBackend = {
  exportChat: (
    input: AiChatExportInput,
    runtime: {
      showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
      writeFile?: (
        filePath: string,
        content: string,
        encoding: 'utf-8'
      ) => Promise<
        | void
        | {
            filePath?: string
            bytes?: number
          }
      >
      now?: () => Date
    }
  ) => Promise<AiChatExportResult>
}

const tempDirs: string[] = []

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/chatExport'
  return (await import(modulePath)) as ChatExportBackend
}

const createTempOutput = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-chat-export-'))
  tempDirs.push(dir)
  return join(dir, 'exported-chat.md')
}

const exportInput = (): AiChatExportInput => ({
  title: '生产/巡检:*?"<>|回滚执行',
  messages: [
    {
      id: 'system',
      role: 'system',
      text: '系统提示：保持操作可审计。'
    },
    {
      id: 'user',
      role: 'user',
      text: 'rollback 计划',
      contentParts: [
        { type: 'text', text: '参考 ' },
        { type: 'chip', chipType: 'doc', ref: { absPath: '/kb/runbooks/release.md', relPath: 'runbooks/release.md', name: 'release.md', type: 'file' } },
        { type: 'text', text: ' 并运行 ' },
        { type: 'chip', chipType: 'command', ref: { command: '/rollback-plan', label: 'rollback-plan', path: 'commands/rollback.md' } },
        { type: 'text', text: '，使用 ' },
        { type: 'chip', chipType: 'skill', ref: { skillName: 'incident-triage', description: 'Collect symptoms first.' } },
        { type: 'text', text: '。' },
        { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'topology.png' }
      ],
      hosts: [{ id: 'prod-1', kind: 'hosts', label: '10.24.8.12', detail: '生产主机' }]
    },
    {
      id: 'command',
      role: 'assistant',
      text: 'kubectl rollout status deploy/web',
      ask: 'command',
      executedCommand: 'kubectl rollout status deploy/web',
      commandExecution: {
        ip: 'prod-agent',
        command: 'kubectl rollout status deploy/web',
        requiresApproval: true,
        interactive: false
      }
    },
    {
      id: 'output',
      role: 'assistant',
      text: 'deployment "web" successfully rolled out',
      say: 'command_output'
    },
    {
      id: 'mcp',
      role: 'assistant',
      text: '调用 MCP 工具',
      ask: 'mcp_tool_call',
      mcpToolCall: {
        serverName: 'prod-agent',
        toolName: 'inspect_deployment',
        arguments: { namespace: 'prod', name: 'web' }
      }
    },
    {
      id: 'mcp-resource',
      role: 'assistant',
      text: '访问 MCP 资源',
      ask: 'mcp_resource_access',
      mcpResourceAccess: {
        serverName: 'prod-agent',
        uri: 'file:///workspace/release.md'
      }
    },
    {
      id: 'followup',
      role: 'assistant',
      text: '请选择下一步',
      ask: 'followup',
      followupOptions: ['继续观察', '执行回滚'],
      selectedOption: '执行回滚'
    },
    {
      id: 'search-result',
      role: 'assistant',
      text: 'Found previous rollback runbook.',
      say: 'search_result'
    },
    {
      id: 'context-truncated',
      role: 'assistant',
      text: '{"status":"compressing"}',
      say: 'context_truncated',
      partial: true
    },
    {
      id: 'approved',
      role: 'assistant',
      text: 'approval',
      action: 'approved'
    },
    {
      id: 'rejected',
      role: 'assistant',
      text: 'rejection',
      action: 'rejected'
    }
  ]
})

describe('AI chat export backend boundary', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('owns Markdown serialization, save dialog options, and file writes', async () => {
    const { exportChat } = await loadBackend()
    const outputFile = await createTempOutput()
    const input = exportInput()
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: outputFile }))

    const result = await exportChat(input, {
      showSaveDialog,
      now: () => new Date('2026-06-04T12:00:00+08:00')
    })

    expect(result).toEqual({
      ok: true,
      data: {
        exported: input.messages.length,
        fileName: sanitizeChatExportFileName(input.title),
        filePath: outputFile,
        bytes: expect.any(Number),
        markdown: expect.any(String)
      }
    })
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: sanitizeChatExportFileName(input.title),
      filters: [{ name: 'Markdown Files', extensions: ['md'] }]
    })

    const markdown = await readFile(outputFile, 'utf-8')
    expect(result.data?.markdown).toBe(markdown)
    expect(result.data?.bytes).toBe(Buffer.byteLength(markdown, 'utf8'))
    await expect(stat(outputFile)).resolves.toMatchObject({ size: result.data?.bytes })
    expect(markdown).toContain('# 生产/巡检:*?"<>|回滚执行')
    expect(markdown).toContain('from aiopsterm')
    expect(markdown).toContain('**System:**')
    expect(markdown).toContain('**User:**')
    expect(markdown).toContain('@release.md')
    expect(markdown).toContain('rollback-plan')
    expect(markdown).toContain('@skill:incident-triage')
    expect(markdown).toContain('[image: topology.png]')
    expect(markdown).toContain('Hosts: 10.24.8.12')
    expect(markdown).toContain('```bash\nkubectl rollout status deploy/web\n```')
    expect(markdown).toContain('**OUTPUT**')
    expect(markdown).toContain('deployment "web" successfully rolled out')
    expect(markdown).toContain('"MCP SERVER": "prod-agent"')
    expect(markdown).toContain('"namespace": "prod"')
    expect(markdown).toContain('"URI": "file:///workspace/release.md"')
    expect(markdown).toContain('- [ ] 继续观察')
    expect(markdown).toContain('- [x] 执行回滚')
    expect(markdown).toContain('**Search Result**')
    expect(markdown).toContain('Context is being compressed.')
    expect(markdown).toContain('Approved')
    expect(markdown).toContain('Rejected')
  })

  it('returns a canceled result without writing when the save dialog is canceled', async () => {
    const { exportChat } = await loadBackend()
    const writeFile = vi.fn(async () => undefined)
    const result = await exportChat(exportInput(), {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile
    })

    expect(result).toEqual({
      ok: true,
      data: {
        exported: 0,
        fileName: sanitizeChatExportFileName(exportInput().title),
        canceled: true
      }
    })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('fails before opening a save dialog when there are no messages', async () => {
    const { exportChat } = await loadBackend()
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/unused.md' }))

    const result = await exportChat({ title: 'empty', messages: [] }, { showSaveDialog })

    expect(result).toEqual({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_EMPTY',
      errorMessage: '当前会话为空，无法导出。'
    })
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('reports backend file-write failures through the mutation result contract', async () => {
    const { exportChat } = await loadBackend()
    const result = await exportChat(exportInput(), {
      showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/aiopsterm-export-failure.md' }),
      writeFile: async () => {
        throw new Error('disk full')
      }
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_FAILED',
      errorMessage: 'disk full'
    })
  })

  it('rejects chat export save paths that cannot be written as absolute files', async () => {
    const { exportChat } = await loadBackend()
    const writeFileMock = vi.fn(async () => undefined)

    await expect(
      exportChat(exportInput(), {
        showSaveDialog: async () => ({ canceled: false, filePath: '   ' }),
        writeFile: writeFileMock
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_SAVE_PATH_INVALID'
    })

    await expect(
      exportChat(exportInput(), {
        showSaveDialog: async () => ({ canceled: false, filePath: 'relative/export.md' }),
        writeFile: writeFileMock
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_SAVE_PATH_INVALID'
    })

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects chat export writers that cannot confirm the written file', async () => {
    const { exportChat } = await loadBackend()
    const outputFile = await createTempOutput()
    const otherOutputFile = await createTempOutput()

    await expect(
      exportChat(exportInput(), {
        showSaveDialog: async () => ({ canceled: false, filePath: outputFile }),
        writeFile: async (filePath, content) => {
          await writeFile(filePath, content, 'utf-8')
          return { filePath: otherOutputFile, bytes: Buffer.byteLength(content, 'utf8') }
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID'
    })

    await expect(
      exportChat(exportInput(), {
        showSaveDialog: async () => ({ canceled: false, filePath: outputFile }),
        writeFile: async (filePath, content) => {
          await writeFile(filePath, content, 'utf-8')
          return { filePath, bytes: 1 }
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID'
    })

    await expect(
      exportChat(exportInput(), {
        showSaveDialog: async () => ({ canceled: false, filePath: outputFile }),
        writeFile: async (filePath) => {
          await writeFile(filePath, 'not the generated markdown', 'utf-8')
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_EXPORT_WRITE_CONFIRMATION_INVALID'
    })
  })
})
