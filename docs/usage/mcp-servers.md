# MCP Servers

aiopsterm stores MCP server configuration in `setting/mcp_settings.json` under the app user-data directory. Open Settings -> MCP and use Add Server/Edit to open the JSON editor.

New non-test profiles start with an empty MCP config:

```json
{
  "mcpServers": {}
}
```

## Stdio Discovery

`stdio` servers are discovered by the main process. When the MCP settings page or editor refreshes the server list, aiopsterm starts the configured command, sends MCP `initialize`, then requests `tools/list` and `resources/list`. The renderer only displays the backend-discovered tools and resources.

Example:

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

Per-tool enabled state is stored separately by aiopsterm, so editing a server command does not force disabled tools back on.

## Tool Auto Approve

Settings -> MCP tool rows include an Auto Approve switch. The switch writes the tool name to the server's `autoApprove` array in `setting/mcp_settings.json` through the preload/main MCP config bridge, then refreshes the visible tool row from the backend-returned MCP snapshot.

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

The renderer does not flip Auto Approve locally before the backend confirms the write. Missing bridges, failed writes, or malformed successful envelopes preserve the last backend-confirmed MCP rows and show an error. The stored flag is available for agent/tool approval policy; the Settings Run button remains an explicit user action.

## Tool Calls And Resource Reads

The main process now exposes real runtime operations for discovered `stdio` servers through `window.aiops.callMcpTool(serverName, toolName, args)` and `window.aiops.readMcpResource(serverName, uri)`. Each operation starts the configured MCP server command, sends MCP `initialize`, calls `tools/call` or `resources/read`, returns the server response in an `ok` envelope, and closes the process.

Settings -> MCP also exposes those operations directly on discovered server cards. A tool row accepts a JSON object argument draft and the Run button sends that exact object to the preload bridge. A resource row exposes Read for its discovered URI. The result preview is rendered only from the backend returned `content` or `contents` payload; invalid JSON arguments, disabled servers/tools, missing bridges, malformed success envelopes, or request-mismatched responses fail closed and show an error instead of local sample output.

Disabled servers, disabled tools, missing servers, unsupported transports, invalid config files, command failures, and MCP protocol errors return structured `ok: false` results. Renderer code should display those backend results and must not synthesize MCP output locally.

## Unsupported Transports

`sse` and `streamableHttp` entries are accepted in the config file but currently fail closed with an unsupported-transport status for discovery, tool calls, and resource reads. They do not create renderer-side tools or resources.
