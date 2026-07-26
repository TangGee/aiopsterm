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

Open **① Export MCP**, manage the local gateway and token at **②**, and install the first independent capability card at **③**. The other two server cards follow on the same page.

**Settings -> 导出 MCP (Export MCP)** splits aiopsterm capabilities into three independent MCP servers for hosts and SSH, managed AI sessions, and read-only database access, so external Codex, Claude Code, and similar agents can install only what they need:

| Server | Typical scenario | Capability boundary |
| --- | --- | --- |
| `aiopsterm_hosts` | Reuse saved hosts from an external agent, open headless SSH connections, and inspect remote files | Host listing, connect/disconnect, authentication requests, bounded commands, file reads, glob, and grep; never returns passwords, private keys, or tokens |
| `aiopsterm_ai_sessions` | See where another coding agent is blocked and return the operator to its terminal | Sessions, approvals/questions/plans, events and notifications, focus, mark, and clear; blocking Claude hooks can receive replies, while native Codex prompts must be completed in the Codex terminal |
| `aiopsterm_databases` | Let a trusted external agent inspect saved schemas and bounded data samples | Redacted connections, catalog search, table metadata/DDL, structured filters and paging; no arbitrary SQL, and external database reads are off by default |

Installation flow:

1. Confirm that the local gateway is enabled and generate a token for the target agent.
2. Install only the capability cards required for the task. An uninstalled server contributes no tool schemas.
3. For database work, also enable **Allow external Agents to read databases**; non-SQLite connections normally need to be open in Database Workspace.
4. Reload the external agent's MCP list and verify it with one read-only call.

The three servers share the local socket, bundled runtime, and current token, while publishing fully disjoint tool lists:

- **Regenerate Token** immediately invalidates the old token, so running external agents must reload their configuration.
- Helper scripts run through aiopsterm's bundled runtime (`ELECTRON_RUN_AS_NODE=1 <aiopsterm-executable> <helper.js>`) — **no system Node.js needed**.
- Database tools go through the separate Export MCP gateway, resolving process-scoped random handles to saved connections inside the main process — external agents never see a second DSN or password.
- Database handles change after an app restart. External agents must list connections again instead of persisting a handle.

> Best practice: give the token only to a trusted local agent and regenerate it on any suspicion of leakage. Host commands remain bounded by connection and authentication rules; database access stays read-only; AI-session tools do not close the owning terminal or kill the agent process.
