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
  if (name !== 'run_command' && name !== 'target_context') {
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
