# MCP Settings

This page lives under `Settings -> Host Agent -> MCP`. It manages MCP Servers, Tools, and Resources available to aiopsterm's internal Agent.

## Top Actions

- Add Server: Opens the MCP config editor for `mcp_settings.json`.
- Save: Saves the MCP JSON in the editor.
- Close: Closes the MCP config editor.

## MCP Server List

- Expand/collapse: Click a server name to show its tools and resources.
- Status badge: Shows server state, such as connected, disabled, or error.
- Edit: Opens the MCP config editor.
- Delete: Removes the server configuration.
- Enable switch: Enables or disables the server. Disabled servers do not provide tools or resources to the Agent.

## Transport Config

`mcp_settings.json` supports `stdio`, `streamableHttp`, and legacy `sse`. Codex-style configs may omit the transport type: when a server has `url` and no `command`, aiopsterm saves it as `streamableHttp`. Common aliases `http`, `streamable_http`, and `streamable-http` are also normalized to `streamableHttp`.

## Tools

- Tool name: Click to enable or disable the tool.
- Auto Approve: Allows the tool to be auto-approved when policy permits it. High-risk calls still require approval.
- PARAMETERS: Shows parameter names, required markers, and descriptions.
- Argument editor: JSON arguments used for a direct tool test.
- Run: Calls the tool directly and shows result or error.

## Resources

- Resources tab: Shows resources exposed by the server.
- Read: Reads the selected resource and shows returned content or error.

## Filesystem Scope

`@modelcontextprotocol/server-filesystem` only accesses the local filesystem of the process that starts the MCP server. For example, when the configured argument is `/home/tester`, it accesses `/home/tester` on the machine running aiopsterm.

It does not use aiopsterm SSH/SFTP asset connections and does not bind to the active terminal's remote shell. After a manual `relay ssh -> ssh target` hop, filesystem MCP still cannot see files on the final target. Use shell commands in that terminal, or a purpose-built aiopsterm MCP server that explicitly bridges to an asset SFTP channel or terminal session.

MCP settings change the tool set that later Agent requests can use.
