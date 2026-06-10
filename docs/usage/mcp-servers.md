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

## Tool Calls And Resource Reads

The main process now exposes real runtime operations for discovered `stdio` servers through `window.aiops.callMcpTool(serverName, toolName, args)` and `window.aiops.readMcpResource(serverName, uri)`. Each operation starts the configured MCP server command, sends MCP `initialize`, calls `tools/call` or `resources/read`, returns the server response in an `ok` envelope, and closes the process.

Disabled servers, disabled tools, missing servers, unsupported transports, invalid config files, command failures, and MCP protocol errors return structured `ok: false` results. Renderer code should display those backend results and must not synthesize MCP output locally.

## Unsupported Transports

`sse` and `streamableHttp` entries are accepted in the config file but currently fail closed with an unsupported-transport status for discovery, tool calls, and resource reads. They do not create renderer-side tools or resources.
