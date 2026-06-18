# MCP Settings

This page manages MCP Servers, Tools, and Resources available to the Agent.

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

## Tools

- Tool name: Click to enable or disable the tool.
- Auto Approve: Allows the tool to be auto-approved when policy permits it. High-risk calls still require approval.
- PARAMETERS: Shows parameter names, required markers, and descriptions.
- Argument editor: JSON arguments used for a direct tool test.
- Run: Calls the tool directly and shows result or error.

## Resources

- Resources tab: Shows resources exposed by the server.
- Read: Reads the selected resource and shows returned content or error.

MCP settings change the tool set that later Agent requests can use.
