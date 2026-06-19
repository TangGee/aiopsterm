# External Codex MCP Host Gateway

aiopsterm exposes two Codex-facing MCP boundaries:

- Embedded Codex MCP: `resources/codex-aiopsterm-mcp.js` talks to `src/main/backend/codexTerminalBridge.ts`. It is bound to the selected visible terminal tab.
- External Codex MCP: `resources/aiopsterm-external-codex-mcp.js` talks to `src/main/backend/externalCodexMcpBridge.ts`. It is a headless host gateway for an external Codex process and is not bound to any visible terminal tab.

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
- `focus_ai_session`: Requests aiopsterm to open the AI session manager and focus the owning visible terminal when it exists.
- `reply_ai_session`: Sends an allow/deny/reply/handled decision through the managed session backend.
- `clear_ai_session`: Removes a managed AI session record without killing the owning terminal or agent process.

`list_hosts` returns identifiers, host metadata, tags, proxy/jump-host labels, and auth method labels. It does not return passwords, private keys, passphrases, or token material.

`list_ai_sessions` returns non-secret routing fields such as source, session id, title, summary, state, cwd, panel id, terminal session id, transcript path, process ids, and a compact recent timeline when requested. It does not return full raw hook payloads.

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

Do not reuse external MCP connection ids for UI terminals, and do not register external MCP sessions with `codexTerminalBridge.ts`.
