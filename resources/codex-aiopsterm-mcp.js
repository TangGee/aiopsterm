#!/usr/bin/env node
'use strict'

const net = require('net')
const readline = require('readline')

const socketPath = process.env.AIOPSTERM_CODEX_BRIDGE_SOCKET || ''
let nextBridgeId = 1

const writeMessage = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const result = (id, payload) => writeMessage({ jsonrpc: '2.0', id, result: payload })

const error = (id, code, message) =>
  writeMessage({
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: {
      code,
      message
    }
  })

const textContent = (text) => ({ type: 'text', text: String(text || '') })

const callBridge = (method, params) =>
  new Promise((resolve, reject) => {
    if (!socketPath) {
      reject(new Error('AIOPSTERM_CODEX_BRIDGE_SOCKET is not configured.'))
      return
    }
    const id = `bridge-${nextBridgeId++}`
    const socket = net.createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(Number(params?.timeoutMs || 180000) + 5000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
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
      reject(new Error('aiopsterm bridge request timed out.'))
    })
    socket.on('error', reject)
  })

const runCommandSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description:
        'Non-interactive shell command to run in the currently selected aiopsterm terminal session on the managed host. This never runs in the local Codex client process.'
    },
    timeoutMs: {
      type: 'number',
      description: 'Optional timeout in milliseconds. Defaults to 30000 and is capped by aiopsterm.'
    },
    sessionId: {
      type: 'string',
      description:
        'Optional aiopsterm terminal session id. Omit to use the current selected terminal. The call fails if the selected terminal is not connected.'
    }
  },
  required: ['command'],
  additionalProperties: false
}

const targetContextSchema = {
  type: 'object',
  properties: {
    sessionId: {
      type: 'string',
      description: 'Optional aiopsterm terminal session id. Omit to inspect the current selected terminal.'
    }
  },
  additionalProperties: false
}

const readFileSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Remote file path to read from the selected aiopsterm terminal session.'
    },
    offset: {
      type: 'number',
      description: 'Zero-based line offset. Defaults to 0.'
    },
    limit: {
      type: 'number',
      description: 'Maximum number of lines to return. Defaults to 200 and is capped by aiopsterm.'
    },
    timeoutMs: {
      type: 'number',
      description: 'Optional timeout in milliseconds.'
    },
    sessionId: {
      type: 'string',
      description: 'Optional aiopsterm terminal session id. Omit to use the current selected terminal.'
    }
  },
  required: ['path'],
  additionalProperties: false
}

const globSearchSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Remote glob pattern to match. Supports common shell-style wildcards such as *, ?, and character classes.'
    },
    path: {
      type: 'string',
      description: 'Remote base path. Defaults to the current remote working directory.'
    },
    limit: {
      type: 'number',
      description: 'Maximum number of paths to return. Defaults to 200 and is capped by aiopsterm.'
    },
    sort: {
      type: 'string',
      enum: ['path', 'none'],
      description: 'Sort matched paths by path or leave remote traversal order.'
    },
    timeoutMs: {
      type: 'number',
      description: 'Optional timeout in milliseconds.'
    },
    sessionId: {
      type: 'string',
      description: 'Optional aiopsterm terminal session id. Omit to use the current selected terminal.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
}

const grepSearchSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Extended regular expression to search in remote files.'
    },
    path: {
      type: 'string',
      description: 'Remote base path. Defaults to the current remote working directory.'
    },
    include: {
      type: 'string',
      description: 'Optional filename glob filter, for example *.log or *.conf.'
    },
    case_sensitive: {
      type: 'boolean',
      description: 'Whether matching is case-sensitive. Defaults to false.'
    },
    context_lines: {
      type: 'number',
      description: 'Optional context lines around each match. Defaults to 0 and is capped by aiopsterm.'
    },
    max_matches: {
      type: 'number',
      description: 'Maximum output lines to return. Defaults to 100 and is capped by aiopsterm.'
    },
    timeoutMs: {
      type: 'number',
      description: 'Optional timeout in milliseconds.'
    },
    sessionId: {
      type: 'string',
      description: 'Optional aiopsterm terminal session id. Omit to use the current selected terminal.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
}

const tools = [
  {
    name: 'run_command',
    title: 'Run command in aiopsterm terminal',
    description:
      'Run a bounded, non-interactive command in the selected real aiopsterm terminal session on the managed host. Use target_context first when the target is ambiguous. This is the only command tool that targets the managed host instead of the local Codex client process.',
    inputSchema: runCommandSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'read_file',
    title: 'Read remote file through aiopsterm terminal',
    description:
      'Read a bounded line range from a file on the selected managed host through the current aiopsterm terminal session. This is read-only and never reads the local Codex client filesystem.',
    inputSchema: readFileSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'glob_search',
    title: 'Find remote files through aiopsterm terminal',
    description:
      'Find remote files matching a glob-like pattern on the selected managed host through the current aiopsterm terminal session. Prefer this over composing ad hoc find commands.',
    inputSchema: globSearchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'grep_search',
    title: 'Search remote file contents through aiopsterm terminal',
    description:
      'Search remote file contents on the selected managed host through the current aiopsterm terminal session. Prefer this over composing ad hoc grep commands.',
    inputSchema: grepSearchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'target_context',
    title: 'Read aiopsterm target context',
    description: 'Return the currently selected aiopsterm terminal target context.',
    inputSchema: targetContextSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
]

const handleInitialize = (id, params) => {
  result(id, {
    protocolVersion: params?.protocolVersion || '2025-03-26',
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    serverInfo: {
      name: 'aiopsterm-remote',
      title: 'aiopsterm Remote Terminal',
      version: '0.1.0'
    }
  })
}

const handleListTools = (id) => {
  result(id, {
    tools,
    nextCursor: null
  })
}

const handleCallTool = async (id, params) => {
  const name = params?.name
  const args = params?.arguments || {}
  if (!tools.some((tool) => tool.name === name)) {
    result(id, {
      content: [textContent(`Unknown aiopsterm tool: ${name || ''}`)],
      isError: true
    })
    return
  }

  try {
    const bridgeResponse = await callBridge(name, args)
    const text = bridgeResponse.ok
      ? JSON.stringify(
          {
            target: bridgeResponse.target || null,
            result: bridgeResponse.data || null
          },
          null,
          2
        )
      : bridgeResponse.errorMessage || 'aiopsterm bridge request failed.'
    result(id, {
      content: [textContent(text)],
      structuredContent: bridgeResponse,
      isError: bridgeResponse.ok ? false : true
    })
  } catch (callError) {
    result(id, {
      content: [textContent(callError instanceof Error ? callError.message : String(callError))],
      isError: true
    })
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
