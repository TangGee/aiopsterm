# MCP Servers

aiopsterm stores MCP server configuration in `setting/mcp_settings.json` under the app user-data directory. Open Settings -> Host Agent -> MCP and use Add Server/Edit to open the JSON editor.

New profiles start with an empty MCP config unless the development seed switch `AIOPSTERM_MCP_ENABLE_SEED=1` is set. `NODE_ENV=test` alone does not install sample MCP servers:

```json
{
  "mcpServers": {}
}
```

When the seed switch is enabled, aiopsterm may create development examples such as `filesystem` and `ops-inventory`. `ops-inventory` is a test/demo asset-inventory MCP server name used by aiopsterm tests and local seed data; it is not imported from External reference and is not required by normal usage. If it appears in an existing local config and the `ops-inventory` command is not installed, it will fail with a spawn/ENOENT-style error and can be deleted from `setting/mcp_settings.json`.

## Transport Discovery

MCP servers are discovered by the main process. When the MCP settings page or editor refreshes the server list, aiopsterm opens the configured transport, sends MCP `initialize`, then requests `tools/list` and `resources/list`. The renderer only displays the backend-discovered tools and resources.

If a server comes only from the JSON config or the backend returns a malformed/missing runtime status, the renderer keeps it `disconnected` rather than assuming it is connected. Run and Read actions stay blocked until the backend returns a valid `connected` status for that server.

`stdio` example:

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "timeout": 10,
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

`streamableHttp` example:

```json
{
  "mcpServers": {
    "remote-tools": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "timeout": 10,
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      }
    }
  }
}
```

aiopsterm also accepts Codex-style remote MCP configs that omit `type`: when a server has `url` and no `command`, it is treated as `streamableHttp`. Common aliases `http`, `streamable_http`, and `streamable-http` are normalized to `streamableHttp` when the config is saved. If both `command` and `url` are present without an explicit supported `type`, aiopsterm keeps the safer stdio interpretation.

Legacy `sse` servers use the same `url`, `timeout`, and `headers` shape with `"type": "sse"`.

Per-tool enabled state is stored separately by aiopsterm, so editing a server command does not force disabled tools back on.

## Filesystem Scope

`@modelcontextprotocol/server-filesystem` works on the local filesystem of the process that starts it. In aiopsterm, that means the app host running the MCP server, for example `/home/tlinux` when the configured argument is `/home/tlinux`.

It does not use aiopsterm's SSH/SFTP asset connections, does not attach to the active terminal session, and does not follow a manual `relay ssh -> ssh target` chain. For files on a relay-connected remote shell, use terminal commands in that shell, or a purpose-built aiopsterm MCP server that explicitly bridges to a known asset SFTP channel or terminal session.

## Tool Auto Approve

Settings -> Host Agent -> MCP tool rows include an Auto Approve switch. The switch writes the tool name to the server's `autoApprove` array in `setting/mcp_settings.json` through the preload/main MCP config bridge, then refreshes the visible tool row from the backend-returned MCP snapshot.

Example:

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "autoApprove": ["read_status"]
    }
  }
}
```

The renderer does not flip Auto Approve locally before the backend confirms the write. Server enable/disable, server delete, tool enable/disable, and Auto Approve changes return a backend MCP snapshot and are accepted only after that mutation snapshot plus the refreshed backend snapshot match the requested server/tool state. Missing bridges, failed writes, stale refresh snapshots, request-mismatched snapshots, or malformed successful envelopes preserve the last backend-confirmed MCP rows and show an error. The stored flag is available for agent/tool approval policy; the Settings Run button remains an explicit user action.

AI chat also consumes the same stored flag. When a configured model returns a External reference-style `<use_mcp_tool>` block, the main process parses the requested server, tool, and JSON arguments. If the discovered tool is not Auto Approved, the assistant message becomes an `mcp_tool_call` approval card. Approve, Reject, and Auto Approve actions go through `window.aiops.approveAiMcpToolCall()` or `rejectAiMcpToolCall()`; the backend reads the saved conversation message, executes the tool only after approval, persists the updated message snapshot, and returns the result for rendering. If the tool is already Auto Approved, the backend executes it directly and returns a command-output message. The renderer never fabricates MCP approval state or tool output.

## Tool Calls And Resource Reads

The main process now exposes real runtime operations for discovered `stdio`, `streamableHttp`, and legacy `sse` servers through `window.aiops.callMcpTool(serverName, toolName, args)` and `window.aiops.readMcpResource(serverName, uri)`. The backend opens and initializes a transport client for the configured server, reuses that initialized operation client for later matching tool/resource requests, calls `tools/call` or `resources/read`, and returns the server response in an `ok` envelope. Runtime clients are closed when MCP config changes, when the app quits, or after an operation failure so the next request reconnects from the latest config.

Settings -> Host Agent -> MCP also exposes those operations directly on discovered server cards. A tool row accepts a JSON object argument draft and the Run button sends that exact object to the preload bridge. A resource row exposes Read for its discovered URI. The result preview is rendered only from the backend returned `content` or `contents` payload; invalid JSON arguments, disabled servers/tools, missing bridges, malformed success envelopes, or request-mismatched responses fail closed and show an error instead of local sample output.

Disabled servers, disabled tools, missing servers, invalid URLs, connection failures, invalid config files, command failures, HTTP status failures, and MCP protocol errors return structured `ok: false` results. Renderer code should display those backend results and must not synthesize MCP output locally.
