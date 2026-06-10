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

## Unsupported Transports

`sse` and `streamableHttp` entries are accepted in the config file but currently fail closed with an unsupported-transport status. They do not create renderer-side tools or resources.
