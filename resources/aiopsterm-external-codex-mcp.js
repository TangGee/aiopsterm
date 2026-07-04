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

const aiNotificationSelectorProperties = {
  id: {
    type: 'string',
    description: 'Managed AI notification id returned by list_ai_notifications.'
  },
  source: {
    type: 'string',
    description: 'Optional AI agent source, for example codex or claude-code.'
  },
  sessionId: {
    type: 'string',
    description: 'Managed AI session id associated with the notification.'
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
    name: 'list_auth_requests',
    title: 'List pending aiopsterm SSH authentication requests',
    description:
      'List SSH password or keyboard-interactive authentication requests currently waiting in aiopsterm for external MCP host connections. Secrets are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Optional external MCP connection id to filter by.' },
        includeCompleted: { type: 'boolean', description: 'When true, include recently completed, canceled, failed, or timed-out requests.' },
        include_completed: { type: 'boolean', description: 'Alias for includeCompleted.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_auth_request_status',
    title: 'Get aiopsterm SSH authentication request status',
    description:
      'Read the current status of one SSH authentication request returned by connect_host or list_auth_requests. Secrets are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        authRequestId: { type: 'string', description: 'Authentication request id returned by connect_host or list_auth_requests.' },
        id: { type: 'string', description: 'Alias for authRequestId.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'focus_auth_request',
    title: 'Focus aiopsterm SSH authentication prompt',
    description:
      'Ask aiopsterm to focus and re-show the SSH authentication prompt for a pending request. Use this when connect_host returns SSH_AUTH_REQUIRED.',
    inputSchema: {
      type: 'object',
      properties: {
        authRequestId: { type: 'string', description: 'Authentication request id returned by connect_host or list_auth_requests.' },
        id: { type: 'string', description: 'Alias for authRequestId.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'cancel_auth_request',
    title: 'Cancel aiopsterm SSH authentication request',
    description:
      'Cancel a pending SSH authentication request for an external MCP host connection. This usually causes the connection attempt to fail.',
    inputSchema: {
      type: 'object',
      properties: {
        authRequestId: { type: 'string', description: 'Authentication request id returned by connect_host or list_auth_requests.' },
        id: { type: 'string', description: 'Alias for authRequestId.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'submit_ssh_auth_response',
    title: 'Submit aiopsterm SSH authentication response',
    description:
      'Submit password, verification code, or keyboard-interactive responses for a pending SSH authentication request. This works only when aiopsterm Settings -> Export MCP allows external Agents to submit SSH authentication information.',
    inputSchema: {
      type: 'object',
      properties: {
        authRequestId: { type: 'string', description: 'Authentication request id returned by connect_host or list_auth_requests.' },
        id: { type: 'string', description: 'Alias for authRequestId.' },
        response: { type: 'string', description: 'Single password, verification code, or response value.' },
        responses: { type: 'array', items: { type: 'string' }, description: 'Multiple keyboard-interactive responses, in prompt order.' },
        rememberPassword: { type: 'boolean', description: 'When true and aiopsterm allows it, remember the submitted password for the host asset.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
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
      'Run a bounded, non-interactive command on an external MCP-owned host connection. Use connect_host first; this does not run in a visible terminal or the local Codex process. Commands are run in an isolated command-local child shell; avoid naked shell-state or shell-lifecycle commands such as set -e, set -u, set -o pipefail, trap, exit, or exec unless scoped inside that command.',
    inputSchema: {
      type: 'object',
      properties: {
        ...hostSelectorProperties,
        command: {
          type: 'string',
          description:
            'Non-interactive shell command to run on the connected host. Avoid naked shell-state or shell-lifecycle commands such as set -e, trap, exit, or exec unless scoped inside the command.'
        },
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
    name: 'get_ai_session',
    title: 'Get aiopsterm managed AI session',
    description:
      'Read one managed AI session by source and sessionId, including a compact non-secret timeline tail by default. Use this after list_ai_sessions when you need details for a specific session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        includeEvents: { type: 'boolean', description: 'Include a compact tail of recent non-secret timeline event summaries. Defaults to true.' },
        include_events: { type: 'boolean', description: 'Alias for includeEvents.' },
        eventLimit: { type: 'number', description: 'Maximum recent timeline events to return. Defaults to 25 and is capped by aiopsterm.' },
        event_limit: { type: 'number', description: 'Alias for eventLimit.' }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'list_ai_approvals',
    title: 'List aiopsterm AI approvals',
    description:
      'List approval, question, and plan requests reported by agents running inside aiopsterm-managed local terminals. Stock Codex hook approvals remain native Codex TUI prompts; this tool marks them local-only instead of blocking them.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter across source, title, summary, cwd, and terminal ids.' },
        source: { type: 'string', description: 'Optional agent source filter, for example codex or claude-code.' },
        pendingOnly: { type: 'boolean', description: 'When true, return only approvals currently waiting for input.' },
        pending_only: { type: 'boolean', description: 'Alias for pendingOnly.' },
        includeHandled: { type: 'boolean', description: 'When true, include approval records already handled locally.' },
        include_handled: { type: 'boolean', description: 'Alias for includeHandled.' },
        includeEvents: { type: 'boolean', description: 'Include a compact tail of recent non-secret timeline event summaries.' },
        eventLimit: { type: 'number', description: 'Maximum recent timeline events per approval when includeEvents is true. Defaults to 5.' },
        limit: { type: 'number', description: 'Maximum approvals to return. Defaults to 50 and is capped by aiopsterm.' }
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
    name: 'approve_ai_session',
    title: 'Approve aiopsterm AI session request',
    description:
      'Approve a managed AI approval or plan request. For blocking Claude Code requests this can unblock the waiting hook; local-only requests record handling state but may still require the agent native TUI.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        mode: {
          type: 'string',
          enum: ['allow', 'once', 'always', 'all', 'bypass', 'handled'],
          description: 'Approval mode. once maps to allow; all maps to the persistent allow behavior when supported.'
        },
        kind: {
          type: 'string',
          enum: ['allow', 'once', 'always', 'all', 'bypass', 'handled'],
          description: 'Alias for mode.'
        },
        message: { type: 'string', description: 'Optional handling note.' }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'deny_ai_session',
    title: 'Deny aiopsterm AI session request',
    description:
      'Deny a managed AI approval, question, or plan request. For blocking Claude Code requests this can unblock the waiting hook with a denial response.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        message: { type: 'string', description: 'Optional denial reason or feedback.' }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'answer_ai_question',
    title: 'Answer aiopsterm AI question',
    description:
      'Answer a managed AI question request. For blocking Claude Code AskUserQuestion hooks this can unblock the waiting hook with the supplied answer.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        message: { type: 'string', description: 'Question answer text.' },
        answer: { type: 'string', description: 'Alias for message.' },
        reply: { type: 'string', description: 'Alias for message.' }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'handle_ai_session',
    title: 'Mark aiopsterm AI session handled',
    description:
      'Mark a managed AI approval, question, plan, notification, or local-only request handled in aiopsterm without claiming to approve the agent native prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiSessionSelectorProperties,
        message: { type: 'string', description: 'Optional handling note.' }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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
  },
  {
    name: 'list_ai_notifications',
    title: 'List aiopsterm managed AI notifications',
    description:
      'List notification-style attention items derived from aiopsterm managed AI sessions, including read/unread state and routing to the owning visible terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter across notification id, source, title, summary, cwd, and terminal ids.' },
        source: { type: 'string', description: 'Optional agent source filter, for example codex or claude-code.' },
        unread: { type: 'boolean', description: 'When true, return only unread attention items.' },
        read: { type: 'boolean', description: 'When true, return only read attention items.' },
        limit: { type: 'number', description: 'Maximum notifications to return. Defaults to 50 and is capped by aiopsterm.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'mark_ai_notification_read',
    title: 'Mark aiopsterm AI notification read',
    description:
      'Mark one managed AI notification read, or mark all unread managed AI notifications read. For waiting sessions this records a local handled decision.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiNotificationSelectorProperties,
        all: { type: 'boolean', description: 'When true, mark all unread managed AI notifications read.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'dismiss_ai_notification',
    title: 'Dismiss aiopsterm AI notification',
    description:
      'Dismiss one read managed AI notification, or dismiss all read managed AI notifications. Unread notifications must be marked read before dismissal.',
    inputSchema: {
      type: 'object',
      properties: {
        ...aiNotificationSelectorProperties,
        allRead: { type: 'boolean', description: 'When true, dismiss every read managed AI notification.' },
        all_read: { type: 'boolean', description: 'Alias for allRead.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'clear_ai_notifications',
    title: 'Clear aiopsterm AI notifications',
    description:
      'Clear all managed AI notification records from aiopsterm. This removes session-manager records only and does not kill visible terminals or agent processes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'open_ai_notification',
    title: 'Open aiopsterm AI notification',
    description:
      'Ask aiopsterm to open the AI session manager, select the notification session, and focus its owning visible terminal panel when available.',
    inputSchema: {
      type: 'object',
      properties: aiNotificationSelectorProperties,
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'jump_to_unread_ai_notification',
    title: 'Jump to next unread aiopsterm AI notification',
    description:
      'Ask aiopsterm to focus the newest unread managed AI notification, matching the top-bar bell behavior. It does not mark the item read.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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
