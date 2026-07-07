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

Closed or failed external MCP connections are removed from the external connection map, and any pending command waiting on that connection is failed with `CONNECTION_CLOSED`. The bridge does not keep a connection-wide unbounded output string; pending command output is owned by the individual command request and bounded by the command/file/search tool limits.

## SSH Authentication Model

External MCP host connections reuse `createSshTerminalSession`. The sink passed by `externalCodexMcpBridge.ts` records lifecycle/data/exit events and now also provides `keyboardInteractive` / `keyboardInteractiveResult` handlers backed by `externalCodexMcpAuthRuntime.ts`.

The default path keeps credential entry inside aiopsterm. When `connect_host` encounters a password or keyboard-interactive request, the auth runtime stores a pending request, asks the renderer to show the existing terminal authentication dialog, and causes `connect_host` to return `SSH_AUTH_REQUIRED` immediately instead of waiting for the shell-ready timeout. The response includes a localized `errorMessage`, `messageKey`, `messageParams`, `nextAction: "OPEN_AIOPSTERM_AUTH_PROMPT"`, and an `authRequestId`. The SSH session remains in `connecting` while the user completes authentication in aiopsterm.

The external helper exposes auth-management tools:

- `list_auth_requests`: Lists pending or recently completed auth requests without secrets.
- `get_auth_request_status`: Reads one request status.
- `focus_auth_request`: Re-sends/focuses the aiopsterm prompt for a pending request.
- `cancel_auth_request`: Cancels a pending request and normally fails the connection attempt.
- `submit_ssh_auth_response`: Submits password, OTP, or keyboard-interactive responses only when the Export MCP setting allows external Agent submission.

Agent-side submission is disabled by default and controlled by `UserConfig.exportMcp.allowAgentSshAuthSubmit`. When disabled, `submit_ssh_auth_response` returns `AGENT_SIDE_AUTH_DISABLED` with localized `errorMessage`, `messageKey`, and a `settingsTarget: "exportMcp"` hint. When enabled, the tool resolves the pending SSH keyboard-interactive promise and dismisses the renderer prompt so the UI does not wait until its own timeout.

Relay-shell fallback runs local OpenSSH in a PTY after jump-host TCP forwarding fails. In visible terminal sessions, password, dynamic-code, and host-key prompts appear in that terminal stream for the user to answer. In external MCP, the same PTY is headless, so relay-shell only completes when the relay login and nested `ssh <target>` can both proceed without interactive input. A prompt-looking relay output prevents aiopsterm from sending the nested SSH command and the MCP connection eventually fails or times out.

## Tools

The external server currently exposes:

- `list_hosts`: Lists saved non-local host assets without secrets.
- `connect_host`: Opens or reuses a headless external MCP-owned SSH connection.
- `list_connections`: Lists only external MCP-owned connections.
- `disconnect_host`: Closes only an external MCP-owned connection.
- `list_auth_requests`: Lists pending external MCP SSH authentication requests.
- `get_auth_request_status`: Reads one SSH authentication request status.
- `focus_auth_request`: Requests aiopsterm to focus the SSH authentication prompt.
- `cancel_auth_request`: Cancels one pending SSH authentication request.
- `submit_ssh_auth_response`: Submits SSH authentication responses when the Export MCP setting allows it.
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
```

By default, aiopsterm generates a persistent token on first use and stores it under the app user-data directory at `external-codex-mcp/token.json` with best-effort current-user-only permissions. `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN` remains supported as an explicit override for managed deployments; when set, it takes precedence over the app-managed token and requires restart after changes.

`AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET` is optional. If omitted, aiopsterm creates a stable socket under the app user-data directory: `external-codex-mcp/aiopsterm-external-codex.sock` on Unix-like systems, or `\\.\pipe\aiopsterm-external-codex` on Windows. Startup removes a stale Unix socket file before listening, so client configs installed through Settings continue to work after an aiopsterm restart.

## Settings Installer

The user-facing entry is `Settings -> Export MCP`. It exposes the same helper as an installable external MCP server named `aiopsterm_hosts`.

Built-in installers use the external client's official CLI rather than hand-editing client config files:

```bash
codex mcp remove aiopsterm_hosts
codex mcp add aiopsterm_hosts \
  --env AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=/path/to/aiopsterm-external-codex.sock \
  --env AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=<current-aiopsterm-token> \
  --env ELECTRON_RUN_AS_NODE=1 \
  -- /path/to/aiopsterm /path/to/aiopsterm-external-codex-mcp.js
```

```bash
claude mcp remove -s user aiopsterm_hosts
claude mcp add -s user aiopsterm_hosts \
  -e AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET=/path/to/aiopsterm-external-codex.sock \
  -e AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN=<current-aiopsterm-token> \
  -e ELECTRON_RUN_AS_NODE=1 \
  -- /path/to/aiopsterm /path/to/aiopsterm-external-codex-mcp.js
```

The installer resolves the current token in the main process and passes it to the external client's official CLI. Status detection treats a stale socket path or stale token as a conflict so the page can prompt the user to reinstall.

For clients without a supported installer, the settings page provides copyable stdio JSON and command configs. The renderer preview intentionally contains a token placeholder, but the copy action is handled by the main process and writes the complete config, including the current token, to the system clipboard.

The external stdio MCP script needs the socket path and token. A generic JSON shape is:

```json
{
  "mcpServers": {
    "aiopsterm_hosts": {
      "type": "stdio",
      "command": "/path/to/aiopsterm",
      "args": ["/path/to/resources/aiopsterm-external-codex-mcp.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET": "/path/to/aiopsterm-external-codex.sock",
        "AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN": "<current-aiopsterm-token>"
      }
    }
  }
}
```

Regenerating the app-managed token invalidates already installed or copied external Agent configs. Codex / Claude Code must be reinstalled through the settings page, and other Agents must receive a freshly copied config. If `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN` is set, the app-managed token cannot be rotated until that override is removed and aiopsterm is restarted.

For packaged builds, the script is copied to packaged resources as `aiopsterm-external-codex-mcp.js`, and clients launch it through aiopsterm's packaged Electron/Node runtime with `ELECTRON_RUN_AS_NODE=1`. AppImage installs should use the original `APPIMAGE` executable path, not the temporary `/tmp/.mount_*` path.

## Safety Model

The embedded MCP can rely on visible terminal context because the user sees the selected terminal and Codex approval mode is configured by the embedded Codex session.

The external MCP is different: it is a headless host gateway for an external Codex process. It therefore relies on:

- an explicit opt-in environment flag
- a shared token on a local socket request, generated and persisted by aiopsterm unless explicitly overridden by environment
- a stable socket path as service discovery only, not as authentication
- no secret exposure in host listing or connection snapshots
- SSH password/MFA entry stays in aiopsterm by default; external Agent submission requires the explicit Export MCP setting
- external Codex MCP tool approval for execution tools
- destructive tool annotations on `run_command` and `disconnect_host`
- destructive tool annotations on `clear_ai_session`
- bounded output and timeout caps for command/file/search operations
- approval aliases that route through the existing managed AI decision backend and respect per-session capabilities

Do not reuse external MCP connection ids for UI terminals, and do not register external MCP sessions with `codexTerminalBridge.ts`.
