# External Codex MCP Host Gateway

aiopsterm exposes two Codex-facing MCP boundaries:

- Embedded Codex MCP: `resources/codex-aiopsterm-mcp.js` talks to `src/main/backend/codex/codexTerminalBridge.ts`. It is bound to the selected visible terminal tab.
- External Codex MCP: `resources/aiopsterm-external-codex-mcp.js` talks to `src/main/backend/codex/externalCodexMcpBridge.ts`. It is a headless host gateway for an external Codex process and is not bound to any visible terminal tab.

The two systems are intentionally separate. External Codex connections are stored in an independent connection pool with ids prefixed by `mcp-`, `owner: "external_codex"`, and `visible: false`.

The external server can also inspect and act on managed AI sessions reported by agents that were launched inside aiopsterm-created local terminal panes. Those managed AI sessions stay attached to their visible terminal owner; the external MCP does not create, own, or close those terminal panes.

## Lifecycle

`connect_host` creates a headless SSH shell from a saved aiopsterm host asset. It waits until the SSH backend reports `shell-ready` before returning a successful connection, so a following `run_command` can write to a live remote shell.

`disconnect_host` only accepts connection ids that start with `mcp-`. It refuses terminal-owned ids with `TERMINAL_OWNED_CONNECTION`. Closing an external MCP connection must not close a visible aiopsterm terminal tab.

Visible terminals continue to be managed by the normal terminal workspace and the embedded Codex terminal bridge.

## Tools

The external server currently exposes:

- `list_hosts`: Lists saved non-local host assets without secrets.
- `connect_host`: Opens or reuses a headless external MCP-owned SSH connection.
- `list_connections`: Lists only external MCP-owned connections.
- `disconnect_host`: Closes only an external MCP-owned connection.
- `target_context`: Returns context for an external connection or a saved host asset.
- `run_command`: Runs a bounded non-interactive command on an external connection.
- `read_file`: Reads a bounded line range from a remote file.
- `glob_search`: Finds remote files by glob pattern with bounded output.
- `grep_search`: Searches remote file contents with bounded output.
- `list_ai_sessions`: Lists managed AI sessions with compact state, routing, and recent-event summaries.
- `get_ai_session`: Reads one managed AI session by source/session id, including a compact timeline tail by default.
- `list_ai_approvals`: Lists approval, question, and plan requests with their supported decision capabilities.
- `focus_ai_session`: Requests aiopsterm to open the AI session manager and focus the owning visible terminal when it exists.
- `reply_ai_session`: Sends an allow/deny/reply/handled decision through the managed session backend.
- `approve_ai_session`: Approval-oriented alias for allowing a managed AI approval or plan request.
- `deny_ai_session`: Approval-oriented alias for denying a managed AI request.
- `answer_ai_question`: Approval-oriented alias for replying to a managed AI question.
- `handle_ai_session`: Marks a managed AI item handled without claiming to approve an agent-native prompt.
- `clear_ai_session`: Removes a managed AI session record without killing the owning terminal or agent process.
- `list_ai_session_events`: Reads recent managed AI event-stream frames with a sequence cursor.
- `list_ai_notifications`: Lists notification-style attention items derived from managed AI sessions.
- `mark_ai_notification_read`: Marks one notification or all unread notifications as locally handled.
- `dismiss_ai_notification`: Removes one read notification or all read notifications from the managed session list.
- `clear_ai_notifications`: Clears all managed AI notification records without closing terminals or agent processes.
- `open_ai_notification`: Requests aiopsterm to focus the notification's AI session and owning visible terminal.
- `jump_to_unread_ai_notification`: Requests aiopsterm to focus the newest unread managed AI notification.

`list_hosts` returns identifiers, host metadata, tags, proxy/jump-host labels, and auth method labels. It does not return passwords, private keys, passphrases, or token material.

`list_ai_sessions` returns non-secret routing fields such as source, session id, title, summary, state, request kind, decision mode, optional wait timeout/tool name, cwd, panel id, terminal session id, transcript path, process ids, and a compact recent timeline when requested. `get_ai_session` returns the same safe field set for one selected session and includes recent timeline events by default, so external Codex can inspect a specific session without fetching and filtering the full list. Neither tool returns full raw hook payloads.

`list_ai_approvals` is a Feed-style view over the same managed AI session store. It includes permission, question, and plan records, plus a `capabilities` block that says which decisions are meaningful for that session. Blocking Claude Code requests can report `canUnblockAgent: true` when the waiting hook is still live. Stock Codex hook `PermissionRequest` records are marked `localOnly`/`nativePrompt` and expose only `handled`; aiopsterm does not preempt Codex's native TUI or app-server approval flow. The approval action tools are ergonomic aliases over `reply_ai_session`, so they do not create a second approval store.

`list_ai_session_events` is the request-response MCP form of the managed-AI event stream. It accepts `afterSeq`/`after_seq`, `name`/`names`, `category`/`categories`, `source`/`sources`, `sessionId`/`sessionIds`, and `limit`, then returns `boot_id`, cursor metadata, `gap`, and matching event frames. The frames come from the in-memory replay ring; use `list_ai_sessions` to refresh state if `gap` is true.

`list_ai_notifications` returns compact attention items with `id`, source, session id, title, summary, read state, event type, request kind, decision mode, cwd, and visible-terminal routing fields. Notification ids use `managed-ai:<source>:<sessionId>`. Opening or jumping to a notification does not mark it read. Dismissing an unread notification is rejected; call `mark_ai_notification_read` first when the user has handled it. `clear_ai_notifications` is the bulk-clear form and removes all managed AI notification records regardless of read state, but it does not close the owning visible terminal or the agent process.

## Enablement

The local socket bridge is disabled by default. Enable it with:

```bash
export AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1
export AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN="$(openssl rand -hex 32)"
```

`AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET` is optional. If omitted, aiopsterm creates a per-process socket under the app user-data directory.

The external stdio MCP script needs the socket path and token:

```json
{
  "mcp_servers": {
    "aiopsterm_hosts": {
      "command": "node",
      "args": ["/path/to/resources/aiopsterm-external-codex-mcp.js"],
      "env": {
        "AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET": "/path/to/aiopsterm-external-codex.sock",
        "AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN": "replace-with-the-runtime-token"
      }
    }
  }
}
```

For packaged builds, the script is copied to packaged resources as `aiopsterm-external-codex-mcp.js`.

## Safety Model

The embedded MCP can rely on visible terminal context because the user sees the selected terminal and Codex approval mode is configured by the embedded Codex session.

The external MCP is different: it is a headless host gateway for an external Codex process. It therefore relies on:

- an explicit opt-in environment flag
- a shared token on a local socket request
- no secret exposure in host listing or connection snapshots
- external Codex MCP tool approval for execution tools
- destructive tool annotations on `run_command` and `disconnect_host`
- destructive tool annotations on `clear_ai_session`
- bounded output and timeout caps for command/file/search operations
- approval aliases that route through the existing managed AI decision backend and respect per-session capabilities

Do not reuse external MCP connection ids for UI terminals, and do not register external MCP sessions with `codexTerminalBridge.ts`.
