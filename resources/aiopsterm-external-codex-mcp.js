#!/usr/bin/env node
'use strict'

const net = require('net')
const readline = require('readline')

const socketPath = process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET || ''
const token = process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN || ''
let nextBridgeId = 1

const writeMessage = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const result = (id, payload) => writeMessage({ jsonrpc: '2.0', id, result: payload })

const error = (id, code, message) =>
  writeMessage({
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code, message }
  })

const textContent = (text) => ({ type: 'text', text: String(text || '') })

const callBridge = (method, params = {}) =>
  new Promise((resolve, reject) => {
    if (!socketPath) {
      reject(new Error('AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET is not configured.'))
      return
    }
    if (!token) {
      reject(new Error('AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN is not configured.'))
      return
    }
    const id = `external-bridge-${nextBridgeId++}`
    const socket = net.createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(Number(params.timeoutMs || 180000) + 5000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params, token })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      socket.end()
      try {
        resolve(JSON.parse(line))
      } catch (parseError) {
        reject(parseError)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('aiopsterm external Codex MCP bridge request timed out.'))
    })
    socket.on('error', reject)
  })

const hostSelectorProperties = {
  connectionId: {
    type: 'string',
    description: 'External MCP-owned connection id returned by connect_host.'
  },
  assetId: {
    type: 'string',
    description: 'aiopsterm host asset id. Use connect_host first unless autoConnect is explicitly supported by the tool.'
  }
}

const aiSessionSelectorProperties = {
  source: {
    type: 'string',
    description:
      'Optional AI agent source, for example codex or claude-code. Required when multiple managed AI sessions share the same sessionId.'
  },
  sessionId: {
    type: 'string',
    description: 'Managed AI session id returned by list_ai_sessions.'
  }
}

const tools = [
  {
    name: 'list_hosts',
    title: 'List aiopsterm hosts',
    description:
      'List host assets from aiopsterm without exposing secrets. Use this to discover assetId values before connecting.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter across id, name, host, username, group, and tags.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'connect_host',
    title: 'Connect aiopsterm host',
    description:
      'Create an external MCP-owned headless SSH connection to a saved aiopsterm host asset. This does not open or close visible terminal tabs and never returns secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'aiopsterm host asset id returned by list_hosts.' },
        timeoutMs: { type: 'number', description: 'Optional SSH shell-ready timeout in milliseconds. Defaults to 120000 and is capped by aiopsterm.' }
      },
      required: ['assetId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'list_connections',
    title: 'List external aiopsterm host connections',
    description: 'List only external MCP-owned headless connections. Visible terminal sessions are not owned by this MCP server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'disconnect_host',
    title: 'Disconnect external aiopsterm host',
    description:
      'Disconnect an external MCP-owned connection returned by connect_host. This refuses visible terminal-owned sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'External MCP connection id returned by connect_host.' }
      },
      required: ['connectionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'target_context',
    title: 'Read aiopsterm host target context',
    description: 'Return context for an external MCP connection or a saved host asset.',
    inputSchema: {
      type: 'object',
      properties: hostSelectorProperties,
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'run_command',
    title: 'Run command on external aiopsterm host',
    description:
      'Run a bounded, non-interactive command on an external MCP-owned host connection. Use connect_host first; this does not run in a visible terminal or the local Codex process.',
    inputSchema: {
      type: 'object',
      properties: {
        ...hostSelectorProperties,
        command: { type: 'string', description: 'Non-interactive shell command to run on the connected host.' },
        autoConnect: { type: 'boolean', description: 'When true and assetId is supplied, connect before running if no external connection exists.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 30000 and is capped by aiopsterm.' }
      },
      required: ['command'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'read_file',
    title: 'Read file on external aiopsterm host',
    description: 'Read a bounded line range from a file on an external MCP-owned host connection.',
    inputSchema: {
      type: 'object',
      properties: {
        ...hostSelectorProperties,
        path: { type: 'string', description: 'Remote file path to read.' },
        offset: { type: 'number', description: 'Zero-based line offset. Defaults to 0.' },
        limit: { type: 'number', description: 'Maximum number of lines. Defaults to 200 and is capped by aiopsterm.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds.' }
      },
      required: ['path'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: 'glob_search',
    title: 'Find files on external aiopsterm host',
    description: 'Find remote files by glob pattern on an external MCP-owned host connection.',
    inputSchema: {
      type: 'object',
      properties: {
        ...hostSelectorProperties,
        pattern: { type: 'string', description: 'Filename or path glob, for example *.log or /srv/app/**/*.ts.' },
        path: { type: 'string', description: 'Remote base path. Defaults to the current remote working directory.' },
        limit: { type: 'number', description: 'Maximum number of entries. Defaults to 200 and is capped by aiopsterm.' },
        sort: { type: 'string', enum: ['path', 'none'], description: 'Sort mode. Defaults to path.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds.' }
      },
      required: ['pattern'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: 'grep_search',
    title: 'Search files on external aiopsterm host',
    description: 'Search remote file contents on an external MCP-owned host connection.',
    inputSchema: {
      type: 'object',
      properties: {
        ...hostSelectorProperties,
        pattern: { type: 'string', description: 'Extended regular expression to search in remote files.' },
        path: { type: 'string', description: 'Remote base path. Defaults to the current remote working directory.' },
        include: { type: 'string', description: 'Optional filename glob filter, for example *.log or *.conf.' },
        case_sensitive: { type: 'boolean', description: 'Whether matching is case-sensitive. Defaults to false.' },
        context_lines: { type: 'number', description: 'Optional context lines around each match. Defaults to 0 and is capped.' },
        max_matches: { type: 'number', description: 'Maximum output lines. Defaults to 100 and is capped.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds.' }
      },
      required: ['pattern'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: 'list_ai_sessions',
    title: 'List aiopsterm managed AI sessions',
    description:
      'List AI coding-agent sessions reported by agents running inside aiopsterm-managed local terminals. This does not manage the embedded Codex sidebar or external OS terminals.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter across source, title, summary, cwd, and terminal ids.' },
        source: { type: 'string', description: 'Optional agent source filter, for example codex or claude-code.' },
        state: { type: 'string', enum: ['idle', 'working', 'needsInput', 'ended', 'unknown'], description: 'Optional managed session state filter.' },
        needsInput: { type: 'boolean', description: 'When true, return only sessions waiting for user input.' },
        includeEvents: { type: 'boolean', description: 'Include a compact tail of recent non-secret timeline event summaries.' },
        eventLimit: { type: 'number', description: 'Maximum recent timeline events per session when includeEvents is true. Defaults to 5.' },
        limit: { type: 'number', description: 'Maximum sessions to return. Defaults to 50 and is capped by aiopsterm.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'focus_ai_session',
    title: 'Focus aiopsterm managed AI session',
    description:
      'Ask aiopsterm to open the AI session manager, select the managed AI session, and focus its owning visible terminal panel when available. This does not create or close connections.',
    inputSchema: {
      type: 'object',
      properties: aiSessionSelectorProperties,
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'reply_ai_session',
    title: 'Reply to aiopsterm managed AI session',
    description:
      'Resolve a managed AI session request through aiopsterm. For Claude Code actionable hooks this can unblock the waiting hook; for telemetry-only agents it marks local handling state.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        kind: {
          type: 'string',
          enum: ['allow', 'always', 'bypass', 'deny', 'reply', 'handled'],
          description: 'Decision kind to send to aiopsterm.'
        },
        message: { type: 'string', description: 'Optional reply text, answer, denial reason, or handling note.' }
      },
      required: ['sessionId', 'kind'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'clear_ai_session',
    title: 'Clear aiopsterm managed AI session',
    description: 'Remove a managed AI session from aiopsterm session management. This does not kill the owning terminal or agent process.',
    inputSchema: {
      type: 'object',
      properties: aiSessionSelectorProperties,
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'list_ai_session_events',
    title: 'List aiopsterm managed AI session events',
    description:
      'Read recent managed AI session event-stream frames with a reconnect-style sequence cursor. This is the MCP request-response equivalent of aiopsterm agent events streaming.',
    inputSchema: {
      type: 'object',
      properties: {
        afterSeq: { type: 'number', description: 'Return events whose seq is greater than this value.' },
        after_seq: { type: 'number', description: 'Alias for afterSeq.' },
        name: { type: 'string', description: 'Optional exact event name filter, for example agent.hook.PermissionRequest.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Optional exact event name filters.' },
        category: { type: 'string', enum: ['agent', 'managed-ai'], description: 'Optional event category filter.' },
        categories: { type: 'array', items: { type: 'string', enum: ['agent', 'managed-ai'] }, description: 'Optional event category filters.' },
        source: { type: 'string', description: 'Optional agent source filter.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional agent source filters.' },
        sessionId: { type: 'string', description: 'Optional managed AI session id filter.' },
        sessionIds: { type: 'array', items: { type: 'string' }, description: 'Optional managed AI session id filters.' },
        limit: { type: 'number', description: 'Maximum events to return. Defaults to 100 and is capped by aiopsterm.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
]

const handleInitialize = (id, params) => {
  result(id, {
    protocolVersion: params?.protocolVersion || '2025-03-26',
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: 'aiopsterm-hosts',
      title: 'aiopsterm Host Gateway',
      version: '0.1.0'
    }
  })
}

const handleListTools = (id) => result(id, { tools, nextCursor: null })

const handleCallTool = async (id, params) => {
  const name = params?.name
  const args = params?.arguments || {}
  if (!tools.some((tool) => tool.name === name)) {
    result(id, { content: [textContent(`Unknown aiopsterm external Codex tool: ${name || ''}`)], isError: true })
    return
  }
  try {
    const bridgeResponse = await callBridge(name, args)
    const text = bridgeResponse.ok
      ? JSON.stringify({ target: bridgeResponse.target || null, result: bridgeResponse.data || null }, null, 2)
      : bridgeResponse.errorMessage || 'aiopsterm external Codex MCP bridge request failed.'
    result(id, {
      content: [textContent(text)],
      structuredContent: bridgeResponse,
      isError: bridgeResponse.ok ? false : true
    })
  } catch (callError) {
    result(id, { content: [textContent(callError instanceof Error ? callError.message : String(callError))], isError: true })
  }
}

const handleRequest = async (message) => {
  const { id, method, params } = message
  if (method === 'initialize') {
    handleInitialize(id, params)
    return
  }
  if (method === 'tools/list') {
    handleListTools(id)
    return
  }
  if (method === 'tools/call') {
    await handleCallTool(id, params)
    return
  }
  error(id, -32601, `Method not found: ${method || ''}`)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch (parseError) {
    error(null, -32700, parseError instanceof Error ? parseError.message : String(parseError))
    return
  }
  const hasRequestId = Object.prototype.hasOwnProperty.call(message, 'id')
  if (!hasRequestId && message.method === 'notifications/initialized') return
  if (!hasRequestId && message.method) return
  void handleRequest(message)
})
