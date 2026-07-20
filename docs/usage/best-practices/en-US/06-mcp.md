# MCP Integration Best Practices

aiopsterm's MCP story has two directions: **consuming third-party MCP servers** for the internal Agent, and **exporting** aiopsterm's own capabilities to external coding agents.

## Configuring Third-Party MCP Servers

![Host Agent settings](../images/settings-hostagent.png)

Open **① Settings -> 主机Agent (Host Agent)**. The **② sub-tabs** are `对话与主机` (Conversation & Hosts), `MCP`, `Skills`, and `规则` (Rules).

![MCP settings](../images/settings-mcp.png)

On the **① MCP sub-tab**:

- **② Add Server** opens the JSON editor for `setting/mcp_settings.json` under the app user-data directory.
- **③ Server and tool list** — after main-process discovery (`initialize` → `tools/list` → `resources/list`), each server's tools and resources appear here; tool rows expand to show parameters and a per-tool Auto Approve switch.

`stdio` and `streamableHttp` examples:

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "timeout": 10
    },
    "remote-tools": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

Practical rules:

- Omitted `type`: `url` without `command` is treated as `streamableHttp`; aliases `http`, `streamable_http`, `streamable-http` are normalized on save; both `command` and `url` without an explicit type keeps the safer stdio interpretation.
- A server without a valid backend `connected` status displays `disconnected`, and its Run/Read actions stay blocked — being present in JSON does not mean connected.
- Legacy `sse` servers use the same shape with `"type": "sse"`.
- The seeded `ops-inventory` name is a dev/test example; if it lingers in a local config without the command installed it fails with ENOENT and can simply be deleted.

> Security boundary: the Agent can only read exact resource URIs already listed on an enabled server, and every read requires an explicit click on its approval card. MCP transport commands, env vars, headers, and credentials are never exposed to the model.

## Exporting MCP To External Agents

![Export MCP](../images/settings-export-mcp.png)

**Settings -> 导出 MCP (Export MCP)** splits aiopsterm capabilities into three independent MCP servers for hosts and SSH, managed AI sessions, and read-only database access, so external Codex, Claude Code, and similar agents can install only what they need:

- The page provides the external Agent MCP installer and token management (`重新生成 Token` regenerates and invalidates the old token).
- The three capability cards install and uninstall independently; an uninstalled server contributes no tool schemas to the Agent context.
- Helper scripts run through aiopsterm's bundled runtime (`ELECTRON_RUN_AS_NODE=1 <aiopsterm-executable> <helper.js>`) — **no system Node.js needed**.
- Database tools go through the separate Export MCP gateway, resolving process-scoped random handles to saved connections inside the main process — external agents never see a second DSN or password.

> Best practice: issue a separate token per external agent and regenerate on any suspicion of leakage. Keep exported capabilities read-only; write operations belong in aiopsterm's internal approval flow.
