# Export MCP

This page lives under `Settings -> Export MCP`. It exposes aiopsterm host connections, sessions, and explicitly authorized read-only database capabilities as an external MCP server. External Codex, Claude Code, or another MCP-capable Agent can use this server to call the aiopsterm gateway, session, and tool interfaces.

## Prerequisites

Export MCP is controlled by aiopsterm startup environment variables:

```bash
export AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1
```

By default, aiopsterm generates the token on first use and stores it at `external-codex-mcp/token.json` under the app data directory. The file mode is best-effort restricted to the current user. `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN` can still be used as an explicit override; restart aiopsterm after setting it, and the settings page's `Regenerate Token` action will not override that environment variable.

`AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET` is optional. When omitted, aiopsterm creates a stable socket under the app data directory: `external-codex-mcp/aiopsterm-external-codex.sock` on Unix-like systems, or `\\.\pipe\aiopsterm-external-codex` on Windows. Restart aiopsterm after changing these variables.

## SSH Authentication

Export MCP `connect_host` is a headless connection, but it now reuses aiopsterm's SSH authentication prompt. The target host first tries non-interactive authentication through saved passwords, private keys, Keychain entries, SSH Agent, or authenticated connection pools in the current app process. If direct SSH, a standard jump host, or the target host requires live SSH password, OTP, or keyboard-interactive input, MCP returns `SSH_AUTH_REQUIRED` and the localized `errorMessage` tells the user to complete authentication in aiopsterm.

External Agents can call `list_auth_requests`, `get_auth_request_status`, and `focus_auth_request` to inspect or focus the prompt. By default, passwords and verification codes are still entered by the user in aiopsterm. The external Agent only receives the request id, target host, authentication type, and localized guidance; it does not receive secrets.

If you trust the local external Agent, enable `Allow external Agents to submit SSH authentication` on this page. Then the Agent can call `submit_ssh_auth_response` to submit passwords, verification codes, or keyboard-interactive responses. When the setting is off, that tool returns a localized error explaining that the capability can be enabled in `Settings -> Export MCP`, or the user can complete authentication in aiopsterm.

Relay-shell followed by a second `ssh` still exposes text prompts rather than structured SSH authentication events. It only works when both the relay login and nested target SSH need no interactive input. Use a visible aiopsterm terminal for relay flows that require dynamic codes, passwords, or host-key confirmation.

## Database Read Permission

Database MCP tools are discovered with `aiopsterm_hosts`, but database access is disabled by default. External Agents can call these tools only after `Allow external Agents to read databases` is enabled on this page:

- `list_database_connections`
- `search_database_objects`
- `describe_database_table`
- `get_database_table_ddl`
- `query_database_table`

While disabled, calls return `DB_MCP_DATABASE_READ_DISABLED` without reading the catalog or a connection. Connection listings expose a process-scoped random handle and generated label; they omit the saved id, user-defined name, host, port, username, URL, file path, proxy settings, and password. Handles change after aiopsterm restarts and must be rediscovered. DDL and table data reads also require non-SQLite connections to be open in the Database workspace.

The first phase does not expose arbitrary SQL or writes. `query_database_table` accepts base tables only, bounded scalar column projections, catalog-validated structured filters, sorting, and pagination, with at most 100 rows per page. Views and unbounded LOB/TEXT/JSON/collection columns are rejected or omitted; DDL and total serialized response size are bounded as well. Strict data queries are supported for the relational drivers and SQLite. ClickHouse and Presto cannot hold a portable table-identity lock across HTTP requests, so their MCP data query fails closed while catalog, describe, and redacted DDL tools remain available. This permission can still expose database schemas and returned table data to the external Agent, so enable it only for a trusted local Agent.

## Why A Token Is Required

Export MCP is not a simple status-reading endpoint. After an external Agent connects, it can call aiopsterm host gateway, session, and tool interfaces, so the stable socket path is only a service locator and must not be treated as authentication.

The token proves that the caller is an authorized external MCP client. Even when the socket is local, other processes under the same user can try to connect. The installer writes the current token into Codex or Claude Code MCP environment variables.

Manual copy writes the complete config to the system clipboard, including the current token. After the user explicitly copies and pastes that config into an external Agent, that copy is controlled by the user's local environment; paste it only into trusted Agents.

## Built-In Installers

The built-in installer detects local CLI and config state, and only manages the `aiopsterm_hosts` MCP server entry.

- Codex: runs `codex mcp remove aiopsterm_hosts`, then `codex mcp add aiopsterm_hosts --env ... -- <aiopsterm-runtime> <helper>`, with `ELECTRON_RUN_AS_NODE=1`.
- Claude Code: runs `claude mcp remove -s user aiopsterm_hosts`, then `claude mcp add -s user aiopsterm_hosts -e ... -- <aiopsterm-runtime> <helper>`, with `ELECTRON_RUN_AS_NODE=1`.

The install buttons do not hand-edit Codex or Claude Code config files. Config files are only read for status detection and conflict warnings.

If the page warns that `aiopsterm_hosts` already exists but does not match the current Export MCP settings, the client likely has an older process-id socket path or a stale token. Reinstall from this page to refresh it to the current stable socket and token.

`Regenerate Token` immediately invalidates installed or copied external Agent configs. Reinstall Codex / Claude Code, and copy fresh config for other Agents.

## Manual Config For Other Agents

Less common Agents may not have a stable MCP CLI. Use the `Manual Config For Other Agents` section:

- `Copy JSON Template`: for Agents that support `mcpServers` JSON config.
- `Copy stdio Command Template`: for Agents that let you enter stdio command/env manually.

The page preview hides the token with a placeholder, but the copy buttons write the complete config to the clipboard, including the current token. Copy again after regenerating the token.

If `Allow external Agents to submit SSH authentication` is enabled, manually configured Agents also receive the `submit_ssh_auth_response` tool. Paste token-bearing configs only into trusted Agents, because that Agent can submit authentication responses you give it.

## Status

- Service: Whether the export bridge is enabled and listening.
- Token: Whether the current process has a usable token. Install buttons are disabled when it is missing.
- Socket: Local socket path used by the external MCP helper.
- MCP Helper: Path to the `aiopsterm-external-codex-mcp.js` script started by external clients.
- JS Runtime: aiopsterm executable path used to launch the helper, without relying on system `node`.
